/**
 * Финмодель Ваныча — детерминированная. Три прогона Дагестана без инструмента
 * дали на одних документах результат от −50,8 до +74,5 млн ₽: модель считала
 * сценарии в голове. Здесь числа — из кода, с формулой в реестре, и один и тот
 * же вход даёт один и тот же ответ.
 */
import { describe, expect, it } from "vitest";

import { FINANCE_MODEL_FORMULA, buildFinanceModel, renderFinanceModel } from "./finance-model.js";

// Цена 122 с НДС 22 % → выручка ровно 100: доли и проценты читаются глазами.
const основа = {
  priceWithVat: "122",
  vatRate: "0.22",
  costs: [
    { name: "Материалы", amount: "60" },
    { name: "Работы", amount: "20" },
  ],
  months: 12,
};

describe("финмодель: выручка, себестоимость, сценарии", () => {
  it("снимает НДС с цены и раскладывает себестоимость по статьям с долями", () => {
    const модель = buildFinanceModel(основа);

    expect(модель.revenueWithoutVat).toBe("100.00");
    expect(модель.vat).toBe("22.00");
    expect(модель.costsTotal).toBe("80.00");
    expect(модель.costItems[0]).toEqual({ name: "Материалы", amount: "60.00", share: "0.7500" });
  });

  it("считает три сценария: база, оптимист −5 %, стресс +15 % себестоимости", () => {
    const модель = buildFinanceModel({ ...основа, redLine: "0.1" });
    const [база, оптимист, стресс] = модель.scenarios;

    expect(база!.profit).toBe("20.00");
    expect(база!.marginShare).toBe("0.2000");
    expect(база!.belowRedLine).toBe(false);

    expect(оптимист!.costs).toBe("76.00");
    expect(оптимист!.profit).toBe("24.00");

    expect(стресс!.costs).toBe("92.00");
    expect(стресс!.profit).toBe("8.00");
    expect(стресс!.belowRedLine).toBe(true);
  });

  it("называет, сколько базе не хватает до красной линии", () => {
    expect(buildFinanceModel({ ...основа, redLine: "0.1" }).toRedLine).toBe("0.00");
    expect(buildFinanceModel({ ...основа, redLine: "0.25" }).toRedLine).toBe("5.00");
  });

  it("вычитает комиссию за обеспечение исполнения: доля × ставка × годы срока", () => {
    // 122 × 0.1 × 0.05 × 1 год = 0.61
    const модель = buildFinanceModel({ ...основа, guaranteeShare: "0.1", guaranteeRatePerYear: "0.05" });

    expect(модель.scenarios[0]!.guaranteeCost).toBe("0.61");
    expect(модель.scenarios[0]!.profit).toBe("19.39");
  });

  it("детерминирована: один вход — один ответ", () => {
    expect(buildFinanceModel(основа)).toEqual(buildFinanceModel(основа));
  });

  it("ведёт след формулы из реестра", () => {
    const модель = buildFinanceModel(основа);

    expect(модель.trace.formulaId).toBe(FINANCE_MODEL_FORMULA);
    expect(модель.trace.formulaId).toBe("calculation.finance-model");
    expect(модель.trace.output).toBe(модель.scenarios[0]!.profit);
  });

  it("отказывается считать без целого положительного срока", () => {
    expect(() => buildFinanceModel({ ...основа, months: 0 })).toThrow(/срок/);
  });
});

describe("финмодель: БДДС и стоимость денег", () => {
  it("отсрочка оплаты актов даёт кассовый разрыв в первый месяц, проценты — на пик разрыва", () => {
    // Два месяца по 40 расходов; акты по 50 приходят на месяц позже.
    const модель = buildFinanceModel({ ...основа, months: 2, paymentLagMonths: 1, financingRatePerYear: "0.365" });
    const база = модель.scenarios[0]!;

    expect(база.cash.periods).toHaveLength(3);
    expect(база.cash.firstGapAt).toBe("месяц 1");
    expect(база.cash.peakShortfall).toBe("40.00");
    // 40 × 0.365 × 30/365 = 1.20 — половина срока 60 дней
    expect(база.financingCost).toBe("1.20");
    expect(база.profit).toBe("18.80");
  });

  it("аванс закрывает разрыв, и стоимость денег нулевая", () => {
    // 60 аванса в первый месяц покрывает 40 расходов; акты по 20 с отсрочкой — остаток не уходит в минус.
    const модель = buildFinanceModel({ ...основа, months: 2, paymentLagMonths: 1, advanceShare: "0.6", financingRatePerYear: "0.365" });
    const база = модель.scenarios[0]!;

    expect(база.cash.peakShortfall).toBe("0.00");
    expect(база.cash.firstGapAt).toBeUndefined();
    expect(база.financingCost).toBe("0.00");
  });

  it("график по годам: аванс — в первый месяц как часть лимита первого года", () => {
    const модель = buildFinanceModel({
      ...основа,
      months: 24,
      advanceShare: "0.2",
      fundingByYear: [
        { year: 2026, share: "0.5" },
        { year: 2027, share: "0.5" },
      ],
    });
    const периоды = модель.scenarios[0]!.cash.periods;

    expect(периоды).toHaveLength(24);
    // 20 аванса + (50 − 20) / 12
    expect(периоды[0]!.inflow).toBe("22.50");
    expect(периоды[1]!.inflow).toBe("2.50");
    expect(периоды[12]!.inflow).toBe("4.17");
    expect(модель.scenarios[0]!.cash.peakShortfall).toBe("0.00");
    expect(модель.parameters["график по годам"]).toBe("2026: 0.5; 2027: 0.5");
  });
});

describe("финмодель: текст для роли", () => {
  it("называет формулу, сценарии и красную линию", () => {
    const текст = renderFinanceModel(buildFinanceModel({ ...основа, redLine: "0.1" }));

    expect(текст).toContain("calculation.finance-model v1");
    expect(текст).toContain("Выручка без НДС: 100.00 ₽");
    expect(текст).toMatch(/стресс \| 92\.00 .* 🔴 ниже красной линии/);
    expect(текст).toContain("До красной линии базе не хватает: 0.00 ₽");
  });
});
