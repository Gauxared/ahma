/**
 * Постановка Проверки — ОДНА функция для двух обработчиков (spec-demo-stage-1 А2).
 *
 * До экипажа Проверку ставил только `/api/checks`. Галочка «сразу через
 * агентов» рядом с загрузкой означает, что ставить её должен и `/api/uploads` —
 * той же логикой: тот же поиск живой задачи, та же запись, та же очередь, тот
 * же журнал. Две копии постановки разошлись бы на первом же изменении, и одна
 * из кнопок стала бы ставить не то, что другая.
 *
 * ЧТО ТАКОЕ ПОВТОР — воркфлоу И режим. Конвейерный `full-check` и экипаж на
 * том же `full-check` — разные прогоны, и запускать их рядом на одной партии
 * законно: это и есть сравнение путей. Двойное нажатие при этом по-прежнему
 * ловится — та же пара второй раз не ставится.
 */
import type { PrismaClient } from "@prisma/client";

import { withTenant } from "@platform/db/prisma";
import { CHECK_JOB_TYPE } from "@platform/execution/check-job";
import { JobQueue } from "@platform/queue/job-queue";
import { recordAudit } from "@platform/security/audit";

export type CheckModeValue = "express" | "standard" | "agentic" | "codex";

/**
 * Слово формы → воркфлоу и режим записи.
 *
 * `быстрый` — второй воркфлоу (`estimate-only`), остальные — `full-check`:
 * состав ролей один, меняется исполнитель. `агенты` — экипаж на Codex SDK.
 */
export function режимПрогона(режим: string): { readonly workflowId: string; readonly mode: CheckModeValue } {
  const слово = режим.trim();

  if (слово === "быстрый") return { workflowId: "estimate-only", mode: "express" };
  if (слово === "агентный") return { workflowId: "full-check", mode: "agentic" };
  if (слово === "агенты") return { workflowId: "full-check", mode: "codex" };

  return { workflowId: "full-check", mode: "standard" };
}

export type StartOutcome = "повтор" | "в-очередь" | "да";

export async function startCheck(input: {
  readonly db: PrismaClient;
  readonly tenantId: string;
  readonly objectId: string;
  readonly objectCode: string;
  readonly objectPath: string;
  readonly batch: string;
  readonly workflowId: string;
  readonly mode: CheckModeValue;
  readonly actorId: string;
  readonly now: Date;
}): Promise<StartOutcome> {
  const { db, tenantId } = input;

  const живые = await withTenant(db, tenantId, (tx) =>
    tx.job.findMany({
      where: {
        type: CHECK_JOB_TYPE,
        status: { in: ["queued", "running"] },
        check: { object: { code: input.objectCode } },
      },
      select: { check: { select: { workflowId: true, mode: true } } },
    }),
  );

  if (живые.some((job) => job.check?.workflowId === input.workflowId && job.check.mode === input.mode)) {
    return "повтор";
  }

  await withTenant(db, tenantId, async (tx) => {
    const check = await tx.check.create({
      data: {
        tenantId,
        objectId: input.objectId,
        workflowId: input.workflowId,
        mode: input.mode,
        createdBy: input.actorId,
      },
    });

    await new JobQueue().enqueue(tx, {
      tenantId,
      type: CHECK_JOB_TYPE,
      payload: { objectPath: input.objectPath, objectCode: input.objectCode },
      // Ключ уникален по проверке: сама проверка и есть намерение, а защиту от
      // одновременного повтора даёт поиск живой задачи выше.
      idempotencyKey: `check:${check.id}`,
      now: input.now,
      checkId: check.id,
    });

    await recordAudit(tx, tenantId, {
      action: "check.started",
      resourceKind: "check",
      resourceId: check.id,
      actorId: input.actorId,
      reason: `объект ${input.objectCode}, партия ${input.batch}, воркфлоу ${input.workflowId}, режим ${input.mode}`,
    });
  });

  // Воркер один: поставленный вторым начнётся после первого, и сказать
  // «поставлено», умолчав об этом, значило бы обещать быстрый проход через пять
  // минут в момент, когда впереди у него тридцать шесть.
  return живые.length > 0 ? "в-очередь" : "да";
}
