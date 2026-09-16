/**
 * ОПОЗНАНИЕ КОНТЕЙНЕРА ПО ЦЕНТРАЛЬНОМУ ОГЛАВЛЕНИЮ.
 *
 * ЧТО СЛУЧИЛОСЬ. Перечень записей архива читался обходом заголовков С НАЧАЛА
 * файла, и обход останавливался на первой записи со стриминговым размером.
 * PowerPoint пишет так ПЕРВУЮ же запись — до папки `ppt/` дело не доходило
 * никогда. Презентация опознавалась «ZIP-архивом без признаков документа», и
 * восемь файлов корпуса читались описью вложений вместо текста слайдов.
 *
 * Дефект был молчаливым вдвойне: формат определялся «успешно», содержимое
 * извлекалось «успешно», и только замер по корпусу показал, что извлекается не
 * то.
 *
 * Набор строит контейнер ровно с этим свойством: первая запись со стриминговым
 * размером, значимая — второй.
 */
import { describe, expect, it } from "vitest";

import { detectFormat } from "./format-detector.js";

/** Запись оглавления. Сжатие «без сжатия», размеры настоящие. */
function central(name: string, offset: number): Buffer {
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt32LE(offset, 42);
  return Buffer.concat([head, Buffer.from(name, "utf8")]);
}

/** Локальный заголовок; `streaming` — размер не объявлен (данные в дескрипторе). */
function local(name: string, streaming: boolean): Buffer {
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt32LE(streaming ? 0 : 1, 18);
  head.writeUInt16LE(name.length, 26);
  return Buffer.concat([head, Buffer.from(name, "utf8"), streaming ? Buffer.alloc(0) : Buffer.alloc(1)]);
}

function контейнер(entries: readonly string[]): Buffer {
  // Первая запись — стриминговая: именно она обрывала прежний обход.
  const locals = entries.map((name, index) => local(name, index === 0));
  const данные = Buffer.concat(locals);

  let offset = 0;
  const оглавление: Buffer[] = [];
  for (const [index, name] of entries.entries()) {
    оглавление.push(central(name, offset));
    offset += locals[index]!.length;
  }

  const каталог = Buffer.concat(оглавление);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(каталог.length, 12);
  eocd.writeUInt32LE(данные.length, 16);

  return Buffer.concat([данные, каталог, eocd]);
}

describe("контейнер опознаётся по всем записям, а не по первой", () => {
  it("презентация со стриминговой первой записью — это pptx, а не архив", () => {
    const detected = detectFormat({
      fileName: "каталожные листы.pptx",
      bytes: контейнер(["[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml"]),
    });

    expect(detected.format).toBe("pptx");
    expect(detected.supported).toBe(true);
  });

  it("документ Word опознаётся так же", () => {
    const detected = detectFormat({
      fileName: "записка.docx",
      bytes: контейнер(["[Content_Types].xml", "word/document.xml"]),
    });

    expect(detected.format).toBe("docx");
  });

  it("архив без признаков документа остаётся архивом", () => {
    // Обратная сторона: опознавать документом ВСЁ подряд нельзя — тогда
    // настоящий архив перестал бы распаковываться обходом партии.
    const detected = detectFormat({
      fileName: "комплект.zip",
      bytes: контейнер(["[Content_Types].xml", "смета.xlsx", "письмо.pdf"]),
    });

    expect(detected.format).toBe("zip-архив");
  });
});
