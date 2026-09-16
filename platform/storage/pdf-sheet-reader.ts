/**
 * СМЕТА В PDF ЧИТАЕТСЯ ЛИСТОМ — ЧЕРЕЗ РАСКЛАДКУ КОЛОНОК POPPLER.
 *
 * ПОЧЕМУ ЭТОГО НЕТ В `SHEET_READERS`. Тот реестр отвечает на вопрос «какие
 * книги система читает», и его список идёт в классификацию документов: всё, что
 * в нём есть, считается книгой, от которой ЖДУТ позиций. Вписать туда `pdf`
 * значило бы объявить сметой каждый чертёж комплекта — а их в объекте сотни.
 *
 * PDF — документ, В КОТОРОМ МОЖЕТ БЫТЬ таблица. Отвечает на это не список
 * форматов, а само содержимое: разбор пробует прочитать таблицу и обязан
 * подтвердить чтение арифметикой документа (`any-estimate.ts`). Не подтвердил —
 * PDF остаётся рабочей документацией и идёт к ролям текстом и картинками.
 */
import { readFile } from "node:fs/promises";

import { layoutSheet } from "@modules/documents/layout-sheet.js";
import type { Sheet } from "@modules/documents/sheet.js";

import { readPdfText } from "./pdf-reader.js";

/**
 * Лист из PDF: один на документ, со сквозной нумерацией строк.
 *
 * Пустой лист — честный ответ «таблицы не видно» (скан без текста, чертёж), а
 * не «таблица пуста»: разбор скажет об этом словами, а не нулём позиций.
 */
export async function readPdfSheets(path: string): Promise<readonly Sheet[]> {
  const { text } = await readPdfText(await readFile(path), path);
  const имя = path.split("/").pop() ?? "PDF";

  return [layoutSheet(text, имя)];
}
