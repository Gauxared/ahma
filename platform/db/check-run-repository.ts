/**
 * Состояние прогона Проверки (M2, §5.6: воркер переживает рестарт).
 *
 * Что именно должно пережить рестарт и почему:
 *
 *  · **состояние предметов** — ВОР, потолки, аудит договора со своими статусами
 *    и счётчиком возвратов. Без них перезапущенный воркер не знает, можно ли
 *    Ванычу считать финмодель, и либо спросит заново, либо посчитает без права;
 *  · **исполненные шаги** — иначе рестарт стоит столько же, сколько прогон с
 *    нуля, и обещание «без повторной загрузки» не выполняется.
 *
 * ЭСКАЛАЦИЯ — ПАУЗА, А НЕ КОНЕЦ. Прогон со статусом `awaiting_human`
 * возобновляем: цикл возврата исчерпан, решение принимает человек, и после
 * решения работа обязана продолжиться с того же места. Завершённый прогон
 * (`completed`, `failed`, `cancelled`), наоборот, не возобновляется: повтор
 * завершённой Проверки — это новый прогон со своим отпечатком входов.
 *
 * ДВА РУБЕЖА, И ОДНОГО RLS ЗДЕСЬ НЕ ХВАТАЕТ (ADR-R-015, R-016).
 *
 * Каждый метод принимает транзакцию из `withTenant`, и политика отсекает чужие
 * строки при ЧТЕНИИ. Но на записи остаётся дыра, которую нашёл тест: проверка
 * внешнего ключа выполняется В ОБХОД RLS. Арендатор Б может завести предмет со
 * своим `tenantId`, сославшись на прогон арендатора А: ссылка существует
 * физически, `WITH CHECK` проходит по своему же арендатору, и запись удаётся.
 *
 * Арендатор А такую строку не увидит — у неё чужой `tenantId`, — но межарендная
 * запись состоялась. Поэтому владение прогоном проверяется и в коде: это тот
 * самый первый рубеж, который ADR-R-016 требует держать поверх RLS.
 */
import type { Tx } from "./prisma.js";

/** Статусы прогона из схемы. Возобновляемы только первые два. */
export type RunStatus = "queued" | "running" | "awaiting_human" | "completed" | "cancelled" | "failed";

const RESUMABLE: ReadonlySet<RunStatus> = new Set<RunStatus>(["queued", "running", "awaiting_human"]);

export interface SubjectRecord {
  readonly id: string;
  readonly status: string;
  readonly returnedCount: number;
  readonly reason?: string;
}

export interface StartedRun {
  readonly id: string;
  readonly status: RunStatus;
}

export interface ResumedRun {
  readonly id: string;
  readonly workflowId: string;
  readonly objectId: string;
  readonly status: RunStatus;
  readonly subjects: ReadonlyMap<string, SubjectRecord>;
  /** Ключи вида `такт-1/людмила`. Только исполненные шаги. */
  readonly completedSteps: readonly string[];
  /** Сколько раз шаг уже пробовали. Нужен, чтобы цикл возврата пережил рестарт. */
  readonly attempts: ReadonlyMap<string, number>;
}

export interface StartRun {
  readonly tenantId: string;
  readonly objectId: string;
  readonly workflowId: string;
  readonly createdBy: string;
  readonly mode?: "standard" | "expert";
}

/**
 * Отказ, а не тихая запись мимо: прогон, невидимый в текущем контексте
 * арендатора, для записи не существует. Без этой проверки чужой арендатор
 * привяжет свои строки к прогону по внешнему ключу — см. шапку модуля.
 */
async function assertOwned(tx: Tx, runId: string): Promise<void> {
  const owned = await tx.check.findFirst({ where: { id: runId }, select: { id: true } });

  if (owned === null) {
    throw new Error(`Прогон ${runId} недоступен в контексте текущего арендатора`);
  }
}

/** Ключ шага: такт и агент. Пара уникальна внутри воркфлоу. */
export function stepKey(stage: string, agent: string): string {
  return `${stage}/${agent}`;
}

export class CheckRunRepository {
  async start(tx: Tx, input: StartRun): Promise<StartedRun> {
    const check = await tx.check.create({
      data: {
        tenantId: input.tenantId,
        objectId: input.objectId,
        workflowId: input.workflowId,
        mode: input.mode ?? "standard",
        status: "running",
        createdBy: input.createdBy,
        startedAt: new Date(),
      },
      select: { id: true, status: true },
    });

    return { id: check.id, status: check.status as RunStatus };
  }

  /**
   * Записывает состояние предметов.
   *
   * Предмет один на прогон: два ВОР в одном прогоне — это потерянная история
   * возвратов и неизвестно какой из них действующий. Схема держит это
   * уникальным индексом, здесь — upsert по той же паре.
   */
  async saveSubjects(
    tx: Tx,
    tenantId: string,
    runId: string,
    subjects: readonly SubjectRecord[],
  ): Promise<void> {
    await assertOwned(tx, runId);

    for (const subject of subjects) {
      await tx.gateSubject.upsert({
        where: { checkId_subjectId: { checkId: runId, subjectId: subject.id } },
        create: {
          tenantId,
          checkId: runId,
          subjectId: subject.id,
          status: subject.status,
          returnedCount: subject.returnedCount,
          ...(subject.reason === undefined ? {} : { reason: subject.reason }),
        },
        update: {
          status: subject.status,
          returnedCount: subject.returnedCount,
          ...(subject.reason === undefined ? {} : { reason: subject.reason }),
        },
      });
    }
  }

  /**
   * Отмечает шаг исполненным.
   *
   * Пишется в отдельную таблицу, а НЕ в журнал аудита. Журнал — неизменяемый
   * след действий; это состояние прогона, по которому воркер решает, что
   * делать дальше. Смешать их значит лишиться права чистить журнал: вместе с
   * историей уйдёт возможность продолжить работу.
   *
   * Повтор шага обновляет запись и наращивает счётчик попыток, а не заводит
   * вторую строку: цикл возврата должен быть виден числом, а не длиной списка.
   */
  async markStepDone(
    tx: Tx,
    tenantId: string,
    runId: string,
    stage: string,
    agent: string,
    status: string = "исполнен",
  ): Promise<void> {
    await assertOwned(tx, runId);

    await tx.checkStep.upsert({
      where: { checkId_stage_agent: { checkId: runId, stage, agent } },
      create: { tenantId, checkId: runId, stage, agent, status },
      update: { status, attempts: { increment: 1 }, doneAt: new Date() },
    });
  }

  /**
   * Возвращает состояние прогона для продолжения.
   *
   * `undefined` означает две разные вещи, и обе честны: прогона нет либо он
   * принадлежит другому арендатору; прогон завершён и продолжать нечего.
   * Различать их вызывающему не нужно — в обоих случаях работать не с чем.
   */
  async resume(tx: Tx, runId: string): Promise<ResumedRun | undefined> {
    const check = await tx.check.findFirst({
      where: { id: runId },
      select: { id: true, workflowId: true, objectId: true, status: true },
    });

    if (check === null) return undefined;
    if (!RESUMABLE.has(check.status as RunStatus)) return undefined;

    const subjects = await tx.gateSubject.findMany({
      where: { checkId: runId },
      select: { subjectId: true, status: true, returnedCount: true, reason: true },
    });

    const steps = await tx.checkStep.findMany({
      where: { checkId: runId },
      select: { stage: true, agent: true, status: true, attempts: true },
    });

    return {
      id: check.id,
      workflowId: check.workflowId,
      objectId: check.objectId,
      status: check.status as RunStatus,
      subjects: new Map(
        subjects.map((subject) => [
          subject.subjectId,
          {
            id: subject.subjectId,
            status: subject.status,
            returnedCount: subject.returnedCount,
            ...(subject.reason === null ? {} : { reason: subject.reason }),
          },
        ]),
      ),
      // Продолжать нечего только по ИСПОЛНЕННЫМ шагам: заблокированный и
      // нереализованный обязаны быть попробованы снова — состояние предметов
      // с прошлого раза могло измениться.
      completedSteps: steps
        .filter((step) => step.status === "исполнен")
        .map((step) => stepKey(step.stage, step.agent)),
      attempts: new Map(steps.map((step) => [stepKey(step.stage, step.agent), step.attempts])),
    };
  }

  async finish(tx: Tx, runId: string, status: RunStatus): Promise<void> {
    await tx.check.updateMany({
      // updateMany, а не update: он фильтруется политикой RLS, поэтому запись
      // в чужой прогон просто не найдёт строку, а не обновит её.
      where: { id: runId },
      data: {
        status,
        // Пауза не закрывает прогон: `finishedAt` ставится только на исходах,
        // после которых продолжения не будет.
        ...(RESUMABLE.has(status) ? {} : { finishedAt: new Date() }),
      },
    });
  }

}
