/**
 * Очередь задач на PostgreSQL — ТЗ §5.6, роадмап M6, ADR-V3-014.
 *
 * §5.6: «Проверки в режимах "стандарт" и "эксперт" выполняются асинхронно.
 * Интерфейс не блокирует пользователя на время расчёта.»
 *
 * ГЛАВНОЕ СВОЙСТВО — НЕ «ЗАДАЧА ВЫПОЛНИЛАСЬ»
 *
 * Главное — «задача не потерялась и не выполнилась дважды». Проверка стоимостью
 * в часы работы модели, выполненная дважды, — двойной счёт по внешнему контуру.
 * Потерянная — пользователь, ждущий результата, которого никто не считает.
 *
 * ПОЧЕМУ БАЗА, А НЕ ОТДЕЛЬНАЯ ОЧЕРЕДЬ
 *
 * Отдельный Redis добавляет к контуру заказчика ещё одну систему с отдельным
 * резервным копированием, отдельным доступом и отдельной точкой отказа —
 * ради нагрузки, которой здесь нет. PostgreSQL с `FOR UPDATE SKIP LOCKED` даёт
 * ту же гарантию невыдачи одной задачи двум воркерам, а состояние задачи живёт
 * в той же транзакции, что и её результат.
 *
 * ВОССТАНОВЛЕНИЕ — ЭТО ИСТЕЧЕНИЕ АРЕНДЫ, А НЕ ОТДЕЛЬНЫЙ МЕХАНИЗМ
 *
 * Воркер, упавший на середине, не снимет с себя задачу — сообщить об этом ему
 * уже нечем. Поэтому задача принадлежит воркеру не навсегда, а на срок; по
 * истечении её берёт другой. Отдельная «уборка зависших» была бы вторым
 * механизмом, который сам может не работать.
 *
 * ВОЗВРАТ ПО ИСТЕЧЕНИИ СЧИТАЕТСЯ ПОПЫТКОЙ
 *
 * Иначе задача, роняющая воркер, крутится вечно: каждый новый воркер берёт её,
 * падает, счётчик не растёт. Считать такую задачу «просто медленной» значит
 * тратить контур бесконечно.
 *
 * ОТМЕНА ВЫПОЛНЯЮЩЕЙСЯ ЗАДАЧИ — СОГЛАСИЕ, А НЕ КОМАНДА
 *
 * Убить чужой процесс из этого модуля нельзя. Честный ответ — «отмена записана,
 * воркер остановится на ближайшей проверке», а не «отменено». Разница видна
 * пользователю: во втором случае он решит, что расчёт уже не идёт.
 */
import { createHash } from "node:crypto";

import type { Tx } from "@platform/db/prisma.js";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "dead" | "cancelled";

export interface EnqueuedJob {
  readonly id: string;
  readonly status: JobStatus;
  readonly attempts: number;
  /** Задача с таким ключом уже стояла: вернули её, а не завели вторую. */
  readonly deduplicated: boolean;
}

export interface ClaimedJob {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  /** Проверка, к которой относится задача. Исполнитель привязывает к ней артефакт. */
  readonly checkId?: string;
  readonly idempotencyKey: string;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly leaseExpiresAt: Date;
}

export interface CancelOutcome {
  readonly cancelled: boolean;
  /**
   * Задача уже выполнялась. Воркер остановится на ближайшей проверке, а не в
   * момент отмены — и пользователю это сказано.
   */
  readonly wasRunning: boolean;
  readonly reason?: string;
}

/**
 * Отсрочка повтора: минута, четыре, девять…
 *
 * Растёт квадратом номера попытки, а не удвоением: удвоение на пятой попытке
 * даёт полчаса, и задача, которую починили через десять минут, всё равно ждёт.
 */
function retryDelaySeconds(attempts: number): number {
  return 60 * attempts * attempts;
}

export class JobQueue {
  /**
   * Ставит задачу в очередь.
   *
   * Ключ идемпотентности — единственная защита от повторного нажатия «Проверить».
   * Без неё пользователь, не дождавшийся ответа и нажавший ещё раз, получает
   * второй счёт за ту же работу.
   */
  async enqueue(
    tx: Tx,
    input: {
      readonly tenantId: string;
      readonly type: string;
      readonly payload: unknown;
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly checkId?: string;
      readonly maxAttempts?: number;
    },
  ): Promise<EnqueuedJob> {
    const existing = await tx.job.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });

    if (existing !== null) {
      return {
        id: existing.id,
        status: existing.status as JobStatus,
        attempts: existing.attempts,
        deduplicated: true,
      };
    }

    const payloadHash = createHash("sha256")
      .update(JSON.stringify(input.payload), "utf8")
      .digest("hex");

    const created = await tx.job.create({
      data: {
        tenantId: input.tenantId,
        type: input.type,
        payload: input.payload as never,
        payloadHash,
        idempotencyKey: input.idempotencyKey,
        notBefore: input.now,
        ...(input.checkId === undefined ? {} : { checkId: input.checkId }),
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      },
    });

    return {
      id: created.id,
      status: created.status as JobStatus,
      attempts: created.attempts,
      deduplicated: false,
    };
  }

  /**
   * Забирает одну задачу.
   *
   * `FOR UPDATE SKIP LOCKED` — то, ради чего очередь и живёт в базе: два
   * воркера, спросившие одновременно, получат РАЗНЫЕ задачи, а не одну и ту же.
   * Пропускается всё, что занято другим воркером с живой арендой.
   */
  async claim(
    tx: Tx,
    input: { readonly owner: string; readonly now: Date; readonly leaseSeconds: number },
  ): Promise<ClaimedJob | undefined> {
    const expiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000);

    const rows = await tx.$queryRawUnsafe<
      {
        id: string;
        type: string;
        payload: unknown;
        checkId: string | null;
        idempotencyKey: string;
        attempts: number;
      }[]
    >(
      `
      UPDATE "job" SET
        status = 'running',
        "leaseOwner" = $1,
        "leaseExpiresAt" = $2,
        attempts = attempts + 1,
        "updatedAt" = $3
      WHERE id = (
        SELECT id FROM "job"
        WHERE "notBefore" <= $3
          AND (
            status = 'queued'
            -- Возврат после падения воркера: аренда истекла, значит владельца
            -- больше нет. Отдельной «уборки зависших» не нужно.
            OR (status = 'running' AND "leaseExpiresAt" <= $3)
          )
        ORDER BY "notBefore"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, "checkId", "idempotencyKey", attempts
      `,
      input.owner,
      expiresAt,
      input.now,
    );

    const row = rows[0];
    if (row === undefined) return undefined;

    return {
      id: row.id,
      type: row.type,
      payload: row.payload,
      ...(row.checkId === null ? {} : { checkId: row.checkId }),
      idempotencyKey: row.idempotencyKey,
      status: "running",
      attempts: row.attempts,
      leaseExpiresAt: expiresAt,
    };
  }

  /**
   * Продлевает аренду.
   *
   * Продлить может ТОЛЬКО владелец: иначе воркер, чью задачу уже отобрали по
   * истечении, продолжит держать её и приведёт к двойному исполнению.
   */
  async heartbeat(
    tx: Tx,
    jobId: string,
    input: { readonly owner: string; readonly now: Date; readonly leaseSeconds: number },
  ): Promise<boolean> {
    const result = await tx.job.updateMany({
      where: { id: jobId, leaseOwner: input.owner, status: "running" },
      data: {
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseSeconds * 1000),
        updatedAt: input.now,
      },
    });

    return result.count > 0;
  }

  /**
   * Завершает задачу.
   *
   * Отменённая задача НЕ становится выполненной: пользователь видел «отменено»
   * и результата не ждёт. Воркер, дошедший до конца после отмены, не должен
   * переписывать её исход.
   */
  async complete(
    tx: Tx,
    jobId: string,
    input: { readonly owner: string; readonly now: Date },
  ): Promise<boolean> {
    const result = await tx.job.updateMany({
      where: { id: jobId, leaseOwner: input.owner, status: "running" },
      data: { status: "completed", leaseOwner: null, leaseExpiresAt: null, updatedAt: input.now },
    });

    return result.count > 0;
  }

  /**
   * Отмечает неудачу: повтор с отсрочкой либо смерть по исчерпании попыток.
   *
   * Бесконечный повтор — не надёжность, а бесконечная трата внешнего контура на
   * задачу, которая не выполнится.
   */
  async fail(
    tx: Tx,
    jobId: string,
    input: { readonly owner: string; readonly now: Date; readonly error: string },
  ): Promise<JobStatus | undefined> {
    const job = await tx.job.findUnique({ where: { id: jobId } });

    if (job === null || job.leaseOwner !== input.owner || job.status !== "running") {
      return undefined;
    }

    const exhausted = job.attempts >= job.maxAttempts;

    const status: JobStatus = exhausted ? "dead" : "queued";

    // `updateMany` со счётчиком, а не `update`, — тем же приёмом, что `heartbeat`.
    //
    // Чтение выше проверяет условия, но между чтением и записью строка может
    // ИСЧЕЗНУТЬ: `Job` привязан к Проверке каскадом, и удаление Проверки уносит
    // её задачи. `update` в этом окне падает `P2025` и валит весь воркер —
    // процесс умирает из-за того, что строки не стало. Одно выражение с теми же
    // условиями в `where` окна не оставляет.
    const updated = await tx.job.updateMany({
      where: { id: jobId, leaseOwner: input.owner, status: "running" },
      data: {
        status,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: { message: input.error, at: input.now.toISOString() } as never,
        notBefore: exhausted
          ? job.notBefore
          : new Date(input.now.getTime() + retryDelaySeconds(job.attempts) * 1000),
        updatedAt: input.now,
      },
    });

    // Задача ушла из-под нас: аренда потеряна, и это не повод падать.
    return updated.count === 0 ? undefined : status;
  }

  /**
   * Отменяет задачу.
   *
   * Ждущая в очереди отменяется сразу. Выполняющаяся помечается отменённой, но
   * воркер узнаёт об этом лишь на ближайшей проверке — и в ответе это сказано.
   */
  async cancel(
    tx: Tx,
    jobId: string,
    input: { readonly now: Date; readonly reason: string },
  ): Promise<CancelOutcome> {
    const job = await tx.job.findUnique({ where: { id: jobId } });

    if (job === null) {
      return { cancelled: false, wasRunning: false, reason: "задача не найдена" };
    }

    if (job.status === "completed" || job.status === "cancelled" || job.status === "dead") {
      // Завершённое не отменяется: отмена сделанного — это не отмена, а
      // переписывание истории.
      return {
        cancelled: false,
        wasRunning: false,
        reason: `задача уже в состоянии «${job.status}»: отменять нечего`,
      };
    }

    const wasRunning = job.status === "running";

    // См. `fail`: между чтением и записью строка может исчезнуть вместе с
    // Проверкой, и `update` тогда падает `P2025`.
    const updated = await tx.job.updateMany({
      where: { id: jobId, status: { notIn: ["completed", "cancelled", "dead"] } },
      data: {
        status: "cancelled",
        lastError: { message: input.reason, at: input.now.toISOString() } as never,
        updatedAt: input.now,
      },
    });

    if (updated.count === 0) {
      return {
        cancelled: false,
        wasRunning: false,
        reason: "состояние задачи изменилось во время отмены: повторите, чтобы увидеть текущее",
      };
    }

    return {
      cancelled: true,
      wasRunning,
      ...(wasRunning
        ? { reason: "отмена записана; воркер остановится на ближайшей проверке" }
        : {}),
    };
  }

  /**
   * Просил ли кто-нибудь остановить задачу.
   *
   * Воркер обязан спрашивать это между этапами. Долгая задача, не спрашивающая,
   * доведёт до конца работу, которую отменили, — и потратит внешний контур на
   * результат, которого никто не ждёт.
   */
  async cancelRequested(tx: Tx, jobId: string): Promise<boolean> {
    const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true } });

    return job?.status === "cancelled";
  }
}
