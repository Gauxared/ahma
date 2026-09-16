/**
 * Тесты написаны до реализации. Финмодель Ваныча — такт 2 легаси-протокола
 * (`reference-system/skills/stroiintellect-master/.../workflow.md`):
 *
 *   4. ТРИ СЦЕНАРИЯ: Базовый / Реалистичный (-15% выручка +10% расходы) / Стресс
 *   6. ПОТОЛКИ → таблица: Пакет | Потолок | Бюджет | Дедлайн → к Халилю и Марине
 *
 * Сценарии — не украшение отчёта: по ним видно, при каком стечении
 * обстоятельств объект уходит в минус.
 */
import { describe, expect, it } from "vitest";

import { buildScenarios, SCENARIO_SHIFTS } from "./scenarios.js";

describe("три сценария финмодели (такт 2)", () => {
  const модель = buildScenarios({ revenue: "104976702.48", costs: "94000000.00" });

  it("держит три сценария протокола, не больше и не меньше", () => {
    expect(модель.scenarios.map((scenario) => scenario.id)).toEqual([
      "базовый",
      "реалистичный",
      "стресс",
    ]);
  });

  it("базовый сценарий — это план как есть, без сдвигов", () => {
    const базовый = модель.scenarios[0]!;

    expect(базовый.revenue).toBe("104976702.48");
    expect(базовый.costs).toBe("94000000.00");
    expect(базовый.margin).toBe("10976702.48");
  });

  it("реалистичный сдвигает выручку и расходы по правилу протокола", () => {
    // Дословно: «-15% выручка +10% расходы».
    const реалистичный = модель.scenarios[1]!;

    expect(реалистичный.revenue).toBe("89230197.11");
    expect(реалистичный.costs).toBe("103400000.00");
  });

  it("показывает, что реалистичный сценарий уводит объект в минус", () => {
    // Это и есть смысл сценариев: не «сколько заработаем», а «при каком
    // стечении обстоятельств не заработаем».
    const реалистичный = модель.scenarios[1]!;

    expect(реалистичный.margin).toBe("-14169802.89");
    expect(реалистичный.profitable).toBe(false);
  });

  it("называет первый сценарий, где маржа уходит ниже нуля", () => {
    expect(модель.breaksAt).toBe("реалистичный");
  });

  it("не выдумывает перелом там, где его нет", () => {
    const прибыльная = buildScenarios({ revenue: "200000000.00", costs: "50000000.00" });

    expect(прибыльная.breaksAt).toBeUndefined();
    expect(прибыльная.scenarios.every((scenario) => scenario.profitable)).toBe(true);
  });

  it("считает долю маржи, а не только рубли", () => {
    // Маржа 10 млн на объекте 100 млн и на объекте 1 млрд — разные истории.
    const базовый = модель.scenarios[0]!;

    expect(базовый.marginShare).toBe("0.1046");
  });

  it("сдвиги объявлены данными, а не зашиты в расчёт", () => {
    // Протокол может смениться, и проценты — его часть, а не наша.
    expect(SCENARIO_SHIFTS.реалистичный).toEqual({ revenue: "-0.15", costs: "0.10" });
  });

  it("даёт след формулы каждому сценарию", () => {
    for (const scenario of модель.scenarios) {
      expect(scenario.trace.formulaId).toBe("calculation.scenario-margin");
      expect(scenario.trace.output).toBe(scenario.margin);
    }
  });
});
