/**
 * Очередь задач на PostgreSQL (v3 ADR-V3-014: без отдельного Redis).
 *
 * ТЗ §5.6 требует асинхронного исполнения с состоянием очереди, уведомлением,
 * сохранением и продолжением после перезапуска без повторной загрузки файлов.
 *
 * Захват идёт через `FOR UPDATE SKIP LOCKED`: несколько воркеров разбирают
 * очередь без блокировок друг о друга. Аренда с истечением возвращает задачу
 * в очередь, если воркер умер, не сняв её.
 *
 * ВАЖНО про изоляцию: очередь — платформенная инфраструктура, воркер разбирает
 * задачи всех арендаторов. Поэтому репозиторий работает через соединение
 * ВЛАДЕЛЬЦА, а сама работа по задаче выполняется уже в контексте арендатора
 * через `withTenant` (ADR-R-015). Смешивать эти два соединения нельзя.
 */
import { createHash, randomUUID } from "node:crypto";

import type { Client, Pool } from "pg";

export type Queryable = Pick<Client | Pool, "query">;

export interface EnqueueInput {
  readonly tenantId: string;
  readonly checkId?: string;
  readonly type: string;
  readonly payload: unknown;
  /** Ключ идемпотентности: повторная постановка той же задачи не создаёт дубля. */
  readonly idempotencyKey?: string;
  readonly notBefore?: Date;
  readonly maxAttempts?: number;
}

export interface ClaimedJob {
  readonly id: string;
  readonly tenantId: string;
  readonly checkId: string | null;
  readonly type: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
}

function payloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload) ?? "null", "utf8").digest("hex");
}

export class JobRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Ставит задачу в очередь. При совпадении ключа идемпотентности возвращает
   * существующую задачу вместо создания второй: повтор доставки не должен
   * порождать дублирующих побочных эффектов.
   */
  async enqueue(input: EnqueueInput): Promise<{ id: string; created: boolean }> {
    const hash = payloadHash(input.payload);
    const key = input.idempotencyKey ?? `${input.type}:${input.tenantId}:${hash}`;

    const result = await this.db.query<{ id: string; created: boolean }>(
      `INSERT INTO job (id, "tenantId", "checkId", type, payload, "payloadHash", "idempotencyKey",
                        status, "notBefore", "maxAttempts", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'queued', COALESCE($8, now()), COALESCE($9, 5), now())
       ON CONFLICT ("idempotencyKey") DO NOTHING
       RETURNING id, true AS created`,
      [
        randomUUID(),
        input.tenantId,
        input.checkId ?? null,
        input.type,
        JSON.stringify(input.payload),
        hash,
        key,
        input.notBefore ?? null,
        input.maxAttempts ?? null,
      ],
    );

    const inserted = result.rows[0];
    if (inserted !== undefined) {
      return { id: inserted.id, created: true };
    }

    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM job WHERE "idempotencyKey" = $1`,
      [key],
    );

    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error(`Задача с ключом ${key} не создана и не найдена`);
    }

    return { id: row.id, created: false };
  }

  /**
   * Захватывает одну готовую задачу. Готовой считается очередная, чей `notBefore`
   * наступил, либо запущенная с истёкшей арендой — её воркер не пережил.
   *
   * `types` ограничивает выборку: воркер может обслуживать не весь набор типов
   * (например, отдельный воркер под тяжёлый разбор документов).
   */
  async claim(owner: string, leaseMs: number, types?: readonly string[]): Promise<ClaimedJob | undefined> {
    const result = await this.db.query<ClaimedJob>(
      `UPDATE job SET
         status = 'running',
         attempts = attempts + 1,
         "leaseOwner" = $1,
         "leaseExpiresAt" = now() + make_interval(secs => $2::double precision / 1000),
         "updatedAt" = now()
       WHERE id = (
         SELECT id FROM job
         WHERE ((status = 'queued' AND "notBefore" <= now())
             OR (status = 'running' AND "leaseExpiresAt" < now()))
           AND ($3::text[] IS NULL OR type = ANY($3::text[]))
         ORDER BY "notBefore"
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, "tenantId", "checkId", type, payload, attempts, "maxAttempts"`,
      [owner, leaseMs, types ?? null],
    );

    return result.rows[0];
  }

  /** Продлевает аренду работающей задачи. Возвращает false, если аренду перехватили. */
  async heartbeat(jobId: string, owner: string, leaseMs: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE job SET
         "leaseExpiresAt" = now() + make_interval(secs => $3::double precision / 1000),
         "updatedAt" = now()
       WHERE id = $1 AND "leaseOwner" = $2 AND status = 'running'`,
      [jobId, owner, leaseMs],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async complete(jobId: string, owner: string): Promise<void> {
    await this.db.query(
      `UPDATE job SET status = 'completed', "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
       WHERE id = $1 AND "leaseOwner" = $2`,
      [jobId, owner],
    );
  }

  /**
   * Возвращает задачу в очередь с отсрочкой либо переводит в dead-letter, когда
   * бюджет попыток исчерпан. Ошибка сохраняется: молчаливая потеря задачи
   * недопустима при глубине журнала 12 месяцев (ТЗ §11).
   */
  async fail(jobId: string, owner: string, error: unknown, retryDelayMs: number): Promise<"retry" | "dead"> {
    const result = await this.db.query<{ status: string }>(
      `UPDATE job SET
         status = CASE WHEN attempts >= "maxAttempts" THEN 'dead'::"JobStatus" ELSE 'queued'::"JobStatus" END,
         "notBefore" = now() + make_interval(secs => $3::double precision / 1000),
         "lastError" = $4::jsonb,
         "leaseOwner" = NULL,
         "leaseExpiresAt" = NULL,
         "updatedAt" = now()
       WHERE id = $1 AND "leaseOwner" = $2
       RETURNING status`,
      [jobId, owner, retryDelayMs, JSON.stringify({ message: String(error) })],
    );

    return result.rows[0]?.status === "dead" ? "dead" : "retry";
  }

  async cancel(jobId: string): Promise<void> {
    await this.db.query(
      `UPDATE job SET status = 'cancelled', "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [jobId],
    );
  }
}
