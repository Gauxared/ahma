/**
 * ВЫГРУЗКА ИСТОЧНИКА ЦЕЛИКОМ — Т12.
 *
 * Проверяется ровно то, чего не делал прежний путь: лист, у которого нет ни
 * шифра, ни статуса, доходит целиком, а число листов не упирается в потолок.
 * Оба свойства теряются молча — книга выглядит прочитанной и в том, и в другом
 * случае, — поэтому набор смотрит на числа, а не на «функция отработала».
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dumpWorkbook, sheetToTsv } from "./base-dump.js";

describe("выгрузка источника целиком", () => {
  it("несуществующий файл — не выгрузка, а её отсутствие", async () => {
    expect(await dumpWorkbook(join(await mkdtemp(join(tmpdir(), "база-")), "нет.xlsx"))).toBeUndefined();
  });

  it("файл, который не книга, читается другим путём и не пропадает", async () => {
    const dir = await mkdtemp(join(tmpdir(), "база-"));
    const path = join(dir, "не-книга.xlsx");
    await writeFile(path, "цена битума 55000 руб/т");

    /**
     * ВЫГРУЗКА КНИГ ОТВЕЧАЕТ «ЭТО НЕ КНИГА» — И ЭТО НЕ ПОТЕРЯ.
     *
     * Файл под расширением книги, книгой не являющийся, здесь не превращается
     * в пустой лист: пустая книга и отсутствие книги неразличимы для читателя,
     * а «прочитано ноль строк» выглядит успехом.
     *
     * Содержимое при этом НЕ пропадает: такой файл читает
     * `platform/storage/universal-reader.ts` — текстом, как он и устроен. Ворота
     * здесь мягкие в том смысле, что данные идут другим путём, а не в том,
     * что книга притворяется прочитанной.
     */
    expect(await dumpWorkbook(path)).toBeUndefined();

    const { readAnything } = await import("@platform/storage/universal-reader.js");
    expect((await readAnything(path)).text).toContain("55000");
  });

  it("строка без шифра и статуса доходит до TSV: отбора здесь нет", () => {
    const tsv = sheetToTsv({
      name: "Примечания",
      rows: [
        [1, ["Порядок применения индексов"]],
        [2, [""]],
        [3, ["Согласовано", "Иванов"]],
      ],
    });

    expect(tsv).toContain("1\tПорядок применения индексов");
    // Пустая строка сохраняет номер: роль называет находку номером строки листа.
    expect(tsv).toContain("2\t");
    expect(tsv).toContain("3\tСогласовано\tИванов");
    expect(tsv).toContain("# строк: 3");
  });
});

describe("Единая база — все 120 вкладок", () => {
  const path = "config/crew/bases/СтройИнтеллект_ЕдинаяБаза_v1.0.xlsx";

  it(
    "читается целиком, а не первыми сорока одним листом",
    async () => {
      const book = await dumpWorkbook(path);
      if (book === undefined) return; // книги заказчика в поставку не входят

      // Прежний загрузчик обрывался на `index > 40`: восемьдесят вкладок не
      // читались никогда, и об этом ничто не сообщало.
      expect(book.sheets.length).toBeGreaterThan(100);
      expect(book.rowCount).toBeGreaterThan(1000);
    },
    300_000,
  );
});
