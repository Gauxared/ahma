/**
 * Агент Виктора (договорник) — договорные условия и разграничение объёма.
 * ТЗ §5.1, §12.2.
 *
 * Восьмой из девяти и пятый объектный.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ — И ЭТО ГЛАВНОЕ В НЁМ
 *
 * Первый протокол Виктора в легаси: «ДОКУМЕНТ ЦЕЛИКОМ. Фрагмент договора не
 * аудируется». Текста договора у системы нет вообще, поэтому red-flag аудит
 * (стандарт 3.1, пять групп, пятьдесят паттернов) не выполняется. Не
 * «выполняется приблизительно» — не выполняется.
 *
 * Соблазн здесь очевиден и дорог: по составу работ можно правдоподобно
 * написать «в договоре, вероятно, штраф 0,1%/день» и получить красивый экран.
 * Это был бы не аудит, а сочинение на тему договора, и читатель принял бы его
 * за прочитанный документ.
 *
 * ЧТО ОН ДЕЛАЕТ ВМЕСТО ЭТОГО
 *
 * Две работы, для которых состава работ ДОСТАТОЧНО, и обе — из боевых дельт,
 * снятых на этом же курганском объекте:
 *
 *  · В-4: матрица разграничения объёма (наше / давальческое / заказчика) по
 *    дорогим позициям. «Договор без разграничения = подписанный убыток», и
 *    дельта требует этот артефакт ПЕРВЫМ — до финмодели.
 *  · Какие условия договор ОБЯЗАН содержать при ТАКОМ составе работ. Срок
 *    уведомления о скрытых работах нужен потому, что скрытые работы здесь есть;
 *    порядок распределения экономии (ст. 710 ГК) — потому, что есть чему
 *    экономиться. Это выводится из состава, а не из договора.
 *
 * РИСК СЧИТАЕТСЯ В РУБЛЯХ, И РУБЛИ БЕРУТСЯ ИЗ СМЕТЫ
 *
 * Протокол 2: «„опасно" без цифры не существует». Суммы подставляет оболочка по
 * порядковому номеру позиции — число из ответа модели было бы числом без следа
 * (§12.1д).
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

export type ContractAuditBody = AgentReviewBody;

export const RUN_CONTRACT_AUDIT: OperationDefinition = {
  id: "run-contract-audit",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["contract_audit"],
  preconditions: [],
};

/** Позиция объекта — кандидат в матрицу разграничения объёма. */
export interface WorkForContract {
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

export interface ContractAuditAgentInput {
  /** Путь ОБЪЕКТА: договор заключается на объект, а не на смету. */
  readonly documentPath: string;
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  readonly works: readonly WorkForContract[];
  /**
   * Есть ли у системы текст договора.
   *
   * Отдельным полем, а не выводом из пустоты: «договора нет» и «договор есть, но
   * пуст» — разные положения, и первое обязано быть сказано вслух.
   */
  readonly hasContractText: boolean;
  readonly missing: readonly string[];
}

export interface ContractAuditDeps {
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

function buildPrompt(input: ContractAuditAgentInput): string {
  const lines: string[] = [`Объект: ${input.documentPath}`, ""];

  if (!input.hasContractText) {
    // Ставится ПЕРВЫМ, до состава работ: не увидев этого, модель начнёт
    // аудировать договор, которого ей не показывали.
    lines.push(
      "ТЕКСТА ДОГОВОРА НЕТ. Red-flag аудит (3.1) НЕ ВЫПОЛНЯЕТСЯ: «документ",
      "целиком, фрагмент договора не аудируется». Не предполагай, какие условия",
      "в договоре написаны, — их тебе не показывали. Скажи прямо, что аудит",
      "невозможен, и назови, что для него нужно.",
      "",
    );
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
    "ЗАДАЧА — то, для чего состава работ ДОСТАТОЧНО.",
    "1. РАЗГРАНИЧЕНИЕ ОБЪЁМА (дельта В-4, снята на этом же объекте): по дорогим",
    "   позициям скажи, чья это зона — наши работы, давальческий материал",
    "   заказчика или работы заказчика, — и где принадлежность СПОРНА. Договор",
    "   без разграничения = подписанный убыток, и матрица нужна ДО финмодели.",
    "2. КАКИЕ УСЛОВИЯ ДОГОВОР ОБЯЗАН СОДЕРЖАТЬ ПРИ ЭТОМ СОСТАВЕ РАБОТ и почему",
    "   именно при этом: срок уведомления о скрытых работах — потому что скрытые",
    "   работы здесь есть; порядок распределения экономии (ст. 710 ГК) — потому",
    "   что есть чему экономиться; порядок ДС; право на работы (ст. 743 ГК).",
    "   Условие без привязки к составу работ — общее место, оно не нужно.",
    "3. ЧТО ЗАПРОСИТЬ и у кого, чтобы аудит стал возможен.",
    "",
    "РИСК — В РУБЛЯХ (протокол 2): «опасно» без цифры не существует. Сумму под",
    "угрозой бери из переданных позиций и указывай её основание.",
    "",
    "НЕ ВЫДУМЫВАЙ УСЛОВИЙ ДОГОВОРА. «Вероятно, там штраф 0,1%/день» — это не",
    "аудит, а сочинение на тему договора, и читатель примет его за прочитанное.",
    "",
    "ТРЕТЬЯ КОЛОНКА (протокол 3): у каждой правки называй, что скажет вторая",
    "сторона. Правка без возражения второй стороны не переживает переговоров.",
    "",
    "В impactOrdinal указывай порядковый номер позиции либо пустую строку.",
  );

  return lines.join("\n");
}

/** Риск в рублях берётся из сметы, а не из ответа модели (§12.1д). */
function evidenceOf(input: ContractAuditAgentInput): AgentEvidence {
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

export function createContractAuditOperation(deps: ContractAuditDeps) {
  return createAgentOperation<ContractAuditAgentInput>({
    definition: RUN_CONTRACT_AUDIT,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.works.length > 0 }),
    runAgent: deps.runAgent,
  });
}
