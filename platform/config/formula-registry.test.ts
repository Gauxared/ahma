/**
 * Тесты написаны до реализации. Реестр формул — ADR-R-014 и ТЗ §6.4:
 *
 *   «формула вне `formula-registry` — запрещено (§6.4)»
 *
 * ЗАЧЕМ РЕЕСТР, ЕСЛИ ВЕРСИЯ УЖЕ ЛЕЖИТ РЯДОМ С ФОРМУЛОЙ
 *
 * Затем, что версия рядом с формулой — это обещание, которое некому проверить.
 * Формулу правят, а константу `VERSION = 1` рядом с ней забывают тронуть, и
 * два разных вычисления уходят в отчёты под одним номером. Разобрать потом,
 * какой из них дал число в подписанном документе, нельзя: `FormulaTrace`
 * говорит «версия 1», а версий 1 было две.
 *
 * Реестр не мешает забыть — он делает забывчивость видимой: список формул
 * лежит в одном файле, и гейт сборки сверяет с ним каждую формулу в коде.
 */
import { describe, expect, it } from "vitest";

import { FormulaRegistry, formulaBundleSchema } from "./formula-registry.js";
import type { FormulaBundleInput } from "./formula-registry.js";

const БАЗА: FormulaBundleInput = {
  formulas: [
    {
      id: "calculation.convergence",
      title: "Сходимость сметы",
      version: 1,
      clause: "§6.4",
      rounding: "half-up",
      unit: "RUB",
      inputs: ["computed", "declared"],
      output: "delta",
    },
    {
      id: "calculation.vat-gap",
      title: "Разрыв по НДС",
      version: 2,
      clause: "§6.4",
      rounding: "half-up",
      unit: "RUB",
      inputs: ["base", "rateFrom", "rateTo"],
      output: "gap",
    },
  ],
};

describe("схема реестра формул", () => {
  it("принимает корректный набор", () => {
    expect(() => formulaBundleSchema.parse(БАЗА)).not.toThrow();
  });

  it("не принимает формулу без указания пункта ТЗ", () => {
    // Формула без ссылки на пункт — число, за которое никто не отвечает.
    const без = { formulas: [{ ...БАЗА.formulas[0], clause: "" }] };

    expect(() => formulaBundleSchema.parse(без)).toThrow();
  });

  it("не принимает нулевую или отрицательную версию", () => {
    const плохая = { formulas: [{ ...БАЗА.formulas[0], version: 0 }] };

    expect(() => formulaBundleSchema.parse(плохая)).toThrow();
  });

  it("не принимает формулу без входов: вычисление из ничего не воспроизводится", () => {
    const пустая = { formulas: [{ ...БАЗА.formulas[0], inputs: [] }] };

    expect(() => formulaBundleSchema.parse(пустая)).toThrow();
  });
});

describe("реестр", () => {
  it("отвергает повторное объявление одного идентификатора", () => {
    const дубль = { formulas: [БАЗА.formulas[0]!, БАЗА.formulas[0]!] };

    expect(() => new FormulaRegistry(дубль)).toThrow(/дважды/i);
  });

  it("отдаёт объявление по идентификатору", () => {
    const реестр = new FormulaRegistry(БАЗА);

    expect(реестр.get("calculation.vat-gap")?.version).toBe(2);
  });

  it("на незнакомую формулу отвечает undefined, а не выдумывает версию", () => {
    const реестр = new FormulaRegistry(БАЗА);

    expect(реестр.get("calculation.не-объявлена")).toBeUndefined();
  });
});

describe("построение следа", () => {
  it("строит FormulaTrace с версией ИЗ РЕЕСТРА, а не из аргумента", () => {
    // Версию нельзя передать снаружи: иначе реестр остаётся справочником,
    // с которым код волен не соглашаться.
    const реестр = new FormulaRegistry(БАЗА);

    const след = реестр.trace("calculation.vat-gap", {
      inputs: { base: "100.00", rateFrom: "0.20", rateTo: "0.22" },
      output: "2.00",
    });

    expect(след.formulaVersion).toBe(2);
    expect(след.formulaId).toBe("calculation.vat-gap");
    expect(след.rounding).toBe("half-up");
  });

  it("отказывается строить след для незарегистрированной формулы", () => {
    const реестр = new FormulaRegistry(БАЗА);

    expect(() =>
      реестр.trace("calculation.самодеятельность", { inputs: { a: "1" }, output: "1" }),
    ).toThrow(/не объявлена/i);
  });

  it("отказывается строить след, если не передан объявленный вход", () => {
    // Пропущенный вход — это не «ноль по умолчанию» (§9): след, в котором
    // входов меньше, чем у формулы, невоспроизводим.
    const реестр = new FormulaRegistry(БАЗА);

    expect(() =>
      реестр.trace("calculation.vat-gap", { inputs: { base: "100.00" }, output: "2.00" }),
    ).toThrow(/rateFrom/);
  });

  it("отказывается строить след с входом, которого у формулы нет", () => {
    // Лишний вход означает, что формула изменилась, а реестр — нет.
    const реестр = new FormulaRegistry(БАЗА);

    expect(() =>
      реестр.trace("calculation.convergence", {
        inputs: { computed: "1", declared: "1", лишний: "1" },
        output: "0",
      }),
    ).toThrow(/лишний/);
  });

  it("для открытого набора входов принимает любые имена слагаемых", () => {
    // Сумма смет объекта: имена слагаемых — пути файлов, заранее их не
    // перечислить. Открытость набора объявлена в реестре как `variadic`, а не
    // получена молчаливым ослаблением проверки.
    const реестр = new FormulaRegistry({
      formulas: [
        {
          id: "calculation.object-total",
          title: "Итог по объекту",
          version: 1,
          clause: "§6.4",
          rounding: "half-up",
          unit: "RUB",
          arity: "variadic",
          inputs: ["смета"],
          output: "total",
        },
      ],
    });

    const след = реестр.trace("calculation.object-total", {
      inputs: { "1-1-ЭОМ.xlsx": "10.00", "1-2-ОВ.xlsx": "20.00" },
      output: "30.00",
    });

    expect(след.formulaVersion).toBe(1);
  });

  it("отказывается строить след открытой формулы без слагаемых", () => {
    // Сумма пустого набора — не ноль рублей, а отсутствие расчёта (§9).
    const реестр = new FormulaRegistry({
      formulas: [
        {
          id: "calculation.object-total",
          title: "Итог по объекту",
          version: 1,
          clause: "§6.4",
          rounding: "half-up",
          arity: "variadic",
          inputs: ["смета"],
          output: "total",
        },
      ],
    });

    expect(() => реестр.trace("calculation.object-total", { inputs: {}, output: "0.00" })).toThrow(
      /ни одного слагаемого/i,
    );
  });

  it("допускает уточнение области в идентификаторе следа", () => {
    // Сходимость считается по разделу, по смете и по шапке — это одна формула
    // в трёх областях, а не три формулы. Область уточняет след, но версия и
    // округление остаются реестровыми.
    const реестр = new FormulaRegistry(БАЗА);

    const след = реестр.trace("calculation.convergence", {
      scope: "раздел-3",
      inputs: { computed: "10", declared: "10" },
      output: "0",
    });

    expect(след.formulaId).toBe("calculation.convergence.раздел-3");
    expect(след.formulaVersion).toBe(1);
  });
});

describe("реестр из конфигурации проекта", () => {
  it("объявляет каждую формулу, которую считает система", async () => {
    // Этот тест — вторая половина гейта. Гейт сборки проверяет, что в коде нет
    // формул вне реестра; здесь проверяется, что сам файл реестра читается и
    // валиден. Без него гейт зелёный на пустом реестре.
    const { loadFormulaRegistry } = await import("./formula-registry.js");
    const реестр = await loadFormulaRegistry();

    expect(реестр.ids().length).toBeGreaterThan(0);
    for (const id of реестр.ids()) {
      expect(реестр.get(id)?.clause).toMatch(/§/);
    }
  });
});
