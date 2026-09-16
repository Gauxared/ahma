/**
 * Агент Ваныча (эконом) — финансовая модель объекта. ТЗ §5.1, §6.4, §12.2.
 *
 * Третий из девяти договорных агентов и ПЕРВЫЙ ОБЪЕКТНЫЙ: его предмет — стройка
 * целиком, а не отдельная смета. Прогнать его по каждой смете значило бы
 * получить четыре финмодели одного объекта, каждая по четверти картины.
 *
 * ЧТО СЧИТАЕТ МОДУЛЬ, А ЧТО ГОВОРИТ МОДЕЛЬ
 *
 * Считает `modules/calculations/scenarios.ts`: три сценария, маржу, долю маржи,
 * точку перелома, допущение по стрессу. Считает `finance.ts`: стоимость денег
 * за дни задержки по ключевой ставке. Это §6.4 — арифметику делает расчётный
 * модуль, и модель её не пересчитывает.
 *
 * Модель отвечает на то, чего правилами не получить:
 *
 *  · ПОТОЛКИ ПО ПАКЕТАМ (3.5). Как разбить объект на закупочные пакеты и где
 *    поставить предел — вопрос понимания состава работ, а не деления суммы.
 *    «Без потолков снабжение и подряд торгуются вслепую».
 *  · КАССОВЫЙ РАЗРЫВ (3.3) — «ищешь на входе, всегда». Даты платежей нет, и
 *    выдумывать её нельзя; но сказать, при каком сценарии и на какой сумме
 *    разрыв возникнет, и чего не хватает для даты — можно.
 *  · ПРИМОРТЕМ (3.7) — пять причин, по которым ЭТА модель окажется ошибочной,
 *    названные применительно к тому, что мы о ней знаем.
 *
 * СЕБЕСТОИМОСТЬ НЕ ВЫВОДИТСЯ ИЗ СМЕТЫ
 *
 * Чек-лист приёмки Ваныча требует этого прямо: «смета — цена заказчику, не
 * затраты». До 02.09.2026 отчёт передавал итог сметы в сценарии как затраты, и
 * маржа выходила втрое меньше (О-76). Здесь затраты приходят отдельным входом,
 * а сметная стоимость передаётся модели ОТДЕЛЬНО и с оговоркой.
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

export type FinanceModelBody = AgentReviewBody;

export const RUN_FINANCE_MODEL: OperationDefinition = {
  id: "run-finance-model",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["finance_model"],
  preconditions: [],
};

/** Сценарий в форме, нужной агенту: числа уже посчитаны. */
export interface ScenarioForAgent {
  readonly id: string;
  readonly revenue: string;
  readonly costs: string;
  readonly margin: string;
  readonly marginShare: string;
  readonly profitable: boolean;
}

/**
 * Кандидат в закупочный пакет — группа работ по таблице норм.
 *
 * Именно КАНДИДАТ: как разбивать объект на пакеты, решает Ваныч. Модуль лишь
 * показывает, из чего объект состоит и сколько это стоит.
 */
export interface PackageCandidate {
  readonly table: string;
  readonly name: string;
  readonly amount: string;
  /** Доля в сметной стоимости объекта, четыре знака. */
  readonly share: string;
}

/** Стоимость денег: во что обходится задержка оплаты (3.6). */
export interface MoneyCost {
  readonly days: number;
  readonly annualRate: string;
  /** Дата, с которой действует ставка. Ставка без даты — не ставка. */
  readonly rateSince: string;
  readonly amount: string;
}

export interface FinanceModelAgentInput {
  /** Путь ОБЪЕКТА, а не документа: предмет Ваныча — стройка целиком. */
  readonly documentPath: string;
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  /** Сметная стоимость — ЦЕНА ЗАКАЗЧИКУ. Не себестоимость (чек-лист Ваныча). */
  readonly declaredTotal: string;
  readonly scenarios: readonly ScenarioForAgent[];
  /** Первый сценарий с отрицательной маржой. Отсутствует, если разрыва нет. */
  readonly breaksAt?: string;
  /** Допущение по стрессу: протокол его числами не задаёт. */
  readonly assumption: string;
  readonly packages: readonly PackageCandidate[];
  readonly moneyCost: MoneyCost;
  /** Чего нет для полной модели. Пусто — значит есть всё. */
  readonly missing: readonly string[];
}

export interface FinanceModelDeps {
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

function buildPrompt(input: FinanceModelAgentInput): string {
  const lines: string[] = [
    `Объект: ${input.documentPath}`,
    "",
    `СМЕТНАЯ СТОИМОСТЬ: ${input.declaredTotal} ₽ — это ЦЕНА ЗАКАЗЧИКУ, а не наши`,
    "затраты. Себестоимость приходит отдельно; принять одно за другое значит",
    "посчитать маржу нулевой и не заметить этого.",
    "",
  ];

  if (input.scenarios.length > 0) {
    lines.push("СЦЕНАРИИ (посчитаны расчётным модулем, §6.4):");

    for (const scenario of input.scenarios) {
      lines.push(
        `  ${scenario.id}: выручка ${scenario.revenue} ₽, затраты ${scenario.costs} ₽, ` +
          `маржа ${scenario.margin} ₽ (${scenario.marginShare})` +
          (scenario.profitable ? "" : " — УБЫТОК"),
      );
    }

    lines.push(
      input.breaksAt === undefined
        ? "  перелома нет: все сценарии прибыльны"
        : `  перелом на сценарии «${input.breaksAt}»`,
      `  ${input.assumption}`,
      "",
    );
  } else {
    // Молчание здесь читалось бы как «сценарии сошлись». Их просто нет.
    lines.push("СЦЕНАРИИ НЕ ПОСТРОЕНЫ: не заданы выручка и себестоимость.", "");
  }

  lines.push(
    "СТОИМОСТЬ ДЕНЕГ (посчитана расчётным модулем):",
    `  задержка оплаты на ${input.moneyCost.days} дней при ключевой ставке ` +
      `${input.moneyCost.annualRate} (действует с ${input.moneyCost.rateSince}) — ` +
      `${input.moneyCost.amount} ₽`,
    "",
  );

  if (input.packages.length > 0) {
    lines.push("СОСТАВ ОБЪЕКТА — КАНДИДАТЫ В ЗАКУПОЧНЫЕ ПАКЕТЫ:");

    for (const candidate of input.packages) {
      lines.push(
        `  ${candidate.table} «${candidate.name}» — ${candidate.amount} ₽, доля ${candidate.share}`,
      );
    }

    lines.push("");
  }

  if (input.missing.length > 0) {
    // Названо ЧЕГО нет: иначе модель либо выдумает недостающее, либо промолчит
    // о неполноте, и оба исхода хуже прямого перечня.
    lines.push("ЧЕГО НЕТ ДЛЯ ПОЛНОЙ МОДЕЛИ:");
    for (const item of input.missing) lines.push(`  · ${item}`);
    lines.push("");
  }

  lines.push(
    "ЗАДАЧА.",
    "1. ПОТОЛКИ (3.5): предложи разбиение на закупочные пакеты и потолок цены",
    "   по каждому — в рублях. Без потолков снабжение и подряд торгуются вслепую.",
    "2. КАССОВЫЙ РАЗРЫВ (3.3): при каком сценарии и на какой сумме он возникнет.",
    "   Даты платежей нет — НЕ ВЫДУМЫВАЙ дату, скажи, что нужно для её расчёта.",
    "3. КОРИДОР МАРЖИ: меньше 5% — подрядчик «попал», больше 25% — «надувает».",
    "   И то, и другое требует объяснения, а не одобрения.",
    "4. ПРИМОРТЕМ (3.7): пять причин, по которым ЭТА модель окажется ошибочной.",
    "",
    "Числа НЕ пересчитывай: они посчитаны расчётным модулем и переданы выше.",
    "В impactOrdinal оставляй пустую строку — твой предмет объект, а не позиция.",
    "Недостающее помещай в openQuestions с адресатом и сроком.",
  );

  return lines.join("\n");
}

/**
 * У Ваныча суммы влияния по позициям НЕТ.
 *
 * Его предмет — объект целиком: замечание «маржа за коридором» не относится к
 * строке сметы. Пустая таблица означает, что оболочка оставит влияние
 * незаполненным, а не подставит ноль — неизвестное не превращается в ноль (§9).
 */
function evidenceOf(input: FinanceModelAgentInput): AgentEvidence {
  return {
    amounts: new Map(),
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "ССРСС",
  };
}

export function createFinanceModelOperation(deps: FinanceModelDeps) {
  return createAgentOperation<FinanceModelAgentInput>({
    definition: RUN_FINANCE_MODEL,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    // Точность финмодели определяется полнотой входа, а не наличием сметы:
    // смета есть всегда, а выручки и затрат может не быть.
    accuracy: (input) => deps.accuracyMarker({ hasEstimate: input.missing.length === 0 }),
    runAgent: deps.runAgent,
  });
}
