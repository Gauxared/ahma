/**
 * Тесты написаны до реализации. Определение формата — роадмап M4:
 *
 *   «`ParserAdapter` как реестр с определением типа ПО СОДЕРЖИМОМУ, а не
 *    `switch` по расширению: xlsx/xls, ГРАНД-Смета XML (DTD выключен), docx,
 *    PDF с текстовым слоем. Сканы отклоняются явным статусом (§14 исключает
 *    OCR). Форматы за пределами §8.1 — либо адаптер, либо явный отказ с
 *    причиной; молчаливый пропуск запрещён.»
 *
 * ПОЧЕМУ РАСШИРЕНИЮ НЕЛЬЗЯ ВЕРИТЬ
 *
 * В сметной практике расширение врёт постоянно и в обе стороны. ГРАНД-Смета и
 * 1С выгружают под именем `.xls` то SpreadsheetML, то HTML-таблицу. Заказчик
 * переименовывает `.xlsx` в `.xls`, чтобы «открылось у всех». Архив с
 * документами приезжает под именем `.docx`.
 *
 * `switch` по расширению в каждом таком случае даёт ОДИН из двух исходов, и оба
 * плохи: разбор падает с невнятной ошибкой библиотеки, либо — хуже — файл молча
 * пропускается, и вердикт выносится по неполному обходу. Второе прямо запрещено
 * инвариантом §9.
 *
 * ПОЧЕМУ ОТКАЗ — ЭТО РЕЗУЛЬТАТ
 *
 * Формат за пределами §8.1 не ошибка системы: dwg и db4 Кодекса в объёме не
 * значатся. Но и молчать о них нельзя. Отказ с причиной — полноправный исход,
 * который доходит до отчёта и виден человеку.
 */
import { describe, expect, it } from "vitest";

import { detectFormat } from "./format-detector.js";

/** Минимальный ZIP: сигнатура локального заголовка. */
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

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe("определение формата по содержимому", () => {
  it("опознаёт книгу Excel по записи xl/workbook.xml, а не по расширению", () => {
    const итог = detectFormat({ fileName: "смета.xls", bytes: zipWith(["xl/workbook.xml"]) });

    expect(итог.format).toBe("xlsx");
    expect(итог.supported).toBe(true);
  });

  it("опознаёт документ Word по записи word/document.xml", () => {
    const итог = detectFormat({ fileName: "договор.doc", bytes: zipWith(["word/document.xml"]) });

    expect(итог.format).toBe("docx");
  });

  it("НЕ принимает произвольный ZIP за книгу Excel", () => {
    // Архив с документами под именем `.xlsx` — обычное дело. Разобрать его как
    // книгу невозможно, и притвориться, что это книга, значит получить пустую
    // смету вместо отказа.
    const итог = detectFormat({ fileName: "документы.xlsx", bytes: zipWith(["1.pdf", "2.pdf"]) });

    expect(итог.format).toBe("zip-архив");
    expect(итог.supported).toBe(false);
    expect(итог.reason).toContain("архив");
  });

  it("опознаёт PDF по сигнатуре", () => {
    const итог = detectFormat({ fileName: "смета.pdf", bytes: Buffer.from("%PDF-1.7\nтекст") });

    expect(итог.format).toBe("pdf");
  });

  it("опознаёт ГРАНД-Смету по корню XML", () => {
    const xml = Buffer.from('<?xml version="1.0"?><Document Type="Смета"><Chapter/></Document>', "utf8");
    const итог = detectFormat({ fileName: "выгрузка.xml", bytes: xml });

    expect(итог.format).toBe("grand-smeta-xml");
    expect(итог.supported).toBe(true);
  });

  it("ОТКЛОНЯЕТ XML с объявлением DTD: внешняя сущность — вектор атаки", () => {
    // Разбор XML с включённым DTD позволяет файлу читать локальные файлы через
    // внешнюю сущность. Роадмап требует «DTD выключен»; здесь файл отвергается
    // ДО разбора, а не отдаётся парсеру с выключённой опцией.
    const xml = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document/>',
      "utf8",
    );
    const итог = detectFormat({ fileName: "выгрузка.xml", bytes: xml });

    expect(итог.supported).toBe(false);
    expect(итог.reason).toContain("DTD");
  });

  /**
   * OLE2 — КОНТЕЙНЕР, А НЕ ФОРМАТ, и до Д1б он был одним отказом на три
   * разных файла: книгу Excel, документ Word и `.xlsb`. Книгу мы читать
   * научились, остальное — нет, и различать их обязано определение.
   */
  it("узнаёт книгу Excel внутри OLE2 по потоку `Workbook`", () => {
    const итог = detectFormat({
      fileName: "неважное-имя.dat",
      bytes: Buffer.concat([OLE2, Buffer.alloc(32), Buffer.from("Workbook", "utf16le")]),
    });

    expect(итог.format).toBe("xls");
    expect(итог.supported).toBe(true);
  });

  it("считает книгой .xls, у которого каталог потоков дальше прочитанного куска", () => {
    // У крупной книги каталог уезжает за первые восемь килобайт, и содержимое
    // молчит. Тогда решает расширение — но контейнер к этому моменту уже
    // опознан содержимым, и угадывания здесь нет.
    const итог = detectFormat({ fileName: "смета.xls", bytes: Buffer.concat([OLE2, Buffer.alloc(64)]) });

    expect(итог.format).toBe("xls");
    expect(итог.supported).toBe(true);
  });

  it("документ Word в OLE2 — свой формат `doc`, читаемый, и НЕ книга", () => {
    // Объявить `.doc` книгой значило бы получить отказ разбора, который
    // читается как «смета повреждена». С 07.09.2026 (любой вход, А11) он
    // читается приближённым извлечением текста — и приближение названо в тексте.
    const итог = detectFormat({
      fileName: "договор.doc",
      bytes: Buffer.concat([OLE2, Buffer.alloc(32), Buffer.from("WordDocument", "utf16le")]),
    });

    expect(итог.format).toBe("doc");
    expect(итог.supported).toBe(true);
  });

  it("RTF, презентация, OpenDocument и архивы RAR/7z опознаются по содержимому (А11)", () => {
    expect(detectFormat({ fileName: "письмо.rtf", bytes: Buffer.from("{\\rtf1\\ansi\\ansicpg1251 текст}") }).format).toBe("rtf");
    expect(detectFormat({ fileName: "доклад.pptx", bytes: zipWith(["ppt/slides/slide1.xml"]) }).format).toBe("pptx");
    expect(detectFormat({ fileName: "письмо.odt", bytes: zipWith(["mimetype", "content.xml"]) }).format).toBe("odf");
    expect(detectFormat({ fileName: "смета.zip", bytes: zipWith(["Смета/ЛСР-1.xlsx"]) }).format).toBe("zip-архив");

    const rar = detectFormat({ fileName: "комплект.rar", bytes: Buffer.concat([Buffer.from("Rar!\x1a\x07\x00", "latin1"), Buffer.alloc(16)]) });
    expect(rar.format).toBe("rar-архив");
    expect(rar.supported).toBe(false);
    expect(rar.reason).toContain("распаковывается обходом");

    const seven = detectFormat({ fileName: "комплект.7z", bytes: Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(16)]) });
    expect(seven.format).toBe("7z-архив");
  });

  it("ОТКАЗЫВАЕТ по dwg с причиной, а не молча пропускает", () => {
    // §8.1 не включает чертежи. Это не ошибка системы, но и не повод молчать:
    // человек должен узнать, что файл не разобран и почему.
    const итог = detectFormat({ fileName: "план.dwg", bytes: Buffer.from("AC1027\x00\x00\x00") });

    expect(итог.format).toBe("dwg");
    expect(итог.supported).toBe(false);
    expect(итог.reason).toContain("§8.1");
  });

  it("не выдаёт неопознанное за поддерживаемое", () => {
    const итог = detectFormat({ fileName: "нечто.bin", bytes: Buffer.from([0x00, 0x01, 0x02, 0x03]) });

    expect(итог.format).toBe("неопознан");
    expect(итог.supported).toBe(false);
  });

  it("СООБЩАЕТ расхождение расширения с содержимым", () => {
    // Расхождение само по себе — сигнал: возможно, файл переименовали, а
    // возможно, выгрузка сломана. Молчать о нём нельзя.
    const итог = detectFormat({ fileName: "смета.xlsx", bytes: Buffer.concat([OLE2, Buffer.alloc(64)]) });

    expect(итог.extensionMismatch).toBe(true);
    expect(итог.note).toContain("расширение");
  });

  it("не объявляет расхождением совпадающее расширение", () => {
    const итог = detectFormat({ fileName: "смета.xlsx", bytes: zipWith(["xl/workbook.xml"]) });

    expect(итог.extensionMismatch).toBe(false);
  });

  it("опознаёт текст, а не сваливает его в неопознанное", () => {
    // «Не опознан» и «не в объёме» — разные исходы. Markdown в папке объекта
    // пропустить нормально; неопознанные байты под именем сметы обязан
    // посмотреть человек. Один отказ на оба случая бесполезен.
    const итог = detectFormat({ fileName: "workflow.md", bytes: Buffer.from("# Протокол\n\nТакт 1.", "utf8") });

    expect(итог.format).toBe("текст");
    // §8.1 требует принимать `.txt` первой волной, и проза до агентов доходит.
    // Позиций из неё не появляется: это чтение, а не разбор.
    expect(итог.supported).toBe(true);
  });

  it("отличает таблицу с разделителем от прозы", () => {
    // ГРАНИЦА, КОТОРУЮ ЛЕГКО СДВИНУТЬ, И ОБА СДВИГА ВЫГЛЯДЯТ УСПЕХОМ.
    //
    // CSV читается КНИГОЙ и даёт позиции с координатами; проза уходит агенту
    // текстом. Приняв записку за смету, мы показали бы «прочитано, позиций 0»
    // — неотличимо от пустой сметы. Приняв смету за прозу, потеряли бы
    // координаты у всех её чисел, то есть само обещание §12.1д.
    const смета = detectFormat({
      fileName: "выгрузка.csv",
      bytes: Buffer.from(
        ["№;Наименование;Кол-во;Сумма", "1;Стяжка;10;1000", "2;Штукатурка;20;2000"].join("\n"),
        "utf8",
      ),
    });

    expect(смета.format).toBe("csv");
    expect(смета.supported).toBe(true);

    const записка = detectFormat({
      fileName: "пояснительная.txt",
      bytes: Buffer.from(
        [
          "Работы выполняются в две смены, с 8 до 20 часов.",
          "Подрядчик обеспечивает ограждение, освещение и охрану площадки.",
          "Материалы поставляет заказчик по отдельной ведомости.",
        ].join("\n"),
        "utf8",
      ),
    });

    expect(записка.format).toBe("текст");
  });

  it("не принимает JSON за таблицу", () => {
    // В JSON запятая на каждой строке, и «ширина» у него выходит устойчивой:
    // одна форма без проверки на структуру объявила бы конфиг сметой.
    const итог = detectFormat({
      fileName: "настройки.json",
      bytes: Buffer.from('{\n  "порог": 1,\n  "лимит": 2,\n  "шаг": 3\n}', "utf8"),
    });

    expect(итог.format).toBe("текст");
  });

  it("опознаёт кириллический текст ДЛИННЕЕ окна разбора", () => {
    // Регрессия. Окно в 4096 байт обрывалось посередине двухбайтовой
    // кириллической буквы, декодирование давало замещающий символ, и текст
    // считался двоичным. На настоящем корпусе так потерялись 15 файлов —
    // весь русскоязычный Markdown и txt разом.
    //
    // Граница окна режет символ ДВУМЯ способами, и оба должны быть покрыты.
    //
    // Первый тест ловил только один из них — тот, где граница попадает на
    // продолжающий байт, — и пропустил ошибку: на настоящем `workflow.md`
    // байт 4095 оказался ВЕДУЩИМ, окно осталось незавершённым, и весь
    // русскоязычный Markdown корпуса читался как двоичный.
    //
    // «я» — два байта. Ведущий на границе даёт нечётный сдвиг, продолжающий —
    // чётный, поэтому проверяются оба.
    const чётный = detectFormat({ fileName: "а.md", bytes: Buffer.from("я".repeat(3000), "utf8") });
    const нечётный = detectFormat({
      fileName: "б.md",
      bytes: Buffer.from(`#${"я".repeat(3000)}`, "utf8"),
    });

    expect(чётный.format).toBe("текст");
    expect(нечётный.format).toBe("текст");
  });

  it("объявляет изображение СКАНОМ со ссылкой на §14, а не неопознанным", () => {
    // §14 исключает распознавание из объёма. Скан, попавший в «неопознан»,
    // теряет это основание: отказ выглядит недоработкой вместо границы объёма.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const итог = detectFormat({ fileName: "смета-скан.png", bytes: png });

    expect(итог.format).toBe("скан-изображение");
    expect(итог.reason).toContain("§14");
  });

  it("оставляет неопознанным то, что действительно нечитаемо", () => {
    // Возможно, повреждённая выгрузка настоящей сметы: причина отказа обязана
    // звать человека, а не сообщать «формат не в объёме».
    const итог = detectFormat({
      fileName: "смета.xlsx",
      bytes: Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x9c, 0x00, 0x8f]),
    });

    expect(итог.format).toBe("неопознан");
    expect(итог.reason).toContain("человека");
  });

  it("на пустом файле отказывает, а не гадает по имени", () => {
    const итог = detectFormat({ fileName: "смета.xlsx", bytes: Buffer.alloc(0) });

    expect(итог.supported).toBe(false);
    expect(итог.reason).toContain("пуст");
  });
});
