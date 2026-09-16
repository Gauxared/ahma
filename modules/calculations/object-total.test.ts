/**
 * Тесты написаны до реализации.
 *
 * Четвёртый уровень сходимости: сметы объекта → итог объекта. Три уровня внутри
 * сметы уже закрыты `convergence.ts`; этот отвечает на вопрос, который задаёт
 * эталонный выход: «СУММА 4 ЛСР = 104 976 702.48 ₽».
 */
import { describe, expect, it } from "vitest";

import { decimal } from "@contracts/index.js";

import { sumObjectTotals } from "./object-total.js";

const КУРГАН = [
  { path: "СОТВ.xlsx", total: decimal("14198884.54") },
  { path: "ЭОМ.xlsx", total: decimal("89532565.11") },
  { path: "ПНР.xlsx", total: decimal("890669.50") },
  { path: "СП и СИ.xlsx", total: decimal("354583.33") },
];

describe("итог объекта", () => {
  it("складывает итоги смет курганского комплекта до копейки", () => {
    // Значение сверено с эталонным выходом: лист 04_Свод_ЛСР, «СУММА 4 ЛСР».
    const result = sumObjectTotals(КУРГАН);

    expect(result.total).toBe("104976702.48");
  });

  it("даёт след формулы со всеми слагаемыми", () => {
    // §12.1д: число без следа не имеет права покинуть модуль.
    const result = sumObjectTotals(КУРГАН);

    expect(result.trace.output).toBe("104976702.48");
    expect(Object.keys(result.trace.inputs)).toHaveLength(4);
    expect(result.trace.inputs["СОТВ.xlsx"]).toBe("14198884.54");
    expect(result.trace.formulaVersion).toBeGreaterThan(0);
  });

  it("не теряет копейки на длинных суммах", () => {
    // Двоичная плавающая точка дала бы 0.30000000000000004.
    const result = sumObjectTotals([
      { path: "а", total: decimal("0.10") },
      { path: "б", total: decimal("0.20") },
    ]);

    expect(result.total).toBe("0.30");
  });

  it("на пустом списке даёт ноль и говорит, что слагаемых не было", () => {
    // Ноль здесь — законный итог пустой суммы, но он обязан быть отличим от
    // «не посчитали»: слагаемые видны в следе, и их ноль.
    const result = sumObjectTotals([]);

    expect(result.total).toBe("0.00");
    expect(Object.keys(result.trace.inputs)).toHaveLength(0);
  });

  it("различает сметы с одинаковым итогом, а не схлопывает их", () => {
    // Ключом следа служит путь: две сметы на одну сумму — не одна смета.
    const result = sumObjectTotals([
      { path: "первая.xlsx", total: decimal("100.00") },
      { path: "вторая.xlsx", total: decimal("100.00") },
    ]);

    expect(result.total).toBe("200.00");
    expect(Object.keys(result.trace.inputs)).toHaveLength(2);
  });
});
