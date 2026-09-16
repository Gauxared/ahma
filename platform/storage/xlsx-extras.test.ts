/**
 * ЧТО КНИГА ТЕРЯЛА ПО ДОРОГЕ — Т10.
 *
 * Каждая проверка здесь соответствует потере, которая происходила МОЛЧА: файл
 * читался, число доходило, а формула, примечание, ошибка ячейки, изображение
 * или скрытый лист исчезали без следа. Молчаливая потеря опаснее отказа —
 * книга выглядит прочитанной целиком.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { dumpWorkbook, sheetToTsv } from "@platform/config/base-dump.js";
import { readXlsxExtras, readXlsxSheet } from "./xlsx-reader.js";

async function книга(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "книга-"));
  const path = join(dir, "смета.xlsx");
  const workbook = new ExcelJS.Workbook();

  const лист = workbook.addWorksheet("Расчёт");
  лист.getCell("A1").value = "Наименование";
  лист.getCell("B1").value = "Сумма";
  лист.getCell("B2").value = { formula: "SUM(B3:B4)", result: 1500 };
  лист.getCell("B3").value = 1000;
  лист.getCell("B4").value = 500;
  лист.getCell("A2").value = "Щебень фр. 40-70";
  лист.getCell("A2").note = "по согласованию с заказчиком от 12.03";
  // Гиперссылка задаётся значением ячейки целиком: `hyperlink` — только чтение.
  лист.getCell("A3").value = { text: "Прайс", hyperlink: "https://example.com/прайс" };
  // Excel хранит ошибку латиницей и показывает по локали: `#REF!` в файле —
  // это `#ССЫЛКА!` на экране русского Excel.
  лист.getCell("C2").value = { error: "#REF!" } as ExcelJS.CellErrorValue;
  лист.mergeCells("A6:D6");
  лист.getCell("A6").value = "МАТЕРИАЛЫ";

  const скрытый = workbook.addWorksheet("Служебный");
  скрытый.state = "hidden";
  скрытый.getCell("A1").value = "коэффициент 1,15";

  await workbook.xlsx.writeFile(path);
  return path;
}

describe("книга отдаёт всё, что в ней есть", () => {
  it("формула, примечание и ссылка доходят подробностями листа", async () => {
    const extras = await readXlsxExtras(await книга(), "Расчёт");

    expect(extras).toBeDefined();
    const формулы = extras!.formulas;

    // Результат формулы у нас был всегда; терялось то, ИЗ ЧЕГО он сложился.
    expect(формулы.find((d) => d.cell === "B2")?.formula).toBe("SUM(B3:B4)");
    // Примечание сметчика — основание позиции, а не украшение.
    expect(формулы.find((d) => d.cell === "A2")?.note).toContain("по согласованию");
    // Ссылка на прайс — источник цены.
    expect(формулы.find((d) => d.cell === "A3")?.hyperlink).toContain("example.com");
  }, 60_000);

  it("ошибка ячейки — значение, а не пустота", async () => {
    const sheet = await readXlsxSheet(await книга(), { sheetName: "Расчёт" });

    // `#ССЫЛКА!` означает, что формула указывает в удалённую строку. Раньше
    // ячейка становилась пустой, и разбор видел «суммы нет» вместо «сумма
    // сломана» — признак битой сметы стирался.
    expect(sheet.rows.get(2)?.get("C")).toContain("REF");
  }, 60_000);

  it("объединения и скрытый лист названы, а не пропущены", async () => {
    const path = await книга();
    const extras = await readXlsxExtras(path, "Расчёт");
    const служебный = await readXlsxExtras(path, "Служебный");

    expect(extras!.merges.join(" ")).toContain("A6");
    // Скрытый лист человек в книге не видит, а данные в нём есть.
    expect(служебный!.hidden).toBe(true);
  }, 60_000);

  it("подробности стоят в шапке листа, рядом с числами", async () => {
    const book = await dumpWorkbook(await книга());
    const расчёт = book!.sheets.find((s) => s.name === "Расчёт")!;
    const tsv = sheetToTsv(расчёт);

    // Рядом, а не в соседнем файле: роль, открывшая лист, обязана увидеть,
    // из чего сложилось число, не догадываясь сходить за этим отдельно.
    expect(tsv).toContain("формула SUM(B3:B4)");
    expect(tsv).toContain("объединённые области");
    expect(tsv).toContain("примечание");

    const служебный = book!.sheets.find((s) => s.name === "Служебный")!;
    expect(sheetToTsv(служебный)).toContain("ЛИСТ СКРЫТ");
  }, 60_000);
});
