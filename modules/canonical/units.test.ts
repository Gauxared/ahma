/**
 * Тесты написаны до реализации по спецификации T1 (docs/m1-tasks.md).
 *
 * Набор единиц взят из курганского комплекта — все 14 встречающихся написаний.
 * Спецификация требует: каждая разбирается либо явно помечается нераспознанной,
 * молчаливого пропуска нет.
 */
import { describe, expect, it } from "vitest";

import { convert, parseUnit, unitsAreComparable } from "./units.js";

describe("разбор единицы измерения (ТЗ §5.2)", () => {
  it("разбирает базовые единицы курганского комплекта", () => {
    expect(parseUnit("шт")).toMatchObject({ resolved: true, unit: "шт", multiplier: "1" });
    expect(parseUnit("т")).toMatchObject({ resolved: true, unit: "кг", multiplier: "1000" });
    expect(parseUnit("км")).toMatchObject({ resolved: true, unit: "м", multiplier: "1000" });
  });

  it("снимает числовой префикс и переносит его в множитель", () => {
    // «100 м2» — это сто квадратных метров на единицу расценки, а не единица «100 м2».
    expect(parseUnit("100 м2")).toMatchObject({ resolved: true, unit: "м2", multiplier: "100" });
    expect(parseUnit("100 м3")).toMatchObject({ resolved: true, unit: "м3", multiplier: "100" });
    expect(parseUnit("100 м")).toMatchObject({ resolved: true, unit: "м", multiplier: "100" });
    expect(parseUnit("1000 м")).toMatchObject({ resolved: true, unit: "м", multiplier: "1000" });
    expect(parseUnit("10 шт")).toMatchObject({ resolved: true, unit: "шт", multiplier: "10" });
    expect(parseUnit("100 шт")).toMatchObject({ resolved: true, unit: "шт", multiplier: "100" });
  });

  it("совмещает префикс с переводом единицы", () => {
    // 10 м3 → м3 ×10; 100 т → кг ×100000.
    expect(parseUnit("10 м3")).toMatchObject({ unit: "м3", multiplier: "10" });
    expect(parseUnit("100 т")).toMatchObject({ unit: "кг", multiplier: "100000" });
  });

  it("терпит написание с точкой и лишними пробелами", () => {
    expect(parseUnit("шт.")).toMatchObject({ resolved: true, unit: "шт" });
    expect(parseUnit("  100   м2 ")).toMatchObject({ resolved: true, unit: "м2", multiplier: "100" });
  });

  it("помечает нераспознанную единицу вместо молчаливого пропуска", () => {
    // «антенна» — доменная единица вне реестра: сохраняется как есть, с причиной.
    const antenna = parseUnit("антенна");
    expect(antenna.resolved).toBe(false);
    expect(antenna.unit).toBe("антенна");
    expect(antenna.dimension).toBe("unknown");
    expect(antenna.reason).toBeDefined();
  });

  it("знает комплект как отдельную размерность, а не как штуки", () => {
    // Комплект понятен и распознаётся, но он не штука: несопоставимость
    // с «шт» обеспечивается размерностью, а не отказом в разборе.
    const set = parseUnit("компл");
    expect(set.resolved).toBe(true);
    expect(set.dimension).toBe("set");
    expect(unitsAreComparable("компл", "шт")).toBe(false);
  });

  it("помечает пустую единицу, а не подставляет штуки", () => {
    const empty = parseUnit("");
    expect(empty.resolved).toBe(false);
    expect(empty.reason).toMatch(/не указана/i);
  });
});

describe("размерный анализ", () => {
  it("переводит внутри одной размерности", () => {
    expect(convert("1", "км", "м")).toBe("1000");
    expect(convert("2.5", "т", "кг")).toBe("2500");
    expect(convert("1500", "кг", "т")).toBe("1.5");
  });

  it("ОТКАЗЫВАЕТ в переводе между разными размерностями", () => {
    // Метры в килограммы не переводятся: это не округление, а ошибка данных.
    expect(() => convert("1", "м", "кг")).toThrow(/размерност/i);
    expect(() => convert("1", "м2", "м3")).toThrow(/размерност/i);
    expect(() => convert("1", "шт", "м")).toThrow(/размерност/i);
  });

  it("не считает сопоставимыми штуки и комплекты", () => {
    // «1 комплект» против «3 шт» — классический источник ошибки в сметах.
    expect(unitsAreComparable("шт", "шт")).toBe(true);
    expect(unitsAreComparable("м", "км")).toBe(true);
    expect(unitsAreComparable("шт", "компл")).toBe(false);
    expect(unitsAreComparable("м2", "м3")).toBe(false);
  });

  it("считает нераспознанную единицу сопоставимой только с собой", () => {
    expect(unitsAreComparable("антенна", "антенна")).toBe(true);
    expect(unitsAreComparable("антенна", "шт")).toBe(false);
  });
});
