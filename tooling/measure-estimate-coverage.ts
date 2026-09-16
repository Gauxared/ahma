/**
 * СКОЛЬКО СМЕТ КОРПУСА ВООБЩЕ РАЗБИРАЕТСЯ — И ЧЕМ ИМЕННО.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЗАМЕР. `measure-completeness.ts` отвечает «доехал ли ТЕКСТ до
 * роли». Это другой вопрос. Здесь: становится ли документ ПОЗИЦИЯМИ — со
 * строкой, шифром, объёмом и суммой, — потому что только позиции дают
 * сходимость, дубли, координату и таблицу на экране.
 *
 * ЧТО СЧИТАЕТСЯ. По каждому файлу: каким разбором он взят (форма приказа
 * 421/пр или шапка колонок), сколько листов у книги и на каком нашлась смета,
 * сколько позиций вышло и сошлась ли арифметика.
 *
 * ЗАЧЕМ ЭТО НУЖНО ПОСТОЯННО. Правка разбора либо поднимает это число, либо нет.
 * Без замера «стало лучше» — заявление, а с ним — факт. Числа этого замера
 * ложатся в `docs/spec-demo-stage-1-fact.md`.
 */
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { argv, exit } from "node:process";

import { parseAnyEstimate } from "../modules/documents/parsers/any-estimate.js";
import { LsrParseError, parseLsr } from "../modules/documents/parsers/grand-smeta.js";
import type { LsrDocument } from "../modules/documents/parsers/grand-smeta.js";
import type { Sheet } from "../modules/documents/sheet.js";
import { detectFileFormat, readSheetsOf } from "../platform/storage/sheet-reader.js";

/** Что удалось сделать с файлом. */
interface Итог {
  readonly путь: string;
  readonly чем: "форма 421/пр" | "шапка колонок" | "не разобран";
  readonly листов: number;
  readonly лист: string;
  readonly позиций: number;
  readonly причина?: string;
}

const РАСШИРЕНИЯ = new Set([".xlsx", ".xlsm", ".xls", ".xlsb", ".csv", ".docx", ".pdf"]);

async function файлы(корень: string): Promise<readonly string[]> {
  const найдено: string[] = [];

  const обойти = async (каталог: string): Promise<void> => {
    for (const запись of await readdir(каталог, { withFileTypes: true })) {
      const путь = join(каталог, запись.name);
      if (запись.isDirectory()) await обойти(путь);
      else if (РАСШИРЕНИЯ.has(extname(запись.name).toLowerCase())) найдено.push(путь);
    }
  };

  const сведения = await stat(корень);
  if (сведения.isDirectory()) await обойти(корень);
  else найдено.push(корень);

  return найдено;
}

function позиций(документ: LsrDocument): number {
  return документ.sections.reduce((sum, section) => sum + section.positions.length, 0);
}

async function разобрать(путь: string): Promise<Итог> {
  let sheets: readonly Sheet[] = [];
  let раскладка = false;

  try {
    sheets = await readSheetsOf(путь);
    раскладка = (await detectFileFormat(путь)).format === "pdf";
  } catch (cause) {
    return { путь, чем: "не разобран", листов: 0, лист: "", позиций: 0, причина: (cause as Error).message };
  }

  // Причина показывается ОТ ПОСЛЕДНЕГО разбора: первым идёт форма 421/пр, и её
  // «не найдена шапка таблицы» ничего не объясняет про универсальный разбор.
  let причина = "";

  for (const [чем, разбор] of [
    ["форма 421/пр", (sheet: Sheet) => parseLsr(sheet)],
    ["шапка колонок", (sheet: Sheet) => parseAnyEstimate(sheet, { требоватьАрифметику: раскладка })],
  ] as const) {
    let лучший: LsrDocument | undefined;
    причина = "";

    for (const sheet of sheets) {
      try {
        const документ = разбор(sheet);
        if (позиций(документ) > 0 && (лучший === undefined || позиций(документ) > позиций(лучший))) {
          лучший = документ;
        }
      } catch (cause) {
        причина = cause instanceof LsrParseError ? cause.message : String(cause);
      }
    }

    if (лучший !== undefined) {
      return { путь, чем, листов: sheets.length, лист: лучший.sheet, позиций: позиций(лучший) };
    }
  }

  return { путь, чем: "не разобран", листов: sheets.length, лист: "", позиций: 0, причина };
}

async function main(): Promise<void> {
  const корни = argv.slice(2);

  if (корни.length === 0) {
    console.error("Укажите папку или файлы: npx tsx tooling/measure-estimate-coverage.ts <папка>");
    exit(2);
  }

  const список = (await Promise.all(корни.map(файлы))).flat();
  const итоги: Итог[] = [];

  for (const путь of список) {
    итоги.push(await разобрать(путь));
  }

  for (const итог of итоги) {
    const имя = (путь: string): string => путь.split("/").pop() ?? путь;
    const строка =
      `${имя(итог.путь).slice(0, 52).padEnd(52)} | ${итог.чем.padEnd(13)} | ` +
      `листов ${String(итог.листов).padStart(2)} | позиций ${String(итог.позиций).padStart(5)}`;
    console.log(итог.причина === undefined ? строка : `${строка} | ${итог.причина.replace(/\s+/gu, " ").slice(0, 70)}`);
  }

  const формой = итоги.filter((итог) => итог.чем === "форма 421/пр");
  const шапкой = итоги.filter((итог) => итог.чем === "шапка колонок");
  const нет = итоги.filter((итог) => итог.чем === "не разобран");
  const сумма = (список: readonly Итог[]): number => список.reduce((s, итог) => s + итог.позиций, 0);

  console.log(
    `\nитог по ${итоги.length} файлам: ` +
      `формой 421/пр — ${формой.length} (${сумма(формой)} позиций), ` +
      `по шапке колонок — ${шапкой.length} (${сумма(шапкой)} позиций), ` +
      `не разобрано — ${нет.length}`,
  );
}

await main();
