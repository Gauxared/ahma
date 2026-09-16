/**
 * Агент Настеньки (администратор) — паспорт объекта. ТЗ §5.1, §12.2.
 *
 * Седьмой из девяти и четвёртый объектный. Работает на такте 0: она первая, кто
 * смотрит на объект, и от её паспорта зависит, правильно ли поймут его
 * остальные.
 *
 * ЧТО СЧИТАЕТ МОДУЛЬ, А ЧТО ГОВОРИТ МОДЕЛЬ
 *
 * Считает `modules/intake/object-passport.ts`: поля шаблона, пометка
 * невыведенного, реестр поручений из воркфлоу. Это форма, и она детерминирована.
 *
 * Модель отвечает на вопрос, которого форма не задаёт: ЧТО ЭТО ЗА ОБЪЕКТ.
 * «Смет 4, позиций 101» — это размер, а не предмет. Понять, что перед тобой
 * система видеонаблюдения на железнодорожном переезде, можно только прочитав
 * наименования работ.
 *
 * ДОГАДКА В ПАСПОРТЕ ДОРОЖЕ ДОГАДКИ ГДЕ-ЛИБО ЕЩЁ
 *
 * Паспорт читают все остальные агенты и люди. Поле, додуманное здесь,
 * расходится по всей цепочке уже как факт — поэтому невыведенное помечается, а
 * не заполняется правдоподобным.
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

export type ObjectPassportBody = AgentReviewBody;

export const RUN_OBJECT_PASSPORT: OperationDefinition = {
  id: "run-object-passport",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["object_passport"],
  preconditions: [],
};

export interface DocumentForPassport {
  readonly fileName: string;
  readonly kind: string;
  readonly status: string;
  /** Почему не разобран, если не разобран. */
  readonly reason?: string | undefined;
}

export interface WorkGroupForPassport {
  readonly table: string;
  readonly name: string;
  readonly count: number;
  readonly amount: string;
}

export interface ObjectPassportAgentInput {
  readonly documentPath: string;
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  readonly objectCode: string;
  readonly documents: readonly DocumentForPassport[];
  readonly workGroups: readonly WorkGroupForPassport[];
  readonly positions: number;
  readonly declaredTotal?: string | undefined;
  /** Чего нет и на каком такте появится. */
  readonly expectedLater: readonly string[];
}

export interface ObjectPassportDeps {
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

function buildPrompt(input: ObjectPassportAgentInput): string {
  const lines: string[] = [
    `Объект: ${input.objectCode} (${input.documentPath})`,
    "",
    "ДОКУМЕНТЫ В КОМПЛЕКТЕ:",
  ];

  for (const document of input.documents) {
    lines.push(
      `  ${document.fileName} — ${document.kind}, ${document.status}` +
        (document.reason === undefined ? "" : ` (${document.reason})`),
    );
  }

  lines.push(
    "",
    `ПОЗИЦИЙ РАЗОБРАНО: ${input.positions}`,
    ...(input.declaredTotal === undefined
      ? ["СМЕТНАЯ СТОИМОСТЬ: не выведена — сводного расчёта нет либо он не сверен"]
      : [`СМЕТНАЯ СТОИМОСТЬ ПО СВОДНОМУ РАСЧЁТУ: ${input.declaredTotal} ₽`]),
    "",
    "СОСТАВ РАБОТ ПО ГРУППАМ:",
  );

  for (const group of input.workGroups) {
    lines.push(`  ${group.table} «${group.name}» — позиций ${group.count}, ${group.amount} ₽`);
  }

  if (input.expectedLater.length > 0) {
    // «Ожидается позже» и «отсутствует» — разные вещи, и смешать их значит
    // либо поднять ложную тревогу, либо скрыть настоящую пропажу.
    lines.push("", "ОЖИДАЕТСЯ НА СЛЕДУЮЩИХ ТАКТАХ (это НЕ пропажа):");
    for (const item of input.expectedLater) lines.push(`  · ${item}`);
  }

  lines.push(
    "",
    "ЗАДАЧА.",
    "1. ЧТО ЭТО ЗА ОБЪЕКТ — одной фразой по существу: вид сооружения, что на нём",
    "   делается, чем это подтверждается в документах. «Смет 4, позиций 101» —",
    "   это размер, а не предмет.",
    "2. СОСТАВ УКРУПНЁННО: из каких групп работ он собран.",
    "3. ЧЕГО В КОМПЛЕКТЕ НЕТ и на каком такте это появляется.",
    "4. НА ЧТО ОБРАТИТЬ ВНИМАНИЕ СРАЗУ — то, что видно из документов и повлияет",
    "   на дальнейшую работу.",
    "",
    "НЕ ДОДУМЫВАЙ поля, которых нет в документах: паспорт читают все остальные,",
    "и догадка разойдётся по цепочке уже как факт. Помечай отсутствующее.",
    "",
    "Каждое наблюдение несёт основание: имя документа, шифр, сумма.",
  );

  return lines.join("\n");
}

/** У паспорта нет сумм по позициям: его предмет — объект целиком. */
function evidenceOf(input: ObjectPassportAgentInput): AgentEvidence {
  return {
    amounts: new Map(),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "объект",
  };
}

export function createObjectPassportOperation(deps: ObjectPassportDeps) {
  return createAgentOperation<ObjectPassportAgentInput>({
    definition: RUN_OBJECT_PASSPORT,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.positions > 0 }),
    runAgent: deps.runAgent,
  });
}
