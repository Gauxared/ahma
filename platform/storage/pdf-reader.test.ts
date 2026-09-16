/**
 * Тесты идут по НАСТОЯЩИМ файлам объекта, а не по собранным PDF.
 *
 * Собранный в тесте PDF доказывает, что библиотека вызвана правильно. Он не
 * доказывает главного — что порог отличает рабочую документацию от скана на
 * тех документах, которые действительно приходят от заказчика. Курганские РД
 * дают около трёх тысяч знаков на страницу; порог в сто знаков отделяет их от
 * колонтитула сканера с запасом в тридцать раз, и это видно только на реальном
 * файле.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readPdfText, TEXT_LAYER_MIN_PER_PAGE } from "./pdf-reader.js";

const РД = [
  "reference-system/input-1/КУРГАН ЭОМ 07.04.2025.pdf",
  "reference-system/input-1/КУРГАН_СОТ_07.04.2025.pdf",
];

const доступны = РД.every((path) => existsSync(path));

describe.skipIf(!доступны)("текстовый слой курганских РД", () => {
  it("читает текст обоих чертёжных комплектов", async () => {
    for (const path of РД) {
      const итог = await readPdfText(readFileSync(path));

      expect(итог.hasTextLayer).toBe(true);
      expect(итог.text.length).toBeGreaterThan(10_000);
    }
  });

  it("держит запас над порогом на порядок, а не впритык", async () => {
    // Порог, срабатывающий на настоящих данных еле-еле, — это порог, который
    // завтра сработает не туда. Запас проверяется явно.
    const итог = await readPdfText(readFileSync(РД[0]!));

    expect(итог.charsPerPage).toBeGreaterThan(TEXT_LAYER_MIN_PER_PAGE * 10);
  });

  it("считает знаки НА СТРАНИЦУ, а не суммарно", async () => {
    // Длинный скан набирает много знаков служебного слоя суммарно и прошёл бы
    // проверку по общей длине. Показатель на страницу от числа страниц не
    // зависит.
    const итог = await readPdfText(readFileSync(РД[0]!));

    expect(итог.pages).toBeGreaterThan(1);
    expect(итог.charsPerPage).toBe(Math.round(итог.text.length / итог.pages));
  });
});
