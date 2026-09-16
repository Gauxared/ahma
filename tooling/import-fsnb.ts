/**
 * Импорт ФСНБ-2022 в каталог канонических позиций (A2, docs/track-a-tasks.md).
 *
 * Источник — официальный набор открытых данных ФГИС ЦС: `/api/opendata`,
 * набор «ФСНБ-2022», владелец ФАУ «Главгосэкспертиза России». Скачивание идёт
 * через задокументированный в наборе путь файла, без обхода каких-либо защит.
 *
 * Скачивание раздела ФРСН на портале закрыто капчей — это сознательный сигнал
 * владельца против автоматизации, и мы его не обходим. Набор открытых данных
 * существует ровно для машинного использования и капчей не закрыт.
 *
 * Запуск:
 *   pnpm tsx tooling/import-fsnb.ts            # использовать var/fsnb, если есть
 *   pnpm tsx tooling/import-fsnb.ts --fetch    # скачать свежую версию
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseFsbcChunk, parseFsnbChunk } from "../modules/corpus/fsnb-parser.js";
import type { FsnbEntry } from "../modules/corpus/fsnb-parser.js";

const PORTAL = "https://fgiscs.minstroyrf.ru";
const DATASET = 4; // «ФСНБ-2022» в /api/opendata
const WORK_DIR = "var/fsnb";
const OUT = "config/canonical-items.json";

const USER_AGENT = "StroyIntellect/1.0 (импорт открытых данных ФГИС ЦС)";

interface DatasetMeta {
  readonly datasetName: string;
  readonly lastChangeDate: string;
  readonly datasetFile: { readonly path: string; readonly name: string };
}

async function fetchDataset(): Promise<void> {
  console.log("Запрашиваю метаданные набора открытых данных…");

  const response = await fetch(`${PORTAL}/api/opendata/${DATASET}`, {
    headers: { "user-agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`ФГИС ЦС ответил ${response.status} на запрос метаданных`);
  }

  const meta = (await response.json()) as DatasetMeta;
  console.log(`  набор: ${meta.datasetName}, обновлён ${meta.lastChangeDate.slice(0, 10)}`);
  console.log(`  файл : ${meta.datasetFile.name}`);

  const file = await fetch(`${PORTAL}/api/values/GetFileContent/${meta.datasetFile.path}`, {
    headers: { "user-agent": USER_AGENT },
  });

  if (!file.ok) {
    throw new Error(`Не удалось скачать набор: ${file.status}`);
  }

  mkdirSync(WORK_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  writeFileSync(join(WORK_DIR, "fsnb-2022.zip"), bytes);

  console.log(`  скачано: ${(bytes.length / 1024 / 1024).toFixed(1)} МБ`);
  console.log("  распакуйте: unzip -o var/fsnb/fsnb-2022.zip -d var/fsnb");
}

if (process.argv.includes("--fetch")) {
  await fetchDataset();
}

/**
 * Два формата внутри одного архива, и разбирать их надо по-разному.
 *
 * ГЭСН — нормы: `<Work>` с наименованием из группы и окончания.
 * ФСБЦ — сметные цены ресурсов: `<Resource>` с целым `Name`.
 *
 * Перепутать легко: тег `<Resource>` есть в обоих, но в ГЭСН это расход внутри
 * нормы, а в ФСБЦ — сама запись каталога.
 */
const FILES: readonly { readonly name: string; readonly kind: "норма" | "цена" }[] = [
  { name: "ГЭСН.xml", kind: "норма" },
  { name: "ГЭСНм.xml", kind: "норма" },
  { name: "ГЭСНмр.xml", kind: "норма" },
  { name: "ГЭСНп.xml", kind: "норма" },
  { name: "ГЭСНр.xml", kind: "норма" },
  { name: "ФСБЦ_Мат&Оборуд.xml", kind: "цена" },
  { name: "ФСБЦ_Маш.xml", kind: "цена" },
];

const present = FILES.filter((file) => existsSync(join(WORK_DIR, file.name)));

if (present.length === 0) {
  console.error(
    `В ${WORK_DIR} нет распакованных файлов базы.\n` +
      "Запустите с --fetch и распакуйте архив, либо положите файлы вручную.",
  );
  process.exit(2);
}

console.log(`\n${"файл".padEnd(24)} ${"МБ".padStart(6)} ${"норм".padStart(8)} ${"систем".padStart(8)}`);

const all: FsnbEntry[] = [];

for (const file of present) {
  const xml = readFileSync(join(WORK_DIR, file.name), "utf8");
  const entries = file.kind === "норма" ? parseFsnbChunk(xml) : parseFsbcChunk(xml);
  const systems = new Set(entries.map((entry) => entry.system));

  all.push(...entries);

  console.log(
    `${file.name.padEnd(24)} ${(xml.length / 1024 / 1024).toFixed(1).padStart(6)} ` +
      `${String(entries.length).padStart(8)} ${[...systems].join(",").padStart(8)}`,
  );
}

// Один шифр может встретиться в нескольких файлах базы; берём первое вхождение,
// но фиксируем расхождения, если они есть.
const byKey = new Map<string, FsnbEntry>();
let duplicates = 0;
let withoutUnit = 0;

for (const entry of all) {
  const key = `${entry.system} ${entry.code}`;

  if (byKey.has(key)) {
    duplicates += 1;
    continue;
  }

  if (entry.unit.trim() === "") {
    withoutUnit += 1;
    continue;
  }

  byKey.set(key, entry);
}

const items = [...byKey.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([key, entry]) => ({
    id: key,
    name: entry.name,
    unit: entry.unit,
    codes: [{ system: entry.system, code: entry.code }],
  }));

console.log(`\nНорм всего        : ${all.length}`);
console.log(`  повторов шифра  : ${duplicates}`);
console.log(`  без единицы     : ${withoutUnit}`);
console.log(`Записей каталога  : ${items.length}`);

writeFileSync(OUT, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
console.log(`\nКаталог записан: ${OUT}`);
