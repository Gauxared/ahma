/**
 * Тесты написаны до реализации. Три режима глубины — ТЗ §5.4 и роадмап M3:
 *
 *   «Три режима глубины (§5.4): экспресс ≤15 строк без таблиц, стандарт
 *    с источником на каждую цифру, эксперт ≥3 варианта и матрица.»
 *
 * Режим — это КОНТРАКТ НА ФОРМУ ОТВЕТА, а не пожелание к стилю. Экспресс,
 * выдавший таблицу на две страницы, нарушил договор ровно так же, как эксперт,
 * не давший вариантов.
 */
import { describe, expect, it } from "vitest";

import { DEPTH_MODES, checkDepth, describeDepth } from "./depth-mode.js";

describe("режимы глубины (§5.4)", () => {
  it("держит три режима договора", () => {
    expect(Object.keys(DEPTH_MODES)).toEqual(["экспресс", "стандарт", "эксперт"]);
  });

  it("экспресс ограничен пятнадцатью строками и запрещает таблицы", () => {
    expect(DEPTH_MODES.экспресс.maxLines).toBe(15);
    expect(DEPTH_MODES.экспресс.tablesAllowed).toBe(false);
  });

  it("стандарт требует источник на каждую цифру", () => {
    expect(DEPTH_MODES.стандарт.sourcePerNumber).toBe(true);
  });

  it("эксперт требует не менее трёх вариантов", () => {
    expect(DEPTH_MODES.эксперт.minOptions).toBe(3);
  });
});

describe("проверка соблюдения режима", () => {
  it("ловит превышение длины в экспрессе", () => {
    const ответ = Array.from({ length: 20 }, (_, index) => `строка ${index}`).join("\n");
    const итог = checkDepth("экспресс", { text: ответ, numbers: 0, numbersWithSource: 0, options: 0 });

    expect(итог.ok).toBe(false);
    expect(итог.violations[0]).toContain("15 строк");
  });

  it("ловит таблицу в экспрессе", () => {
    const итог = checkDepth("экспресс", {
      text: "| колонка | колонка |\n|---|---|\n| а | б |",
      numbers: 0,
      numbersWithSource: 0,
      options: 0,
    });

    expect(итог.ok).toBe(false);
    expect(итог.violations.join(" ")).toContain("таблиц");
  });

  it("ловит цифру без источника в стандарте", () => {
    // Прямое требование §5.4: «стандарт с источником на каждую цифру».
    const итог = checkDepth("стандарт", {
      text: "итог 104 976 702.48 ₽",
      numbers: 5,
      numbersWithSource: 4,
      options: 0,
    });

    expect(итог.ok).toBe(false);
    expect(итог.violations.join(" ")).toContain("без источника");
  });

  it("ловит нехватку вариантов у эксперта", () => {
    const итог = checkDepth("эксперт", {
      text: "вариант А, вариант Б",
      numbers: 2,
      numbersWithSource: 2,
      options: 2,
    });

    expect(итог.ok).toBe(false);
    expect(итог.violations.join(" ")).toContain("3 вариант");
  });

  it("пропускает ответ, соблюдающий режим", () => {
    const итог = checkDepth("экспресс", {
      text: "Короткий вывод.\nВторая строка.",
      numbers: 1,
      numbersWithSource: 1,
      options: 0,
    });

    expect(итог.ok).toBe(true);
    expect(итог.violations).toEqual([]);
  });

  it("НЕ требует источников там, где цифр нет", () => {
    // Ноль цифр — это не «все цифры без источника».
    const итог = checkDepth("стандарт", { text: "нет чисел", numbers: 0, numbersWithSource: 0, options: 0 });

    expect(итог.ok).toBe(true);
  });

  it("эксперт наследует требование источников от стандарта", () => {
    // Более глубокий режим не может быть менее строгим: иначе выбор «эксперт»
    // ослаблял бы требования вместо усиления.
    const итог = checkDepth("эксперт", {
      text: "три варианта",
      numbers: 3,
      numbersWithSource: 1,
      options: 3,
    });

    expect(итог.ok).toBe(false);
    expect(итог.violations.join(" ")).toContain("без источника");
  });
});

describe("описание режима для промпта", () => {
  it("даёт агенту формулировку требований, а не только имя", () => {
    const описание = describeDepth("экспресс");

    expect(описание).toContain("15");
    expect(описание).toContain("таблиц");
  });
});
