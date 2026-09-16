/**
 * Тесты написаны до реализации по спецификации T5 (docs/m1-tasks.md).
 *
 * Здесь проверяется структура книги как чистых данных. Что файл действительно
 * открывается и пересчитывается, проверяется отдельно на настоящем движке
 * (tests/integration/calculation-workbook-recalc.test.ts).
 */
import { describe, expect, it } from "vitest";

import { decimal, money, sha256 } from "@contracts/index.js";
import type { Artifact } from "@contracts/index.js";

import { buildCalculationWorkbook, escapeSpreadsheetText } from "./calculation-workbook.js";
import type { CalculationSource } from "./calculation-workbook.js";

const HASH = sha256("3".repeat(64));

function traced(amount: string, formulaId: string) {
  return {
    value: money(amount),
    provenance: {
      kind: "formula" as const,
      trace: {
        formulaId,
        formulaVersion: 1,
        inputs: { addend_1: decimal("9019.31") },
        output: decimal(amount),
        rounding: "half-up" as const,
      },
    },
  };
}

function sourced(amount: string, row: number) {
  return {
    value: money(amount),
    provenance: {
      kind: "source" as const,
      ref: {
        sourceId: "/лср.xlsx",
        contentHash: HASH,
        locator: { kind: "row" as const, sheet: "ЛСР", row },
        status: "fact" as const,
        acquisition: "parsed" as const,
        checkedAt: "2026-08-25" as never,
        staleAfterDays: 90,
      },
    },
  };
}

const SOURCE: CalculationSource = {
  documentPath: "/лср.xlsx",
  artifact: {
    id: "a-1",
    tenantId: "t-1",
    operation: { id: "check-convergence", version: 1 },
    completeness: "single",
    inputHashes: [HASH],
    degradations: [],
    producedAt: "2026-08-25T10:00:00Z" as Artifact["producedAt"],
    body: {},
  },
  sections: [
    {
      number: "1",
      name: "Оборудование",
      positions: [
        { ordinal: "1", name: "Блок управления", basis: "ГЭСНм08-03-572-06", unit: "шт", amount: sourced("9019.31", 48) },
        { ordinal: "2", name: "Вентилятор", basis: "ГЭСНм08-03-605-01", unit: "шт", amount: sourced("9019.30", 58) },
      ],
      total: traced("18038.61", "calculation.convergence.section:1"),
    },
  ],
  documentTotal: traced("18038.61", "calculation.convergence.document"),
  parameters: [
    { id: "tax.vat.rate", value: decimal("0.22"), effectiveFrom: "2026-01-01", source: "ТЗ АПРИ" },
  ],
  accuracy: { range: "±3–5%", basis: "по локальному сметному расчёту", heuristic: true },
  generatorVersion: "1.0.0",
};

describe("экранирование формульной инъекции (ТЗ §10)", () => {
  it("экранирует текст, начинающийся с опасного символа", () => {
    // Пробельный шум перед признаком формулы не спасает: импортёры его
    // обрезают, и строка снова становится формулой на чужой стороне.
    for (const dangerous of ["=1+1", "+СУММ(A1)", "-2", "@ссылка", "\t=таб", "\r=возврат", " =1+1"]) {
      expect(escapeSpreadsheetText(dangerous).startsWith("'")).toBe(true);
    }
  });

  it("НЕ экранирует текст с ведущей табуляцией без признака формулы", () => {
    // Контракт сузился намеренно: раньше апостроф вешался на любой текст с
    // ведущим управляющим символом. Табуляция сама по себе формулу не
    // запускает, а менять текст источника без причины нельзя — по нему сверяют
    // смету с документом.
    expect(escapeSpreadsheetText("\tБлок управления")).toBe("\tБлок управления");
  });

  it("не трогает обычный текст", () => {
    expect(escapeSpreadsheetText("Блок управления")).toBe("Блок управления");
    expect(escapeSpreadsheetText("ГЭСНм08-03-572-06")).toBe("ГЭСНм08-03-572-06");
  });

  it("экранирует наименование позиции из документа", () => {
    const workbook = buildCalculationWorkbook({
      ...SOURCE,
      sections: [
        {
          ...SOURCE.sections[0]!,
          positions: [{ ...SOURCE.sections[0]!.positions[0]!, name: "=ВЗЛОМ()" }],
        },
      ],
    });

    const cells = workbook.sheets.flatMap((sheet) => sheet.rows.flat());
    const injected = cells.find((cell) => cell.kind === "text" && cell.value.includes("ВЗЛОМ"));

    expect(injected?.kind).toBe("text");
    if (injected?.kind === "text") {
      expect(injected.value.startsWith("'")).toBe(true);
    }
  });
});

describe("структура расчётной книги (ТЗ §10)", () => {
  const workbook = buildCalculationWorkbook(SOURCE);

  it("содержит лист расчёта и лист параметров", () => {
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Расчёт", "Параметры", "Источники"]);
  });

  it("итог раздела — рабочая формула, а не значение", () => {
    const calc = workbook.sheets[0]!;
    const formulas = calc.rows.flat().filter((cell) => cell.kind === "formula");

    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas.some((cell) => cell.kind === "formula" && cell.formula.startsWith("SUM("))).toBe(true);
  });

  it("каждая формульная ячейка несёт след формулы (§12.1д)", () => {
    for (const sheet of workbook.sheets) {
      for (const cell of sheet.rows.flat()) {
        if (cell.kind === "formula") {
          expect(cell.trace.formulaId.length).toBeGreaterThan(0);
          expect(cell.expected).toBeDefined();
        }
      }
    }
  });

  it("каждое число несёт маркер статуса источника (§12.1д)", () => {
    for (const sheet of workbook.sheets) {
      for (const cell of sheet.rows.flat()) {
        if (cell.kind === "number") {
          expect(cell.marker.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("подсвечивает вводимые значения отдельным стилем", () => {
    const calc = workbook.sheets[0]!;
    const inputs = calc.rows.flat().filter((cell) => cell.kind !== "empty" && cell.style === "input");

    // Суммы позиций пришли из документа — это вводимые значения.
    expect(inputs.length).toBe(2);
  });

  it("лист параметров содержит ставку с датой начала действия (ТЗ §6.4)", () => {
    const parameters = workbook.sheets[1]!;
    const flat = parameters.rows.flat().map((cell) => (cell.kind === "text" ? cell.value : ""));

    expect(flat).toContain("tax.vat.rate");
    expect(flat).toContain("2026-01-01");
  });

  it("метаданные содержат версию шаблона, хэш артефакта и версию генератора", () => {
    expect(workbook.metadata.templateVersion).toBeDefined();
    expect(workbook.metadata.artifactId).toBe("a-1");
    expect(workbook.metadata.inputHashes).toEqual([HASH]);
    expect(workbook.metadata.generatorVersion).toBe("1.0.0");
  });

  it("выводит маркер точности как договорную эвристику (ТЗ §9)", () => {
    const flat = workbook.sheets.flatMap((sheet) => sheet.rows.flat());
    const accuracy = flat.find((cell) => cell.kind === "text" && cell.value.includes("±3–5%"));

    expect(accuracy).toBeDefined();
    expect(flat.some((cell) => cell.kind === "text" && /эвристик/i.test(cell.value))).toBe(true);
  });
});
