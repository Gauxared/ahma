/**
 * СМЕТА В ДОКУМЕНТЕ WORD ЧИТАЕТСЯ ЛИСТОМ.
 *
 * ЧТО БЫЛО. Реестр читателей листов знал `xlsx`, `xls`, `xlsb`, `csv`. Смета,
 * присланная документом Word, до разбора не доходила ФИЗИЧЕСКИ: превратить её
 * в лист было некому. Она уходила к роли текстом — без позиций, без сходимости,
 * без шифров и без координаты строки.
 *
 * Владелец 09.09.2026: «сметы — это не только эксель, но и ворд». Проверено на
 * корпусе: ЛСР приходят и документом Word, и PDF-файлом.
 *
 * ПОЧЕМУ ЧИТАТЕЛЬ, А НЕ ВТОРОЙ ПАРСЕР. Разбор написан над абстракцией листа, а
 * не над Excel — так и задумано. Достаточно построить лист из таблицы Word, и
 * форма разбирается тем же кодом, теми же правилами шапки и теми же проверками
 * сходимости. Второй парсер разошёлся бы с первым на первой же правке.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { describe, expect, it } from "vitest";

import { cell, rowNumbers } from "@modules/documents/sheet.js";

import { readDocxSheet } from "./docx-sheet-reader.js";
import { SHEET_READERS } from "./sheet-reader.js";

const строка = (ячейки: readonly string[]): TableRow =>
  new TableRow({
    children: ячейки.map((текст) => new TableCell({ children: [new Paragraph({ children: [new TextRun(текст)] })] })),
  });

/** Документ Word: титульная табличка подписей и сама смета. */
async function сметаВWord(): Promise<string> {
  const документ = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("ЛОКАЛЬНЫЙ СМЕТНЫЙ РАСЧЁТ (СМЕТА) № 02-01")] }),
          // Табличка подписей: строк много, ячеек мало — листом стать не должна.
          new Table({
            rows: [строка(["Составил", "Иванов"]), строка(["Проверил", "Петров"]), строка(["Утвердил", "Сидоров"])],
          }),
          new Paragraph({ children: [new TextRun("Сметная стоимость 10 660,04 тыс. руб.")] }),
          new Table({
            rows: [
              строка(["№ п/п", "Обоснование", "Наименование работ", "Ед. изм.", "Количество", "Цена, ₽", "Всего, ₽"]),
              строка(["Раздел 1. Земляные работы"]),
              строка(["1", "ФЕР27-04-001-01", "Устройство основания из щебня", "100 м2", "723,60", "12 480,15", "9 030 636,54"]),
              строка(["2", "ФССЦ-408-0122", "Щебень фракции 40-70", "м3", "1 250,50", "1 303,00", "1 629 401,50"]),
              строка(["", "", "Всего по смете", "", "", "", "10 660 038,04"]),
            ],
          }),
        ],
      },
    ],
  });

  const путь = join(await mkdtemp(join(tmpdir(), "смета-word-")), "ЛСР-02-01.docx");
  await writeFile(путь, Buffer.from(await Packer.toBuffer(документ)));
  return путь;
}

describe("лист из документа Word", () => {
  it("реестр читателей знает документ Word: до этого смета в нём не доходила до разбора", () => {
    expect(SHEET_READERS["docx"]).toBeDefined();
  });

  it("листом становится смета, а не табличка подписей", async () => {
    const лист = await readDocxSheet(await сметаВWord());

    // «Крупная» считается по ЯЧЕЙКАМ: у таблички подписей строк столько же,
    // сколько у сметы, но колонки две — по строкам она бы и победила.
    expect(cell(лист, 1, "A")).toBe("№ п/п");
    expect(cell(лист, 1, "G")).toBe("Всего, ₽");
  });

  it("строки и колонки на местах: количество не отрывается от своей работы", async () => {
    const лист = await readDocxSheet(await сметаВWord());

    expect(cell(лист, 3, "B")).toBe("ФЕР27-04-001-01");
    expect(cell(лист, 3, "C")).toBe("Устройство основания из щебня");
    expect(cell(лист, 3, "E")).toBe("723,60");
    expect(cell(лист, 3, "G")).toBe("9 030 636,54");
  });

  it("строка раздела занимает первую колонку — как в объединённой ячейке сметы", async () => {
    const лист = await readDocxSheet(await сметаВWord());

    expect(cell(лист, 2, "A")).toBe("Раздел 1. Земляные работы");
  });

  it("номера строк идут подряд с единицы: по ним человек находит строку", async () => {
    const лист = await readDocxSheet(await сметаВWord());

    expect(rowNumbers(лист)).toEqual([1, 2, 3, 4, 5]);
  });

  it("документ без таблиц даёт пустой лист, а не выдуманную структуру", async () => {
    const без = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun("Пояснительная записка без единой таблицы")] })] }],
    });
    const путь = join(await mkdtemp(join(tmpdir(), "записка-")), "записка.docx");
    await writeFile(путь, Buffer.from(await Packer.toBuffer(без)));

    // Пустой лист честнее выдуманного: разбор скажет «формы здесь нет».
    expect((await readDocxSheet(путь)).rows.size).toBe(0);
  });
});
