/**
 * Итог объекта — четвёртый уровень сходимости.
 *
 * Три уровня внутри сметы закрыты `convergence.ts`: позиции → раздел →
 * смета → шапка. Этот отвечает на вопрос уровнем выше, который прямо задаёт
 * эталонный выход: «СУММА 4 ЛСР = 104 976 702.48 ₽, ≈ Гл.1-9 ССРСС».
 *
 * Складывает расчётный модуль, а не языковая модель, и результат покидает
 * модуль только со следом формулы (ТЗ §12.1д).
 *
 * Ключом слагаемого служит путь сметы, а не её сумма: две сметы на одинаковую
 * сумму — это не одна смета, и след обязан показывать оба слагаемых.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

// Тот же запас точности, что в сходимости: суммы объекта доходят до
// сотен миллионов с копейками.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const OBJECT_TOTAL_FORMULA = "calculation.object-total" as const;
export const OBJECT_TOTAL_VERSION = 1 as const;

export interface EstimateTotal {
  readonly path: string;
  readonly total: DecimalString;
}

export interface ObjectTotal {
  readonly total: DecimalString;
  readonly trace: FormulaTrace;
}

export function sumObjectTotals(estimates: readonly EstimateTotal[]): ObjectTotal {
  let sum = new Decimal(0);
  const inputs: Record<string, DecimalString> = {};

  for (const estimate of estimates) {
    sum = sum.plus(new Decimal(estimate.total));
    inputs[estimate.path] = estimate.total;
  }

  const total = decimal(sum.toFixed(2));

  return {
    total,
    trace: {
      formulaId: OBJECT_TOTAL_FORMULA,
      formulaVersion: OBJECT_TOTAL_VERSION,
      inputs,
      output: total,
      rounding: "half-up",
    },
  };
}
