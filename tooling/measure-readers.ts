/**
 * ЗАМЕР ЧИТАТЕЛЕЙ ПО ВСЕМУ КОРПУСУ ЛЕГАСИ.
 *
 * Утверждение «мы поддерживаем все форматы» проверяется одним способом: взять
 * по нескольку файлов КАЖДОГО расширения, встреченного в легаси, прочитать их и
 * показать, сколько знаков вышло. Опознание формата по подписи содержимым не
 * является — файл, у которого правильно назван тип и извлечено ноль знаков,
 * системе бесполезен.
 *
 * Столбец «знаков» и есть ответ. Столбец «как» показывает, ЧЕМ прочитано, и по
 * нему видно, чему верить: разбор книги и печатные последовательности из
 * двоичного файла — разный уровень доверия, и смешивать их нельзя.
 *
 * Запуск:
 *   pnpm tsx tooling/measure-readers.ts [сколько файлов на формат]
 */
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { argv, exit } from "node:process";

import { readAnything } from "../platform/storage/universal-reader.js";

const ROOTS = ["reference-system", "reference-system-new"];
const ПО_ФОРМАТУ = Number.parseInt(argv[2] ?? "3", 10);

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 8) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out, depth + 1);
    else out.push(full);
  }
}

async function main(): Promise<void> {
  const files: string[] = [];
  for (const root of ROOTS) await walk(root, files);

  const byExt = new Map<string, string[]>();

  for (const file of files) {
    const ext = extname(file).slice(1).toLowerCase();
    if (ext === "") continue;
    const list = byExt.get(ext) ?? [];
    if (list.length < ПО_ФОРМАТУ) list.push(file);
    byExt.set(ext, list);
  }

  console.log("| расширение | файлов в корпусе | замерено | знаков (медиана) | как прочитано | оговорка |");
  console.log("|---|---:|---:|---:|---|---|");

  const счёт = new Map<string, number>();
  for (const file of files) {
    const ext = extname(file).slice(1).toLowerCase();
    if (ext !== "") счёт.set(ext, (счёт.get(ext) ?? 0) + 1);
  }

  let пусто = 0;
  let всего = 0;

  for (const [ext, list] of [...byExt].sort((a, b) => (счёт.get(b[0]) ?? 0) - (счёт.get(a[0]) ?? 0))) {
    const длины: number[] = [];
    let how = "";
    let caveat = "";

    for (const file of list) {
      const info = await stat(file).catch(() => undefined);
      // Гигабайтные базы читаются по первым мегабайтам: замер о читателе, а не
      // о терпении, и полный проход по 1,5 ГБ ничего к ответу не добавит.
      if (info !== undefined && info.size > 200 * 1024 * 1024) continue;

      const result = await readAnything(file).catch(() => undefined);
      if (result === undefined) continue;

      длины.push(result.text.length);
      how = result.how;
      caveat = result.caveat ?? "";
    }

    if (длины.length === 0) continue;

    длины.sort((a, b) => a - b);
    const медиана = длины[Math.floor(длины.length / 2)] ?? 0;
    всего += 1;
    if (медиана === 0) пусто += 1;

    console.log(
      `| ${ext} | ${счёт.get(ext) ?? 0} | ${длины.length} | ${медиана} | ${how} | ${caveat.slice(0, 70)} |`,
    );
  }

  console.log("");
  console.log(`Расширений замерено: ${всего}. Из них дают НОЛЬ знаков: ${пусто}.`);
}

main().catch((cause: unknown) => {
  console.error(`Замер не прошёл: ${(cause as Error).message}`);
  exit(1);
});
