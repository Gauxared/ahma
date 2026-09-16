/**
 * Отклонение и разброс — ТЗ §6.4, §5.2.
 *
 * ГЛАВНОЕ ТРЕБОВАНИЕ §5.2
 *
 *   «`не сопоставлено` — полноправный исход, а не ошибка; такие позиции по §5.2
 *    выделяются отдельно и В РАСЧЁТ РАЗБРОСА НЕ ВКЛЮЧАЮТСЯ.»
 *
 * Подрядчик, не давший цену на позицию, — не подрядчик с ценой ноль и не
 * подрядчик со средней ценой. Первое занижает минимум, второе сужает разброс и
 * прячет саму несопоставимость. Поэтому несопоставленные проходят через расчёт
 * отдельным списком и НАЗЫВАЮТСЯ в пояснении: исход, о котором не сказано, —
 * то же самое, что исход, которого не было.
 *
 * ПОЧЕМУ МЕДИАНА, А НЕ СРЕДНЕЕ
 *
 * Одно предложение с ошибкой в порядке величины сдвигает среднее и не сдвигает
 * медиану. §5.2 требует медиану — и требует называть аномалии отдельно, с
 * суммой влияния, а не растворять их в показателе.
 *
 * ОДНО ПРЕДЛОЖЕНИЕ — НЕ ВЫБОРКА
 *
 * Разброс одного значения арифметически равен единице. Выданный как результат,
 * он утверждает согласие рынка, которого никто не наблюдал. Поэтому по одному
 * предложению разброс не считается, а объявляется невычислимым.
 */
import { Decimal } from "decimal.js";

import { decimal, unitCode } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const DEVIATION_FORMULA = "calculation.deviation" as const;
export const DEVIATION_VERSION = 1 as const;

export const SPREAD_FORMULA = "calculation.spread" as const;
export const SPREAD_VERSION = 1 as const;

function money(value: Decimal): DecimalString {
  return decimal(value.toFixed(2));
}

function fraction(value: Decimal): DecimalString {
  return decimal(value.toFixed(4));
}

export interface Deviation {
  /** Факт минус база, в рублях. Знак сохраняется: экономия и перерасход разные. */
  readonly absolute: DecimalString;
  /** Доля от базы. Отсутствует, когда база нулевая. */
  readonly relative?: DecimalString;
  readonly computable: boolean;
  readonly reason?: string;
  readonly trace?: FormulaTrace;
}

export function deviation(input: {
  readonly actual: string;
  readonly base: string;
}): Deviation {
  const actual = new Decimal(input.actual);
  const base = new Decimal(input.base);
  const absolute = money(actual.minus(base));

  if (base.isZero()) {
    // Позиция, которой в базе не было: расхождение в рублях есть, а «на
    // сколько процентов» — вопрос без ответа. Ответить нулём значило бы
    // сказать «расхождения нет» (§9).
    return {
      absolute,
      computable: false,
      reason: "относительное отклонение не вычисляется: база равна нулю",
    };
  }

  const relative = fraction(actual.minus(base).dividedBy(base));

  return {
    absolute,
    relative,
    computable: true,
    trace: {
      formulaId: DEVIATION_FORMULA,
      formulaVersion: DEVIATION_VERSION,
      inputs: { actual: decimal(input.actual), base: decimal(input.base) },
      output: relative,
      unit: unitCode("fraction"),
      rounding: "half-up",
    },
  };
}

export interface Offer {
  readonly source: string;
  readonly amount: string;
}

export interface UnmatchedOffer {
  readonly source: string;
  readonly reason: string;
}

export interface Anomaly {
  readonly source: string;
  readonly amount: string;
  /** Насколько предложение отличается от медианы в рублях (§5.2: сумма влияния). */
  readonly impact: DecimalString;
  readonly ratio: DecimalString;
}

export interface Spread {
  readonly min?: DecimalString;
  readonly max?: DecimalString;
  readonly median?: DecimalString;
  /** Максимум / минимум. Отсутствует, когда минимум нулевой. */
  readonly ratio?: DecimalString;
  /** Сколько предложений вошло в расчёт. */
  readonly comparable: number;
  readonly unmatched: readonly UnmatchedOffer[];
  readonly anomalies: readonly Anomaly[];
  readonly computable: boolean;
  readonly reason?: string;
  readonly note: string;
  readonly trace?: FormulaTrace;
}

/** Порог аномалии по умолчанию: отличие от медианы более чем в два раза. */
const DEFAULT_ANOMALY_RATIO = "2";

export function spread(input: {
  readonly offers: readonly Offer[];
  readonly unmatched?: readonly UnmatchedOffer[];
  readonly anomalyRatio?: string;
}): Spread {
  const unmatched = input.unmatched ?? [];

  const note = (() => {
    if (unmatched.length === 0) {
      return `в расчёт вошли все ${input.offers.length} предложений`;
    }
    const names = unmatched.map((item) => `${item.source} (${item.reason})`).join(", ");
    return `в расчёт вошли ${input.offers.length} предложений; НЕ входят несопоставленные по §5.2: ${names}`;
  })();

  if (input.offers.length === 0) {
    return {
      comparable: 0,
      unmatched,
      anomalies: [],
      computable: false,
      reason: "нет ни одного сопоставимого предложения: разброс не по чему считать",
      note,
    };
  }

  const sorted = [...input.offers].sort((a, b) => new Decimal(a.amount).comparedTo(new Decimal(b.amount)));
  const amounts = sorted.map((offer) => new Decimal(offer.amount));

  const min = amounts[0]!;
  const max = amounts[amounts.length - 1]!;

  const middle = Math.floor(amounts.length / 2);
  const median =
    amounts.length % 2 === 1
      ? amounts[middle]!
      : amounts[middle - 1]!.plus(amounts[middle]!).dividedBy(2);

  const inputs: Record<string, DecimalString> = {};
  for (const offer of sorted) {
    inputs[offer.source] = decimal(offer.amount);
  }

  const trace: FormulaTrace = {
    formulaId: SPREAD_FORMULA,
    formulaVersion: SPREAD_VERSION,
    inputs,
    output: money(median),
    unit: unitCode("RUB"),
    rounding: "half-up",
  };

  const anomalyRatio = new Decimal(input.anomalyRatio ?? DEFAULT_ANOMALY_RATIO);
  const anomalies: Anomaly[] = median.isZero()
    ? []
    : sorted.flatMap((offer) => {
        const amount = new Decimal(offer.amount);
        const ratio = amount.dividedBy(median);
        const away = ratio.greaterThan(anomalyRatio) || ratio.lessThan(new Decimal(1).dividedBy(anomalyRatio));

        return away
          ? [
              {
                source: offer.source,
                amount: offer.amount,
                // §5.2: аномалия называется с СУММОЙ ВЛИЯНИЯ, а не только фактом.
                impact: money(amount.minus(median)),
                ratio: fraction(ratio),
              },
            ]
          : [];
      });

  const base = {
    min: money(min),
    max: money(max),
    median: money(median),
    comparable: sorted.length,
    unmatched,
    anomalies,
    note,
    trace,
  };

  if (sorted.length < 2) {
    return {
      ...base,
      computable: false,
      reason: "разброс не считается: одно предложение — не выборка, а его разброс равен единице по построению",
    };
  }

  if (min.isZero()) {
    return {
      ...base,
      computable: false,
      reason: "отношение максимума к минимуму не вычисляется: минимум равен нулю",
    };
  }

  return { ...base, ratio: fraction(max.dividedBy(min)), computable: true };
}
