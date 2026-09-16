/**
 * Критерий приёмки T5: открытая книга пересчитывается и даёт те же итоги,
 * что и артефакт.
 *
 * Проверяется на НАСТОЯЩЕМ движке: файл прогоняется через LibreOffice, который
 * пересчитывает формулы, и результат сравнивается с ожидаемым. Проверить это
 * своей же библиотекой записи невозможно — она формулы не вычисляет, а лишь
 * хранит, и тест подтверждал бы сам себя.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { decimal, money, sha256 } from "@contracts/index.js";
import type { Artifact } from "@contracts/index.js";
import { buildCalculationWorkbook, tracesOf } from "@modules/exports/calculation-workbook.js";
import type { CalculationSource } from "@modules/exports/calculation-workbook.js";
import { readXlsxSheet } from "@platform/storage/xlsx-reader.js";
import { writeWorkbook } from "@platform/storage/xlsx-writer.js";

const run = promisify(execFile);
const LIBREOFFICE = "/usr/bin/libreoffice";
const describeCalc = existsSync(LIBREOFFICE) ? describe : describe.skip;

const HASH = sha256("4".repeat(64));

function traced(amount: string, formulaId: string) {
  return {
    value: money(amount),
    provenance: {
      kind: "formula" as const,
      trace: {
        formulaId,
        formulaVersion: 1,
        inputs: { total: decimal(amount) },
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

/** Суммы взяты из курганского СОТВ, чтобы проверять на реальных величинах. */
const SOURCE: CalculationSource = {
  documentPath: "/Курган_СОТВ.xlsx",
  artifact: {
    id: "a-recalc",
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
        { ordinal: "1", name: "Блок управления", basis: "ГЭСНм08-03-572-06", unit: "шт", amount: sourced("18038.61", 52) },
        { ordinal: "3", name: "Съёмные блоки", basis: "ГЭСНм11-04-008-01", unit: "шт", amount: sourced("2209.54", 57) },
        { ordinal: "5", name: "Вентилятор", basis: "ГЭСНм08-03-605-01", unit: "шт", amount: sourced("3126.29", 62) },
      ],
      total: traced("23374.44", "calculation.convergence.section:1"),
    },
    {
      number: "2",
      name: "Монтаж",
      positions: [
        { ordinal: "11", name: "Шина ответвительная", basis: "ГЭСНм08-01-072-01", unit: "100 м", amount: sourced("1614.83", 67) },
      ],
      total: traced("1614.83", "calculation.convergence.section:2"),
    },
  ],
  documentTotal: traced("24989.27", "calculation.convergence.document"),
  parameters: [
    { id: "tax.vat.rate", value: decimal("0.22"), effectiveFrom: "2026-01-01", source: "ТЗ АПРИ" },
  ],
  accuracy: { range: "±3–5%", basis: "по локальному сметному расчёту", heuristic: true },
  generatorVersion: "1.0.0",
};

describeCalc("расчётная книга пересчитывается настоящим движком", () => {
  it(
    "формулы дают те же итоги, что и артефакт",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "si-xlsx-"));
      const path = join(directory, "raschet.xlsx");

      const workbook = buildCalculationWorkbook(SOURCE);
      await writeWorkbook(workbook, path);

      // LibreOffice пересчитывает формулы при конвертации.
      await run(LIBREOFFICE, [
        "--headless",
        "--convert-to",
        "xlsx",
        "--outdir",
        join(directory, "out"),
        path,
      ]);

      const recalculated = await readXlsxSheet(join(directory, "out", "raschet.xlsx"), {
        sheetName: "Расчёт",
      });
      const values = [...recalculated.rows.values()].flatMap((row) => [...row.values()]);

      // Итоги разделов и итог по смете обязаны сойтись после пересчёта.
      expect(values).toContain("23374.44");
      expect(values).toContain("1614.83");
      expect(values).toContain("24989.27");
    },
    180_000,
  );

  it("каждая формульная ячейка имеет сохранённый след (§12.1д)", () => {
    const traces = tracesOf(buildCalculationWorkbook(SOURCE));

    // Два итога разделов плюс итог по смете.
    expect(traces).toHaveLength(3);
    for (const trace of traces) {
      expect(trace.formulaId).toMatch(/^calculation\./);
    }
  });
});
