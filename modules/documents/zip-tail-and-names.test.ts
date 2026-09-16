/**
 * АРХИВ ОПОЗНАЁТСЯ ПО ХВОСТУ, А ИМЕНА В НЁМ — ПО ФЛАГУ КОДИРОВКИ.
 *
 * ЗАМЕРЕНО НА ЭТАЛОННОМ КЕЙСЕ «ЙОШКАР-ОЛА» 09.09.2026, и оба дефекта нашлись
 * на одном файле.
 *
 * ПЕРВОЕ. Приложения тендерной документации — ПСД (31 запись: сметы и
 * прайс-листы) и РД (рабочая документация на 252 МБ) — НЕ начинаются с
 * `PK\x03\x04`. Проверка сигнатуры по началу файла объявляла их
 * «неопознанными», и вместо документов роль получала 225 КБ «печатных
 * последовательностей из двоичного файла». То есть терялось самое ценное в
 * комплекте, и терялось молча: файл «прочитан», знаки есть.
 *
 * Так устроен формат: авторитетный перечень записей у ZIP — центральный каталог
 * в ХВОСТЕ, и `unzip` с Python открывают такой файл без единой жалобы.
 *
 * ВТОРОЕ. В тех же архивах флаг UTF-8 (бит 11) не выставлен, а имена записаны в
 * CP866 — так пишет большинство архиваторов Windows. Прочитанные как UTF-8, они
 * превращаются в мусор и такими же ложатся на диск при распаковке, попадая в
 * перечень документов роли. Файл с нечитаемым именем нельзя ни назвать в
 * находке, ни найти человеку.
 *
 * ГРАНИЦА, КОТОРУЮ НЕЛЬЗЯ ПЕРЕЙТИ: `.xlsx` и `.docx` — тоже ZIP с каталогом в
 * хвосте. Приняв их за архивы, обход разложил бы книгу на `xl/…xml` вместо
 * того, чтобы прочитать её сметой.
 */
import { describe, expect, it } from "vitest";

import { detectFormat, zipEntryName, zipListing, zipVolumeIndex } from "./format-detector.js";

/** Минимальный ZIP: одна запись без сжатия, каталог и EOCD. */
function архив(имяЗаписи: Buffer, флаги: number, данные: Buffer, префикс: Buffer, том = 0): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(флаги, 6);
  local.writeUInt32LE(данные.length, 18);
  local.writeUInt32LE(данные.length, 22);
  local.writeUInt16LE(имяЗаписи.length, 26);

  const localOffset = префикс.length;
  const тело = Buffer.concat([префикс, local, имяЗаписи, данные]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(флаги, 8);
  central.writeUInt32LE(данные.length, 20);
  central.writeUInt32LE(данные.length, 24);
  central.writeUInt16LE(имяЗаписи.length, 28);
  central.writeUInt32LE(localOffset, 42);

  const каталог = Buffer.concat([central, имяЗаписи]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  // Номер тома: у обычного архива ноль, у многотомного — индекс последнего.
  eocd.writeUInt16LE(том, 4);
  eocd.writeUInt16LE(том, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(каталог.length, 12);
  eocd.writeUInt32LE(тело.length, 16);

  return Buffer.concat([тело, каталог, eocd]);
}

/** «Смета.pdf» в CP866 — так имя лежит в архиве, собранном под Windows. */
const CP866 = Buffer.from([0x91, 0xac, 0xa5, 0xe2, 0xa0, 0x2e, 0x70, 0x64, 0x66]);

describe("архив, чьё начало занято не сигнатурой", () => {
  it("опознаётся по центральному каталогу в хвосте", () => {
    // Префикс: так выглядят самораспаковка, склейка и повреждённое начало.
    const bytes = архив(Buffer.from("смета.pdf", "utf8"), 0x800, Buffer.from("данные"), Buffer.from("мусор в начале"));

    expect(detectFormat({ fileName: "комплект.zip", bytes }).format).toBe("zip-архив");
  });

  it("книга Excel архивом НЕ становится: у неё каталог тоже в хвосте", () => {
    const bytes = архив(Buffer.from("xl/workbook.xml", "utf8"), 0x800, Buffer.from("<workbook/>"), Buffer.alloc(0));

    // Разложенная как архив, книга перестала бы читаться сметой.
    expect(detectFormat({ fileName: "смета.xlsx", bytes }).format).toBe("xlsx");
  });
});

describe("имя записи в кодировке DOS", () => {
  it("читается по-русски, когда флаг UTF-8 не выставлен", () => {
    expect(zipEntryName(CP866, 0)).toBe("Смета.pdf");
  });

  it("с выставленным флагом читается как UTF-8", () => {
    expect(zipEntryName(Buffer.from("Смета.pdf", "utf8"), 0x800)).toBe("Смета.pdf");
  });

  it("латиница читается одинаково при любом флаге", () => {
    expect(zipEntryName(Buffer.from("report.pdf", "ascii"), 0)).toBe("report.pdf");
  });

  it("опись архива называет имена по-русски и размеры записей", () => {
    const данные = Buffer.from("содержимое");
    const bytes = архив(CP866, 0, данные, Buffer.alloc(0));
    const опись = zipListing(bytes);

    expect(опись).toHaveLength(1);
    expect(опись[0]?.name).toBe("Смета.pdf");
    // Размер — в БАЙТАХ, как он и записан в оглавлении: кириллица занимает по
    // два байта, и путать длину строки с размером записи нельзя.
    expect(опись[0]?.size).toBe(данные.length);
  });
});

describe("многотомный архив", () => {
  it("узнаётся по номеру тома, а не объявляется повреждённым", () => {
    /**
     * ЗАМЕРЕНО НА КЕЙСЕ «ЙОШКАР-ОЛА»: приложения ПСД и РД не распаковываются
     * ничем — ни `unzip`, ни JSZip, ни 7-Zip. Причина не в повреждении: это
     * последние тома многотомных архивов (том 9 из 9 и том 6 из 6), а
     * предыдущие тома в комплект не попали.
     *
     * «Архив повреждён» и «приложены не все тома» ведут к разным действиям:
     * первое закрывает вопрос неправдой, второе решается запросом недостающих
     * томов у заказчика.
     */
    const bytes = архив(Buffer.from("смета.pdf", "utf8"), 0x800, Buffer.from("данные"), Buffer.alloc(0), 8);

    expect(zipVolumeIndex(bytes)).toBe(8);
  });

  it("обычный архив номера тома не имеет", () => {
    const bytes = архив(Buffer.from("смета.pdf", "utf8"), 0x800, Buffer.from("данные"), Buffer.alloc(0));

    expect(zipVolumeIndex(bytes)).toBeUndefined();
  });
});
