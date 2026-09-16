/**
 * Агент Палыча (ПТО) — исполнительная документация и скрытые работы.
 * ТЗ §5.1, §12.2.
 *
 * Пятый из девяти и третий ОБЪЕКТНЫЙ: реестр документации ведётся по стройке.
 *
 * ЧТО СЧИТАЕТ МОДУЛЬ, А ЧТО ГОВОРИТ МОДЕЛЬ
 *
 * Считает `modules/agents/start-checklist.ts`: семь пунктов чек-листа старта,
 * последствие невыполнения у каждого, разделение «нет» и «не отвечено». Это
 * правила, и они детерминированы верно.
 *
 * Модель отвечает на то, чего правилами не получить, — стандарт 3.3:
 *
 *   КАКИЕ ИЗ ЭТИХ РАБОТ ЯВЛЯЮТСЯ СКРЫТЫМИ.
 *
 * Признак не в шифре и не в единице: «устройство подстилающего слоя» закрывается
 * покрытием, «прокладка кабеля в лотках» — крышкой лотка, а «установка камеры»
 * не закрывается ничем. Отличить их может только тот, кто понимает
 * последовательность работ.
 *
 * Цена ошибки названа в самом промпте: «закрыли бетоном без акта — вскрытие за
 * свой счёт». Пропущенный акт не создаёт замечания в смете и обнаруживается на
 * объекте, когда работа уже закрыта.
 *
 * ДЕНЬГИ ОБЯЗАТЕЛЬНЫ У КАЖДОГО ЗАМЕЧАНИЯ
 *
 * Стандарт 3.2: «алерт без денежного последствия не засчитывается». Суммы
 * приходят из сметы и подставляются оболочкой по порядковому номеру — модель их
 * не пересчитывает (§12.1д).
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

export type ExecutiveDocsBody = AgentReviewBody;

export const RUN_EXECUTIVE_DOCS: OperationDefinition = {
  id: "run-executive-docs",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["executive_docs"],
  preconditions: [],
};

/** Работа объекта — кандидат в реестр исполнительной документации. */
export interface WorkForDocs {
  readonly ordinal: string;
  readonly name: string;
  readonly basis: string;
  readonly unit: string;
  readonly quantity?: string | undefined;
  readonly amount: string;
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

export interface ExecutiveDocsAgentInput {
  /** Путь ОБЪЕКТА: реестр документации ведётся по стройке. */
  readonly documentPath: string;
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  readonly works: readonly WorkForDocs[];
  /** Пункты чек-листа старта, не закрытые на сейчас. Считает модуль. */
  readonly startChecklistOpen: readonly string[];
  readonly missing: readonly string[];
}

export interface ExecutiveDocsDeps {
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

function buildPrompt(input: ExecutiveDocsAgentInput): string {
  const lines: string[] = [`Объект: ${input.documentPath}`, ""];

  if (input.startChecklistOpen.length > 0) {
    // Незакрытый чек-лист старта — это «выход на объект преждевременный»
    // (3.1), и знать об этом надо до разговора о скрытых работах.
    lines.push("ЧЕК-ЛИСТ СТАРТА НЕ ЗАКРЫТ (посчитан модулем, 3.1):");
    for (const item of input.startChecklistOpen) lines.push(`  · ${item}`);
    lines.push("");
  }

  lines.push("СОСТАВ РАБОТ ОБЪЕКТА (суммы посчитаны, пересчитывать не нужно):");

  for (const work of input.works) {
    lines.push(
      `  поз. ${work.ordinal} ${work.basis || "без шифра"} «${work.name}» — ` +
        `${work.quantity ?? "объём не указан"} ${work.unit}, ${work.amount} ₽`,
    );
  }

  if (input.missing.length > 0) {
    lines.push("", "ЧЕГО НЕТ НА ВХОДЕ:");
    for (const item of input.missing) lines.push(`  · ${item}`);
  }

  lines.push(
    "",
    "ЗАДАЧА.",
    "1. СКРЫТЫЕ РАБОТЫ (3.3): какие из этих работ закрываются последующими и",
    "   требуют освидетельствования ДО закрытия. Признак не в шифре и не в",
    "   единице — он в последовательности работ. Закрыли без акта — вскрытие",
    "   за свой счёт.",
    "2. ПЕРЕЧЕНЬ АКТОВ (3.4): какие акты понадобятся по видам работ.",
    "3. ВХОДНОЙ КОНТРОЛЬ (3.5): какие материалы не пойдут в работу без паспорта",
    "   или сертификата.",
    "",
    "У КАЖДОГО замечания — денежное последствие (3.2): назови сумму под угрозой",
    "и укажи её в основании. Алерт без денег не засчитывается.",
    "",
    "ДАТЫ НЕ ВЫДУМЫВАЙ: графика работ нет, и «за десять дней до закрытия» без",
    "даты закрытия — не срок, а формулировка. Скажи, что нужно для её расчёта.",
    "",
    "В impactOrdinal указывай порядковый номер позиции либо пустую строку.",
  );

  return lines.join("\n");
}

/** Суммы под угрозой берутся из сметы, а не из ответа модели (§12.1д). */
function evidenceOf(input: ExecutiveDocsAgentInput): AgentEvidence {
  return {
    amounts: new Map(
      input.works.map((work) => [
        work.ordinal,
        {
          amount: work.amount,
          row: work.sourceRow,
          ...(work.document === undefined ? {} : { sourceId: work.document }),
          ...(work.documentHash === undefined ? {} : { contentHash: work.documentHash }),
        },
      ]),
    ),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "ЛСР",
  };
}

export function createExecutiveDocsOperation(deps: ExecutiveDocsDeps) {
  return createAgentOperation<ExecutiveDocsAgentInput>({
    definition: RUN_EXECUTIVE_DOCS,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.missing.length === 0 }),
    runAgent: deps.runAgent,
  });
}
