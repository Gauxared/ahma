/**
 * Агент Тимофея (планировщик) — график производства работ. Десятый документ.
 *
 * ПОЧЕМУ ОН ПОЯВИЛСЯ ПОСЛЕДНИМ И ПОЧЕМУ ВСЁ-ТАКИ ПОЯВИЛСЯ
 *
 * Десятый документ эталонного пакета — «График производства работ» — девять
 * месяцев значился объявленным отсутствием: «агента нет». Это было честно, но
 * неполно: пакет обещает заказчику десять документов, и десятая строка стояла
 * пустой при полном комплекте входных данных.
 *
 * ЕГО ПРЕДМЕТ — ВРЕМЯ, А НЕ ДЕНЬГИ. Остальные девять отвечают «что не так»;
 * этот отвечает «когда» и «из-за чего не когда». Он второй агент СИНТЕЗА и,
 * как Артемий, читает то, что сказали остальные: риск снабженца — это недели
 * ожидания поставки, замечание ПТО о незакрытом чек-листе старта — это недели
 * до выхода на объект.
 *
 * ОТСЧЁТ В НЕДЕЛЯХ ОТ Т0, И ЭТО НЕ УПРОЩЕНИЕ
 *
 * Т0 — дата подписания договора, и до подписания её не знает никто. Календарный
 * график, построенный на выдуманной дате, выглядит точнее, чем он есть: читатель
 * поверит числам, у которых нет основания. Недели от Т0 — единственная честная
 * шкала, и её приходится объявлять допущением каждый раз.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ
 *
 * Не считает деньги: их считают Ваныч и Людмила, и второй счёт разошёлся бы с
 * первым. Не берёт длительности из переданных документов — их там нет; он берёт
 * их по типовым нормам и обязан сказать об этом в допущениях. Разница между
 * «посчитано по вашему объекту» и «взято по норме» здесь и есть предмет доверия.
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

export type ScheduleAgentBody = AgentReviewBody;

export const RUN_SCHEDULE: OperationDefinition = {
  id: "run-schedule",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["work_schedule"],
  preconditions: [],
};

/** Что сказал смежник — то же, что видит вердикт, и по той же причине. */
export interface SchedulePeer {
  readonly capability: string;
  readonly verdict: string;
  readonly findings: readonly { readonly severity: string; readonly statement: string }[];
  readonly error?: string;
}

export interface ScheduleAgentInput {
  readonly documentPath: string;
  readonly contentHash: Sha256;
  /** Итог обхода: от него зависит, есть ли вообще что планировать. */
  readonly walkVerdict: string;
  /** Сколько смет и позиций прошло разбор — грубая мера объёма работ. */
  readonly estimates: number;
  readonly positions: number;
  readonly peers: readonly SchedulePeer[];
  /** Чего не хватило на входе: каждый пробел — это допущение в графике. */
  readonly missing: readonly string[];
}

export interface ScheduleAgentDeps {
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

function buildPrompt(input: ScheduleAgentInput): string {
  const lines: string[] = [
    `Объект: ${input.documentPath}`,
    "",
    `ИТОГ ОБХОДА (посчитан детерминированно): ${input.walkVerdict}`,
    `ОБЪЁМ: смет разобрано ${input.estimates}, позиций ${input.positions}.`,
    "",
    "ЧТО СКАЗАЛИ СМЕЖНИКИ — из этого и складываются сроки и задержки:",
  ];

  for (const peer of input.peers) {
    if (peer.error !== undefined) {
      // Отказ смежника — это не «у него нет рисков», а «его риски неизвестны».
      // График, построенный без них, выглядит спокойнее, чем есть основания.
      lines.push(`  ${peer.capability}: ОТКАЗ — ${peer.error}`);
      continue;
    }

    lines.push(`  ${peer.capability}: ${peer.verdict}`);
    for (const finding of peer.findings) lines.push(`    [${finding.severity}] ${finding.statement}`);
  }

  if (input.missing.length > 0) {
    lines.push("", "ЧЕГО НЕТ НА ВХОДЕ (каждый пробел — допущение графика):");
    for (const item of input.missing) lines.push(`  · ${item}`);
  }

  lines.push(
    "",
    "ЗАДАЧА. Построй график производства работ В НЕДЕЛЯХ ОТ Т0 (дата договора).",
    "",
    "1. ТРИ СЦЕНАРИЯ СРОКА — оптимистичный, реалистичный, пессимистичный. У",
    "   каждого срок в неделях И УСЛОВИЕ его наступления. Сценарий без условия —",
    "   это число, а не сценарий.",
    "2. ФАЗЫ И РАБОТЫ: работа, ответственный, старт (неделя от Т0), длительность",
    "   (недель), на критическом ли пути. Критический путь — то, что определяет",
    "   срок объекта: сдвинулось оно — сдвинулся объект.",
    "3. РИСКИ-ЗАДЕРЖКИ: каждый В НЕДЕЛЯХ, с вероятностью, мерой и держателем.",
    "   Риск без недель — беспокойство, а не риск.",
    "4. ДОПУЩЕНИЯ: что заложено и чего в исходных данных не было.",
    "",
    "ПЕРВОЕ ДОПУЩЕНИЕ ВСЕГДА ОДНО И ТО ЖЕ: Т0 неизвестна, весь график висит на",
    "ней. Не называй календарных дат — их не знает никто до подписания.",
    "",
    "Длительности бери по типовым нормам и ГОВОРИ ОБ ЭТОМ в допущениях: разница",
    "между «посчитано по вашему объекту» и «взято по норме» — это предмет доверия.",
    "",
    "Деньги не считай: их считают эконом и сметчик, и второй счёт разойдётся.",
    "",
    "Каждый сценарий, работу критического пути и риск оформляй ЗАМЕЧАНИЕМ:",
    "  · severity: critical — то, что сдвигает срок объекта;",
    "  · severity: high — то, что сдвигает фазу;",
    "  · severity: medium — то, что поглощается запасом.",
    "В impactOrdinal оставляй пустую строку: твой предмет — объект целиком.",
    "В openQuestions вынеси то, без чего срок не уточнить: что, с кого, к сроку.",
  );

  return lines.join("\n");
}

/**
 * У графика нет суммы по позиции.
 *
 * Его предмет — время объекта целиком, и пустая таблица означает, что оболочка
 * оставит влияние незаполненным, а не подставит ноль (§9). Поставить сюда рубли
 * значило бы завести второй счёт денег рядом с расчётным модулем.
 */
function evidenceOf(input: ScheduleAgentInput): AgentEvidence {
  return {
    amounts: new Map(),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "объект",
  };
}

export function createScheduleOperation(deps: ScheduleAgentDeps) {
  return createAgentOperation<ScheduleAgentInput>({
    definition: RUN_SCHEDULE,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    // «Есть смета» здесь значит «есть что планировать»: без разобранных смет
    // график был бы построен по одному имени объекта.
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.estimates > 0 }),
    runAgent: deps.runAgent,
  });
}
