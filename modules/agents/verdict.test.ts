/**
 * Тесты написаны до реализации. Вердикт Артемия — такт 4.
 *
 * Источники:
 *  · `workflow.md`, ТАКТ 4: три цвета вердикта и обязательный примортем;
 *  · `Артемий_РП_v9.7.txt`, ЧАСТЬ 2: «ПОРОГИ МАРЖИ ОТ НМЦК: база 8–9% (цель) ·
 *    оптимизм 10–12% · минимум 5–6% (красная линия) · ниже 5% = 🔴 стоп-решение»;
 *  · ЧАСТЬ 4: «Матрица 5×5: 1–4 приемлемо · 5–9 мониторинг · 10–15 меры ·
 *    16–25 СТОП»;
 *  · ЧАСТЬ 8, А-3: «Вердикт 🟡 (условный) — „Три условия входа": обязательный
 *    формат, короткий список „без чего не подписывать", каждое с ценой вопроса».
 */
import { describe, expect, it } from "vitest";

import { buildVerdict, MARGIN_THRESHOLDS, riskLevel } from "./verdict.js";

describe("пороги маржи от НМЦК (Артемий)", () => {
  it("держит пороги промпта как данные", () => {
    expect(MARGIN_THRESHOLDS).toEqual({ stop: "0.05", minimum: "0.06", target: "0.08", optimistic: "0.10" });
  });

  it("маржа ниже пяти процентов даёт стоп", () => {
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "4000000",
      findings: [],
      openSubjects: [],
    });

    expect(вердикт.color).toBe("🔴");
    expect(вердикт.reasons.join(" ")).toContain("ниже красной линии");
  });

  it("маржа в целевом диапазоне не мешает старту", () => {
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "9000000",
      findings: [],
      openSubjects: [],
    });

    expect(вердикт.color).toBe("🟢");
  });
});

describe("матрица рисков 5×5", () => {
  it("разводит четыре уровня по порогам протокола", () => {
    expect(riskLevel(3)).toBe("приемлемо");
    expect(riskLevel(7)).toBe("мониторинг");
    expect(riskLevel(12)).toBe("меры");
    expect(riskLevel(20)).toBe("СТОП");
  });
});

describe("вердикт трёх цветов (такт 4)", () => {
  it("критическое замечание не даёт зелёного вердикта", () => {
    // workflow.md: «🟢 Старт разрешён — все CRITICAL закрыты».
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "9000000",
      findings: [{ severity: "critical", statement: "объёмы не обоснованы", amount: "64710398.29" }],
      openSubjects: [],
    });

    expect(вердикт.color).toBe("🔴");
  });

  it("незакрытый предмет протокола даёт условный старт с условием", () => {
    // Не критично само по себе, но подписывать нельзя, пока не закрыто.
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "9000000",
      findings: [],
      openSubjects: ["аудит-договора"],
    });

    expect(вердикт.color).toBe("🟡");
    expect(вердикт.conditions.map((condition) => condition.subject)).toContain("аудит-договора");
  });

  it("У КАЖДОГО УСЛОВИЯ ЕСТЬ ЦЕНА ВОПРОСА (правило А-3)", () => {
    // Условие без цены человек откладывает: непонятно, чем рискует.
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "9000000",
      findings: [{ severity: "high", statement: "НДС-разрыв", amount: "2141524.80" }],
      openSubjects: ["аудит-договора"],
    });

    for (const condition of вердикт.conditions) {
      expect(condition.cost).not.toBe("");
    }
  });

  it("несёт примортем: он обязателен перед вердиктом", () => {
    // workflow.md: «Обязательный примортем перед вердиктом».
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "9000000",
      findings: [],
      openSubjects: [],
    });

    expect(вердикт.premortem.length).toBeGreaterThanOrEqual(3);
  });

  it("считает долю маржи и называет её словами протокола", () => {
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "11000000",
      findings: [],
      openSubjects: [],
    });

    expect(вердикт.marginShare).toBe("0.1100");
    expect(вердикт.marginBand).toBe("оптимизм");
  });

  it("суммирует влияние замечаний, но не смешивает с маржой", () => {
    // Влияние замечаний — это то, что МОЖЕТ произойти; маржа — то, что
    // посчитано. Сложить их значит выдать риск за факт.
    const вердикт = buildVerdict({
      contractAmount: "100000000",
      margin: "9000000",
      findings: [
        { severity: "critical", statement: "объёмы", amount: "64710398.29" },
        { severity: "high", statement: "НДС", amount: "2141524.80" },
      ],
      openSubjects: [],
    });

    expect(вердикт.findingsImpact).toBe("66851923.09");
    expect(вердикт.margin).toBe("9000000.00");
  });
});
