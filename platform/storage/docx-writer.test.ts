/**
 * Проверка ЗАПИСАННОГО ФАЙЛА: записка читается обратно и проверяется, что в
 * ней есть то, ради чего §10 её требует.
 *
 * Как и с книгой Excel, модульный тест доказывает форму данных, но не то, что
 * рендер её донёс. Здесь docx открывается как ZIP, и из `word/document.xml`
 * достаётся текст — без библиотеки, которой этот текст записывали.
 */
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildMemo } from "@modules/exports/memo.js";

import { writeMemo } from "./docx-writer.js";

/** Достаёт `word/document.xml` из docx без сторонних библиотек. */
function documentXml(bytes: Buffer): string {
  let offset = 0;

  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const compressed = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + compressed);

    if (name === "word/document.xml") {
      return (method === 0 ? data : method === 8 ? inflateRawSync(data) : gunzipSync(data)).toString("utf8");
    }

    offset = dataStart + compressed;
  }

  throw new Error("word/document.xml не найден: файл не является документом Word");
}

describe("запись записки", () => {
  it("доносит паспорт, сводный вывод и разделы до файла", async () => {
    const memo = buildMemo({
      passport: {
        objectName: "Курган, электроснабжение",
        customer: "ПАО «АПРИ»",
        documentCount: 7,
        checkedAt: "2026-08-31",
        total: "104976702.48",
      },
      sections: [
        {
          agent: "Денчик",
          role: "ГИП",
          status: "выполнен",
          findings: ["объём блока ГЭСНм20-03-035 не подтверждён РД"],
          conclusion: "объём принять нельзя до сверки с осями РД",
        },
      ],
    });

    const path = join(tmpdir(), `si-memo-${process.pid}.docx`);

    try {
      await writeMemo(memo, path);
      const xml = documentXml(readFileSync(path));

      expect(xml).toContain("Курган, электроснабжение");
      expect(xml).toContain("СВОДНЫЙ ВЫВОД");
      expect(xml).toContain("Денчик");
      // Итог отформатирован для человека: разряды и запятая, а не 104976702.48.
      // Разделитель разрядов — неразрывный пробел: обычный дал бы Word
      // перенести «104 976» и «702,48» на разные строки, превратив сумму в
      // два числа. Тест проверяет именно его, иначе замена на обычный пробел
      // пройдёт незамеченной.
      expect(xml).toContain("104\u00A0976\u00A0702,48");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("доносит пометку непроверенного раздела", async () => {
    // Она и есть содержание: без неё отсутствие текста читается как отсутствие
    // темы, а не как непроверенную тему.
    const memo = buildMemo({
      passport: {
        objectName: "Курган",
        customer: "ПАО «АПРИ»",
        documentCount: 1,
        checkedAt: "2026-08-31",
        total: "0.00",
      },
      sections: [{ agent: "Ваныч", role: "Эконом", status: "не выполнен", findings: [], conclusion: "" }],
    });

    const path = join(tmpdir(), `si-memo-idle-${process.pid}.docx`);

    try {
      await writeMemo(memo, path);
      const xml = documentXml(readFileSync(path));

      expect(xml).toContain("НЕ проверена");
    } finally {
      rmSync(path, { force: true });
    }
  });
});
