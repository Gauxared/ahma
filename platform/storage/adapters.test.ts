/**
 * Адаптеры проверяются НА НАСТОЯЩИХ документах заказчика через реестр —
 * то есть так, как их будет вызывать система.
 *
 * Проверять адаптер в отрыве от реестра значит проверять чтение файла. Смысл
 * же в том, что реестр ВСЕГДА отвечает: на любой документ папки объекта
 * возвращается либо разбор, либо отказ с причиной, и пустой ветки нет.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ParserRegistry } from "@modules/documents/parser-registry.js";

import {
  docxAdapter,
  grandSmetaXmlAdapter,
  pdfAdapter,
  plainTextAdapter,
  xmlAdapter,
} from "./adapters.js";
import type { TextPayload } from "./adapters.js";

const РЕЕСТР = new ParserRegistry([
  docxAdapter,
  pdfAdapter,
  plainTextAdapter,
  xmlAdapter,
  grandSmetaXmlAdapter,
]);

const ДОГОВОР = "reference-system-new/Выход/АПРИ/Договора ГП/Проет договора генерального подряда 1.docx";
const РД = "reference-system/input-1/КУРГАН ЭОМ 07.04.2025.pdf";

describe.skipIf(!existsSync(ДОГОВОР))("договор через реестр", () => {
  it("разбирается и отдаёт текст, а не позиции", async () => {
    // Договор даёт ТЕКСТ. Притвориться, что он вернул ноль позиций, значило бы
    // поставить его в один ряд с пустой сметой.
    const итог = await РЕЕСТР.parse({ fileName: ДОГОВОР, bytes: readFileSync(ДОГОВОР) });

    expect(итог.status).toBe("разобран");
    expect(итог.format).toBe("docx");
    expect(итог.positions).toBe(0);
    expect((итог.payload as TextPayload).text.length).toBeGreaterThan(10_000);
  });
});

describe.skipIf(!existsSync(РД))("рабочая документация через реестр", () => {
  it("разбирается: у курганских РД есть текстовый слой", async () => {
    const итог = await РЕЕСТР.parse({ fileName: РД, bytes: readFileSync(РД) });

    expect(итог.status).toBe("разобран");
    expect(итог.format).toBe("pdf");
    expect((итог.payload as TextPayload).source).toBe("pdf");
  });
});

describe("первая волна §8.1: txt и xml доходят до агентов текстом", () => {
  const записка = [
    "Пояснительная записка к сметной документации.",
    "Работы ведутся в две смены. Материалы поставляет заказчик.",
    "Стоимость определена в текущих ценах II квартала 2025 года.",
  ].join("\n");

  it("проза читается и отдаёт ТЕКСТ, а не ноль позиций молча", async () => {
    const итог = await РЕЕСТР.parse({
      fileName: "пояснительная.txt",
      bytes: Buffer.from(записка, "utf8"),
    });

    expect(итог.status).toBe("разобран");
    expect(итог.format).toBe("текст");
    // Позиций ноль — и это не отговорка: извлекала бы их модель, а не разбор,
    // и у чисел не было бы координаты (§12.1д).
    expect(итог.positions).toBe(0);
    expect((итог.payload as TextPayload).text).toContain("две смены");
    expect((итог.payload as TextPayload).source).toBe("txt");
  });

  it("обрывок текста — отказ, а не документ", async () => {
    // Файл в пару символов не записка. Отдав его агенту, мы добавили бы в
    // запрос шум и заплатили бы за него токенами.
    const итог = await РЕЕСТР.parse({ fileName: "пусто.txt", bytes: Buffer.from("ок\n", "utf8") });

    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("читать нечего");
  });

  it("выгрузка ГРАНД-Сметы ПРОЧИТАНА текстом, но позиций не обещает", async () => {
    // Схемы у нас нет, и раскладывать её по колонкам наугад значило бы выдать
    // правдоподобные числа за сметные данные. Прочитать глазами агента —
    // можно: это чтение, а не разбор, и `positions` остаётся нулём.
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<Document Тип=\"ЛокальнаяСмета\">",
      "  <Позиция Шифр=\"ФЕР08-02-001-01\" Наименование=\"Кладка стен\" Сумма=\"124500.00\"/>",
      "</Document>",
    ].join("\n");

    const итог = await РЕЕСТР.parse({ fileName: "смета.xml", bytes: Buffer.from(xml, "utf8") });

    expect(итог.status).toBe("разобран");
    expect(итог.format).toBe("grand-smeta-xml");
    expect(итог.positions).toBe(0);
    expect((итог.payload as TextPayload).text).toContain("ФЕР08-02-001-01");
  });

  it("XML c объявлением DTD отвергается ДО чтения", async () => {
    // Чтение текстом не должно было открыть дорогу внешней сущности: она
    // позволяет файлу прочитать локальные файлы. Отказ обязан наступить в
    // определителе, а не в адаптере.
    const итог = await РЕЕСТР.parse({
      fileName: "смета.xml",
      bytes: Buffer.from(
        '<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document/>',
        "utf8",
      ),
    });

    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("DTD");
  });

  it("таблица с разделителем НЕ уходит текстом: её читает книга", async () => {
    // Разграничение, ради которого `csv` отделён от `текст`. Уйди выгрузка
    // текстом — позиции называла бы модель, и след до источника исчез бы.
    const итог = await РЕЕСТР.parse({
      fileName: "выгрузка.csv",
      bytes: Buffer.from(
        ["№;Наименование;Сумма", "1;Кладка стен;124500", "2;Штукатурка;38200"].join("\n"),
        "utf8",
      ),
    });

    expect(итог.format).toBe("csv");
    // Адаптера текста у `csv` нет и не должно быть: книгу читает `SHEET_READERS`.
    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("адаптер разбора не зарегистрирован");
  });
});

describe("реестр отвечает всегда", () => {
  it("на книгу Excel без зарегистрированного адаптера даёт отказ с причиной", async () => {
    // В этом наборе адаптеров xlsx нет: смету разбирает операция parse-estimate.
    // Реестр обязан сказать это словами, а не промолчать.
    const имя = Buffer.from("xl/workbook.xml", "utf8");
    const книга = Buffer.alloc(30);
    книга.writeUInt32LE(0x04034b50, 0);
    книга.writeUInt16LE(имя.length, 26);
    const bytes = Buffer.concat([книга, имя]);

    const итог = await РЕЕСТР.parse({ fileName: "смета.xlsx", bytes });

    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("адаптер разбора не зарегистрирован");
  });

  it("РАЗЛИЧАЕТ повреждённый PDF и скан", async () => {
    // Первая версия теста ждала здесь отказ по §14 и получила «разбор не
    // удался» — и это ВЕРНО. Повреждённый файл не является сканом: у скана
    // структура цела, а текстового слоя нет, тогда как здесь нечитаема сама
    // структура. Свести их к одному отказу значило бы предложить человеку не
    // тот следующий шаг: скан вводят вручную, битый файл перезапрашивают.
    //
    // Путь §14 (целый PDF без текстового слоя) проверяется модульно в
    // `parser-registry.test.ts` на управляемом адаптере: настоящего скана в
    // корпусе заказчика нет, и подделывать его здесь значило бы проверять
    // подделку.
    const итог = await РЕЕСТР.parse({
      fileName: "битый.pdf",
      bytes: Buffer.from("%PDF-1.4\n%%EOF\n", "ascii"),
    });

    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("разбор не удался");
    expect(итог.reason).not.toContain("§14");
  });
});
