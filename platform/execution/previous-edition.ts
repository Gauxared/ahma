/**
 * ПРЕЖНЯЯ РЕДАКЦИЯ РОЛИ ПО ЭТОМУ ОБЪЕКТУ (Т9.5, память между прогонами).
 *
 * ЧЕГО НЕ БЫЛО. Эталонная система вела РЕДАКЦИИ: в кейсах лежат «ВОР
 * итерация1» и «ВОР итерация2 ПОЛНЫЙ», «Реестр ИД ред1» и «ред2», «ПЭС-2025-ВК
 * ред.6». Документ не переписывался с чистого листа — он уточнялся: замечания
 * ГИПа закрывались по одному, и в следующей редакции видно, какие закрыты, а
 * какие остались. У нас каждый прогон объекта начинался заново: роль не видела
 * ни собственного прошлого заключения, ни того, что по нему сказали.
 *
 * ЧЕМ ЭТО ПЛОХО НА СТРОЙКЕ. Повторный прогон запускают не от скуки: пришла
 * недостающая ЛСР, заказчик прислал ответ на открытый вопрос, подрядчик
 * исправил ведомость. Роль, не помнящая прежней редакции, отвечает так, будто
 * ничего не присылали: те же ⚠ на тех же цифрах, те же открытые вопросы — и
 * человеку заново читать тридцать страниц, чтобы понять, ЧТО ИЗМЕНИЛОСЬ.
 *
 * ПАМЯТЬ ЗДЕСЬ ДВУХСЛОЙНАЯ, И ЭТО НЕ ДУБЛИРОВАНИЕ.
 *
 * 1. Тред роли (`threadId`). Продолжение прежнего разговора — роль видит
 *    собственные рассуждения, а не пересказ. Работает, пока на диске жив
 *    rollout треда; дом Codex его переживает (`sessions/` не трогается при
 *    пересборке дома), но выпуск на другом сервере — нет.
 * 2. Текст прежнего заключения во вводной. Работает ВСЕГДА, включая случай,
 *    когда тред продолжить нечем. Именно поэтому слоя два: память, живущая
 *    только в файле сессии, потерялась бы при первом же переезде.
 *
 * БЕРЁТСЯ ПОСЛЕДНЕЕ, ЧТО РОЛЬ СКАЗАЛА ОБ ЭТОМ ОБЪЕКТЕ, а не «последний прогон
 * целиком»: если в прошлый раз Ваныч отказал, его редакцией остаётся
 * позапрошлая — то есть последнее, что он действительно говорил. Иначе отказ
 * стирал бы память, и повторный прогон после сбоя терял бы всё накопленное.
 */
import { withTenant, type Db } from "../db/prisma.js";

/** Что роль сказала об этом объекте в прошлый раз. */
export interface PreviousEdition {
  /** Способность роли — по ней экипаж находит свою редакцию. */
  readonly capability: string;
  /** Тред прежнего разговора; `undefined` — продолжать нечего. */
  readonly threadId?: string;
  /** Вердикт прежней редакции одной строкой. */
  readonly verdict: string;
  /** Когда роль это сказала (ISO). */
  readonly saidAt: string;
  /** Находки прежней редакции: важность и утверждение. */
  readonly findings: readonly string[];
  /** Открытые вопросы прежней редакции: вопрос · с кого · срок. */
  readonly questions: readonly string[];
  /**
   * Во сколько входных токенов обошёлся прошлый ход роли.
   *
   * Нужно не для отчётности, а для решения, продолжать ли тред. Замерено на
   * прогоне 16 (редакция 9): продолжение тредов подняло прогон с 2,80 до
   * 14,51 млн входных токенов — впятеро, потому что каждый ход тащит за собой
   * все прежние редакции. Разросшийся тред отсекается по этому числу.
   */
  readonly inputTokens?: number;
}

export interface PreviousEditions {
  /** Номер текущей редакции: 2 — второй прогон этого объекта. */
  readonly edition: number;
  readonly roles: readonly PreviousEdition[];
}

/** Сколько находок и вопросов прежней редакции переносится во вводную. */
const ПОТОЛОК = 40;

interface RowFinding {
  readonly severity?: unknown;
  readonly statement?: unknown;
}

interface RowQuestion {
  readonly question?: unknown;
  readonly owner?: unknown;
  readonly dueBy?: unknown;
}

/** Строка списка из JSON-колонки. Кривая запись пропускается, а не роняет прогон. */
function строкой(value: unknown, render: (item: never) => string): readonly string[] {
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const text = render(item as never).trim();
    if (text !== "") out.push(text);
    if (out.length >= ПОТОЛОК) break;
  }
  return out;
}

/**
 * Прежние редакции ролей по объекту.
 *
 * Прогон, который идёт сейчас, исключается: его собственные строки `agent_run`
 * пишутся по ходу, и без исключения роль получила бы «прежней редакцией»
 * саму себя.
 */
export async function loadPreviousEditions(input: {
  readonly db: Db;
  readonly tenantId: string;
  readonly objectId: string;
  readonly exceptCheckId: string;
}): Promise<PreviousEditions> {
  return withTenant(input.db, input.tenantId, async (tx) => {
    const edition =
      1 +
      (await tx.check.count({
        where: { objectId: input.objectId, id: { not: input.exceptCheckId }, status: "completed" },
      }));

    const runs = await tx.agentRun.findMany({
      where: {
        status: "исполнен",
        checkId: { not: input.exceptCheckId },
        check: { objectId: input.objectId },
      },
      orderBy: { finishedAt: "desc" },
      select: {
        agentId: true,
        threadId: true,
        verdict: true,
        findings: true,
        questions: true,
        finishedAt: true,
        inputTokens: true,
      },
    });

    const роли = new Map<string, PreviousEdition>();
    for (const run of runs) {
      // Первая строка по роли — самая свежая: сортировка по времени сделана в базе.
      if (роли.has(run.agentId)) continue;

      роли.set(run.agentId, {
        capability: run.agentId,
        ...(run.threadId === null || run.threadId === undefined ? {} : { threadId: run.threadId }),
        ...(run.inputTokens === null || run.inputTokens === undefined ? {} : { inputTokens: run.inputTokens }),
        verdict: run.verdict ?? "вердикт прежней редакции не записан",
        saidAt: (run.finishedAt ?? new Date()).toISOString(),
        findings: строкой(run.findings, (f: RowFinding) => `${String(f.severity ?? "?")} · ${String(f.statement ?? "")}`),
        questions: строкой(
          run.questions,
          (q: RowQuestion) =>
            `${String(q.question ?? "")}${q.owner === undefined ? "" : ` · с кого: ${String(q.owner)}`}${
              q.dueBy === undefined ? "" : ` · срок: ${String(q.dueBy)}`
            }`,
        ),
      });
    }

    return { edition, roles: [...роли.values()] };
  });
}
