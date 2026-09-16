/**
 * СХОДИМОСТЬ ПРИ НЕИЗВЕСТНОЙ СУММЕ ПОЗИЦИИ — против нуля, который сложится.
 *
 * НАЙДЕНО НА ПАКЕТЕ ЗАКАЗЧИКА, а не набором.
 *
 * В пакете «Устройство фундаментов линии 720» все десять ЛСР — без стоимостной
 * части: шифры и объёмы есть, денежных колонок нет. Позиции таких смет теперь
 * доходят до расчёта (см. `parsers/estimate-without-prices.test.ts`), и их
 * итог — НЕИЗВЕСТЕН.
 *
 * ЧЕМ ЭТО ОПАСНО ИМЕННО ЗДЕСЬ
 *
 * Сложение — операция, которая молча съедает незнание. Двадцать неизвестных
 * сумм, взятых как нули, дают ровный итог «0.00 ₽», а §12.1б требует
 * расхождения ровно 0 ₽ — и получил бы его: ноль минус ноль. Гейт стал бы
 * зелёным на смете, о стоимости которой не известно ничего.
 *
 * Инвариант ТЗ §9 «неизвестное не превращается в ноль» здесь работает в обе
 * стороны: неизвестное нельзя ни занулить, ни выдать за проверенное. Поэтому
 * незнание ПОДНИМАЕТСЯ по уровням: неизвестная позиция делает несравнимым
 * раздел, несравнимый раздел — смету.
 */
import { describe, expect, it } from "vitest";

import { calculateConvergence, compareWithHeader } from "./convergence.js";

describe("сходимость при неизвестной сумме позиции", () => {
  it("раздел с неизвестной позицией НЕ СХОДИТСЯ и не расходится — он несравним", () => {
    const отчёт = calculateConvergence({
      sections: [{ number: "1", positionTotals: [undefined, undefined], declaredTotal: undefined }],
      declaredTotal: undefined,
    });

    expect(отчёт.sections[0]?.status).toBe("not_comparable");
    expect(отчёт.sections[0]?.computed, "неизвестная сумма выдана числом").toBeUndefined();
    expect(отчёт.sections[0]?.reason).toMatch(/без суммы|сложить нельзя/i);
  });

  it("НОЛЬ НЕ ПОДСТАВЛЯЕТСЯ: гейт §12.1б не зеленеет на смете без цен", () => {
    // Худший из возможных исходов: «расхождение 0 ₽» там, где о стоимости не
    // известно ничего. Именно это и получилось бы от сложения нулей.
    const отчёт = calculateConvergence({
      sections: [{ number: "1", positionTotals: [undefined, undefined], declaredTotal: "0" }],
      declaredTotal: "0",
    });

    expect(отчёт.converged, "смета без цен объявлена сошедшейся").toBe(false);
    expect(отчёт.sections[0]?.delta, "посчитано расхождение с неизвестным").toBeUndefined();
  });

  it("незнание ПОДНИМАЕТСЯ до уровня сметы", () => {
    // Иначе раздел честно скажет «несравним», а документ сложит его как ноль —
    // и итог сметы окажется меньше настоящего на весь такой раздел.
    const отчёт = calculateConvergence({
      sections: [
        { number: "1", positionTotals: ["100.00", "200.00"], declaredTotal: "300.00" },
        { number: "2", positionTotals: [undefined], declaredTotal: undefined },
      ],
      declaredTotal: "300.00",
    });

    expect(отчёт.sections[0]?.status, "сошедшийся раздел перестал сходиться").toBe("converged");
    expect(отчёт.document.status).toBe("not_comparable");
    expect(отчёт.document.computed, "итог сметы посчитан без несравнимого раздела").toBeUndefined();
    expect(отчёт.notComparable).toContain("document");
  });

  it("часть позиций с суммами, часть без — раздел всё равно несравним", () => {
    /**
     * Смешанный случай опаснее чистого: сумма известных позиций выглядит
     * правдоподобным итогом раздела и отличается от настоящего ровно на то,
     * чего мы не знаем. Показать её как итог значило бы соврать числом,
     * похожим на правду.
     */
    const отчёт = calculateConvergence({
      sections: [{ number: "1", positionTotals: ["100.00", undefined, "200.00"], declaredTotal: "450.00" }],
      declaredTotal: "450.00",
    });

    expect(отчёт.sections[0]?.status).toBe("not_comparable");
    expect(отчёт.sections[0]?.computed).toBeUndefined();
    expect(отчёт.sections[0]?.reason).toMatch(/1 позиц/);
  });

  it("смета с полными суммами считается по-прежнему", () => {
    // Правка не должна стоить работающего случая: курганский комплект сходится
    // в 0 ₽, и это проверяется отдельными наборами — здесь только контроль.
    const отчёт = calculateConvergence({
      sections: [{ number: "1", positionTotals: ["100.00", "200.00"], declaredTotal: "300.00" }],
      declaredTotal: "300.00",
    });

    expect(отчёт.converged).toBe(true);
    expect(отчёт.document.computed).toBe("300.00");
    expect(отчёт.document.delta).toBe("0.00");
  });
});

/**
 * СВЕРКА С ШАПКОЙ — против ошибки ровно в тысячу раз.
 *
 * Множитель 1000 стоял в коде константой: курганский сводный расчёт составлен
 * в тыс. руб., и это выглядело свойством формы. Форма 421/пр допускает и
 * рубли — так составлен пакет Нижнего Тагила («Сметная стоимость, руб.»).
 */
describe("сверка итога с заявленной в шапке стоимостью", () => {
  it("шапка в ТЫС. РУБ. переводится в рубли", () => {
    const сверка = compareWithHeader("104976702.48" as never, "104976.71");

    expect(сверка?.headerInRubles).toBe("104976710.00");
    expect(сверка?.delta).toBe("7.52");
    expect(сверка?.explainedByScale, "7,52 ₽ при гранулярности 10 ₽ — округление источника").toBe(true);
  });

  it("шапка В РУБЛЯХ берётся как есть", () => {
    // Умножив её на тысячу, система объявила бы расхождение в 999 раз больше
    // стоимости объекта — и число выглядело бы посчитанным.
    const сверка = compareWithHeader("86778920.38" as never, "86778920.38", {
      scale: "unit",
      fractionDigits: 2,
    });

    expect(сверка?.headerInRubles).toBe("86778920.38");
    expect(сверка?.delta).toBe("0.00");
    expect(сверка?.explainedByScale).toBe(true);
  });
});
