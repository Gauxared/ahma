/**
 * ВЫГРУЗКА ИСТОЧНИКА ЦЕЛИКОМ — Т12: «до единой строчки и до единого символа».
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ КАНАЛ, А НЕ ПРАВКА `reference-base-loader`
 *
 * Тот загрузчик готовит базу К ПОКАЗУ В ПРОМПТЕ, и потому обязан отбирать:
 * он выбрасывает лист «навигатор», сводит строку к модели «шифр · статус ·
 * норма» и в `renderReferenceBase` печатает только строки, у которых есть шифр
 * или статус. Для окна промпта это верно, для требования «вся база в системе» —
 * нет: строка без шифра (пояснение, цена, порядок действий) исчезала молча.
 *
 * Здесь отбора НЕТ вовсе. Лист — как в книге, строка — как в листе, ячейка —
 * как в ячейке. Роль читает эти файлы командами из рабочей папки, а не через
 * окно промпта, поэтому платить за полноту размером окна не приходится.
 *
 * ЧТО ЭТО ЧИНИТ ПОМИМО ОТБОРА
 *
 * `loadReferenceBase` перебирал листы по индексу и обрывался на сорок первом
 * (`if (index > 40) break`). У Единой базы 120 вкладок — восемьдесят из них не
 * читались никогда, и об этом ничто не сообщало. Здесь листы берутся списком.
 */
import { existsSync } from "node:fs";

import { rowNumbers } from "@modules/documents/sheet.js";

import { readSheetOf } from "../storage/sheet-reader.js";
import { fileContentHash, listXlsxSheets, readXlsxExtras } from "../storage/xlsx-reader.js";
import type { SheetExtras } from "../storage/xlsx-reader.js";

export interface DumpedSheet {
  readonly name: string;
  /** Строки как в листе: номер строки книги и значения ячеек по колонкам. */
  readonly rows: readonly (readonly [number, readonly string[]])[];
  /**
   * Что есть в листе сверх значений: формулы, примечания, ссылки, объединения,
   * изображения, скрытость (Т10). Пусто — лист прочитан, но подробностей нет;
   * `undefined` — подробности читать не удалось, и это разные утверждения.
   */
  readonly extras?: SheetExtras | undefined;
}

export interface DumpedWorkbook {
  readonly source: string;
  readonly contentHash: string;
  readonly sheets: readonly DumpedSheet[];
  /** Сколько строк вышло. Число сверяется с источником в приёмке Т12. */
  readonly rowCount: number;
}

/** Все листы книги, все строки, без отбора и без потолка. */
export async function dumpWorkbook(path: string): Promise<DumpedWorkbook | undefined> {
  if (!existsSync(path)) return undefined;

  let names: string[];

  try {
    names = await listXlsxSheets(path);
  } catch {
    // Книга не открывается (битый файл, чужой формат под расширением `.xlsx`).
    // Один такой файл не должен обрывать сборку рабочей папки: источник
    // называется непрочитанным в описи, остальные читаются.
    return undefined;
  }

  if (names.length === 0) return undefined;

  const sheets: DumpedSheet[] = [];
  let rowCount = 0;

  for (const name of names) {
    let sheet;

    try {
      /**
       * ЧЕРЕЗ ОБЩИЙ ДИСПЕТЧЕР, А НЕ ЧИТАТЕЛЬ ОДНОГО ФОРМАТА.
       *
       * Прямой вызов читателя `.xlsx` возвращал ПУСТОЙ ЛИСТ на книге старого
       * формата и на файле, который книгой не является: выгрузка выглядела
       * успешной и не содержала ничего. Диспетчер выбирает читателя по
       * содержимому, и книга любого формата отдаёт строки.
       */
      sheet = await readSheetOf(path, { sheetName: name });
    } catch {
      // Лист не прочитался — он называется в описи пустым, а не пропадает.
      sheets.push({ name, rows: [] });
      continue;
    }

    const rows: [number, string[]][] = [];

    for (const number of rowNumbers(sheet)) {
      const cells = sheet.rows.get(number);
      if (cells === undefined) continue;

      const values = [...cells.keys()]
        .sort((left, right) => left.localeCompare(right))
        .map((column) => (cells.get(column) ?? "").replace(/[\t\r\n]+/gu, " "));

      // Пустая строка тоже строка: без неё номера строк уехали бы, а роль
      // называет находку номером строки листа.
      rows.push([number, values]);
    }

    rowCount += rows.length;
    sheets.push({ name, rows, extras: await readXlsxExtras(path, name) });
  }

  /**
   * КНИГА БЕЗ ЕДИНОЙ СТРОКИ — НЕ КНИГА.
   *
   * Перечень листов теперь отвечает и на файле, книгой не являющемся: SheetJS
   * снисходителен и назовёт «Sheet1». Вернуть такую выгрузку значило бы отдать
   * пустой лист под видом прочитанной книги — молчаливая потеря, ровно та, от
   * которой этот модуль и заведён.
   *
   * Отсутствие выгрузки НЕ означает потери содержимого: файл читает
   * `universal-reader` текстом. Здесь просто сказано, что книгой он не был.
   */
  if (rowCount === 0) return undefined;

  return { source: path.split("/").filter(Boolean).pop() ?? path, contentHash: await fileContentHash(path), sheets, rowCount };
}

/**
 * Лист в TSV: первая колонка — номер строки книги, дальше ячейки как есть.
 *
 * Подробности листа идут ШАПКОЙ, а не отдельным файлом: роль, открывшая лист,
 * обязана увидеть формулу и примечание рядом с числом, а не догадаться сходить
 * за ними в соседний файл.
 */
export function sheetToTsv(sheet: DumpedSheet): string {
  const lines = sheet.rows.map(([number, values]) => `${number}\t${values.join("\t")}`);
  const extras = sheet.extras;
  const head = [`# лист: ${sheet.name}`, `# строк: ${sheet.rows.length}`];

  if (extras === undefined) {
    head.push("# подробности листа прочитать не удалось: формул, примечаний и изображений здесь нет");
  } else {
    if (extras.hidden) head.push("# ЛИСТ СКРЫТ в книге: человек его не видит, данные в нём есть");
    if (extras.merges.length > 0) head.push(`# объединённые области: ${extras.merges.join(" ")}`);
    if (extras.images.length > 0) head.push(`# изображений на листе: ${extras.images.length} (лежат в листы/)`);

    for (const detail of extras.formulas) {
      const части = [
        detail.formula === undefined ? undefined : `формула ${detail.formula}`,
        detail.note === undefined ? undefined : `примечание «${detail.note.replace(/\s+/gu, " ").trim()}»`,
        detail.hyperlink === undefined ? undefined : `ссылка ${detail.hyperlink}`,
      ].filter((часть) => часть !== undefined);
      head.push(`# ${detail.cell}: ${части.join("; ")}`);
    }
  }

  return `${head.join("\n")}\nстрока\tячейки…\n${lines.join("\n")}\n`;
}
