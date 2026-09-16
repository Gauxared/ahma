/**
 * Банковская гарантия против гарантийного удержания — правило 3.2 Виктора.
 *
 * Источник — промпт `reference-system-new/Выход/Виктор_Договорник_v9.6.txt`:
 *
 *   3.2. БГ vs ГУ — СИСТЕМНЫЙ ВОПРОС КАЖДОГО B2G, Такт 1:
 *        Расчёт: стоимость БГ (ставка %/год × сумма × срок) против заморозки
 *        ГУ вне оборота. (Школа №19: ГУ 101 млн на 5 лет против БГ ≈ 2,3 млн —
 *        замена обязательна к проработке.)
 *
 * ЧТО С ЧЕМ СРАВНИВАЕТСЯ
 *
 * Гарантийное удержание — деньги подрядчика, замороженные у заказчика.
 * Банковская гарантия — процент банку, деньги остаются в обороте.
 *
 * Сравнивать «сумму удержания с ценой гарантии» неверно: удержание вернётся,
 * а гарантия — расход. Сравнивать надо СТОИМОСТЬ ДЕНЕГ: во что обходится
 * заморозка суммы на срок против прямой платы за гарантию.
 *
 * ЧЕМ ЭТО ЛУЧШЕ ОРИГИНАЛА
 *
 * В легаси расчёт делает человек по ставкам «из базы, с датой ⚠». Здесь обе
 * ставки — параметры реестра с датой действия: стоимость капитала берётся из
 * `finance.key_rate`, ставка гарантии задаётся явно. Подставить прошлогоднюю
 * ставку молча нельзя — реестр разрешает значение НА ДАТУ.
 *
 * РЕКОМЕНДАЦИЯ — СЛЕДСТВИЕ ЧИСЕЛ, А НЕ ПРАВИЛО
 *
 * Промпт называет замену «обязательной к проработке», но не автоматической:
 * дорогая гарантия при дешёвом капитале делает её невыгодной. Поэтому вывод
 * считается, а не назначается.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const GUARANTEE_FORMULA = "calculation.guarantee-comparison" as const;
export const GUARANTEE_VERSION = 1 as const;

export interface GuaranteeInput {
  /** Сумма гарантийного удержания. */
  readonly retentionAmount: string;
  /** Срок в годах. */
  readonly years: string;
  /** Ставка банковской гарантии, доля в год. */
  readonly guaranteeRatePerYear: string;
  /** Стоимость капитала подрядчика, доля в год. Ключевая ставка либо цена долга. */
  readonly capitalCostPerYear: string;
}

export interface GuaranteeComparison {
  /** Прямая плата банку за гарантию. */
  readonly guaranteeCost: DecimalString;
  /** Цена заморозки удержания: сумма × стоимость капитала × срок. */
  readonly retentionCost: DecimalString;
  /** Выгода замены ГУ на БГ. Отрицательная — замена невыгодна. */
  readonly saving: DecimalString;
  readonly recommendation: "заменить ГУ на БГ" | "оставить ГУ";
  readonly basis: string;
  readonly trace: FormulaTrace;
}

export function compareGuarantee(input: GuaranteeInput): GuaranteeComparison {
  const amount = new Decimal(input.retentionAmount);
  const years = new Decimal(input.years);
  const guaranteeRate = new Decimal(input.guaranteeRatePerYear);
  const capitalRate = new Decimal(input.capitalCostPerYear);

  const guaranteeCost = amount.times(guaranteeRate).times(years);
  const retentionCost = amount.times(capitalRate).times(years);
  const saving = retentionCost.minus(guaranteeCost);

  const value = decimal(saving.toFixed(2));

  return {
    guaranteeCost: decimal(guaranteeCost.toFixed(2)),
    retentionCost: decimal(retentionCost.toFixed(2)),
    saving: value,
    // Вывод считается: замена выгодна ровно тогда, когда заморозка дороже платы.
    recommendation: saving.greaterThan(0) ? "заменить ГУ на БГ" : "оставить ГУ",
    basis:
      `удержание ${amount.toFixed(2)} ₽ на ${input.years} г.: ` +
      `БГ ${input.guaranteeRatePerYear}/год = ${guaranteeCost.toFixed(2)} ₽, ` +
      `заморозка по ${input.capitalCostPerYear}/год = ${retentionCost.toFixed(2)} ₽`,
    trace: {
      formulaId: GUARANTEE_FORMULA,
      formulaVersion: GUARANTEE_VERSION,
      inputs: {
        retentionAmount: decimal(amount.toFixed(2)),
        years: decimal(input.years),
        guaranteeRatePerYear: decimal(input.guaranteeRatePerYear),
        capitalCostPerYear: decimal(input.capitalCostPerYear),
      },
      output: value,
      rounding: "half-up",
    },
  };
}
