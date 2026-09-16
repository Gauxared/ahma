/**
 * Чтение CSV с диска в лист.
 *
 * Здесь только ввод-вывод: разбор и определение кодировки живут в
 * `modules/documents/csv.ts` и проверяются без файлов. Тот же порядок, что у
 * книги Excel, — и по той же причине, что записана в `sheet.ts`.
 */
import { readFile } from "node:fs/promises";

import { csvSheet, decodeText } from "@modules/documents/csv.js";
import type { Sheet } from "@modules/documents/sheet.js";

export async function readCsvSheet(path: string): Promise<Sheet> {
  return csvSheet(decodeText(await readFile(path)), path.split("/").pop() ?? "CSV");
}
