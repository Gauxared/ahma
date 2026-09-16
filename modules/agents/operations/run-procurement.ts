/**
 * Агент Марины (снабжение) — карта лид-таймов и закупка. ТЗ §5.1, §12.2.
 *
 * Четвёртый из девяти и второй ОБЪЕКТНЫЙ: закупка ведётся по стройке, а не по
 * отдельной смете.
 *
 * ЧТО СЧИТАЕТ МОДУЛЬ, А ЧТО ГОВОРИТ МОДЕЛЬ
 *
 * Считает `modules/calculations/lead-time.ts`: статусы по порогам, крайний срок
 * заказа, сортировка по убыванию суммы, правило трёх КП. Это правила, и они
 * правильно детерминированы.
 *
 * Но карту лид-таймов НЕ ИЗ ЧЕГО СТРОИТЬ, пока не отделено закупаемое от
 * выполняемого. Смета — это работы и ресурсы вперемешку:
 *
 *   «Камеры видеонаблюдения: наружная»  — закупается
 *   «Прокладка кабеля в лотках»          — выполняется
 *
 * Отличить их правилом нельзя: признак не в шифре и не в единице, а в том, что
 * названо. Это и есть работа модели — и без неё стандарт 3.2 не выполним в
 * принципе, потому что «топ-5 ТМЦ по стоимости» требует знать, какие позиции
 * вообще ТМЦ.
 *
 * ЛИД-ТАЙМЫ НЕ ВЫДУМЫВАЮТСЯ
 *
 * Срок поставки берётся из коммерческого предложения. Названный по памяти срок
 * выглядит проверенным и уводит планирование на недели — а `reverseDeadline`,
 * получив его, оформит догадку следом формулы с провенансом. Поэтому модель
 * называет, для каких позиций срок нужен в первую очередь, и не называет сам
 * срок.
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

export type ProcurementBody = AgentReviewBody;

export const RUN_PROCUREMENT: OperationDefinition = {
  id: "run-procurement",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["procurement_map"],
  preconditions: [],
};

/** Позиция сметы как кандидат в закупку. Что закупается — решает модель. */
export interface ProcurementCandidate {
  readonly ordinal: string;
  readonly name: string;
  readonly basis: string;
  readonly unit: string;
  readonly quantity?: string | undefined;
  readonly amount: string;
  /** Применимо ли правило трёх КП (3.1). Считает модуль по порогу. */
  readonly requiresThreeQuotes: boolean;
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

export interface ProcurementAgentInput {
  /** Путь ОБЪЕКТА: закупка ведётся по стройке. */
  readonly documentPath: string;
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  /** Позиции по убыванию суммы: дорогое видно первым (3.2). */
  readonly candidates: readonly ProcurementCandidate[];
  /** Порог правила трёх КП в рублях. Из расчётного модуля, не из промпта. */
  readonly quotesThreshold: string;
  readonly missing: readonly string[];
}

export interface ProcurementDeps {
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

function buildPrompt(input: ProcurementAgentInput): string {
  const lines: string[] = [
    `Объект: ${input.documentPath}`,
    "",
    `ПОРОГ ТРЁХ КП: ${input.quotesThreshold} ₽ (стандарт 3.1). Позиции дороже`,
    "помечены ниже; дешевле — три предложения не требуются.",
    "",
    "СОСТАВ ОБЪЕКТА ПО УБЫВАНИЮ СУММЫ — работы и ресурсы ВПЕРЕМЕШКУ:",
  ];

  for (const candidate of input.candidates) {
    lines.push(
      `  поз. ${candidate.ordinal} ${candidate.basis || "без шифра"} ` +
        `«${candidate.name}» — ${candidate.quantity ?? "объём не указан"} ${candidate.unit}, ` +
        `${candidate.amount} ₽` +
        (candidate.requiresThreeQuotes ? " [нужны 3 КП]" : ""),
    );
  }

  if (input.missing.length > 0) {
    lines.push("", "ЧЕГО НЕТ НА ВХОДЕ:");
    for (const item of input.missing) lines.push(`  · ${item}`);
  }

  lines.push(
    "",
    "ЗАДАЧА.",
    "1. ЧТО ЗАКУПАТЬ: отдели товарно-материальные ценности — оборудование,",
    "   материалы, изделия — от работ и монтажа. Работа и монтаж не твои.",
    "   Правилом это не отличить: признак не в шифре и не в единице, а в том,",
    "   что названо.",
    "2. ТОП ПО СТОИМОСТИ (3.2): с чего начинать карту лид-таймов.",
    "3. ГОСТ-КОНТРОЛЬ (3.3): где спецификация недостаточна, чтобы закупать —",
    "   назван тип, но не марка, класс или типоразмер.",
    "4. ПРИМОРТЕМ: пять причин срыва поставки, видных уже сейчас.",
    "",
    "ЛИД-ТАЙМЫ НЕ ПЕРЕДАНЫ, и выдумывать их НЕЛЬЗЯ. Срок поставки берётся из",
    "коммерческого предложения; названный по памяти выглядит проверенным и",
    "уводит планирование на недели. Скажи, для каких позиций срок нужен первым.",
    "",
    "В impactOrdinal указывай порядковый номер позиции либо пустую строку.",
    "Недостающее помещай в openQuestions с адресатом и сроком.",
  );

  return lines.join("\n");
}

/**
 * Суммы влияния Марины — из позиций сметы.
 *
 * Замечание «спецификация недостаточна для закупки» относится к конкретной
 * строке, и сумма берётся оттуда же, а не из ответа модели (§12.1д).
 */
function evidenceOf(input: ProcurementAgentInput): AgentEvidence {
  return {
    amounts: new Map(
      input.candidates.map((candidate) => [
        candidate.ordinal,
        {
          amount: candidate.amount,
          row: candidate.sourceRow,
          ...(candidate.document === undefined ? {} : { sourceId: candidate.document }),
          ...(candidate.documentHash === undefined ? {} : { contentHash: candidate.documentHash }),
        },
      ]),
    ),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "ЛСР",
  };
}

export function createProcurementOperation(deps: ProcurementDeps) {
  return createAgentOperation<ProcurementAgentInput>({
    definition: RUN_PROCUREMENT,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    // Точность карты закупки определяется наличием лид-таймов и КП, а не сметы.
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.missing.length === 0 }),
    runAgent: deps.runAgent,
  });
}
