/**
 * Сборка каталога канонических позиций из корпуса (A1, docs/track-a-tasks.md).
 *
 * Запуск: pnpm tsx tooling/build-catalogue.ts [--root <путь>] [--out <путь>]
 *
 * Порог размера файла — не оптимизация. В корпусе АПРИ есть книга на 38 МБ,
 * которая исчерпывает кучу 4 ГБ и кладёт процесс до того, как сработает любой
 * перехват исключения.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildCatalogue } from "../modules/corpus/build-catalogue.js";
import type { CorpusFile, CorpusPosition } from "../modules/corpus/build-catalogue.js";
import { parseLsr } from "../modules/documents/parsers/grand-smeta.js";
import { readXlsxSheet } from "../platform/storage/xlsx-reader.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const root = flag("root", "reference-system-new/Выход/АПРИ");
const out = flag("out", "config/canonical-items.json");
const maxFileBytes = Number(flag("max-mb", "5")) * 1024 * 1024;

/**
 * Исключение по подстроке пути. Нужно для ЧЕСТНОГО замера покрытия: курганский
 * комплект лежит и в корпусе тоже, и каталог, построенный вместе с ним, покрыл
 * бы его на 100% просто потому, что видел эти же файлы.
 */
const exclude = flag("exclude", "");

function walk(directory: string): CorpusFile[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    try {
      const stats = statSync(path);
      if (stats.isDirectory()) return walk(path);
      if (!/\.xlsx$/i.test(path)) return [];
      if (exclude !== "" && path.includes(exclude)) return [];
      return [{ path, bytes: stats.size }];
    } catch {
      return [];
    }
  });
}

console.log(`Корпус: ${root}${exclude === "" ? "" : `, исключено по «${exclude}»`}`);

const report = await buildCatalogue({
  listFiles: () => walk(root),
  maxFileBytes,
  readEstimate: async (path): Promise<readonly CorpusPosition[]> => {
    const sheet = await readXlsxSheet(path);
    const lsr = parseLsr(sheet);

    return lsr.sections.flatMap((section) =>
      section.positions.map((position) => ({
        code: position.code,
        basis: position.basis,
        name: position.name,
        unit: position.unit,
      })),
    );
  },
});

const byReason = new Map<string, number>();
for (const skip of report.skipped) {
  byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1);
}

console.log(`\nФайлов всего      : ${report.totalFiles}`);
console.log(`  разобрано       : ${report.parsedFiles}`);
for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
  const label =
    reason === "size_limit"
      ? "превышен размер"
      : reason === "not_an_estimate"
        ? "не смета"
        : "ошибка чтения";
  console.log(`  ${label.padEnd(15)} : ${count}`);
}

console.log(`\nПозиций           : ${report.positionsTotal}`);
console.log(`  без шифра       : ${report.positionsWithoutCode}`);
console.log(`Записей каталога  : ${report.items.length}`);
console.log(`  шифров без единицы (не в каталоге): ${report.itemsWithoutUnit.length}`);
console.log(`Конфликтов        : ${report.conflicts.length}`);

if (report.skipped.some((skip) => skip.reason === "read_error")) {
  console.log("\nОшибки чтения:");
  for (const skip of report.skipped.filter((entry) => entry.reason === "read_error").slice(0, 10)) {
    console.log(`  ${skip.path.slice(-64)}`);
    console.log(`     ${skip.detail.slice(0, 90)}`);
  }
}

if (report.conflicts.length > 0) {
  console.log("\nПримеры конфликтов:");
  for (const conflict of report.conflicts.slice(0, 5)) {
    console.log(`  ${conflict.code} · ${conflict.field}: выбрано «${conflict.chosen.slice(0, 40)}»`);
    console.log(`     отвергнуто: ${conflict.rejected.slice(0, 2).map((value) => `«${value.slice(0, 34)}»`).join(", ")}`);
  }
}

writeFileSync(
  out,
  `${JSON.stringify(
    {
      items: report.items.map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        codes: item.codes,
      })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`\nКаталог записан: ${out}`);
