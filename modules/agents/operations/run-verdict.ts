/**
 * Агент Артемия (руководитель) — вердикт по объекту. ТЗ §5.1, §5.3, §12.2.
 *
 * Шестой из девяти и ЕДИНСТВЕННЫЙ АГЕНТ СИНТЕЗА: его предмет — не документ и не
 * объект, а то, что сказали остальные.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ФАЗА
 *
 * Запустить его вместе с прочими значило бы дать ему пустой список замечаний:
 * параллельные задачи не видят результатов друг друга. Порядок здесь не
 * оптимизация, а условие осмысленности.
 *
 * ЧТО СЧИТАЕТ МОДУЛЬ, А ЧТО ГОВОРИТ МОДЕЛЬ
 *
 * Считает `modules/agents/verdict.ts`: цвет по марже и замечаниям, полоса маржи
 * по порогам от НМЦК, сумма влияния. Главное правило там — **маржа и влияние
 * замечаний НЕ СКЛАДЫВАЮТСЯ**: это разные величины, и их сумма не значит
 * ничего, а выглядит итогом.
 *
 * Модель отвечает на то, чего правилами не получить:
 *
 *  · ПРОТИВОРЕЧИЯ между смежниками. Денчик говорит «объём не подтверждён», а
 *    Людмила «сходимость 0 ₽» — это не спор, но выглядит спором; а вот
 *    «закупать нельзя» от Марины при «принято» от обхода — уже противоречие;
 *  · УСЛОВИЯ ВХОДА с ценой вопроса. Условие без цены — пожелание;
 *  · ПРИМОРТЕМ по ЭТОМУ объекту, а не вообще.
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

export type VerdictAgentBody = AgentReviewBody;

export const RUN_VERDICT: OperationDefinition = {
  id: "run-verdict",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["object_verdict"],
  preconditions: [],
};

/** Что сказал один смежник. */
export interface PeerReview {
  readonly capability: string;
  readonly verdict: string;
  readonly findings: readonly { readonly severity: string; readonly statement: string }[];
  /** Отказ агента. Молчание о нём сделало бы вердикт полнее, чем он есть. */
  readonly error?: string | undefined;
}

export interface VerdictAgentInput {
  readonly documentPath: string;
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  /** Итог обхода: принято, не принято, нечего проверять. */
  readonly walkVerdict: string;
  /** Договорные гейты и их исход — то, на чём стоит вердикт обхода. */
  readonly gates: readonly { readonly id: string; readonly passed: boolean; readonly detail: string }[];
  readonly peers: readonly PeerReview[];
  readonly missing: readonly string[];
}

export interface VerdictAgentDeps {
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

function buildPrompt(input: VerdictAgentInput): string {
  const lines: string[] = [
    `Объект: ${input.documentPath}`,
    "",
    `ИТОГ ОБХОДА (посчитан детерминированно): ${input.walkVerdict}`,
    "",
    "ДОГОВОРНЫЕ ГЕЙТЫ:",
  ];

  for (const gate of input.gates) {
    lines.push(`  ${gate.passed ? "пройден" : "НЕ ПРОЙДЕН"} · ${gate.id}: ${gate.detail}`);
  }

  lines.push("", "ЧТО СКАЗАЛИ СМЕЖНИКИ:");

  for (const peer of input.peers) {
    if (peer.error !== undefined) {
      // Отказ смежника — это не отсутствие мнения, а отсутствие проверки.
      // Промолчав о нём, вердикт оказался бы полнее, чем есть основания.
      lines.push(`  ${peer.capability}: ОТКАЗ — ${peer.error}`);
      continue;
    }

    lines.push(`  ${peer.capability}: ${peer.verdict}`);

    for (const finding of peer.findings) {
      lines.push(`    [${finding.severity}] ${finding.statement}`);
    }
  }

  if (input.missing.length > 0) {
    lines.push("", "ЧЕГО НЕТ НА ВХОДЕ:");
    for (const item of input.missing) lines.push(`  · ${item}`);
  }

  lines.push(
    "",
    "ЗАДАЧА.",
    "1. ВЕРДИКТ одним цветом и одной фразой: 🟢 идём, 🟡 идём при условиях,",
    "   🔴 не идём. Цвет СЛЕДУЕТ из состояния, а не ставится по ощущению.",
    "2. УСЛОВИЯ ВХОДА для жёлтого: каждое с ЦЕНОЙ ВОПРОСА — чем рискуем, если",
    "   не закрыть. Условие без цены это пожелание.",
    "3. ПРОТИВОРЕЧИЯ: что в сказанном смежниками не сходится между собой.",
    "4. ПРИМОРТЕМ ДО вердикта: пять причин провала ИМЕННО этого объекта.",
    "   Примортем после вердикта — оправдание; до вердикта — проверка.",
    "",
    "НЕ СКЛАДЫВАЙ маржу с влиянием замечаний: это разные величины, и их сумма",
    "не значит ничего, а выглядит итогом.",
    "Чужие числа не пересчитывай — они посчитаны расчётным модулем.",
    "",
    "В impactOrdinal оставляй пустую строку: твой предмет объект целиком.",
    "Условия входа помещай в openQuestions: что, с кого и к какому сроку.",
  );

  return lines.join("\n");
}

/**
 * У вердикта нет суммы по позиции.
 *
 * Его предмет — объект целиком, и пустая таблица означает, что оболочка
 * оставит влияние незаполненным, а не подставит ноль (§9).
 */
function evidenceOf(input: VerdictAgentInput): AgentEvidence {
  return {
    amounts: new Map(),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "объект",
  };
}

export function createVerdictOperation(deps: VerdictAgentDeps) {
  return createAgentOperation<VerdictAgentInput>({
    definition: RUN_VERDICT,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.peers.length > 0 }),
    runAgent: deps.runAgent,
  });
}
