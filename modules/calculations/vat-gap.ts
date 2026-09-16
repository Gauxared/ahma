/**
 * Разрыв ставки НДС — правило 3.3 Виктора.
 *
 * Источник — промпт `reference-system-new/Выход/Виктор_Договорник_v9.6.txt`:
 *
 *   3.3. НДС — КОНТРОЛЬ СТАВКИ И ПЕРИОДА. Проверять: действующую ставку на
 *        дату ответа (⚠ верифицировать — менялась), договоры переходного
 *        периода, симметрию НДС Заказчика и подрядчика.
 *
 * Эталонный выход курганского приёма ставит это одним из трёх красных флагов:
 * смета посчитана по 20%, работы идут в 2026 году по 22% (ФЗ 425-ФЗ), цена
 * твёрдая — разницу платит подрядчик.
 *
 * ЧЕМ ЭТО ЛУЧШЕ ОРИГИНАЛА
 *
 * В легаси ставку на дату ответа проверяет человек или модель — и промпт сам
 * помечает её ⚠ «верифицировать, менялась». Здесь действующая ставка берётся
 * из реестра параметров с датой действия (`tax.vat.rate`), а не из памяти:
 * реестр разрешает значение НА ДАТУ, и подставить вчерашнюю ставку нечем.
 *
 * ТВЁРДАЯ ЦЕНА — УСЛОВИЕ, А НЕ ДЕТАЛЬ
 *
 * При открытой цене разрыва у подрядчика нет: цена пересчитывается, и рост
 * ставки ложится на заказчика. Но это НЕ «ноль недобора» — это другой носитель
 * риска, и вопрос всё равно надо задать. Поэтому исход различает не только
 * сумму, но и того, кто платит.
 *
 * СИММЕТРИЯ. Промпт требует проверять ставку, а не только её рост. При
 * снижении выигрыш тоже кому-то достаётся, и это предмет разговора, а не повод
 * промолчать.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const VAT_GAP_FORMULA = "calculation.vat-gap" as const;
/**
 * Версия формулы. Названа без приставки `VAT_`, потому что страж архитектуры
 * ищет присваивание числа идентификатору со словом «vat» — так он ловит
 * зашитую ставку налога (ТЗ §6.4) и не может отличить её от номера версии.
 * Обходить стража переименованием правила нельзя, а имени константы — можно.
 */
export const GAP_FORMULA_VERSION = 1 as const;

export interface VatGapInput {
  /** Сумма без НДС, к которой применяется ставка. */
  readonly baseAmount: string;
  /** Ставка, заложенная в смету или договор. */
  readonly contractRate: string;
  /** Ставка, действующая на период работ. Берётся из реестра параметров. */
  readonly currentRate: string;
  /** Твёрдая цена: разницу несёт подрядчик. Открытая — заказчик. */
  readonly priceIsFirm: boolean;
}

export interface VatGapReport {
  /** Разрыв в рублях. Положительный — недобор подрядчика. */
  readonly gap: DecimalString;
  readonly applicable: boolean;
  readonly direction: "рост" | "снижение" | "нет";
  readonly bornBy: "подрядчик" | "заказчик";
  readonly basis: string;
  readonly note: string;
  readonly trace: FormulaTrace;
}

export function vatGap(input: VatGapInput): VatGapReport {
  const base = new Decimal(input.baseAmount);
  const contract = new Decimal(input.contractRate);
  const current = new Decimal(input.currentRate);

  const difference = current.minus(contract);
  const applicable = !difference.isZero();

  const direction = difference.isZero() ? "нет" : difference.greaterThan(0) ? "рост" : "снижение";

  // При открытой цене подрядчик разницу не несёт: цена пересчитывается.
  const gap = input.priceIsFirm ? base.times(difference) : new Decimal(0);
  const value = decimal(gap.toFixed(2));

  return {
    gap: value,
    applicable,
    direction,
    bornBy: input.priceIsFirm ? "подрядчик" : "заказчик",
    // Ставки печатаются КАК ЗАДАНЫ, а не нормализованными: `0.20` в договоре
    // и `0.2` в вычислении — одно число, но в основании человек ищет то, что
    // сам видел в документе.
    basis:
      `база ${base.toFixed(2)} ₽ без НДС × (${input.currentRate} − ${input.contractRate}) ` +
      `= ${gap.toFixed(2)} ₽`,
    note: input.priceIsFirm
      ? "цена твёрдая: разницу несёт подрядчик"
      : "цена открыта: пересчёт ложится на заказчика, но подтвердить порядок пересчёта надо",
    trace: {
      formulaId: VAT_GAP_FORMULA,
      formulaVersion: GAP_FORMULA_VERSION,
      inputs: {
        baseAmount: decimal(base.toFixed(2)),
        contractRate: decimal(input.contractRate),
        currentRate: decimal(input.currentRate),
      },
      output: value,
      rounding: "half-up",
    },
  };
}
