/**
 * Тесты написаны до реализации. Правило 3.3 промпта Виктора
 * (`Виктор_Договорник_v9.6.txt`):
 *
 *   3.3. НДС — КОНТРОЛЬ СТАВКИ И ПЕРИОДА. Проверять: действующую ставку на
 *        дату ответа (⚠ верифицировать — менялась), договоры переходного
 *        периода, симметрию НДС Заказчика и подрядчика.
 *
 * Эталонный выход курганского приёма ставит это красным флагом:
 *
 *   «🟡 НДС 20% в смете, с 01.01.2026 — 22% (ФЗ 425-ФЗ), работы 2026 →
 *    недобор ≈2,14 млн ₽ при твёрдой цене.»
 *
 * Разрыв возникает только при ТВЁРДОЙ цене: при открытой цена пересчитывается,
 * и подрядчик ничего не теряет.
 */
import { describe, expect, it } from "vitest";

import { vatGap } from "./vat-gap.js";

describe("разрыв ставки НДС (Виктор 3.3)", () => {
  it("считает недобор при твёрдой цене", () => {
    // Курган: Гл.1-9 = 104 976 710 ₽ без НДС, смета по 20%, работы 2026 по 22%.
    const разрыв = vatGap({
      baseAmount: "104976710.00",
      contractRate: "0.20",
      currentRate: "0.22",
      priceIsFirm: true,
    });

    expect(разрыв.gap).toBe("2099534.20");
    expect(разрыв.bornBy).toBe("подрядчик");
  });

  it("при открытой цене разрыва нет: пересчёт ложится на заказчика", () => {
    // Это не «ноль недобора», а другой носитель риска. Свести к нулю значит
    // потерять, что при открытой цене вопрос всё равно надо задать.
    const разрыв = vatGap({
      baseAmount: "104976710.00",
      contractRate: "0.20",
      currentRate: "0.22",
      priceIsFirm: false,
    });

    expect(разрыв.gap).toBe("0.00");
    expect(разрыв.bornBy).toBe("заказчик");
    expect(разрыв.note).toContain("открыт");
  });

  it("молчит, когда ставки совпадают", () => {
    const разрыв = vatGap({
      baseAmount: "104976710.00",
      contractRate: "0.22",
      currentRate: "0.22",
      priceIsFirm: true,
    });

    expect(разрыв.gap).toBe("0.00");
    expect(разрыв.applicable).toBe(false);
  });

  it("считает и обратный случай: ставка снизилась", () => {
    // Симметрия из промпта: проверяется НЕ только рост. При снижении
    // выигрыш тоже кому-то достаётся, и это предмет разговора.
    const разрыв = vatGap({
      baseAmount: "1000000.00",
      contractRate: "0.22",
      currentRate: "0.20",
      priceIsFirm: true,
    });

    expect(разрыв.gap).toBe("-20000.00");
    expect(разрыв.direction).toBe("снижение");
  });

  it("несёт основание расчёта, а не только число", () => {
    // ТЗ §9: без основания нет вывода.
    const разрыв = vatGap({
      baseAmount: "104976710.00",
      contractRate: "0.20",
      currentRate: "0.22",
      priceIsFirm: true,
    });

    expect(разрыв.basis).toContain("104976710.00");
    expect(разрыв.basis).toContain("0.20");
    expect(разрыв.basis).toContain("0.22");
  });

  it("даёт след формулы: число не покидает расчёт без него", () => {
    const разрыв = vatGap({
      baseAmount: "1000000.00",
      contractRate: "0.20",
      currentRate: "0.22",
      priceIsFirm: true,
    });

    expect(разрыв.trace.formulaId).toBe("calculation.vat-gap");
    expect(разрыв.trace.output).toBe("20000.00");
    expect(Object.keys(разрыв.trace.inputs)).toContain("baseAmount");
  });
});
