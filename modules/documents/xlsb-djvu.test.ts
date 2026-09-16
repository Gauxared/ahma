/**
 * ДВА ФОРМАТА, ТЕРЯВШИЕСЯ ПО РАЗНЫМ ПРИЧИНАМ — Т10.
 *
 * `.xlsb` отвергался при ЖИВОМ читателе: он был объявлен вместе с `.doc` как
 * «старый двоичный формат Microsoft», хотя это контейнер zip, и читает его та
 * же библиотека, что и `.xls`. В корпусе заказчика так терялись АРМы учёта
 * материалов — тридцать четыре файла.
 *
 * `.djvu` не опознавался вовсе и попадал в «неопознанные байты». Читателя у
 * него нет и сейчас, но НАЗВАННЫЙ формат с причиной и молчание — разные
 * исходы: первый чинится поиском читателя, второй выглядит как недосмотр.
 */
import { describe, expect, it } from "vitest";

import { detectFormat } from "./format-detector.js";

describe("двоичная книга Excel и DjVu названы своими именами", () => {
  it("DjVu опознаётся по подписи контейнера, а не по расширению", () => {
    const detected = detectFormat({ fileName: "книга.djvu", bytes: Buffer.from("AT&TFORMxxxxDJVM", "utf8") });

    expect(detected.format).toBe("djvu");
    // Читателя нет — и это сказано словом, а не молчанием.
    expect(detected.supported).toBe(false);
    expect(detected.reason).toContain("DjVu");
  });

  it("книга .xlsb больше не считается документом Word", () => {
    // Ключевое утверждение: `.xlsb` отделён от `ole2`. Содержимое контейнера
    // проверяется отдельно, на настоящей книге заказчика.
    const detected = detectFormat({
      fileName: "АРМ.xlsb",
      bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("xl/workbook.bin", "utf8")]),
    });

    expect(detected.format).not.toBe("ole2");
  });
});
