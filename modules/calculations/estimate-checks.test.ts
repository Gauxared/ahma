/**
 * Тесты написаны до реализации по спецификации T4 (docs/m1-tasks.md).
 *
 * Проверки взяты из промпта Людмилы v9.6, часть 3.1 «Чеклист полноты ЛСР»
 * и 3.8 «MVP-проверка сметы». Все они арифметические, поэтому считает их
 * расчётный модуль, а не модель (ТЗ §6.4).
 */
import { describe, expect, it } from "vitest";

import { accuracyMarker, checkEstimate, topPositionsByShare } from "./estimate-checks.js";
import type { PositionForCheck } from "./estimate-checks.js";

function position(overrides: Partial<PositionForCheck> = {}): PositionForCheck {
  return {
    ordinal: "1",
    section: "1",
    name: "Блок управления",
    basis: "ГЭСНм08-03-572-06",
    unit: "шт",
    amount: "1000.00",
    row: 10,
    ...overrides,
  };
}

describe("чеклист полноты ЛСР (Людмила, часть 3.1)", () => {
  it("находит дубли позиций между разделами", () => {
    const report = checkEstimate([
      position({ ordinal: "1", section: "1", basis: "ГЭСНм08-03-572-06", amount: "1000.00" }),
      position({ ordinal: "5", section: "2", basis: "ГЭСНм08-03-572-06", amount: "1000.00", row: 40 }),
    ]);

    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]?.basis).toBe("ГЭСНм08-03-572-06");
    expect(report.duplicates[0]?.rows).toEqual([10, 40]);
  });

  it("не считает дублем одинаковый шифр с разной суммой", () => {
    // Одна расценка на разных объёмах — норма, а не двойной счёт.
    const report = checkEstimate([
      position({ basis: "ГЭСНм08-03-572-06", amount: "1000.00" }),
      position({ basis: "ГЭСНм08-03-572-06", amount: "2500.00", row: 40 }),
    ]);

    expect(report.duplicates).toEqual([]);
  });

  it("находит отрицательные позиции", () => {
    const report = checkEstimate([position({ amount: "-500.00" })]);

    expect(report.negatives).toHaveLength(1);
    expect(report.negatives[0]?.amount).toBe("-500.00");
  });

  it("помечает нерасшифрованный комплект от 5% итога как блокер", () => {
    // «1 компл.» ≥ 5% НМЦК → блокер: позиция не расшифрована.
    const report = checkEstimate([
      position({ unit: "компл", amount: "600.00", name: "Комплект оборудования" }),
      position({ ordinal: "2", amount: "9400.00", row: 20 }),
    ]);

    expect(report.unexplainedLumpSums).toHaveLength(1);
    expect(report.unexplainedLumpSums[0]?.share).toBe("0.06");
  });

  it("не поднимает тревогу на мелком комплекте", () => {
    const report = checkEstimate([
      position({ unit: "компл", amount: "100.00" }),
      position({ ordinal: "2", amount: "9900.00", row: 20 }),
    ]);

    expect(report.unexplainedLumpSums).toEqual([]);
  });

  it("считает итог как сумму позиций, а не как заявленное значение", () => {
    const report = checkEstimate([
      position({ amount: "1000.00" }),
      position({ ordinal: "2", amount: "2000.50", row: 20 }),
    ]);

    expect(report.total).toBe("3000.50");
    expect(report.positions).toBe(2);
  });
});

describe("MVP-проверка: ТОП по доле суммы (Людмила, часть 3.8)", () => {
  it("отбирает позиции свыше порога доли и считает накопленный охват", () => {
    // «ТОП-5 позиций >5% суммы каждая — это 70–80% финансовой картины».
    const positions = [
      position({ ordinal: "1", amount: "7000.00" }),
      position({ ordinal: "2", amount: "2000.00", row: 20 }),
      position({ ordinal: "3", amount: "600.00", row: 30 }),
      position({ ordinal: "4", amount: "400.00", row: 40 }),
    ];

    const top = topPositionsByShare(positions, { minShare: "0.05", limit: 5 });

    expect(top.positions.map((entry) => entry.ordinal)).toEqual(["1", "2", "3"]);
    expect(top.coverage).toBe("0.96");
  });

  it("ограничивает выборку заданным числом позиций", () => {
    const positions = Array.from({ length: 10 }, (_, index) =>
      position({ ordinal: String(index + 1), amount: "1000.00", row: index * 10 }),
    );

    const top = topPositionsByShare(positions, { minShare: "0.05", limit: 5 });

    expect(top.positions).toHaveLength(5);
    expect(top.coverage).toBe("0.50");
  });

  it("возвращает пустой отбор на пустой смете, а не делит на ноль", () => {
    const top = topPositionsByShare([], { minShare: "0.05", limit: 5 });

    expect(top.positions).toEqual([]);
    expect(top.coverage).toBe("0.00");
  });
});

describe("маркер точности (Людмила 3.4, ТЗ §9 и §12.1 REQ-TZ-RESULT-02)", () => {
  it("даёт ±3–5% при наличии сметы", () => {
    expect(accuracyMarker({ hasEstimate: true })).toEqual({
      range: "±3–5%",
      basis: "оценка выполнена по локальному сметному расчёту",
      heuristic: true,
    });
  });

  it("даёт ±10–15% без сметы", () => {
    expect(accuracyMarker({ hasEstimate: false }).range).toBe("±10–15%");
  });

  it("всегда помечает маркер как договорную эвристику, а не достигнутую точность", () => {
    // ТЗ: маркер не представляется как подтверждённая точность.
    expect(accuracyMarker({ hasEstimate: true }).heuristic).toBe(true);
    expect(accuracyMarker({ hasEstimate: false }).heuristic).toBe(true);
  });
});
