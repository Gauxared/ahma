/**
 * ЗАГРУЗКА НОРМАТИВКИ И ОПОРНЫХ БАЗ В БАЗУ ДАННЫХ — Т12 и Т13.
 *
 * ЗАЧЕМ В БД, ЕСЛИ ФАЙЛЫ УЖЕ ЛЕЖАТ В РАБОЧЕЙ ПАПКЕ РОЛИ
 *
 * Роль читает `база/` командами — этого достаточно ей и недостаточно всему
 * остальному. В БД знание нужно для того, чего файлами не сделать: показать
 * источники на экране, искать по ним из интерфейса, сослаться на строку из
 * находки и увидеть, какой версией источника пользовались. Т12 требует, чтобы
 * в находке было видно, из какого источника и какой версии взято, — а версия
 * живёт рядом со строкой, а не в имени файла.
 *
 * ИСТОЧНИКИ ОБЩИЕ ДЛЯ ИНСТАЛЛЯЦИИ (`tenantId IS NULL`)
 *
 * Нормативка — не данные заказчика: ГЭСН одинаков у всех. Политика RLS это
 * прямо разрешает: общее видно всем, чужое — никому.
 *
 * ПОВТОРНАЯ ЗАГРУЗКА ЗАМЕЩАЕТ, А НЕ ДОБАВЛЯЕТ
 *
 * Источник опознаётся по `slug`, строки перезаписываются целиком. Иначе второй
 * запуск удвоил бы базу, и «строк в системе равно строкам в источнике» —
 * приёмка Т12 — перестало бы выполняться незаметно.
 *
 * Запуск:
 *   pnpm tsx tooling/import-knowledge.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";

import { createPrismaClient } from "../platform/db/prisma.js";
import { allBases } from "../platform/codex/crew-reviewers.js";
import { dumpWorkbook } from "../platform/config/base-dump.js";

// Тот же конструктор, что у приложения: Prisma 7 требует драйверный адаптер,
// и второй способ подключения разошёлся бы с боевым на первой же настройке.
const prisma = createPrismaClient(process.env["DATABASE_URL"]);

/** Слаг источника: имя файла без расширения, латиница не требуется. */
const slugOf = (title: string): string => title.trim().replace(/\s+/gu, "_").slice(0, 180);

interface RecordRow {
  readonly section: string;
  readonly key: string;
  readonly unit: string | null;
  readonly payload: unknown;
}

async function replaceSource(input: {
  readonly slug: string;
  readonly kind: string;
  readonly contentHash: string;
  readonly rows: readonly RecordRow[];
}): Promise<number> {
  const source = await prisma.knowledgeSource.upsert({
    where: { slug: input.slug },
    create: { slug: input.slug, kind: input.kind, enabled: true, contentHash: input.contentHash },
    update: { kind: input.kind, enabled: true, contentHash: input.contentHash },
  });

  await prisma.knowledgeRecord.deleteMany({ where: { sourceId: source.id } });

  const checkedAt = new Date();
  let written = 0;

  // Партиями: сто тысяч строк одним запросом кладут соединение, а не базу.
  for (let from = 0; from < input.rows.length; from += 2000) {
    const chunk = input.rows.slice(from, from + 2000);

    const result = await prisma.knowledgeRecord.createMany({
      data: chunk.map((row, offset) => ({
        sourceId: source.id,
        // ОТПЕЧАТОК САМОЙ ЗАПИСИ, а не книги: колонка уникальна (ADR-R-027).
        // Версия книги живёт у источника — одна на все её строки.
        contentHash: createHash("sha256")
          .update(`${input.slug}\u0000${row.section}\u0000${from + offset}\u0000${row.key}`)
          .digest("hex"),
        section: row.section.slice(0, 200),
        capability: "общая",
        key: row.key.slice(0, 2000),
        unit: row.unit,
        // `benchmark` — значение опоры, а не факт объекта: ТЗ §7 различает их,
        // и роль обязана видеть разницу, ссылаясь на строку.
        status: "benchmark",
        checkedAt,
        payload: row.payload as never,
      })),
    });

    written += result.count;
  }

  return written;
}

async function main(): Promise<void> {
  const configRoot = join(cwd(), "config");
  let sources = 0;
  let rows = 0;

  for (const base of allBases(configRoot)) {
    const book = await dumpWorkbook(base.path);

    if (book === undefined) {
      console.log(`${base.title}\tНЕ ПРОЧИТАН`);
      continue;
    }

    const records: RecordRow[] = [];

    for (const sheet of book.sheets) {
      for (const [number, cells] of sheet.rows) {
        const значимые = cells.filter((value) => value.trim() !== "");
        // Пустая строка книги в базу не едет: в файле она держит нумерацию, в
        // базе номер строки лежит рядом со значением и держится сам.
        if (значимые.length === 0) continue;

        records.push({
          section: sheet.name,
          key: значимые.join(" · ").slice(0, 2000),
          unit: null,
          payload: { лист: sheet.name, строка: number, ячейки: cells },
        });
      }
    }

    const written = await replaceSource({
      slug: slugOf(base.title),
      kind: "опорная-база",
      contentHash: book.contentHash,
      rows: records,
    });

    sources += 1;
    rows += written;
    console.log(`${base.title}\t${book.sheets.length} листов\t${written} строк`);
  }

  // ── Текстовые источники: своды правил, ГОСТы, кейсы прежней системы ──────
  //
  // Один файл — одна запись: своды правил ищут по названию документа, а не по
  // строке внутри. Разбивать текст свода на строки значило бы получить сотни
  // тысяч записей, в которых поиск по «СП 30» не находит ничего.
  for (const [dir, slug, kind] of [
    [env["STROYINTELLECT_NORMATIVE_DIR"] ?? join(cwd(), "var", "нормативка"), "Своды-правил-и-ГОСТы", "нормативные-документы"],
    [env["STROYINTELLECT_CASES_DIR"] ?? join(cwd(), "var", "кейсы"), "Кейсы-прежней-системы", "кейсы"],
  ] as const) {
    if (!existsSync(dir)) {
      console.log(`${slug}\tПАПКИ НЕТ: ${dir}`);
      continue;
    }

    const records: RecordRow[] = [];

    for (const name of readdirSync(dir).filter((file) => file.endsWith(".txt") || file.endsWith(".md")).sort()) {
      const text = readFileSync(join(dir, name), "utf8");
      // Заголовок документа — первая содержательная строка: по ней человек
      // узнаёт свод, а не по имени файла с подчёркиваниями.
      const заголовок = text.split("\n").find((line) => line.trim() !== "" && !line.startsWith("#")) ?? name;

      records.push({
        section: name.replace(/\.(txt|md)$/u, ""),
        key: `${name} · ${заголовок}`.slice(0, 2000),
        unit: null,
        payload: { файл: name, знаков: text.length, начало: text.slice(0, 4000) },
      });
    }

    const written = await replaceSource({ slug, kind, contentHash: "0".repeat(64), rows: records });
    sources += 1;
    rows += written;
    console.log(`${slug}\t${written} документов`);
  }

  // ── Нормативный каталог ФСНБ ─────────────────────────────────────────────
  const cataloguePath = join(configRoot, "canonical-items.json");

  if (existsSync(cataloguePath)) {
    const bundle = JSON.parse(readFileSync(cataloguePath, "utf8")) as {
      items?: readonly { name: string; unit: string; codes: readonly { system: string; code: string }[] }[];
    };

    const records: RecordRow[] = [];

    for (const item of bundle.items ?? []) {
      for (const code of item.codes) {
        records.push({
          section: code.system,
          key: `${code.code} ${item.name}`.slice(0, 2000),
          unit: item.unit,
          payload: { шифр: code.code, система: code.system, наименование: item.name, единица: item.unit },
        });
      }
    }

    const written = await replaceSource({
      slug: "ФСНБ-2022",
      kind: "нормативный-каталог",
      // Отпечаток набора: по нему видно, той ли версией базы пользовались.
      contentHash: "0".repeat(64),
      rows: records,
    });

    sources += 1;
    rows += written;
    console.log(`ФСНБ-2022\t${written} позиций`);
  }

  console.log("");
  console.log(`Источников: ${sources}, строк: ${rows}`);
}

main()
  .catch((cause: unknown) => {
    console.error(`Загрузка не прошла: ${(cause as Error).message}`);
    exit(1);
  })
  .finally(() => void prisma.$disconnect());
