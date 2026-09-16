/**
 * Агент Халиля (подряд) — ведомость распределения работ. ТЗ §5.1, §12.2.
 *
 * Девятый из девяти и шестой объектный.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ
 *
 * Скоринга субподрядчиков. Два протокола легаси запрещают его здесь прямо:
 * «СКОРИНГ БЕЗ ФИНОТЧЁТНОСТИ НЕ СУЩЕСТВУЕТ» и «ТРИ КАНДИДАТА. Один кандидат —
 * не выбор». Реестра кандидатов у системы нет, отчётности — тем более.
 *
 * Модель, у которой спросить «кого нанять», назовёт правдоподобные компании.
 * Правдоподобная компания в отчёте о субподряде — это не ошибка формата, это
 * приглашение позвонить по выдуманному телефону.
 *
 * ЧТО ОН ДЕЛАЕТ
 *
 * Стандарт 3.1 — ведомость распределения работ, и легаси называет её СТАРТОМ:
 * «до любого разговора о субподрядчике». Для неё нужен состав работ, и он есть.
 *
 *   | Вид работ | Свои силы % | Субподряд % | Обоснование |
 *
 * Правилом это не считается. Что отдавать на сторону, определяется не суммой и
 * не шифром, а тем, есть ли у работы своя технология, свой допуск и свои люди:
 * прокладка кабеля и пусконаладка систем безопасности — разные ответы, хотя в
 * смете стоят рядом.
 *
 * ГРАНИЦА С МАРИНОЙ
 *
 * Легаси проводит её явно: «работа/монтаж — ты, материал — она». Без разделения
 * материала и монтажа доля субподряда считается от неверной базы — отдать
 * «пакет на 10 млн», из которых 8 млн материал, значит отдать не то, что думал.
 */
import type { AccuracyMarker, OperationDefinition, Sha256 } from "@contracts/index.js";

import { createAgentOperation } from "../agent-shell.js";
import type {
  AgentEvidence,
  AgentRunRequest,
  AgentReviewBody,
  AgentTurn,
  RequiredSection,
} from "../agent-shell.js";
import type { DepthMode } from "../depth-mode.js";

export type SubcontractPlanBody = AgentReviewBody;

export const RUN_SUBCONTRACT_PLAN: OperationDefinition = {
  id: "run-subcontract-plan",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["subcontract_plan"],
  preconditions: [],
};

/**
 * Группа работ объекта — строка будущей ведомости распределения.
 *
 * СУММА ГРУППЫ И СУММА ПОЗИЦИИ РАЗВЕДЕНЫ НАМЕРЕННО
 *
 * `groupAmount` — итог по группе, он идёт в промпт как справка. Подставлять его
 * в последствие замечания по `ordinal` было бы подлогом: замечание указывает на
 * одну позицию, а сумма пришла бы от двадцати. Поэтому в основание идёт
 * `ordinalAmount` — деньги той самой строки, на которую сослались (§12.1д).
 */
export interface WorkPackage {
  readonly table: string;
  readonly name: string;
  readonly count: number;
  /** Итог по группе — для ведомости распределения. В основание не подставляется. */
  readonly groupAmount: string;
  /** Самая дорогая позиция группы: на неё сошлётся замечание. */
  readonly ordinal: string;
  /** Сумма ИМЕННО этой позиции. */
  readonly ordinalAmount: string;
  readonly sourceRow: number;
  /**
   * Файл ЭТОЙ позиции и его отпечаток.
   *
   * Агент работает по объекту, а позиции приходят из разных смет. Без них
   * ссылка «откуда взято» называла путь ПАПКИ объекта и отпечаток первого
   * документа обхода — то есть указывала не на тот файл.
   */
  readonly document?: string | undefined;
  readonly documentHash?: Sha256 | undefined;
}

export interface SubcontractPlanAgentInput {
  readonly documentPath: string;
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  readonly packages: readonly WorkPackage[];
  /**
   * Есть ли реестр кандидатов. Без него скоринг не существует по протоколу 1, и
   * сказать это надо вслух, а не оставить читателя гадать, почему его нет.
   */
  readonly hasCandidates: boolean;
  readonly missing: readonly string[];
}

export interface SubcontractPlanDeps {
  /** Опорная база агента (лениво). Пусто — режим [БЕЗ БАЗЫ]. */
  readonly referenceBase?: () => Promise<string | undefined>;
  /**
   * Каркас роли из манифеста: листы, обязательные при ЛЮБОМ объекте.
   *
   * Приходит извне, а не задаётся здесь: тот же список нужен сборщику книги —
   * чтобы назвать не данный лист пробелом, — и два списка разошлись бы молча.
   */
  readonly requiredSections?: readonly RequiredSection[];
  readonly prompt: string;
  readonly accuracyMarker: (context: { hasEstimate: boolean }) => AccuracyMarker;
  readonly runAgent: (request: AgentRunRequest) => Promise<AgentTurn>;
}

function buildPrompt(input: SubcontractPlanAgentInput): string {
  const lines: string[] = [`Объект: ${input.documentPath}`, ""];

  if (!input.hasCandidates) {
    // Первым, до состава: иначе модель начнёт называть компании, которых не
    // видела, и отчёт о субподряде превратится в список выдуманных телефонов.
    lines.push(
      "РЕЕСТРА КАНДИДАТОВ НЕТ. Скоринг НЕ ВЫПОЛНЯЕТСЯ: «скоринг без",
      "финотчётности не существует», «три кандидата — один кандидат не выбор».",
      "НЕ НАЗЫВАЙ конкретных компаний, ИНН и контактов: ты их не видел, а",
      "правдоподобное имя в отчёте о субподряде — это приглашение позвонить по",
      "выдуманному телефону. Скажи, что нужно для скоринга.",
      "",
    );
  }

  lines.push("ГРУППЫ РАБОТ ОБЪЕКТА (суммы посчитаны, пересчитывать не нужно):");

  for (const item of input.packages) {
    lines.push(
      `  ${item.table} «${item.name}» — позиций ${item.count}, по группе ${item.groupAmount} ₽ ` +
        `(самая дорогая — поз. ${item.ordinal}, ${item.ordinalAmount} ₽)`,
    );
  }

  if (input.missing.length > 0) {
    lines.push("", "ЧЕГО НЕТ НА ВХОДЕ:");
    for (const item of input.missing) lines.push(`  · ${item}`);
  }

  lines.push(
    "",
    "ЗАДАЧА — ведомость распределения работ (3.1). Легаси называет её СТАРТОМ:",
    "до любого разговора о субподрядчике.",
    "",
    "1. ПО КАЖДОЙ ГРУППЕ: свои силы или субподряд, и ОБОСНОВАНИЕ. Ответ",
    "   определяется не суммой и не шифром, а тем, нужны ли работе своя",
    "   технология, свой допуск и свои люди: прокладка кабеля и пусконаладка",
    "   систем безопасности — разные ответы, хотя в смете стоят рядом.",
    "2. ГРАНИЦА С МАТЕРИАЛОМ: где в группе основная часть суммы — это материал,",
    "   а не работа. Работа и монтаж — предмет подряда, материал — снабжения.",
    "   Пакет «на 10 млн», из которых 8 млн материал, отдаётся не тот, что думали.",
    "3. СЦЕНАРИЙ Г (3.4): на каких пакетах отказ исполнителя останавливает",
    "   объект, а не отодвигает срок. Именно там резерв обязателен.",
    "4. ЧТО ЗАПРОСИТЬ, чтобы скоринг стал возможен.",
    "",
    "СРОКОВ МОБИЛИЗАЦИИ И ЦЕН ПЕРЕБАЗИРОВКИ НЕ ВЫДУМЫВАЙ: ни графика, ни",
    "географии исполнителей у тебя нет. Скажи, что нужно для расчёта.",
    "",
    "В impactOrdinal указывай порядковый номер позиции либо пустую строку.",
  );

  return lines.join("\n");
}

/**
 * Суммы берутся из сметы, а не из ответа модели (§12.1д), и это сумма ПОЗИЦИИ,
 * на которую сослались, а не итог её группы.
 */
function evidenceOf(input: SubcontractPlanAgentInput): AgentEvidence {
  return {
    amounts: new Map(
      input.packages.map((item) => [
        item.ordinal,
        {
          amount: item.ordinalAmount,
          row: item.sourceRow,
          ...(item.document === undefined ? {} : { sourceId: item.document }),
          ...(item.documentHash === undefined ? {} : { contentHash: item.documentHash }),
        },
      ]),
    ),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "ЛСР",
  };
}

export function createSubcontractPlanOperation(deps: SubcontractPlanDeps) {
  return createAgentOperation<SubcontractPlanAgentInput>({
    definition: RUN_SUBCONTRACT_PLAN,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.packages.length > 0 }),
    runAgent: deps.runAgent,
  });
}
