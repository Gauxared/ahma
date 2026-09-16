import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readXlsSheet } from "./xls-reader.js";
import { detectFileFormat } from "./sheet-reader.js";

const DIR = "reference-system-new/Выход/АПРИ/АРМы/Учет доставки материалов и работы техники на объекте в Excel. dnl14834";

describe("двоичная книга Excel", () => {
  it("читается как книга, а не как документ Word", async () => {
    const name = readdirSync(DIR).find((f) => f.toLowerCase().endsWith(".xlsb"));
    if (name === undefined) return;
    const path = join(DIR, name);
    const detected = await detectFileFormat(path, name);
    const sheet = await readXlsSheet(path);
    console.log("ФАЙЛ:", name, "| формат:", detected.format, "| поддержан:", detected.supported, "| строк:", sheet.rows.size);
    expect(sheet.rows.size).toBeGreaterThan(0);
  }, 120_000);
});
