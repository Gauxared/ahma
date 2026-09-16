/**
 * Чтение xlsx в абстракцию листа (`modules/documents/sheet.ts`).
 *
 * Это единственное место, знающее про библиотеку чтения. Логика разбора смет
 * работает над `Sheet` и не меняется при смене библиотеки или при добавлении
 * ГРАНД-Смета XML по ТЗ §8.1.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import ExcelJS from "exceljs";

import { sha256 } from "@contracts/index.js";
import type { Sha256 } from "@contracts/index.js";
import type { Sheet } from "@modules/documents/sheet.js";

/**
 * Хэш содержимого файла по байтам (ADR-R-027).
 *
 * Считается именно по буферу: перевод бинарного файла в строку теряет данные
 * и делает хэш невоспроизводимым.
 */
export async function fileContentHash(path: string): Promise<Sha256> {
  const bytes = await readFile(path);
  return sha256(createHash("sha256").update(bytes).digest("hex"));
}

/**
 * Приводит значение ячейки к тексту, каким его видит пользователь.
 *
 * РАЗБОР СМЕТЫ РАБОТАЕТ НАД ЭТИМ ЗНАЧЕНИЕМ, поэтому здесь именно то, что
 * человек видит в ячейке: у формулы — её результат, а не текст. Формула,
 * ошибка и примечание нужны ЧЕЛОВЕКУ И РОЛИ, а не арифметике, и едут отдельным
 * каналом (`cellDetails`): подставить `=СУММ(H12:H48)` в колонку суммы значило
 * бы сломать сходимость.
 */
function toText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    // Формула: берём вычисленный результат, а не текст формулы.
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return toText(value.result as ExcelJS.CellValue);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("error" in value) {
      /**
       * ОШИБКА ЯЧЕЙКИ — ЭТО ЗНАЧЕНИЕ, А НЕ ПУСТОТА.
       *
       * `#ССЫЛКА!` в смете означает, что формула указывает в удалённую строку;
       * `#ДЕЛ/0!` — что делитель обнулился. Обе — признак битого документа, и
       * обе до сих пор превращались в пустую ячейку: разбор видел «суммы нет»
       * там, где на деле «сумма сломана».
       */
      return String((value as { error: unknown }).error);
    }
  }

  return "";
}

/** Что в ячейке есть сверх видимого значения (Т10): формула, примечание, ссылка. */
export interface CellDetail {
  readonly cell: string;
  readonly formula?: string;
  readonly note?: string;
  readonly hyperlink?: string;
}

/** Что есть на листе сверх ячеек: изображения, объединения, состояние. */
export interface SheetExtras {
  readonly formulas: readonly CellDetail[];
  /** Объединённые области как их видит Excel: `A1:D1`. */
  readonly merges: readonly string[];
  /** Изображения листа: подпись и байты. */
  readonly images: readonly { readonly name: string; readonly extension: string; readonly bytes: Buffer }[];
  /** Лист скрыт — человек его в книге не видит, а данные в нём есть. */
  readonly hidden: boolean;
}

function columnLetter(address: string): string {
  return address.replace(/\d+/g, "");
}

export interface ReadOptions {
  /** Индекс листа с нуля; по умолчанию первый. */
  readonly sheetIndex?: number;
  readonly sheetName?: string;
}

/**
 * Имена листов книги в порядке следования.
 *
 * ДВЕ БИБЛИОТЕКИ, ПОТОМУ ЧТО ОДНА НЕ ЧИТАЕТ СТАРЫЙ ФОРМАТ.
 *
 * ЗАМЕРЕНО НА КОМПЛЕКТЕ ЗАКАЗЧИКА 08.09.2026: `ExcelJS` на `.xls` бросает
 * «Can't find end of central directory» — он умеет только контейнер OPC. Здесь
 * это возвращало ПУСТОЙ СПИСОК, а вызывающий читал книгу как одностраничную:
 *
 *   · «Ведомость объёмов… .xls» — 3 листа, 305 ячеек; читалось 95 (лист один);
 *   · «Обоснование НМЦК.xls» — 4 листа, 485 ячеек; читалось 279.
 *
 * То есть у книг старого формата ДВЕ ТРЕТИ содержимого не доходило никуда, и
 * это выглядело успехом: «книга, листов 1». Пустой список от библиотеки,
 * принятый за «в книге один лист», — та же молчаливая потеря, что и пропуск
 * файла.
 *
 * Поэтому: контейнер OPC — `ExcelJS`, поток OLE2 — `SheetJS`, и ни один формат
 * не остаётся без перечня листов.
 */
export async function listXlsxSheets(path: string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(path);
    if (workbook.worksheets.length > 0) return workbook.worksheets.map((sheet) => sheet.name);
  } catch {
    // Не контейнер OPC — ниже пробуем старый формат.
  }

  const { default: XLSX } = await import("xlsx");
  const bytes = await readFile(path);
  const book = XLSX.read(bytes, { type: "buffer", bookSheets: true });

  return book.SheetNames;
}

/**
 * ЧТО ЕСТЬ В ЛИСТЕ СВЕРХ ВИДИМЫХ ЗНАЧЕНИЙ — Т10: «не потерять ни единой детали».
 *
 * `readXlsxSheet` отдаёт то, что человек видит в ячейке, и этого хватает
 * арифметике. Но в книге лежит больше, и каждое «больше» до сих пор пропадало
 * молча:
 *
 *   · ФОРМУЛА — `=СУММ(H12:H48)`. Результат мы берём, а сама формула и есть
 *     ответ на вопрос «как посчитано»: без неё видно число и не видно, из чего
 *     оно сложилось;
 *   · ПРИМЕЧАНИЕ — сметчик пишет в нём «по согласованию с заказчиком от
 *     12.03», и это основание позиции;
 *   · ГИПЕРССЫЛКА — ссылка на прайс или письмо, то есть источник цены;
 *   · ИЗОБРАЖЕНИЕ — штамп, схема узла, фотография. Лист с одной картинкой и
 *     нулём ячеек выглядел пустым;
 *   · ОБЪЕДИНЕНИЯ — шапка «Материалы» над четырьмя колонками; без них строка
 *     теряет принадлежность;
 *   · СКРЫТЫЙ ЛИСТ — человек его не видит, данные в нём есть.
 *
 * Возвращается ОТДЕЛЬНО от `Sheet`, а не подмешивается в ячейки: подставить
 * текст формулы в колонку суммы значило бы сломать сходимость.
 */
export async function readXlsxExtras(path: string, sheetName: string): Promise<SheetExtras | undefined> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(path);
  } catch {
    return undefined;
  }

  const worksheet = workbook.getWorksheet(sheetName);
  if (worksheet === undefined) return undefined;

  const formulas: CellDetail[] = [];

  /**
   * ОБХОД ВКЛЮЧАЕТ ПУСТЫЕ ЯЧЕЙКИ, и это не мелочь.
   *
   * Ячейка с одним лишь примечанием пуста по значению: сметчик написал
   * «по согласованию с заказчиком от 12.03» и ничего не набрал. При обходе по
   * непустым такая ячейка не встречалась ни разу, и основание позиции
   * пропадало — молча, как будто его не было. Поймано набором.
   *
   * ЧЕГО ЭТО НЕ ЧИНИТ, И ЭТО НАЗВАНО ЧЕСТНО: примечание на ячейке БЕЗ
   * значения не возвращает сама библиотека чтения — замерено зондом, `note`
   * приходит `undefined` и при обходе, и при прямом обращении. Примечание на
   * ячейке со значением — а это обычный случай в сметах — доходит.
   */
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const formula =
        typeof value === "object" && value !== null && "formula" in value
          ? String((value as { formula: unknown }).formula)
          : undefined;
      const note =
        cell.note === undefined
          ? undefined
          : typeof cell.note === "string"
            ? cell.note
            : (cell.note.texts ?? []).map((part) => part.text).join("");
      const hyperlink =
        typeof cell.hyperlink === "string" ? cell.hyperlink : undefined;

      if (formula === undefined && (note ?? "") === "" && hyperlink === undefined) return;

      formulas.push({
        cell: cell.address,
        ...(formula === undefined ? {} : { formula }),
        ...((note ?? "") === "" ? {} : { note: note! }),
        ...(hyperlink === undefined ? {} : { hyperlink }),
      });
    });
  });

  const merges = Object.keys((worksheet as unknown as { _merges?: Record<string, unknown> })._merges ?? {});

  const images = worksheet
    .getImages()
    .map((placement) => {
      const media = workbook.getImage(Number(placement.imageId));
      return media?.buffer === undefined
        ? undefined
        : {
            name: `${sheetName}-${placement.imageId}`,
            extension: media.extension ?? "png",
            bytes: Buffer.from(media.buffer as unknown as ArrayBuffer),
          };
    })
    .filter((image) => image !== undefined) as { name: string; extension: string; bytes: Buffer }[];

  return { formulas, merges, images, hidden: worksheet.state === "hidden" || worksheet.state === "veryHidden" };
}

export async function readXlsxSheet(path: string, options: ReadOptions = {}): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(path);
  } catch (error) {
    // Книга xlsx — это zip-архив, и на любом другом файле наружу выходит
    // внутренняя ошибка распаковщика («Can't find end of central directory»).
    // Она не называет настоящую причину: пользователь навёл команду на PDF.
    const message = (error as Error).message;

    if (/central directory|is this a zip file|End of data reached/i.test(message)) {
      throw new Error(
        `Файл ${path} не является книгой Excel (.xlsx). ` +
          "Разбор сметы работает с выгрузкой ГРАНД-Сметы по форме 421/пр; " +
          "для PDF путь разбора появится отдельной задачей.",
      );
    }

    throw error;
  }

  const worksheet =
    options.sheetName !== undefined
      ? workbook.getWorksheet(options.sheetName)
      : workbook.worksheets[options.sheetIndex ?? 0];

  if (worksheet === undefined) {
    const available = workbook.worksheets.map((sheet) => sheet.name).join(", ");
    throw new Error(`Лист не найден в ${path}. Доступны: ${available || "нет листов"}`);
  }

  return листКниги(worksheet);
}

/** Лист ExcelJS → абстракция листа. Общее тело одиночного и полного чтения. */
function листКниги(worksheet: ExcelJS.Worksheet): Sheet {
  const rows = new Map<number, Map<string, string>>();

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells = new Map<string, string>();

    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = toText(cell.value).trim();
      if (text !== "") {
        cells.set(columnLetter(cell.address), text);
      }
    });

    if (cells.size > 0) {
      rows.set(rowNumber, cells);
    }
  });

  return { name: worksheet.name, rows };
}

/**
 * ВСЕ ЛИСТЫ КНИГИ ЗА ОДНО ОТКРЫТИЕ.
 *
 * Разбор сметы читал ТОЛЬКО ПЕРВЫЙ лист книги. Замерено на комплекте
 * заказчика: смета сплошь и рядом лежит вторым-третьим листом, а первым идёт
 * титул или расчёт индексов — и такая книга давала ноль позиций при живом
 * разборе.
 *
 * Книга открывается ОДИН раз: чтение по листу отдельным вызовом означало бы
 * разбор всего контейнера столько раз, сколько в нём листов, а книги здесь до
 * шестидесяти четырёх мегабайт.
 */
export async function readXlsxSheets(path: string): Promise<readonly Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  return workbook.worksheets.map((worksheet) => листКниги(worksheet));
}
