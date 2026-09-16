/**
 * Двойной счёт между сметами — второй по важности вывод эталонного разбора
 * курганского объекта, и единственный из четырёх, который мы не воспроизводили
 * вовсе.
 *
 * Ситуация, ради которой правило написано: каждая смета сходится до рубля,
 * сумма смет сходится со сводным расчётом, все внутренние проверки зелёные — а
 * пусконаладка оплачена дважды.
 */
import { describe, expect, it } from "vitest";

import { findCrossEstimateDuplicates } from "./cross-estimate-duplicates.js";
import type { PositionAcrossEstimates } from "./cross-estimate-duplicates.js";

function поз(over: Partial<PositionAcrossEstimates>): PositionAcrossEstimates {
  return {
    document: "объект/СОТВ.xlsx",
    ordinal: "1",
    name: "Пусконаладочные работы",
    basis: "ГЭСНп02-02-001-01",
    amount: "890669.50",
    sourceRow: 10,
    ...over,
  };
}

describe("курганский случай", () => {
  it("НАХОДИТ ту же расценку с той же суммой в двух РАЗНЫХ сметах", () => {
    const отчёт = findCrossEstimateDuplicates([
      поз({}),
      поз({ document: "объект/ПНР.xlsx", ordinal: "2", sourceRow: 14 }),
    ]);

    expect(отчёт.duplicates).toHaveLength(1);
    expect(отчёт.duplicates[0]!.amount).toBe("890669.50");
    // Лишним считается всё сверх первого вхождения: работа одна, оплат две.
    expect(отчёт.excess).toBe("890669.50");
    expect(отчёт.duplicates[0]!.occurrences.map((o) => o.document)).toEqual([
      "СОТВ.xlsx",
      "ПНР.xlsx",
    ]);
  });
});

describe("чего правило НЕ считает повтором", () => {
  it("повтор внутри ОДНОЙ сметы — предмет внутренней проверки, не этой", () => {
    // Иначе одна и та же находка выйдет дважды за подписью двух правил, и
    // читатель решит, что нарушений два.
    const отчёт = findCrossEstimateDuplicates([поз({}), поз({ ordinal: "2", sourceRow: 14 })]);

    expect(отчёт.duplicates).toHaveLength(0);
  });

  it("один шифр при РАЗНЫХ суммах — норма: расценка на разных участках", () => {
    const отчёт = findCrossEstimateDuplicates([
      поз({}),
      поз({ document: "объект/ПНР.xlsx", amount: "111333.71" }),
    ]);

    expect(отчёт.duplicates).toHaveLength(0);
  });

  it("одна сумма при РАЗНЫХ шифрах — совпадение, а не повтор", () => {
    const отчёт = findCrossEstimateDuplicates([
      поз({}),
      поз({ document: "объект/ПНР.xlsx", basis: "ГЭСНм10-06-035-01" }),
    ]);

    expect(отчёт.duplicates).toHaveLength(0);
  });

  it("позиции БЕЗ шифра в сопоставление не идут", () => {
    // У безымянной строки нет опознавательного признака, и совпадение сумм у
    // двух таких строк не значит ничего.
    const отчёт = findCrossEstimateDuplicates([
      поз({ basis: "" }),
      поз({ document: "объект/ПНР.xlsx", basis: "" }),
    ]);

    expect(отчёт.duplicates).toHaveLength(0);
  });
});

describe("порядок и охват", () => {
  it("сортирует по деньгам под вопросом, а не по алфавиту", () => {
    const отчёт = findCrossEstimateDuplicates([
      поз({ basis: "А-1", amount: "100.00" }),
      поз({ basis: "А-1", amount: "100.00", document: "объект/Б.xlsx" }),
      поз({ basis: "Б-2", amount: "5000.00" }),
      поз({ basis: "Б-2", amount: "5000.00", document: "объект/Б.xlsx" }),
    ]);

    expect(отчёт.duplicates.map((d) => d.basis)).toEqual(["Б-2", "А-1"]);
    expect(отчёт.excess).toBe("5100.00");
  });

  it("называет, сколько документов сопоставлено", () => {
    // Правило, применённое к одной смете, ничего не проверило — и об этом
    // читатель обязан узнать по числу, а не по отсутствию находок.
    const отчёт = findCrossEstimateDuplicates([поз({})]);

    expect(отчёт.comparedDocuments).toBe(1);
  });
});
