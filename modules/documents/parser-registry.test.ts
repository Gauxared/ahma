/**
 * Тесты написаны до реализации. Реестр адаптеров разбора — роадмап M4:
 *
 *   «`ParserAdapter` как реестр с определением типа по содержимому, а не
 *    `switch` по расширению… Форматы за пределами §8.1 (doc, xlsb, rtf, dwg,
 *    архивы, db4 Кодекса) — политика трека A: либо адаптер, либо явный отказ с
 *    причиной; МОЛЧАЛИВЫЙ ПРОПУСК ЗАПРЕЩЁН.»
 *
 * ГЛАВНОЕ СВОЙСТВО РЕЕСТРА — ОН ВСЕГДА ОТВЕЧАЕТ
 *
 * У `switch` есть ветка `default`, и она почти всегда пустая. Реестр устроен
 * так, что пустой ветки нет: на любой файл возвращается либо разбор, либо
 * ОТКАЗ С ПРИЧИНОЙ. Третьего исхода — «ничего не произошло» — не существует,
 * потому что именно он даёт зелёный вердикт на неполном обходе (§9).
 *
 * СКАН PDF — ЭТО ОТКАЗ, А НЕ ПУСТОЙ РАЗБОР
 *
 * §14 исключает распознавание. PDF без текстового слоя разбирается «успешно» и
 * даёт ноль позиций: результат, неотличимый от пустой сметы. Такой файл обязан
 * отклоняться явным статусом, а не проходить как разобранный.
 */
import { describe, expect, it } from "vitest";

import { ParserRegistry } from "./parser-registry.js";

function zipWith(entries: readonly string[]): Buffer {
  const parts: Buffer[] = [];
  for (const name of entries) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(name.length, 26);
    parts.push(header, Buffer.from(name, "utf8"));
  }
  return Buffer.concat(parts);
}

const РЕЕСТР = new ParserRegistry([
  {
    format: "xlsx",
    parse: () => ({ kind: "разобран", positions: 42 }),
  },
]);

describe("реестр адаптеров", () => {
  it("выбирает адаптер по СОДЕРЖИМОМУ, а не по расширению", async () => {
    // Файл назван `.xls`, внутри — книга Excel.
    const итог = await РЕЕСТР.parse({ fileName: "смета.xls", bytes: zipWith(["xl/workbook.xml"]) });

    expect(итог.status).toBe("разобран");
  });

  it("ОТКАЗЫВАЕТ с причиной, когда адаптера нет", async () => {
    const итог = await РЕЕСТР.parse({ fileName: "договор.docx", bytes: zipWith(["word/document.xml"]) });

    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("docx");
  });

  it("НИКОГДА не возвращает пустой исход: у любого файла есть статус", async () => {
    // Проверка отсутствия ветки `default`. Молчаливый пропуск даёт зелёный
    // вердикт на неполном обходе — прямое нарушение §9.
    const файлы = [
      { fileName: "план.dwg", bytes: Buffer.from("AC1027\x00\x00\x00") },
      { fileName: "архив.zip", bytes: zipWith(["1.pdf"]) },
      { fileName: "мусор.bin", bytes: Buffer.from([0xff, 0xfe, 0x00, 0x9c]) },
      { fileName: "пусто.xlsx", bytes: Buffer.alloc(0) },
    ];

    for (const файл of файлы) {
      const итог = await РЕЕСТР.parse(файл);

      expect(итог.status).toBe("отказ");
      expect(итог.reason).toBeTruthy();
    }
  });

  it("несёт формат в результате отказа: причину можно свести в реестр", async () => {
    const итог = await РЕЕСТР.parse({ fileName: "план.dwg", bytes: Buffer.from("AC1027\x00\x00\x00") });

    expect(итог.format).toBe("dwg");
  });

  it("ОТКЛОНЯЕТ PDF без текстового слоя явным статусом (§14)", async () => {
    // Разобранный скан даёт ноль позиций — результат, неотличимый от пустой
    // сметы. Это худший исход: он выглядит успехом.
    const реестр = new ParserRegistry([
      { format: "pdf", parse: () => ({ kind: "разобран", positions: 0, textLength: 0 }) },
    ]);

    const итог = await реестр.parse({ fileName: "смета.pdf", bytes: Buffer.from("%PDF-1.7\n") });

    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("§14");
  });

  it("принимает PDF С текстовым слоем", async () => {
    const реестр = new ParserRegistry([
      { format: "pdf", parse: () => ({ kind: "разобран", positions: 12, textLength: 4096 }) },
    ]);

    const итог = await реестр.parse({ fileName: "смета.pdf", bytes: Buffer.from("%PDF-1.7\n") });

    expect(итог.status).toBe("разобран");
  });

  it("ошибка адаптера становится отказом с причиной, а не падением прогона", async () => {
    // Один сломанный файл не должен обрывать обход папки объекта: остальные
    // сметы обязаны быть проверены, а этот — попасть в отчёт как отказ.
    const реестр = new ParserRegistry([
      {
        format: "xlsx",
        parse: () => {
          throw new Error("повреждён центральный каталог");
        },
      },
    ]);

    const итог = await реестр.parse({ fileName: "смета.xlsx", bytes: zipWith(["xl/workbook.xml"]) });

    expect(итог.status).toBe("отказ");
    expect(итог.reason).toContain("повреждён центральный каталог");
  });

  it("сообщает расхождение расширения с содержимым в успешном разборе тоже", async () => {
    // Расхождение — не ошибка, но сигнал. Он не должен теряться оттого, что
    // разбор удался.
    const итог = await РЕЕСТР.parse({ fileName: "смета.xls", bytes: zipWith(["xl/workbook.xml"]) });

    expect(итог.status).toBe("разобран");
    expect(итог.note).toContain("расширение");
  });

  it("отвергает повторную регистрацию адаптера на один формат", () => {
    // Два адаптера на формат означают, что выбор между ними где-то неявный.
    expect(
      () =>
        new ParserRegistry([
          { format: "xlsx", parse: () => ({ kind: "разобран", positions: 1 }) },
          { format: "xlsx", parse: () => ({ kind: "разобран", positions: 2 }) },
        ]),
    ).toThrow(/дважды/i);
  });

  it("перечисляет поддержанные форматы: список видно, а не выводится из кода", () => {
    expect(РЕЕСТР.supportedFormats()).toEqual(["xlsx"]);
  });
});
