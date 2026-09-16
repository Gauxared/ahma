/**
 * CSV как ЛИСТ — та же абстракция, что у книги Excel.
 *
 * ПОЧЕМУ ЛИСТ, А НЕ «ТЕКСТ ДЛЯ АГЕНТА»
 *
 * CSV — таблица, а не проза. Отдав её агенту текстом, мы получили бы позиции,
 * НАЗВАННЫЕ моделью вместо ИЗВЛЕЧЁННЫХ разбором: у чисел не стало бы координаты,
 * а §12.1д требует обратного — каждое значение с точкой в источнике. Через
 * `Sheet` работает тот же разбор, что у книг: и форма 421/пр, и сходимость
 * считаются одинаково, и координата замечания указывает на строку файла.
 *
 * ЧТО ЗДЕСЬ ЧЕСТНО, А ЧТО НЕТ
 *
 * Разбор CSV НЕ ПРИТВОРЯЕТСЯ, что понял смету. Он отдаёт лист как есть, а
 * решает уже парсер сметы: нашёл шапку — смета; не нашёл — отказ с той же
 * причиной, что у книги не по форме. Иначе получился бы парсер, молча дающий
 * нули на любой выгрузке.
 *
 * РАЗДЕЛИТЕЛЬ И КОДИРОВКА ОПРЕДЕЛЯЮТСЯ, А НЕ НАЗНАЧАЮТСЯ
 *
 * Русский Excel сохраняет CSV с точкой с запятой в `windows-1251`; выгрузка из
 * веб-системы — с запятой в UTF-8. Назначить одно значило бы читать половину
 * файлов как одну колонку кракозябр, то есть «прочитать» и получить ноль
 * позиций — а это на экране неотличимо от пустой сметы.
 *
 * Здесь только чистая работа над строкой: чтение файла — в
 * `platform/storage/csv-reader.ts`. Разделение не ради слоёв, а ради того же,
 * ради чего существует `Sheet`: разбор проверяется без файлов.
 */
import type { Sheet } from "./sheet.js";

/** Разделители, среди которых выбираем. Порядок роли не играет: считаем все. */
const DELIMITERS = [";", ",", "\t", "|"] as const;

/** Сколько первых строк смотрим, решая про разделитель. */
const PROBE_LINES = 20;

/**
 * Кодировка по содержимому.
 *
 * UTF-8 проверяется декодированием со `fatal`: если байты не складываются в
 * UTF-8, это почти наверняка однобайтовая кириллица. `windows-1251` — то, во
 * что сохраняет русский Excel. Гадать между ней и `koi8-r` мы не будем: koi8 в
 * сметных выгрузках не встречался, а угаданная неверно кодировка выглядит как
 * успешное чтение мусора.
 */
export function decodeText(bytes: Uint8Array): string {
  // Метка порядка байтов однозначна, и проверять после неё нечего.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

/**
 * Разбор строки с учётом кавычек.
 *
 * Наименование работы почти всегда содержит запятую, а нередко и кавычки:
 * «Установка блоков "БК-3", 4 шт». Простой `split` рвал бы такую строку на
 * части и сдвигал все последующие колонки — то есть менял бы суммы, а не
 * ломался бы заметно.
 */
export function splitLine(line: string, delimiter: string): readonly string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      // Удвоенная кавычка внутри поля — это одна кавычка, а не конец поля.
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char ?? "";
  }

  cells.push(current);

  return cells;
}

export interface CsvShape {
  readonly delimiter: string;
  /** Сколько колонок даёт этот разделитель на первой строке. */
  readonly columns: number;
  /** Доля строк с тем же числом колонок. Единица — идеально ровная таблица. */
  readonly stability: number;
}

/**
 * Разделитель — тот, что даёт таблицу, а не тот, что чаще встречается.
 *
 * Счёта вхождений мало: в наименовании работ запятых бывает больше, чем
 * настоящих разделителей в строке. Отличает разделитель от знака препинания
 * УСТОЙЧИВОСТЬ числа колонок — таблица на то и таблица, что у всех строк
 * ширина одна.
 */
export function csvShape(lines: readonly string[]): CsvShape {
  let best: CsvShape = { delimiter: ";", columns: 1, stability: 0 };

  const probe = meaningful(lines).slice(0, PROBE_LINES);

  for (const delimiter of DELIMITERS) {
    const counts = probe.map((line) => splitLine(line, delimiter).length);
    if (counts.length === 0) continue;

    // Ширину задаёт САМОЕ ЧАСТОЕ число колонок, а не первая строка: у выгрузок
    // сверху бывает заголовок объекта в одну ячейку, и по нему ширина вышла бы
    // единичной, а устойчивость — нулевой.
    const columns = mode(counts);
    if (columns < 2) continue;

    const stability = counts.filter((count) => count === columns).length / counts.length;

    if (stability * columns > best.stability * best.columns) {
      best = { delimiter, columns, stability };
    }
  }

  return best;
}

function mode(values: readonly number[]): number {
  const seen = new Map<number, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);

  let best = 0;
  let bestCount = 0;
  for (const [value, count] of seen) {
    // При равенстве побеждает большее число колонок: узкий «хвост» из пустых
    // строк не должен объявлять таблицу двухколоночной.
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Записи файла — ВСЕ, включая пустые.
 *
 * ПЕРЕВОД СТРОКИ ВНУТРИ КАВЫЧЕК НЕ НАЧИНАЕТ НОВУЮ ЗАПИСЬ, И ЭТО НЕ ТОНКОСТЬ
 * СТАНДАРТА. Замерено на курганской ЛСР: наименования оборудования в ней
 * многострочные («76\nО» в номере позиции, обоснование в три строки), и
 * разбиение простым `split` по `\n` сдвигало нумерацию на две записи — две
 * позиции из сорока четырёх исчезали, а разбор при этом рапортовал успех.
 * Именно поэтому здесь ходят по символам, а не режут выражением.
 *
 * Пустые записи не выбрасываются: номер записи — это КООРДИНАТА в источнике.
 * Выбросив их, мы сослались бы на строку 12, а человек, открыв файл в Excel,
 * увидел бы на двенадцатой другую позицию. Пустые пропускаются позже — при
 * построении листа, где им просто нечего дать.
 *
 * Номер записи совпадает с номером строки в Excel, а не с физической строкой
 * текстового файла. Так и правильно: смету смотрят таблицей.
 */
export function csvLines(text: string): readonly string[] {
  const records: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      // Удвоенную кавычку проносим целиком: состояние от неё не меняется, а
      // решать, что она значит, — дело разбора ячейки.
      if (quoted && text[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }
      quoted = !quoted;
      current += char;
      continue;
    }

    // `\r\n` и одиночный `\r`: выгрузки бывают и из Windows, и из старых систем.
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      records.push(current);
      current = "";
      continue;
    }

    current += char ?? "";
  }

  // Последняя запись без завершающего перевода строки — тоже запись. Добавляем
  // её, только если она непуста: иначе файл, оканчивающийся переводом строки,
  // получал бы лишнюю запись в конце.
  if (current !== "") records.push(current);

  return records;
}

/** Непустые — для определения формы: пустые строки о разделителе не говорят. */
function meaningful(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.trim() !== "");
}

/** Номер колонки в букву: 0 → A, 25 → Z, 26 → AA. Как в книге. */
export function columnLetter(index: number): string {
  let rest = index;
  let letter = "";

  do {
    letter = String.fromCharCode(65 + (rest % 26)) + letter;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);

  return letter;
}

/** Лист из уже прочитанного текста. */
export function csvSheet(text: string, name = "CSV"): Sheet {
  const lines = csvLines(text);
  const { delimiter } = csvShape(lines);
  const rows = new Map<number, ReadonlyMap<string, string>>();

  lines.forEach((line, index) => {
    if (line.trim() === "") return;

    const cells = new Map<string, string>();

    splitLine(line, delimiter).forEach((value, column) => {
      const text = value.trim();
      // Пустые ячейки не кладутся: у книги их тоже нет, и разбор отличает
      // «ячейки нет» от «в ячейке пусто» именно отсутствием ключа.
      if (text !== "") cells.set(columnLetter(column), text);
    });

    // Номер строки с единицы — как в книге: координата замечания «строка 12»
    // означает двенадцатую строку ФАЙЛА, а не двенадцатую непустую.
    rows.set(index + 1, cells);
  });

  return { name, rows };
}
