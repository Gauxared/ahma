/**
 * Агент Сметчика (Людмила) — ТЗ §5.1, §12.2.
 *
 * Первый из девяти договорных агентов. После выделения оболочки
 * (`modules/agents/agent-shell.ts`) здесь остаётся ТОЛЬКО частное — то, чем
 * Сметчик отличается от остальных восьми:
 *
 *  · что сложить ему на вход: сходимость, проверки смет, ТОП позиций;
 *  · как это изложить;
 *  · откуда брать суммы влияния.
 *
 * Общее — схема вывода, отбраковка замечания без основания, подстановка числа
 * из расчётного модуля, обезличивание, метрики — живёт в оболочке и одинаково
 * у всех девяти.
 *
 * Разделение труда по §6.4 проведено жёстко: арифметику уже сделал расчётный
 * модуль, модель получает готовые числа и НЕ возвращает свои. Замечание модели
 * ссылается на позицию порядковым номером, а сумму влияния подставляет оболочка
 * из тех же данных. Иначе число попадёт в реестр нарушений без следа и нарушит
 * §12.1д.
 */
import type { AccuracyMarker, OperationDefinition, Sha256 } from "@contracts/index.js";

import { AGENT_OUTPUT_SCHEMA, createAgentOperation } from "../agent-shell.js";
import type { DepthMode } from "../depth-mode.js";
import type {
  AgentEvidence,
  AgentRunRequest,
  AgentReviewBody,
  AgentTurn,
  RequiredSection,
} from "../agent-shell.js";

/**
 * Тело результата Сметчика.
 *
 * Псевдоним общего `AgentReviewBody`: у всех девяти агентов форма результата
 * одна, а различаются они предметом рассуждения. Имя сохранено, потому что
 * читающая сторона — командная строка, порты проверки, замеры — говорит именно
 * о результате СМЕТЧИКА, а не «какого-то агента».
 */
export type EstimateReviewBody = AgentReviewBody;

export type { ReviewFinding, RejectedFinding, AgentRunMetrics, AgentTurn } from "../agent-shell.js";

/** Схема вывода — общая для всех девяти агентов (см. оболочку). */
export const ESTIMATE_REVIEW_SCHEMA = AGENT_OUTPUT_SCHEMA;

export const RUN_ESTIMATE_REVIEW: OperationDefinition = {
  id: "run-estimate-review",
  version: 1,
  kind: "agent",
  variants: ["top-by-share", "full-line-by-line"],
  requires: [],
  optional: [],
  provides: ["estimate_review"],
  preconditions: ["estimate:draft|approved"],
};

export interface ConvergenceSummary {
  readonly converged: boolean;
  readonly documentTotal: string;
  readonly documentDelta: string | undefined;
  readonly sections: readonly {
    readonly scope: string;
    readonly name: string;
    readonly computed: string;
    readonly delta: string | undefined;
    readonly status: string;
  }[];
}

export interface ChecksSummary {
  readonly positions: number;
  /** Пусто — итог не сложить: суммы известны не у всех позиций. */
  readonly total: string | undefined;
  readonly duplicates: readonly { readonly basis: string; readonly amount: string; readonly rows: readonly number[] }[];
  readonly negatives: readonly { readonly ordinal: string; readonly name: string; readonly amount: string; readonly row: number }[];
  readonly unexplainedLumpSums: readonly {
    readonly ordinal: string;
    readonly name: string;
    readonly amount: string;
    readonly share: string;
    readonly row: number;
  }[];
}

export interface TopSummary {
  readonly coverage: string;
  readonly positions: readonly {
    readonly ordinal: string;
    readonly section: string;
    readonly name: string;
    readonly basis: string;
    readonly amount: string;
    readonly share: string;
    readonly row: number;
  }[];
}

/** Позиция для КООРДИНАТЫ замечания: сумма тут необязательна, строка — нет. */
export interface PositionCoordinate {
  readonly ordinal: string;
  readonly amount?: string | undefined;
  readonly row: number;
}

export interface EstimateReviewInput {
  readonly documentPath: string;
  /** Режим глубины ответа (§5.4). «Стандарт», если не задан. */
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  readonly hasEstimate: boolean;
  readonly convergence: ConvergenceSummary;
  readonly checks: ChecksSummary;
  readonly topPositions: TopSummary;
  /**
   * ВСЕ позиции сметы — только ради координаты замечания.
   *
   * В промпт они не идут: модель работает с уже отобранным. Здесь они нужны,
   * чтобы у названной моделью позиции нашлась строка в книге даже тогда, когда
   * денежные списки пусты.
   */
  readonly positions?: readonly PositionCoordinate[];
}

export interface EstimateReviewDeps {
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
  /**
   * Маркер точности считает расчётный модуль. Агент его не выводит и не
   * импортирует напрямую: между модулями ходит только талия (ADR-R-025).
   */
  readonly accuracyMarker: (context: { hasEstimate: boolean }) => AccuracyMarker;
  readonly runAgent: (request: AgentRunRequest) => Promise<AgentTurn>;
}

/**
 * Собирает позиции по порядковому номеру — для координаты замечания и суммы
 * влияния.
 *
 * ОСНОВА — ВСЕ ПОЗИЦИИ, а не денежные списки. Здесь стояли только они —
 * крупнейшие по доле, отрицательные и нерасшифрованные комплекты, — и на смете
 * без стоимостной части все три пусты. Ни одно из двухсот сорока девяти
 * замечаний не получило координаты, и экран честно сказал «показывать нечего»
 * — хотя строка в книге известна у каждой позиции.
 *
 * Денежные списки остаются: они кладутся поверх и приносят суммы влияния.
 */
function amountsByOrdinal(
  input: EstimateReviewInput,
): ReadonlyMap<string, { amount?: string | undefined; row: number }> {
  const index = new Map<string, { amount?: string | undefined; row: number }>();

  for (const entry of input.positions ?? []) {
    index.set(entry.ordinal, { ...(entry.amount === undefined ? {} : { amount: entry.amount }), row: entry.row });
  }

  for (const entry of input.checks.unexplainedLumpSums) {
    index.set(entry.ordinal, { amount: entry.amount, row: entry.row });
  }
  for (const entry of input.checks.negatives) {
    index.set(entry.ordinal, { amount: entry.amount, row: entry.row });
  }
  for (const entry of input.topPositions.positions) {
    index.set(entry.ordinal, { amount: entry.amount, row: entry.row });
  }

  return index;
}

function buildPrompt(input: EstimateReviewInput): string {
  const lines: string[] = [
    `Документ: ${input.documentPath}`,
    "",
    "СХОДИМОСТЬ (посчитана расчётным модулем):",
    `  итог по смете ${input.convergence.documentTotal} ₽, расхождение ${input.convergence.documentDelta ?? "не определено"} ₽`,
  ];

  for (const section of input.convergence.sections) {
    lines.push(
      `  ${section.scope} «${section.name}»: ${section.computed} ₽, расхождение ${section.delta ?? "нечего сверять"} ₽ (${section.status})`,
    );
  }

  lines.push("", `ПОЗИЦИЙ: ${input.checks.positions}, итог ${input.checks.total} ₽`);

  if (input.checks.duplicates.length > 0) {
    lines.push("ДУБЛИ (совпадение шифра и суммы):");
    for (const entry of input.checks.duplicates) {
      lines.push(`  ${entry.basis} — ${entry.amount} ₽, строки ${entry.rows.join(", ")}`);
    }
  }

  if (input.checks.negatives.length > 0) {
    lines.push("ОТРИЦАТЕЛЬНЫЕ ПОЗИЦИИ:");
    for (const entry of input.checks.negatives) {
      lines.push(`  поз. ${entry.ordinal} «${entry.name}» — ${entry.amount} ₽`);
    }
  }

  if (input.checks.unexplainedLumpSums.length > 0) {
    lines.push("НЕРАСШИФРОВАННЫЕ КОМПЛЕКТЫ от 5% итога:");
    for (const entry of input.checks.unexplainedLumpSums) {
      lines.push(`  поз. ${entry.ordinal} «${entry.name}» — ${entry.amount} ₽, доля ${entry.share}`);
    }
  }

  lines.push("", `ТОП ПОЗИЦИЙ (охват ${input.topPositions.coverage} итога):`);
  for (const entry of input.topPositions.positions) {
    lines.push(`  поз. ${entry.ordinal} ${entry.basis} «${entry.name}» — ${entry.amount} ₽, доля ${entry.share}`);
  }

  lines.push(
    "",
    "Классифицируй выявленное, оцени существенность и сформулируй вывод.",
    "Числа НЕ пересчитывай. В impactOrdinal указывай порядковый номер позиции,",
    "к которой относится замечание, либо пустую строку.",
  );

  return lines.join("\n");
}

/** Суммы влияния Сметчика: они уже посчитаны расчётным модулем. */
function evidenceOf(input: EstimateReviewInput): AgentEvidence {
  return {
    amounts: amountsByOrdinal(input),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "ЛСР",
  };
}

export function createEstimateReviewOperation(deps: EstimateReviewDeps) {
  return createAgentOperation<EstimateReviewInput>({
    definition: RUN_ESTIMATE_REVIEW,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.hasEstimate }),
    runAgent: deps.runAgent,
  });
}
