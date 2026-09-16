/**
 * Запись хода прогона в базу — веха Д2 плана демо.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * Прогон по семи файлам идёт 36 минут, а ориентир встречи — начать показывать
 * через 20–30. Ускорять конвейер здесь нечем: сорок секунд на обращение к
 * модели умножаются на число агентов и смет. Но показывать по завершении и не
 * требуется: сметчик высказывается на пятой минуте, и его находки уже можно
 * читать. Этот модуль — то, чем они попадают на экран до конца прогона.
 *
 * КАЖДЫЙ ОТЧЁТ — СВОЯ КОРОТКАЯ ТРАНЗАКЦИЯ
 *
 * Сама работа идёт ВНЕ транзакции намеренно (см. `check-executor.ts`): чтение
 * документов и обращения к модели — минуты, и держать на них открытую
 * транзакцию нельзя. Значит и ход прогона обязан писаться отдельными
 * транзакциями, каждая на одно событие. Иначе запись «Людмила высказалась»
 * стала бы видна только вместе с итогом — то есть ровно тогда, когда она уже
 * не нужна.
 *
 * ОТЧЁТ НЕ ИМЕЕТ ПРАВА УРОНИТЬ ПРОГОН
 *
 * Тридцать шесть минут работы, потерянные из-за недоступной на секунду базы, —
 * цена, несоизмеримая с ценностью строки состояния. Поэтому сбой записи здесь
 * ловится, ПЕЧАТАЕТСЯ (молчаливый `catch` уже стоил этому проекту часа
 * разбирательства) и возвращается обходу, который запомнит его в теле
 * результата. Ни одна из трёх частей не лишняя: в журнале видно причину, в
 * теле — что расхождение экрана с фактом объяснимо.
 */
import { Prisma } from "@prisma/client";

import type { CheckProgress } from "@modules/workflow/check-object.js";

import { withTenant, type Db, type Tx } from "../db/prisma.js";

/**
 * Статус прогона агента в базе.
 *
 * «Исполнен» и «отказ» различаются намеренно: агент, который не смог, — это не
 * агент без замечаний. Доска агентов уже различает эти три состояния, и здесь
 * они записываются теми же словами.
 */
export type AgentRunStatus = "выполняется" | "исполнен" | "отказ";

const { DbNull } = Prisma;

/** Этап прогона по предмету агента. Одно место, где связь объявлена. */
const PHASE_OF_SCOPE = {
  документ: "агенты по сметам",
  объект: "объектные агенты",
  синтез: "синтез",
} as const;

async function applyEvent(tx: Tx, checkId: string, tenantId: string, event: CheckProgress): Promise<void> {
  if (event.kind === "этап") {
    await tx.check.update({ where: { id: checkId }, data: { phase: event.phase } });
    return;
  }

  if (event.kind === "обход") {
    // Пройдено ноль, а не «неизвестно»: обход только что перечислил документы,
    // и это проверенный ноль.
    await tx.check.update({
      where: { id: checkId },
      data: { documentsTotal: event.documents, documentsDone: 0 },
    });
    return;
  }

  if (event.kind === "документ") {
    await tx.check.update({
      where: { id: checkId },
      data: { documentsTotal: event.total, documentsDone: event.done },
    });
    return;
  }

  if (event.kind === "агент-начал") {
    // Upsert, а не create: повторная попытка шага не имеет права завести
    // вторую строку того же агента по тому же предмету — иначе доска покажет
    // двух Людмил, и обе будут «правдой».
    const key = { checkId, agentId: event.capability, subject: event.subject };

    await tx.agentRun.upsert({
      where: { checkId_agentId_subject: key },
      create: {
        ...key,
        tenantId,
        stage: PHASE_OF_SCOPE[event.scope],
        scope: event.scope,
        status: "выполняется" satisfies AgentRunStatus,
        startedAt: new Date(),
      },
      update: {
        stage: PHASE_OF_SCOPE[event.scope],
        scope: event.scope,
        status: "выполняется" satisfies AgentRunStatus,
        startedAt: new Date(),
        // Прошлая попытка стирается целиком: её замечания относились к ней, а
        // не к этой. Оставить их значило бы показать находки попытки, которая
        // переигрывается. `DbNull` — именно NULL столбца, а не JSON-значение
        // `null`: у Prisma это два разных стирания, и второе записало бы в
        // поле «замечания» строку «null».
        finishedAt: null,
        verdict: null,
        findings: DbNull,
        questions: DbNull,
        error: DbNull,
      },
    });
    return;
  }

  const { outcome } = event;
  const failed = outcome.error !== undefined;
  const key = { checkId, agentId: outcome.capability ?? "без-агента", subject: outcome.path };

  const said = {
    stage: PHASE_OF_SCOPE[event.scope],
    scope: event.scope,
    status: (failed ? "отказ" : "исполнен") satisfies AgentRunStatus,
    finishedAt: new Date(),
    verdict: outcome.verdict ?? null,
    // Замечания кладутся как их дал агент — вместе с координатой строки, если
    // модель назвала позицию. Пересчитывать их здесь значило бы завести вторую
    // истину рядом с артефактом.
    findings: outcome.findings as never,
    // Открытые вопросы — отдельным списком: это поручения, а не замечания.
    // «Что проверить человеку» должно быть видно во время прогона по той же
    // причине, что и находки: на встрече это читают, не дожидаясь итога.
    questions: (outcome.openQuestions ?? []) as never,
    ...(failed ? { error: { message: outcome.error } as never } : {}),
    // След хода исполнителя (А8) — в столбцы, которые до экипажа стояли пустыми.
    ...(outcome.run === undefined
      ? {}
      : {
          threadId: outcome.run.threadId ?? null,
          provider: outcome.run.provider,
          model: outcome.run.model,
          inputTokens: outcome.run.inputTokens,
          outputTokens: outcome.run.outputTokens,
        }),
  };

  await tx.agentRun.upsert({
    where: { checkId_agentId_subject: key },
    create: { ...key, tenantId, ...said, startedAt: new Date() },
    update: said,
  });
}

/**
 * Собирает порт хода прогона.
 *
 * `checkId` обязателен: ход прогона без прогона записывать некуда. Командная
 * строка порт не передаёт вовсе и работает как раньше — молча.
 */
export function buildProgressReporter(input: {
  readonly db: Db;
  readonly tenantId: string;
  readonly checkId: string;
  /** Куда печатать сбой записи. По умолчанию — поток ошибок процесса. */
  readonly log?: (message: string) => void;
}): (event: CheckProgress) => Promise<void> {
  const log = input.log ?? ((message: string) => console.error(message));

  return async (event: CheckProgress): Promise<void> => {
    try {
      await withTenant(input.db, input.tenantId, (tx) =>
        applyEvent(tx, input.checkId, input.tenantId, event),
      );
    } catch (cause) {
      const message = (cause as Error).message;
      log(`Ход прогона ${input.checkId}: событие «${event.kind}» не записано — ${message}`);
      // Проброс — не отказ от страховки, а её половина: обход ловит это сам и
      // запоминает в `progressLost`. Проглотить здесь значило бы оставить
      // расхождение экрана с фактом без единого следа.
      throw cause;
    }
  };
}
