/**
 * Тесты написаны до реализации. Правило 3.2 промпта Виктора:
 *
 *   3.2. БГ vs ГУ — СИСТЕМНЫЙ ВОПРОС КАЖДОГО B2G, Такт 1:
 *        Расчёт: стоимость БГ (ставка %/год × сумма × срок) против заморозки
 *        ГУ вне оборота. (Школа №19: ГУ 101 млн на 5 лет против БГ ≈ 2,3 млн —
 *        замена обязательна к проработке.)
 *
 * ГУ — гарантийное удержание: деньги подрядчика заморожены у заказчика.
 * БГ — банковская гарантия: подрядчик платит банку процент, деньги остаются
 * в обороте. Сравнивать надо не «сумму с суммой», а СТОИМОСТЬ ДЕНЕГ.
 */
import { describe, expect, it } from "vitest";

import { compareGuarantee } from "./guarantee-comparison.js";

describe("банковская гарантия против гарантийного удержания (Виктор 3.2)", () => {
  it("считает стоимость БГ как ставку за срок", () => {
    // Пример промпта: 101 млн, 5 лет. При ставке 1,5%/год БГ ≈ 7,58 млн,
    // но в самом примере названо ≈2,3 млн — там иная ставка и срок.
    // Проверяем механику, а не пересказ примера.
    const сравнение = compareGuarantee({
      retentionAmount: "101000000.00",
      years: "5",
      guaranteeRatePerYear: "0.015",
      capitalCostPerYear: "0.21",
    });

    expect(сравнение.guaranteeCost).toBe("7575000.00");
  });

  it("считает цену замороженных денег по стоимости капитала", () => {
    // ГУ дорого не само по себе, а тем, что деньги вне оборота. Мерить это
    // надо ставкой, по которой подрядчик их иначе использовал бы.
    const сравнение = compareGuarantee({
      retentionAmount: "101000000.00",
      years: "5",
      guaranteeRatePerYear: "0.015",
      capitalCostPerYear: "0.21",
    });

    expect(сравнение.retentionCost).toBe("106050000.00");
  });

  it("называет выгоду замены в рублях", () => {
    const сравнение = compareGuarantee({
      retentionAmount: "101000000.00",
      years: "5",
      guaranteeRatePerYear: "0.015",
      capitalCostPerYear: "0.21",
    });

    expect(сравнение.saving).toBe("98475000.00");
    expect(сравнение.recommendation).toBe("заменить ГУ на БГ");
  });

  it("не рекомендует замену, когда она невыгодна", () => {
    // Дорогая гарантия при дешёвом капитале — замена не нужна.
    // Правило проверяется, а не применяется автоматически.
    const сравнение = compareGuarantee({
      retentionAmount: "1000000.00",
      years: "1",
      guaranteeRatePerYear: "0.30",
      capitalCostPerYear: "0.05",
    });

    expect(сравнение.saving).toBe("-250000.00");
    expect(сравнение.recommendation).toBe("оставить ГУ");
  });

  it("несёт основание: обе ставки и срок", () => {
    const сравнение = compareGuarantee({
      retentionAmount: "1000000.00",
      years: "2",
      guaranteeRatePerYear: "0.015",
      capitalCostPerYear: "0.21",
    });

    expect(сравнение.basis).toContain("0.015");
    expect(сравнение.basis).toContain("0.21");
    expect(сравнение.basis).toContain("2");
  });

  it("даёт след формулы", () => {
    const сравнение = compareGuarantee({
      retentionAmount: "1000000.00",
      years: "1",
      guaranteeRatePerYear: "0.015",
      capitalCostPerYear: "0.21",
    });

    expect(сравнение.trace.formulaId).toBe("calculation.guarantee-comparison");
    expect(сравнение.trace.output).toBe("195000.00");
  });
});
