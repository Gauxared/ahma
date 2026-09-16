/**
 * Три сценария финансовой модели — такт 2 легаси-протокола.
 *
 * Источник — `reference-system/skills/stroiintellect-master/.../workflow.md`,
 * ТАКТ 2, ВАНЫЧ:
 *
 *   4. ТРИ СЦЕНАРИЯ: Базовый / Реалистичный (-15% выручка +10% расходы) / Стресс
 *
 * ЗАЧЕМ СЦЕНАРИИ
 *
 * Не «сколько заработаем», а «при каком стечении обстоятельств НЕ заработаем».
 * Одна цифра маржи говорит о плане; три сценария говорят о запасе. Объект с
 * маржой 10% и объект с маржой 10%, уходящий в минус при −15% выручки, —
 * разные объекты, и по базовому расчёту они неразличимы.
 *
 * СДВИГИ — ДАННЫЕ, А НЕ КОД
 *
 * Проценты вынесены в `SCENARIO_SHIFTS`: они часть протокола, а не свойство
 * арифметики. Меняется протокол — меняется таблица, а не формула.
 *
 * ПЕРЕЛОМ НАЗЫВАЕТСЯ ЯВНО
 *
 * `breaksAt` — первый сценарий, где маржа уходит ниже нуля. Читателю нужен не
 * список из трёх чисел, а ответ на вопрос «где рвётся»; искать его глазами по
 * таблице — лишняя работа, которую делает машина.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const SCENARIO_FORMULA = "calculation.scenario-margin" as const;
export const SCENARIO_FORMULA_VERSION = 1 as const;

export type ScenarioId = "базовый" | "реалистичный" | "стресс";

export interface ScenarioShift {
  readonly revenue: string;
  readonly costs: string;
}

/**
 * Сдвиги протокола. «Реалистичный» задан дословно: −15% выручка, +10% расходы.
 * «Стресс» протокол числами не задаёт — берётся удвоенный сдвиг реалистичного,
 * и это ДОПУЩЕНИЕ, а не цитата.
 */
export const SCENARIO_SHIFTS: Readonly<Record<ScenarioId, ScenarioShift>> = {
  базовый: { revenue: "0", costs: "0" },
  реалистичный: { revenue: "-0.15", costs: "0.10" },
  стресс: { revenue: "-0.30", costs: "0.20" },
};

export interface ScenarioInput {
  readonly revenue: string;
  readonly costs: string;
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly revenue: DecimalString;
  readonly costs: DecimalString;
  readonly margin: DecimalString;
  /** Доля маржи в выручке. Четыре знака: 0.1046 — это 10.46%. */
  readonly marginShare: DecimalString;
  readonly profitable: boolean;
  readonly trace: FormulaTrace;
}

export interface ScenarioModel {
  readonly scenarios: readonly Scenario[];
  /** Первый сценарий с отрицательной маржой. Отсутствует, если разрыва нет. */
  readonly breaksAt: ScenarioId | undefined;
  /**
   * Допущение по сценарию «стресс»: числа протоколом не заданы.
   * Прячется — становится выдуманной точностью (ТЗ §9).
   */
  readonly assumption: string;
}

const ORDER: readonly ScenarioId[] = ["базовый", "реалистичный", "стресс"];

export function buildScenarios(input: ScenarioInput): ScenarioModel {
  const baseRevenue = new Decimal(input.revenue);
  const baseCosts = new Decimal(input.costs);

  const scenarios: Scenario[] = ORDER.map((id) => {
    const shift = SCENARIO_SHIFTS[id];

    const revenue = baseRevenue.times(new Decimal(1).plus(new Decimal(shift.revenue)));
    const costs = baseCosts.times(new Decimal(1).plus(new Decimal(shift.costs)));
    const margin = revenue.minus(costs);

    const marginValue = decimal(margin.toFixed(2));

    return {
      id,
      revenue: decimal(revenue.toFixed(2)),
      costs: decimal(costs.toFixed(2)),
      margin: marginValue,
      // Доля от нулевой выручки не определена: ноль здесь честнее выдуманного
      // процента, и он отличим по нулевой выручке рядом.
      marginShare: decimal(
        revenue.isZero() ? "0.0000" : margin.dividedBy(revenue).toDecimalPlaces(4).toFixed(4),
      ),
      profitable: margin.greaterThanOrEqualTo(0),
      trace: {
        formulaId: SCENARIO_FORMULA,
        formulaVersion: SCENARIO_FORMULA_VERSION,
        inputs: {
          revenue: decimal(revenue.toFixed(2)),
          costs: decimal(costs.toFixed(2)),
          revenueShift: decimal(shift.revenue),
          costsShift: decimal(shift.costs),
        },
        output: marginValue,
        rounding: "half-up",
      },
    };
  });

  return {
    scenarios,
    breaksAt: scenarios.find((scenario) => !scenario.profitable)?.id,
    assumption:
      "сценарий «стресс» протоколом числами не задан: принят удвоенный сдвиг " +
      "реалистичного (−30% выручка, +20% расходы) — допущение, требует согласования",
  };
}
