/**
 * Сходимость сметы (ТЗ §6.4, критерий приёмки §12.1б: расхождение 0 ₽).
 *
 * Считает расчётный модуль, не языковая модель. Три уровня, и каждый нужен:
 *
 *  1. позиции → итог раздела;
 *  2. разделы → итог сметы;
 *  3. итог сметы → заявленная в шапке стоимость.
 *
 * Третий уровень отличается принципиально: шапка номинирована в ТЫС. РУБ.,
 * тогда как таблица — в рублях. Расхождение в пределах гранулярности шкалы
 * объясняется округлением источника, а не считается ошибкой сходимости.
 * Молча его гасить нельзя: инвариант ТЗ §9 «неизвестное не превращается в ноль»
 * работает в обе стороны — выдуманная точность так же недопустима.
 */
import { Decimal } from "decimal.js";

import { decimal, roundingGranularity } from "@contracts/index.js";
import type { DecimalString, FormulaTrace, StatedAs } from "@contracts/index.js";

// Суммы смет доходят до сотен миллионов с копейками; запас на порядки.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const CONVERGENCE_FORMULA = "calculation.convergence" as const;
export const CONVERGENCE_VERSION = 1 as const;

/**
 * Статусы разведены намеренно. Пустой раздел без объявленного итога — это
 * «нечего сверять», а не «не сошлось»: в курганском ЭОМ есть раздел 3 «Мебель»
 * без позиций и без итога. Считать его расхождением — ложная тревога; считать
 * сходимостью молча — нарушение инварианта §9 «неизвестное не превращается
 * в ноль». Поэтому третий, видимый статус.
 */
export type ConvergenceStatus = "converged" | "diverged" | "not_comparable";

export interface ConvergenceLevel {
  readonly scope: string;
  /**
   * Сумма слагаемых, посчитанная нами.
   *
   * ПУСТО — значит сложить нельзя: среди слагаемых есть неизвестные. Сложение
   * молча съедает незнание, и двадцать неизвестных сумм дали бы ровный «0.00»,
   * от которого §12.1б позеленел бы на смете без цен.
   */
  readonly computed: DecimalString | undefined;
  /** Итог, объявленный в документе. */
  readonly declared: DecimalString | undefined;
  /** computed − declared. */
  readonly delta: DecimalString | undefined;
  readonly status: ConvergenceStatus;
  readonly reason?: string;
  readonly trace: FormulaTrace;
}

export interface ScaleComparison {
  readonly documentTotal: DecimalString;
  /** Значение из шапки, приведённое к рублям. */
  readonly headerInRubles: DecimalString;
  readonly delta: DecimalString;
  readonly granularity: DecimalString;
  /** Объяснимо ли расхождение округлением шкалы источника. */
  readonly explainedByScale: boolean;
  readonly statedAs: StatedAs;
  readonly trace: FormulaTrace;
}

export interface ConvergenceReport {
  readonly sections: readonly ConvergenceLevel[];
  readonly document: ConvergenceLevel;
  readonly headerScale: ScaleComparison | undefined;
  /** Сошлось ли всё, что можно проверить точно (уровни 1 и 2). */
  readonly converged: boolean;
  /** Уровни, которые не с чем сверить, — предъявляются, а не замалчиваются. */
  readonly notComparable: readonly string[];
}

export interface SectionInput {
  readonly number: string;
  /** Итоги позиций; `undefined` — сумма неизвестна, а не равна нулю. */
  readonly positionTotals: readonly (string | undefined)[];
  readonly declaredTotal: string | undefined;
}

export interface ConvergenceInput {
  readonly sections: readonly SectionInput[];
  readonly declaredTotal: string | undefined;
  /** Стоимость из шапки в тыс. руб., если она есть в документе. */
  readonly headerTotalThousands?: string | undefined;
}

function sum(values: readonly string[]): Decimal {
  return values.reduce((accumulator, value) => accumulator.plus(new Decimal(value)), new Decimal(0));
}

/** Денежное значение всегда с двумя знаками: копейки не теряются и не выдумываются. */
function money(value: Decimal): DecimalString {
  return decimal(value.toFixed(2));
}

function trace(
  scope: string,
  inputs: Readonly<Record<string, DecimalString>>,
  output: DecimalString,
): FormulaTrace {
  return {
    formulaId: `${CONVERGENCE_FORMULA}.${scope}`,
    formulaVersion: CONVERGENCE_VERSION,
    inputs,
    output,
    rounding: "half-up",
  };
}

function level(
  scope: string,
  addends: readonly (string | undefined)[],
  declared: string | undefined,
): ConvergenceLevel {
  const inputs: Record<string, DecimalString> = {};
  addends.forEach((value, index) => {
    if (value !== undefined) inputs[`addend_${index + 1}`] = decimal(value);
  });
  if (declared !== undefined) {
    inputs["declared"] = decimal(declared);
  }

  /**
   * НЕИЗВЕСТНОЕ СЛАГАЕМОЕ ОСТАНАВЛИВАЕТ СЛОЖЕНИЕ.
   *
   * Проверяется ДО сравнения с объявленным итогом: иначе сумма известной части
   * встала бы на место итога уровня — число, похожее на правду и отличающееся
   * от настоящего ровно на то, чего мы не знаем.
   */
  const неизвестных = addends.filter((value) => value === undefined).length;

  if (неизвестных > 0) {
    return {
      scope,
      computed: undefined,
      declared: declared === undefined ? undefined : money(new Decimal(declared)),
      delta: undefined,
      status: "not_comparable",
      reason: `${неизвестных} позиций без суммы: сложить нельзя`,
      trace: trace(scope, inputs, decimal("0")),
    };
  }

  const computed = money(sum(addends.filter((value): value is string => value !== undefined)));

  if (declared === undefined) {
    return {
      scope,
      computed,
      declared: undefined,
      delta: undefined,
      status: "not_comparable",
      reason:
        addends.length === 0
          ? "раздел не содержит позиций и не объявляет итога"
          : "итог не объявлен в документе — сравнивать не с чем",
      trace: trace(scope, inputs, computed),
    };
  }

  const delta = money(new Decimal(computed).minus(new Decimal(declared)));

  return {
    scope,
    computed,
    declared: money(new Decimal(declared)),
    delta,
    status: new Decimal(delta).isZero() ? "converged" : "diverged",
    trace: trace(scope, inputs, delta),
  };
}

export function calculateConvergence(input: ConvergenceInput): ConvergenceReport {
  const sections = input.sections.map((section) =>
    level(`section:${section.number}`, section.positionTotals, section.declaredTotal),
  );

  const document = level(
    "document",
    sections.map((section) => section.computed),
    input.declaredTotal,
  );

  // Сошлось = ничто не разошлось и итог документа реально сверен.
  const converged =
    sections.every((section) => section.status !== "diverged") && document.status === "converged";

  return {
    sections,
    document,
    // Итог не посчитан — сверять с шапкой нечего: сравнение шкал требует
    // обеих величин, и подстановка нуля дала бы «расхождение» размером в
    // объявленную стоимость.
    headerScale:
      document.computed === undefined
        ? undefined
        : compareWithHeader(document.computed, input.headerTotalThousands),
    converged,
    notComparable: [...sections, document]
      .filter((level) => level.status === "not_comparable")
      .map((level) => level.scope),
  };
}

/**
 * Сверяет итог таблицы с заявленной в шапке стоимостью.
 *
 * Измерено на курганском комплекте: сумма четырёх ЛСР даёт 104 976 702.48 ₽,
 * а ССРСС объявляет 104 976.71 тыс. руб. — расхождение 7.52 ₽ при гранулярности
 * шкалы 10 ₽. Это округление источника, а не ошибка сметы.
 *
 * ШКАЛА ПРИХОДИТ ОТ ИСТОЧНИКА, А НЕ ЗАШИТА. Множитель 1000 стоял здесь
 * константой, потому что курганский сводный расчёт составлен в тыс. руб. Форма
 * 421/пр допускает и рубли — так составлен пакет Нижнего Тагила, — и на нём
 * зашитый множитель объявил бы расхождение в 999 раз больше стоимости объекта.
 * Число при этом выглядело бы посчитанным.
 */
export function compareWithHeader(
  documentTotal: DecimalString,
  headerTotal: string | undefined,
  statedAs: StatedAs = { scale: "thousand", fractionDigits: 2 },
): ScaleComparison | undefined {
  if (headerTotal === undefined) {
    return undefined;
  }

  const множитель = { unit: "1", thousand: "1000", million: "1000000" }[statedAs.scale];
  const headerInRubles = money(new Decimal(headerTotal).times(множитель));
  const delta = money(new Decimal(headerInRubles).minus(new Decimal(documentTotal)));
  const granularity = roundingGranularity(statedAs);

  return {
    documentTotal,
    headerInRubles,
    delta,
    granularity,
    explainedByScale: new Decimal(delta).abs().lessThanOrEqualTo(new Decimal(granularity)),
    statedAs,
    trace: trace(
      "header-scale",
      { documentTotal, headerInRubles, granularity },
      delta,
    ),
  };
}
