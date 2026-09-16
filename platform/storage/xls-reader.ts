/**
 * Чтение старого двоичного Excel (`.xls`, BIFF8) в ту же абстракцию листа,
 * что и `.xlsx` — веха Д1б плана демо.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО
 *
 * Замер по клиентским кейсам: `.xls` в них ДЕСЯТКИ — обоснования НМЦК,
 * ведомости объёмов, расчёты стоимости. До этой правки такой файл принимался
 * дверью загрузки и объявлялся неразобранным: честно, но бесполезно. Сто смет в
 * старом формате давали «документов 100, позиций 0».
 *
 * ПОЧЕМУ ДРУГАЯ БИБЛИОТЕКА, А НЕ ТА ЖЕ
 *
 * `exceljs` читает только `.xlsx`: BIFF8 — другой контейнер (OLE2, а не ZIP), и
 * поддержки его там нет вовсе. `xlsx` (SheetJS) читает оба, и он уже в
 * зависимостях. Две библиотеки на два формата — цена, которую платят один раз;
 * альтернатива была бы «переписать чтение xlsx на SheetJS», то есть тронуть
 * путь, который работает и проверен на настоящих сметах.
 *
 * ЛОГИКА РАЗБОРА НЕ МЕНЯЕТСЯ НИ НА СТРОКУ
 *
 * Выход — тот же `Sheet` (номер строки → буква колонки → текст). Ради этого
 * абстракция и заведена: «одна абстракция — одна логика разбора на оба
 * формата». Проверяется это тем, что `parseLsr` работает над `.xls` без
 * единого условия про формат.
 *
 * ЧИСЛА БЕРУТСЯ ТЕКСТОМ, КАК ИХ ВИДИТ ЧЕЛОВЕК
 *
 * `raw: false` у SheetJS даёт форматированное значение ячейки — то же, что
 * показывает Excel. Брать двоичное число значило бы получить `824009.9700000001`
 * там, где в документе стоит `824 009,97`, и §12.1б («расхождение ровно 0 ₽»)
 * перестал бы держаться на округлении, которого в источнике нет.
 */
import { readFile } from "node:fs/promises";

import * as XLSX from "xlsx";

import type { Sheet } from "@modules/documents/sheet.js";

import type { ReadOptions } from "./xlsx-reader.js";

/**
 * Признак OLE2 — контейнер старого Excel.
 *
 * Проверяется ЗДЕСЬ, а не только определителем формата: читатель — публичная
 * функция, и наведённый на `.xlsx` он обязан сказать это словами, а не выдать
 * внутреннюю ошибку разборщика. Ту же ошибку однажды уже пришлось переводить в
 * `xlsx-reader.ts`, и повторять её здесь незачем.
 */
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function readXlsSheet(path: string, options: ReadOptions = {}): Promise<Sheet> {
  const bytes = await readFile(path);

  /**
   * ДВЕ ПОДПИСИ, А НЕ ОДНА: `.xls` — поток OLE2, `.xlsb` — контейнер OPC (zip).
   *
   * Читает их одна и та же библиотека, определяя формат по содержимому, но
   * сторож смотрел только на OLE2 — и двоичная книга Excel отвергалась при
   * живом читателе. В корпусе заказчика так терялись АРМы учёта материалов.
   *
   * Сторож остаётся: без него сюда попал бы PDF, и ошибка распаковщика назвала
   * бы причиной не то, что случилось.
   */
  const ole2 = bytes.subarray(0, 8).equals(OLE2);
  const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (!ole2 && !zip) {
    throw new Error(
      `Файл ${path} не является книгой Excel: ни подписи OLE2 (.xls), ни контейнера zip (.xlsb) в начале нет. ` +
        "Для .xlsx используйте readXlsxSheet.",
    );
  }

  const workbook = XLSX.read(bytes, {
    type: "buffer",
    // Формулы не пересчитываются: в выгрузке лежит их результат, и он же нужен.
    cellFormula: false,
    // Даты как текст: приводить их к `Date` значило бы навязать часовой пояс
    // машины документу, который его не объявлял.
    cellDates: false,
    cellText: true,
  });

  const name =
    options.sheetName ??
    workbook.SheetNames[options.sheetIndex ?? 0];

  if (name === undefined) {
    throw new Error(`В книге ${path} нет ни одного листа`);
  }

  const worksheet = workbook.Sheets[name];

  if (worksheet === undefined) {
    throw new Error(
      `Лист «${name}» не найден в ${path}. Доступны: ${workbook.SheetNames.join(", ") || "нет листов"}`,
    );
  }

  return { name, rows: ячейкиЛиста(worksheet) };
}

/**
 * ВСЕ ЛИСТЫ ДВОИЧНОЙ КНИГИ ЗА ОДНО ЧТЕНИЕ ФАЙЛА.
 *
 * Та же причина, что у `readXlsxSheets`: смета часто лежит не первым листом, а
 * разбор читал только первый. Файл читается один раз — книги бывают большими.
 */
export async function readXlsSheets(path: string): Promise<readonly Sheet[]> {
  const bytes = await readFile(path);
  const workbook = XLSX.read(bytes, { type: "buffer", cellFormula: false, cellDates: false, cellText: true });

  const sheets: Sheet[] = [];

  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (worksheet === undefined) continue;
    sheets.push({ name, rows: ячейкиЛиста(worksheet) });
  }

  return sheets;
}

/** Ячейки листа SheetJS → строки абстракции листа. Общее тело обоих чтений. */
function ячейкиЛиста(worksheet: XLSX.WorkSheet): Map<number, Map<string, string>> {
  const rows = new Map<number, Map<string, string>>();

  for (const [address, cell] of Object.entries(worksheet)) {
    // Служебные ключи листа начинаются с `!` (`!ref`, `!merges`, `!margins`).
    if (address.startsWith("!")) continue;

    const value = cell as XLSX.CellObject | undefined;
    if (value === undefined) continue;

    // `w` — форматированный текст, `v` — исходное значение. Первый ближе к
    // тому, что видит человек; второй нужен, когда формата у ячейки нет.
    const text = (value.w ?? (value.v === undefined || value.v === null ? "" : String(value.v))).trim();
    if (text === "") continue;

    const parsed = XLSX.utils.decode_cell(address);
    // SheetJS считает строки и колонки с нуля, `Sheet` — с единицы и буквами:
    // адрес разбирается обратно, а не собирается из строки вручную.
    const rowNumber = parsed.r + 1;
    const column = XLSX.utils.encode_col(parsed.c);

    const cells = rows.get(rowNumber) ?? new Map<string, string>();
    cells.set(column, text);
    rows.set(rowNumber, cells);
  }

  return rows;
}
