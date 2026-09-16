/**
 * ПОЛНОСТЬЮ ЛИ ФАЙЛ ДОХОДИТ ДО РОЛИ — СВЕРКА С НЕЗАВИСИМЫМ ЧИТАТЕЛЕМ.
 *
 * ЗАЧЕМ ЭТОТ ЗАМЕР ОТДЕЛЬНО ОТ `measure-readers.ts`. Тот отвечает «сколько
 * знаков вышло», и его ответа мало: знаки могут выйти, а половина книги — нет.
 * Вопрос владельца 09.09.2026 звучал иначе: «разбираются ли файлы ПОЛНОСТЬЮ, всё
 * ли попадает в агентов». На него отвечает только сравнение с независимым
 * прочтением того же файла.
 *
 * КАК СЧИТАЕТСЯ. Для книг — вторым читателем (SheetJS) по всем листам, для
 * прочего — эталонной величиной формата: страницы PDF, символы текста. Затем
 * то же читает НАШ путь (`readAnything` — тот самый, которым материал попадает
 * в рабочую папку роли). Разница между числами и есть ответ.
 *
 * ЧЕГО ЭТОТ ЗАМЕР НЕ ДЕЛАЕТ. Он не проверяет, что роль ПРОЧИТАЛА доехавшее:
 * это уже вопрос хода прогона, и его видно по командам роли в следе. Здесь
 * только про доставку.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { argv, exit } from "node:process";

import { execFileSync } from "node:child_process";

import JSZip from "jszip";
import XLSX from "xlsx";

import { readAnything } from "../platform/storage/universal-reader.js";

/** Независимое прочтение книги: все листы, все непустые ячейки. */
function книгаНезависимо(bytes: Buffer): { readonly знаков: number; readonly листов: number; readonly ячеек: number } {
  const wb = XLSX.read(bytes, { type: "buffer", cellText: true, cellDates: true });
  let знаков = 0;
  let ячеек = 0;

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (sheet === undefined) continue;

    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "" });
    for (const row of rows) {
      for (const cell of row) {
        const текст = String(cell ?? "").trim();
        if (текст === "") continue;
        ячеек += 1;
        знаков += текст.length;
      }
    }
  }

  return { знаков, листов: wb.SheetNames.length, ячеек };
}

/**
 * Независимое прочтение документа Word: текст из `word/document.xml` напрямую.
 *
 * Намеренно НЕ mammoth: сверять наш путь его же библиотекой бессмысленно —
 * ошибка библиотеки повторилась бы в обоих числах и стала бы невидимой.
 */
async function документНезависимо(bytes: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (xml === undefined) return 0;

  /**
   * Текстовые узлы `<w:t>` — всё, что человек видит в документе.
   *
   * Шаблон `<w:t[^>]*>` НЕ ГОДИТСЯ: он ловит и `<w:tcPr>`, и `<w:tbl>` — то
   * есть разметку таблиц, — и на «Описании объекта закупки» дал 5,5 миллиона
   * «знаков текста» вместо 85 тысяч. Замер, ошибающийся в шестьдесят раз, хуже
   * отсутствия замера: он объявил бы полную доставку потерей.
   */
  const куски = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)].map((m) => m[1] ?? "");
  return куски.join(" ").replace(/&[a-z]+;/gu, " ").replace(/\s+/gu, " ").trim().length;
}

/**
 * Независимое прочтение PDF: системный `pdftotext` (poppler).
 *
 * Другая реализация, другой язык, другая команда — ровно то, что нужно для
 * сверки. Нет в системе — значит сравнивать не с чем, и это будет сказано.
 */
function pdfНезависимо(путь: string): number {
  try {
    const текст = execFileSync("pdftotext", ["-q", "-enc", "UTF-8", путь, "-"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return текст.replace(/\s+/gu, " ").trim().length;
  } catch {
    return 0;
  }
}

/** Доля дошедшего от независимо прочитанного, в процентах. */
function доля(наше: number, независимо: number): string {
  if (независимо === 0) return наше === 0 ? "—" : "лишнее";
  return `${Math.round((наше / независимо) * 100)}%`;
}

async function main(): Promise<void> {
  const файлы = argv.slice(2);

  if (файлы.length === 0) {
    console.error("Укажите файлы: npx tsx tooling/measure-completeness.ts <файл> [<файл> …]");
    exit(2);
  }

  console.log("файл | размер | независимо | доехало до роли | доля | чем прочитано");

  let полных = 0;
  let частичных = 0;
  let пустых = 0;

  for (const путь of файлы) {
    const имя = basename(путь);
    let размер = 0;

    try {
      размер = (await stat(путь)).size;
    } catch {
      console.log(`${имя} | файла нет`);
      continue;
    }

    const наше = await readAnything(путь);
    const расширение = extname(путь).toLowerCase();

    let независимо = 0;
    let подпись = "";

    if ([".xlsx", ".xlsm", ".xls", ".xlsb", ".csv"].includes(расширение)) {
      try {
        const книга = книгаНезависимо(await readFile(путь));
        независимо = книга.знаков;
        подпись = `${книга.листов} л., ${книга.ячеек} яч.`;
      } catch (cause) {
        подпись = `SheetJS не открыл: ${(cause as Error).message.slice(0, 40)}`;
      }
    } else if ([".docx", ".dotx"].includes(расширение)) {
      независимо = await документНезависимо(await readFile(путь));
      подпись = "word/document.xml напрямую";
    } else if (расширение === ".pdf") {
      независимо = pdfНезависимо(путь);
      подпись = независимо === 0 ? "pdftotext не дал текста (скан?)" : "pdftotext (poppler)";
    } else {
      // У прочих форматов независимой величины нет: сравнивать не с чем, и
      // выдумывать её нельзя. Показывается то, что вышло, и чем прочитано.
      подпись = "нет второго читателя";
    }

    const строка = `${имя.slice(0, 46).padEnd(46)} | ${String(размер).padStart(8)} | ${String(независимо).padStart(8)} | ${String(наше.text.length).padStart(8)} | ${доля(наше.text.length, независимо).padStart(6)} | ${наше.how}`;
    console.log(строка + (подпись === "" ? "" : ` (${подпись})`));

    if (наше.text.length === 0 && наше.images.length === 0) пустых += 1;
    else if (независимо > 0 && наше.text.length < независимо * 0.9) частичных += 1;
    else полных += 1;
  }

  console.log(
    `\nитог: ${полных} доехало полностью, ${частичных} частично, ${пустых} пусто ` +
      "(пусто ≠ потеря: у изображения текста нет, оно идёт зрению)",
  );
}

await main();
