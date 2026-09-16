/**
 * ЛЮБОЙ ВХОД (spec-demo-stage-1 А11): форматы, которые дверь отвергала.
 *
 * НАЙДЕНО НА КЕЙСАХ ЗАКАЗЧИКА: из 298 файлов трёх комплектов 33 отвалились на
 * двери — .doc, .rtf, .pptx, .rar, .png, .frw. Владелец требует принимать
 * любой вход: агенты работают с тем, что есть. Здесь проверяется, что каждый
 * из добавленных форматов даёт роли ТЕКСТ, а приближение — названо приближением.
 */
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { docAdapter, docToText, odfAdapter, pptxAdapter, rtfAdapter, rtfToText } from "./adapters.js";
import { archiveKind, expandArchiveInPlace, safeRelativePath, EXPANDED_SUFFIX } from "./archive-expander.js";
import { imageAsSheet, imageMime } from "./image-sheet.js";

const cp1251 = (text: string): string =>
  [...Buffer.from(text, "utf8").toString()].length === 0
    ? ""
    : [...new TextEncoder().encode(text)].length === 0
      ? ""
      : Array.from(iconv1251(text), (b) => `\\'${b.toString(16).padStart(2, "0")}`).join("");

/** Кириллица в cp1251 без внешних библиотек: А..я — 0xC0..0xFF, Ё/ё — A8/B8. */
function iconv1251(text: string): number[] {
  return [...text].map((ch) => {
    const code = ch.codePointAt(0)!;
    if (ch === "Ё") return 0xa8;
    if (ch === "ё") return 0xb8;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    return code;
  });
}

describe("RTF", () => {
  it("русский текст из \\'hh по кодовой странице 1251, служебные таблицы выброшены, абзацы сохранены", () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1251\\deff0{\\fonttbl{\\f0\\fnil Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}" +
      `{\\*\\generator Riched20}\\pard\\f0\\fs24 ${cp1251("Смета")} 48,2 ${cp1251("млн")}\\par ${cp1251("Срок")}: 12 ${cp1251("недель")}\\par}`;

    const text = rtfToText(Buffer.from(rtf, "latin1"));

    expect(text).toBe("Смета 48,2 млн\nСрок: 12 недель");
    expect(text).not.toContain("Times New Roman");
    expect(text).not.toContain("Riched20");
  });

  it("\\uN даёт символ напрямую, запасной знак пропускается", () => {
    const text = rtfToText(Buffer.from("{\\rtf1\\ansi\\uc1 \\u1057?\\u1084?\\u1077?\\u1090?\\u1072? 1\\par}", "latin1"));
    expect(text).toBe("Смета 1");
  });

  it("адаптер отдаёт текст ролям и отказывает пустому RTF", async () => {
    const outcome = await rtfAdapter.parse({
      fileName: "письмо.rtf",
      bytes: Buffer.from(`{\\rtf1\\ansi\\ansicpg1251 ${cp1251("Уважаемые коллеги, направляем условия договора подряда на объект.")}\\par}`, "latin1"),
    });
    expect((outcome.payload as { source: string; text: string }).source).toBe("rtf");
    expect((outcome.payload as { text: string }).text).toContain("условия договора подряда");

    expect(() => rtfAdapter.parse({ fileName: "п.rtf", bytes: Buffer.from("{\\rtf1 x}", "latin1") })).toThrow("читать нечего");
  });
});

describe("Word 97–2003 (.doc)", () => {
  it("вытягивает текст из UTF-16LE и называет приближение первой строкой", async () => {
    const body = "Договор подряда № 17 от 03.04.2026 на выполнение строительно-монтажных работ по объекту ЖДПП Зауралье";
    const bytes = Buffer.concat([Buffer.alloc(512, 0x00), Buffer.from(body, "utf16le"), Buffer.alloc(64, 0xff)]);

    const text = docToText(bytes);
    expect(text.startsWith("[ПРИБЛИЖЕНИЕ")).toBe(true);
    expect(text).toContain("Договор подряда № 17");

    const outcome = await docAdapter.parse({ fileName: "договор.doc", bytes });
    expect((outcome.payload as { source: string }).source).toBe("doc");
  });

  it("вытягивает текст в кодовой странице 1251, если он однобайтовый", () => {
    const body = "Пояснительная записка к проекту организации строительства участка автомобильной дороги Махачкала — Каспийск";
    const text = docToText(Buffer.concat([Buffer.alloc(300), Buffer.from(iconv1251(body)), Buffer.alloc(20)]));
    expect(text).toContain("Пояснительная записка к проекту");
  });

  it("документ без читаемого текста — отказ с причиной, не пустой успех", async () => {
    expect(() => docAdapter.parse({ fileName: "п.doc", bytes: Buffer.alloc(4096, 0x07) })).toThrow("не дал читаемого текста");
  });
});

describe("PowerPoint и OpenDocument", () => {
  it("слайды идут по номеру, текст абзацев и ячеек сохраняет строки", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide10.xml", "<p:sld><a:p><a:r><a:t>Десятый</a:t></a:r></a:p></p:sld>");
    zip.file("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>Второй: </a:t></a:r><a:r><a:t>маржа 8 %</a:t></a:r></a:p><a:tbl><a:tr><a:tc><a:p><a:t>Пакет</a:t></a:p></a:tc><a:tc><a:p><a:t>Потолок</a:t></a:p></a:tc></a:tr></a:tbl></p:sld>");
    zip.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Первый слайд &amp; заголовок</a:t></a:r></a:p></p:sld>");

    const outcome = await pptxAdapter.parse({ fileName: "доклад.pptx", bytes: await zip.generateAsync({ type: "nodebuffer" }) });
    const text = (outcome.payload as { text: string; pages: number }).text;

    expect(text.indexOf("— слайд 1 —")).toBeLessThan(text.indexOf("— слайд 2 —"));
    expect(text.indexOf("— слайд 2 —")).toBeLessThan(text.indexOf("— слайд 3 —"));
    expect(text).toContain("Первый слайд & заголовок");
    expect(text).toContain("Второй: маржа 8 %");
    expect(text).toContain("Пакет\tПотолок");
    expect((outcome.payload as { pages: number }).pages).toBe(3);
  });

  it("OpenDocument: абзацы и ячейки таблицы из content.xml", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/vnd.oasis.opendocument.text");
    zip.file(
      "content.xml",
      "<office:document-content><office:body><office:text><text:h>Ведомость объёмов работ</text:h><text:p>Раздел 1.<text:line-break/>Земляные работы</text:p>" +
        "<table:table><table:table-row><table:table-cell><text:p>Разработка грунта</text:p></table:table-cell><table:table-cell><text:p>1 250 м3</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>",
    );

    const outcome = await odfAdapter.parse({ fileName: "вор.odt", bytes: await zip.generateAsync({ type: "nodebuffer" }) });
    const text = (outcome.payload as { text: string }).text;

    expect(text).toContain("Ведомость объёмов работ\nРаздел 1.\nЗемляные работы");
    expect(text).toContain("Разработка грунта\t1 250 м3");
  });
});

describe("архив в партии раскрывается на месте", () => {
  async function zipOf(files: Record<string, string | Uint8Array>): Promise<Buffer> {
    const zip = new JSZip();
    for (const [name, data] of Object.entries(files)) zip.file(name, data);
    return zip.generateAsync({ type: "nodebuffer" });
  }

  it("ZIP с документами → папка «.распаковано» рядом; книга-ZIP (xlsx) — не архив", async () => {
    const root = await mkdtemp(join(tmpdir(), "партия-"));
    const archive = join(root, "комплект.zip");
    await writeFile(archive, await zipOf({ "Смета/ЛСР-1.xlsx": "данные", "РД/записка.txt": "текст записки к проекту, сорок с лишним знаков" }));

    const result = await expandArchiveInPlace(archive);
    expect(result?.folder).toBe(`${archive}${EXPANDED_SUFFIX}`);
    expect(result?.files).toBe(2);
    expect(await readFile(join(result!.folder, "РД", "записка.txt"), "utf8")).toContain("записки");

    // Повторный обход: папка уже есть — распаковки нет, ответ тот же.
    const again = await expandArchiveInPlace(archive);
    expect(again?.folder).toBe(result?.folder);

    const workbook = join(root, "смета.xlsx");
    await writeFile(workbook, await zipOf({ "xl/workbook.xml": "<workbook/>" }));
    expect(await expandArchiveInPlace(workbook)).toBeUndefined();
    expect(archiveKind(await zipOf({ "word/document.xml": "<w/>" }), "договор.docx")).toBeUndefined();
  });

  it("записи за пределами папки останавливают архив целиком и оставляют объяснение", async () => {
    const root = await mkdtemp(join(tmpdir(), "партия-"));
    const archive = join(root, "злой.zip");
    // JSZip нормализует `..`, поэтому опасный путь кладётся руками через generate
    // невозможно — проверяется сам фильтр пути и папка-объяснение на пустом архиве.
    expect(safeRelativePath("../../etc/passwd")).toBeUndefined();
    expect(safeRelativePath("/etc/passwd")).toBeUndefined();
    expect(safeRelativePath("C:\\Windows\\x.txt")).toBeUndefined();
    expect(safeRelativePath("Смета\\Раздел 3\\ЛСР.xlsx")).toBe("Смета/Раздел 3/ЛСР.xlsx");

    await writeFile(archive, Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.alloc(64)]));
    const broken = await expandArchiveInPlace(archive);
    expect(broken?.files).toBe(0);
    expect(broken?.rejected[0]?.reason).toContain("не распакован");
    expect(await readdir(broken!.folder)).toEqual(["НЕ_РАСПАКОВАН.txt"]);
  });

  it("вложенность ограничена третьим уровнем — глубже архив остаётся файлом", async () => {
    const root = await mkdtemp(join(tmpdir(), "партия-"));
    const deep = join(root, `а.zip${EXPANDED_SUFFIX}`, `б.zip${EXPANDED_SUFFIX}`, `в.zip${EXPANDED_SUFFIX}`);
    await mkdir(deep, { recursive: true });
    const archive = join(deep, "г.zip");
    await writeFile(archive, await zipOf({ "x.txt": "ещё один архив внутри архива внутри архива внутри архива" }));

    expect(await expandArchiveInPlace(archive)).toBeUndefined();
  });

  it("RAR и 7z узнаются по сигнатуре", () => {
    expect(archiveKind(Buffer.concat([Buffer.from("Rar!\x1a\x07\x01\x00", "latin1"), Buffer.alloc(32)]), "к.rar")).toBe("rar");
    expect(archiveKind(Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(32)]), "к.7z")).toBe("7z");
    expect(archiveKind(Buffer.from("%PDF-1.4"), "к.pdf")).toBeUndefined();
  });
});

describe("изображение — лист", () => {
  it("MIME по расширению, лист из файла без рендера", async () => {
    const root = await mkdtemp(join(tmpdir(), "лист-"));
    const png = join(root, "акт.PNG");
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));

    expect(imageMime("акт.jpg")).toBe("image/jpeg");
    expect(imageMime("смета.xlsx")).toBeUndefined();

    const sheet = await imageAsSheet(png);
    expect(sheet.page).toBe(1);
    expect(sheet.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(sheet.bytes).toBe(11);
  });
});
