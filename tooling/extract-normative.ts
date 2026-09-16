/**
 * ИЗВЛЕЧЕНИЕ НОРМАТИВНЫХ ДОКУМЕНТОВ В ТЕКСТ — Т12.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * Роли ссылаются на «СП 30.13330.2016» и «ГОСТ 9941-81», но текста этих
 * документов у них не было: в опорной книге лежит СТРОКА о норме — шифр,
 * название, статус, — а не сама норма. Проверить утверждение о пункте свода
 * правил было нечем, и роль либо верила строке, либо брала пункт из памяти
 * модели. Второе — ровно то, что запрещено.
 *
 * В корпусе заказчика 158 PDF со сводами правил и ГОСТами. Сам корпус
 * (`reference-system-new`, 14 ГБ) не версионируется и на сервер не едет,
 * поэтому здесь извлекается ТЕКСТ: он едет и в рабочую папку роли, и в базу.
 *
 * СКАН НАЗЫВАЕТСЯ СКАНОМ. Часть сводов — отсканированная бумага без текстового
 * слоя. Такой документ попадает в опись с пометкой и нулём знаков, а не
 * пропадает: «норма есть, но не прочитана» и «нормы нет» — разные утверждения,
 * и первое чинится распознаванием, а второе — поиском файла.
 *
 * Запуск:
 *   pnpm tsx tooling/extract-normative.ts <папка-с-pdf> [куда]
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { argv, exit } from "node:process";

import { readAnything } from "../platform/storage/universal-reader.js";

const SOURCE = argv[2] ?? "reference-system-new/Выход/АПРИ/Нормативка";
const TARGET = argv[3] ?? "var/нормативка";

/** Имя файла для рабочей папки: без пробелов, чтобы роль писала его в команде без кавычек. */
const safeName = (name: string): string =>
  basename(name, extname(name)).replace(/[\s/\\]+/gu, "_").slice(0, 150);

async function main(): Promise<void> {
  await mkdir(TARGET, { recursive: true });

  /**
   * ОБХОД РЕКУРСИВНЫЙ: нормативка разложена по четырнадцати тематическим
   * разделам («0 Право, Градостроительство», «5 Пожарная безопасность»…), и
   * плоский `readdir` возвращал НОЛЬ файлов при полной папке — молча, как
   * успех. Раздел едет вместе с именем: по нему видно, к чему норма относится.
   */
  const собрать = async (dir: string, prefix: string): Promise<{ path: string; label: string; section: string }[]> => {
    const out: { path: string; label: string; section: string }[] = [];

    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await собрать(full, entry.name)));
      // ЛЮБОЙ ФОРМАТ, а не только PDF: свод правил приходит и в `.docx`, и в
      // `.rtf`, и требование заказчика к подрядчику — тоже документ Word.
      else out.push({ path: full, label: entry.name, section: prefix });
    }

    return out;
  };

  const files = (await собрать(SOURCE, "без раздела")).sort((a, b) => a.label.localeCompare(b.label));
  const опись: string[] = [
    "# НОРМАТИВНЫЕ ДОКУМЕНТЫ",
    "",
    "Своды правил и ГОСТы текстом. Ссылаясь на пункт, называй документ и пункт:",
    "проверяемая ссылка — та, которую читатель откроет здесь же.",
    "",
    "| документ | раздел | как прочитано | знаков | файл |",
    "|---|---|---|---:|---|",
  ];

  let прочитано = 0;
  let сканов = 0;
  let знаков = 0;

  for (const { path, label: name, section } of files) {
    const result = await readAnything(path);
    const text = result.text;

    if (text.trim() === "") {
      сканов += 1;
      опись.push(
        `| ${name} | ${section} | ${result.how} | 0 | НЕ ПРОЧИТАН: ${result.caveat ?? "текста нет"} |`,
      );
      continue;
    }

    const file = `${safeName(name)}.txt`;
    await writeFile(
      join(TARGET, file),
      `# ${name}\n# раздел: ${section}\n# прочитано: ${result.how}` +
        `${result.caveat === undefined ? "" : `\n# оговорка: ${result.caveat}`}\n\n${text}\n`,
      "utf8",
    );

    прочитано += 1;
    знаков += text.length;
    опись.push(`| ${name} | ${section} | ${result.how} | ${text.length} | \`${file}\` |`);
  }

  опись.push(
    "",
    `Всего документов: ${files.length}. Прочитано текстом: ${прочитано}. ` +
      `Не прочитано (сканы и форматы без читателя): ${сканов}. Знаков: ${знаков}.`,
  );

  await writeFile(join(TARGET, "ОПИСЬ.md"), `${опись.join("\n")}\n`, "utf8");
  console.log(`Документов ${files.length}: прочитано ${прочитано}, сканов ${сканов}, знаков ${знаков}`);
  console.log(`Куда: ${TARGET}`);
}

main().catch((cause: unknown) => {
  console.error(`Извлечение не прошло: ${(cause as Error).message}`);
  exit(1);
});
