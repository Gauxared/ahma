/**
 * Проверки распаковки архивов.
 *
 * Архивы для проверок собираются ЗДЕСЬ той же библиотекой, а не лежат
 * заготовками: заготовку с обходом каталога пришлось бы держать в репозитории
 * как файл, который любой распаковщик по дороге «починит», — и проверка стала
 * бы зелёной от того, что вредный путь потерялся при выкладке.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  MAX_ENTRIES,
  MAX_EXPANDED_BYTES,
  expandArchive,
  isArchive,
  rawEntryNames,
  safeEntryPath,
} from "./archives.js";

async function zipOf(entries: Readonly<Record<string, string | Uint8Array>>): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** CRC-32 — ZIP хранит его в каждом заголовке, и без него архив не читается. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
    }
  }

  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/**
 * Настоящий ZIP из настоящих байтов, метод «без сжатия».
 *
 * Нужен ровно для одного: положить в архив запись с путём, который библиотека
 * нормализовала бы. Никакой другой проверке он не нужен — остальные собираются
 * через JSZip.
 */
function storedZip(entries: readonly { readonly name: string; readonly data: string }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data, "utf8");
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // имя в UTF-8
    local.writeUInt16LE(0, 8); // без сжатия
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    parts.push(local, name, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02_01_4b_50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt32LE(sum, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);

    central.push(record, name);
    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

describe("путь записи архива", () => {
  it("обход каталога отвергается целиком", () => {
    for (const raw of ["../passwd", "../../etc/passwd", "смета/../../etc/passwd", "/etc/passwd", "C:\\Windows\\x"]) {
      expect(safeEntryPath(raw), `путь ${raw} принят`).toBeUndefined();
    }
  });

  it("обратная косая черта — тот же разделитель, а не имя", () => {
    // Архивы из Windows пишут `Смета\ЛСР-05.xlsx`. Оставить это одним именем
    // значило бы создать файл с косой чертой в имени и потерять папку.
    expect(safeEntryPath("Смета\\ЛСР-05.xlsx")).toBe("Смета/ЛСР-05.xlsx");
  });

  it("кириллица и пробелы сохраняются: имена смет по-русски", () => {
    expect(safeEntryPath("Смета/Раздел 3/РИМ Курган_СОТВ_ испр..xlsx")).toBe(
      "Смета/Раздел 3/РИМ Курган_СОТВ_ испр..xlsx",
    );
  });

  it("скрытый файл и пустое имя отвергаются", () => {
    expect(safeEntryPath(".ssh/id_rsa")).toBeUndefined();
    expect(safeEntryPath("")).toBeUndefined();
    expect(safeEntryPath("///")).toBeUndefined();
  });

  it("слишком глубокое дерево отвергается", () => {
    expect(safeEntryPath(Array.from({ length: 13 }, (_, i) => `п${i}`).join("/") + "/x.xlsx")).toBeUndefined();
  });
});

describe("распаковка", () => {
  it("структура папок сохраняется", async () => {
    const archive = await zipOf({
      "Смета/Раздел 3/ЛСР-05.xlsx": "первая",
      "Смета/ССРСС.xlsx": "вторая",
      "РД/подшивка.pdf": "третья",
    });

    const result = await expandArchive(archive);

    expect(result.files.map((file) => file.path).sort()).toEqual([
      "РД/подшивка.pdf",
      "Смета/Раздел 3/ЛСР-05.xlsx",
      "Смета/ССРСС.xlsx",
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("запись с обходом каталога отвергается с причиной, остальные принимаются", async () => {
    /**
     * АРХИВ СОБИРАЕТСЯ БАЙТАМИ, А НЕ БИБЛИОТЕКОЙ.
     *
     * `JSZip.file()` нормализует путь и `../../etc/passwd` сам превращает в
     * безобидное имя — то есть проверка через него проверяла бы нормализацию
     * JSZip, а не нашу. Хранить готовый вредный архив файлом в репозитории тоже
     * нельзя: любой распаковщик по дороге его «починит», и проверка станет
     * зелёной от того, что опасность потерялась при выкладке.
     *
     * Поэтому здесь настоящий ZIP из настоящих байтов, с настоящим `..` в имени
     * записи. Метод хранения — без сжатия, чтобы обойтись без deflate.
     */
    const archive = storedZip([
      { name: "смета.xlsx", data: "нормальная" },
      { name: "../../etc/passwd", data: "root:x:0:0" },
    ]);

    const result = await expandArchive(archive);

    // Архив отвергнут ЦЕЛИКОМ: запись с `..` — подпись попытки, а не странный
    // файл. Взять из него остальное значило бы скрыть попытку от человека.
    expect(result.files).toEqual([]);
    expect(result.rejected).toEqual([
      {
        path: "../../etc/passwd",
        reason: "путь записи ведёт за пределы партии либо непригоден для хранения: архив не принят",
      },
    ]);
  });

  it("подлинные имена читаются из оглавления, а не из библиотеки", () => {
    // Это и есть находка, ради которой появился `rawEntryNames`: JSZip
    // нормализует `../../etc/passwd` в `etc/passwd` при чтении, и защита,
    // смотревшая на его вывод, не видела опасности ни разу.
    const archive = storedZip([{ name: "../../etc/passwd", data: "root" }]);

    expect(rawEntryNames(archive)).toEqual(["../../etc/passwd"]);
  });

  it("вложенный архив ложится файлом партии — его раскроет обход, а не дверь", async () => {
    // До А11 он отвергался с просьбой распаковать отдельно. Владелец требует
    // принимать любой вход: вложенный архив — часть комплекта, и раскрывает его
    // обход партии вместе с .rar и .7z, которых дверь читать не умеет.
    const inner = await zipOf({ "внутри.xlsx": "данные" });
    const archive = await zipOf({ "смета.xlsx": "данные", "резерв.zip": inner });

    const result = await expandArchive(archive);

    expect(result.files.map((file) => file.path).sort()).toEqual(["резерв.zip", "смета.xlsx"]);
    expect(result.rejected).toEqual([]);
  });

  /**
   * ЭТОТ ФАЙЛ ЖИВЁТ В МЕДЛЕННОМ ПРОЕКТЕ, И ПРИЧИНА — ПАМЯТЬ.
   *
   * Проверка собирает 300 МБ нулей и распаковывает 256 из них. Это буферы, а
   * не куча: потолок `--max-old-space-size` их не сдерживает. В быстром
   * проекте она шла одновременно с шестью другими форками и вносила четверть
   * гигабайта в пик, из-за которого `systemd-oomd` убил рабочий стол
   * владельца — см. пояснение к параллелизму в `vitest.config.ts`.
   *
   * Заодно ушёл её собственный таймаут: в медленном проекте их шестьдесят
   * секунд против замеренных шести с половиной.
   */
  it("бомба сжатия останавливается на потолке, а не разжимается целиком", async () => {
    // Один мегабайт нулей сжимается в килобайты; триста таких записей дают
    // 300 МБ распакованного при потолке 256. Проверяется именно ОСТАНОВКА:
    // без неё вызов съел бы память вместо того, чтобы отказать.
    const block = new Uint8Array(1024 * 1024);
    const entries: Record<string, Uint8Array> = {};

    for (let index = 0; index < 300; index += 1) {
      entries[`нули-${index}.xlsx`] = block;
    }

    // Потолок двери — 2 ГБ; собирать столько нулей в тесте нельзя, поэтому
    // потолок передаётся параметром: проверяется механизм остановки, не число.
    const ПОТОЛОК = 256 * 1024 * 1024;
    const result = await expandArchive(await zipOf(entries), { expandedBytes: ПОТОЛОК });
    const total = result.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);

    expect(total, "распаковано больше потолка: остановки нет").toBeLessThanOrEqual(ПОТОЛОК);
    expect(result.rejected.some((row) => /бомбу сжатия/.test(row.reason))).toBe(true);
  });

  it("битый архив даёт отказ с причиной, а не исключение", async () => {
    const result = await expandArchive(new Uint8Array([1, 2, 3, 4, 5]));

    expect(result.files).toEqual([]);
    expect(result.rejected[0]?.path).toBe("архив");
    // Отказ приходит от чтения ОГЛАВЛЕНИЯ: до библиотеки дело не доходит, и
    // это правильный порядок — сначала подлинные имена, потом распаковка.
    expect(result.rejected[0]?.reason).toMatch(/оглавление архива не прочитано/);
  });

  it("сверх потолка записей отказ называет, сколько осталось за бортом", async () => {
    const entries: Record<string, string> = {};

    for (let index = 0; index < MAX_ENTRIES + 5; index += 1) {
      entries[`смета-${index}.xlsx`] = "данные";
    }

    const result = await expandArchive(await zipOf(entries));

    expect(result.files.length).toBeLessThanOrEqual(MAX_ENTRIES);
    expect(result.rejected.some((row) => row.reason.includes(`не больше ${MAX_ENTRIES} записей`))).toBe(true);
  });

  it("папки не попадают в перечень файлов", async () => {
    const zip = new JSZip();
    zip.folder("Смета")?.file("ЛСР.xlsx", "данные");
    const result = await expandArchive(await zip.generateAsync({ type: "uint8array" }));

    expect(result.files.map((file) => file.path)).toEqual(["Смета/ЛСР.xlsx"]);
  });

  it("архивом считается только объявленное расширение", () => {
    expect(isArchive(".zip")).toBe(true);
    expect(isArchive(".ZIP")).toBe(true);
    expect(isArchive(".xlsx")).toBe(false);
  });
});
