/**
 * КЕЙСЫ ПРЕЖНЕЙ СИСТЕМЫ КАК ИСТОРИЧЕСКИЕ ЭТАЛОНЫ — решение владельца 08.09.2026.
 *
 * ЗАЧЕМ ОНИ РОЛИ
 *
 * Кейс — это прогон прежней системы: что подали на вход и что она выдала на
 * выходе. Для роли это ответ на вопрос, которого ей неоткуда взять: «а что по
 * такому объекту вообще ожидается получить». Не образец для копирования —
 * ПЛАНКА: наш результат должен быть не хуже, а лучше.
 *
 * ЧТО ИЗВЛЕКАЕТСЯ, А ЧТО НЕТ
 *
 * Кейсы весят 3,1 ГБ — 1031 файл сканов, чертежей и книг. Целиком они в
 * рабочую папку не поедут и не должны: роли нужен СОСТАВ, а не содержимое
 * чужого объекта. Поэтому берётся:
 *
 *   · перечень входа — какие документы подавали, в каких форматах и объёме;
 *   · перечень выхода — какие документы выдавала система;
 *   · ЛИСТЫ выходных книг по именам — это и есть «что нужно получать».
 *
 * Имена листов — самое ценное: они показывают, какие разрезы прежняя система
 * считала обязательными по объекту такого типа.
 *
 * Кейс без разделения на вход и выход не пропускается: у части кейсов файлы
 * лежат россыпью, и «материалы» честнее, чем отсутствие кейса в перечне.
 *
 * Запуск:
 *   pnpm tsx tooling/extract-cases.ts [папка-кейсов] [куда]
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, exit } from "node:process";

import { listXlsxSheets } from "../platform/storage/xlsx-reader.js";

const SOURCE = argv[2] ?? "reference-system-new/Выход/АПРИ/0 Кейсы";
const TARGET = argv[3] ?? "var/кейсы";

const safeName = (name: string): string => name.replace(/[\s/\\]+/gu, "_").slice(0, 120);

interface FileRow {
  readonly path: string;
  readonly name: string;
  readonly ext: string;
  readonly size: number;
}

async function walk(dir: string): Promise<FileRow[]> {
  const out: FileRow[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else {
      const info = await stat(full);
      out.push({ path: full, name: entry.name, ext: (entry.name.split(".").pop() ?? "").toLowerCase(), size: info.size });
    }
  }

  return out;
}

const МБ = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

/** Сводка по форматам: «pdf 29 · xls 18 · pptx 4». */
function byFormat(files: readonly FileRow[]): string {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.ext, (counts.get(file.ext) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([ext, n]) => `${ext} ${n}`).join(" · ");
}

async function main(): Promise<void> {
  await mkdir(TARGET, { recursive: true });

  const cases = (await readdir(SOURCE, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const опись: string[] = [
    "# КЕЙСЫ ПРЕЖНЕЙ СИСТЕМЫ — ЧТО ПОДАВАЛИ И ЧТО ПОЛУЧАЛИ",
    "",
    "Прогоны прежней системы СтройИнтеллект. Это не образец для копирования, а",
    "ПЛАНКА: по объекту такого типа система выдавала перечисленные документы с",
    "перечисленными листами, и наш результат должен быть не хуже.",
    "",
    "Содержимого чужих объектов здесь нет — только состав входа, состав выхода и",
    "имена листов выходных книг. Подробности кейса — в файле рядом.",
    "",
    "| кейс | вход | выход | листов в книгах | файл |",
    "|---|---|---|---:|---|",
  ];

  let всего = 0;

  for (const { name } of cases.sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(SOURCE, name);
    const вход = await walk(join(dir, "Вход"));
    const выход = await walk(join(dir, "Выход"));
    // Кейс без разделения: файлы россыпью. Пропустить его значило бы объявить,
    // что кейса нет, — а он есть, просто разложен иначе.
    const россыпь = вход.length === 0 && выход.length === 0 ? await walk(dir) : [];

    const книги = [...выход, ...россыпь].filter((file) => file.ext === "xlsx" || file.ext === "xls");
    const листы: string[] = [];

    for (const книга of книги.slice(0, 40)) {
      try {
        const names = await listXlsxSheets(книга.path);
        if (names.length > 0) листы.push(`### ${книга.name}\n\n${names.map((s) => `- ${s}`).join("\n")}`);
      } catch {
        листы.push(`### ${книга.name}\n\n- книга не открылась`);
      }
    }

    const листовВсего = листы.reduce((sum, block) => sum + block.split("\n- ").length - 1, 0);
    const file = `${safeName(name)}.md`;

    const текст = [
      `# Кейс: ${name}`,
      "",
      россыпь.length > 0
        ? `Файлы кейса лежат россыпью, без разделения на вход и выход: ${россыпь.length} шт., ${МБ(россыпь.reduce((s, f) => s + f.size, 0))} МБ (${byFormat(россыпь)}).`
        : `Вход: ${вход.length} файлов, ${МБ(вход.reduce((s, f) => s + f.size, 0))} МБ (${byFormat(вход)}).\n\n` +
          `Выход: ${выход.length} файлов, ${МБ(выход.reduce((s, f) => s + f.size, 0))} МБ (${byFormat(выход)}).`,
      "",
      "## Что подавали на вход",
      "",
      (вход.length > 0 ? вход : россыпь).map((f) => `- ${f.name} · ${МБ(f.size)} МБ`).join("\n") || "- перечня нет",
      "",
      "## Что система выдала",
      "",
      выход.map((f) => `- ${f.name} · ${МБ(f.size)} МБ`).join("\n") || "- выход отдельно не выделен",
      "",
      "## Листы выходных книг — планка по составу",
      "",
      листы.join("\n\n") || "книг на выходе нет",
      "",
    ].join("\n");

    await writeFile(join(TARGET, file), `${текст}\n`, "utf8");
    всего += 1;

    опись.push(
      `| ${name} | ${вход.length || россыпь.length} файлов | ${выход.length} файлов | ${листовВсего} | \`${file}\` |`,
    );
  }

  опись.push("", `Кейсов: ${всего}.`);
  await writeFile(join(TARGET, "ОПИСЬ.md"), `${опись.join("\n")}\n`, "utf8");
  console.log(`Кейсов ${всего}. Куда: ${TARGET}`);
}

main().catch((cause: unknown) => {
  console.error(`Извлечение кейсов не прошло: ${(cause as Error).message}`);
  exit(1);
});
