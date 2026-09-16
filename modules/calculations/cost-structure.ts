/**
 * Себестоимость по элементам затрат и ₽/м² — ТЗ §6.4.
 *
 * ДВА РАЗНЫХ ВОПРОСА
 *
 * «По элементам» отвечает, ИЗ ЧЕГО сложилась стоимость. «₽/м²» — ДОРОГО ЛИ, и
 * требует площади, которой в смете нет: она приходит из паспорта объекта.
 * Поэтому это две формулы, а не одна с двумя выходами.
 *
 * ДОЛЯ ОТ ЧЕГО
 *
 * Смета почти никогда не разложена по элементам полностью: оборудование,
 * прочие затраты и НДС в разбивку не попадают. Доля от ИТОГА сметы не сложится
 * в единицу, и разбивка будет выглядеть неполной без объяснения. Доля от суммы
 * объявленных элементов сложится — но непокрытый остаток исчезнет из виду.
 *
 * Здесь верно и то и другое: доля считается от суммы ОБЪЯВЛЕННЫХ элементов, а
 * непокрытый остаток называется отдельной величиной. Спрятать его в знаменатель
 * значило бы сделать неизвестное нулём (§9).
 *
 * НЕВЫЧИСЛИМОЕ НЕ РАВНО НУЛЮ
 *
 * ₽/м² без площади — не ноль и не бесконечность, а отсутствие показателя.
 * Такой результат не несёт следа формулы: след объясняет полученное число, и
 * след несуществующего числа утверждал бы, что расчёт состоялся.
 */
import { Decimal } from "decimal.js";

import { decimal, unitCode } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const COST_STRUCTURE_FORMULA = "calculation.cost-structure" as const;
export const COST_STRUCTURE_VERSION = 1 as const;

export const COST_PER_SQM_FORMULA = "calculation.cost-per-sqm" as const;
export const COST_PER_SQM_VERSION = 1 as const;

/** Пять элементов прямых и накладных затрат по §6.4. */
export type CostElement =
  | "материалы"
  | "оплата труда"
  | "эксплуатация машин"
  | "накладные расходы"
  | "сметная прибыль";

export interface CostElementAmount {
  readonly element: CostElement;
  readonly amount: string;
}

export interface CostStructureItem {
  readonly element: CostElement;
  readonly amount: DecimalString;
  /** Доля от суммы ОБЪЯВЛЕННЫХ элементов, четыре знака. */
  readonly share: DecimalString;
}

export interface CostStructure {
  readonly items: readonly CostStructureItem[];
  /** Сумма объявленных элементов. */
  readonly declaredTotal: DecimalString;
  /** Итог документа минус сумма элементов: что в разбивку не попало. */
  readonly uncovered: DecimalString;
  readonly complete: boolean;
  readonly note: string;
  readonly trace: FormulaTrace;
}

function money(value: Decimal): DecimalString {
  return decimal(value.toFixed(2));
}

export function costStructure(input: {
  readonly elements: readonly CostElementAmount[];
  readonly documentTotal: string;
}): CostStructure {
  // Разбивка по нескольким сметам приносит один элемент несколько раз:
  // складываем, а не оставляем последний.
  const byElement = new Map<CostElement, Decimal>();
  for (const entry of input.elements) {
    byElement.set(entry.element, (byElement.get(entry.element) ?? new Decimal(0)).plus(entry.amount));
  }

  const declared = [...byElement.values()].reduce((sum, value) => sum.plus(value), new Decimal(0));
  const documentTotal = new Decimal(input.documentTotal);
  const uncovered = documentTotal.minus(declared);

  const items: CostStructureItem[] = [...byElement.entries()].map(([element, amount]) => ({
    element,
    amount: money(amount),
    // Доля от объявленного, а не от итога: см. шапку модуля.
    share: decimal(declared.isZero() ? "0.0000" : amount.dividedBy(declared).toFixed(4)),
  }));

  const inputs: Record<string, DecimalString> = {};
  for (const [element, amount] of byElement) {
    inputs[element] = money(amount);
  }
  // Открытый набор входов не может быть пустым: сумма пустого набора — не ноль
  // рублей, а отсутствие расчёта. Итог документа делает след воспроизводимым
  // и в случае, когда разбивки нет вовсе.
  inputs["итог документа"] = money(documentTotal);

  const note =
    byElement.size === 0
      ? "разбивка отсутствует: элементы затрат в источнике не выделены"
      : uncovered.isZero()
        ? "разбивка покрывает итог полностью"
        : uncovered.isPositive()
          ? `не разложен по элементам остаток ${money(uncovered)} ₽ (оборудование, прочие затраты, НДС)`
          : `сумма элементов превышает итог документа на ${money(uncovered.negated())} ₽: расхождение источника`;

  return {
    items,
    declaredTotal: money(declared),
    uncovered: money(uncovered),
    complete: byElement.size > 0 && uncovered.isZero(),
    note,
    trace: {
      formulaId: COST_STRUCTURE_FORMULA,
      formulaVersion: COST_STRUCTURE_VERSION,
      inputs,
      output: money(declared),
      rounding: "half-up",
    },
  };
}

export interface CostPerSqm {
  readonly value?: DecimalString;
  readonly computable: boolean;
  readonly reason?: string;
  readonly trace?: FormulaTrace;
}

export function costPerSqm(input: {
  readonly cost: string;
  readonly area?: string;
}): CostPerSqm {
  if (input.area === undefined) {
    return {
      computable: false,
      reason: "площадь объекта не указана: показатель ₽/м² не вычисляется, а не приравнивается нулю (§9)",
    };
  }

  const area = new Decimal(input.area);

  // Именно `greaterThan(0)`, а не `isPositive()`: в decimal.js `isPositive()`
  // проверяет ЗНАК, а у нуля знак положительный, и нулевая площадь прошла бы
  // проверку, дав в делении Infinity.
  if (!area.greaterThan(0)) {
    return {
      computable: false,
      reason: `площадь ${input.area} м² не положительна: показатель ₽/м² невычислим`,
    };
  }

  const value = money(new Decimal(input.cost).dividedBy(area));

  return {
    value,
    computable: true,
    trace: {
      formulaId: COST_PER_SQM_FORMULA,
      formulaVersion: COST_PER_SQM_VERSION,
      inputs: { cost: decimal(input.cost), area: decimal(input.area) },
      output: value,
      unit: unitCode("RUB"),
      rounding: "half-up",
    },
  };
}
