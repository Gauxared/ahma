/**
 * Смета в CSV даёт позиции — первая волна форматов §8.1.
 *
 * ПОЧЕМУ СВЕРКА, А НЕ «ПОЗИЦИЙ БОЛЬШЕ НУЛЯ»
 *
 * Проверка «разобралось хоть что-то» пропустила бы худший исход: CSV, прочитан
 * неверным разделителем, даёт лист в одну колонку и разбор в ноль позиций —
 * «смета прочитана, в ней ничего нет». Это выглядит РЕЗУЛЬТАТОМ, а не сбоем, и
 * доходит до вердикта.
 *
 * Поэтому требуется РАВЕНСТВО: одна и та же смета в книге и в выгрузке обязана
 * дать одни и те же позиции и тот же итог до копейки. Тот же принцип, что у
 * вехи Д1б со старым двоичным Excel.
 *
 * ФАЙЛ БЕРЁТСЯ НАСТОЯЩИЙ
 *
 * Содержимое — курганская ЛСР, ячейка в ячейку: наименования с запятыми и
 * кавычками, номера позиций с переводом строки внутри («76⏎О»), шапка объекта
 * сверху в одну ячейку, пустые строки между разделами. Выдуманная таблица из
 * трёх строк прошла бы и на неверном читателе — ломается разбор именно на этом.
 *
 * ПОЧЕМУ ВЫГРУЗКУ ПИШЕТ САМ НАБОР, А НЕ `XLSX.utils.sheet_to_csv`
 *
 * Замерено: `sheet_to_csv` выводит ячейку с переводом строки БЕЗ КАВЫЧЕК, то
 * есть выдаёт невалидный CSV. Строка `76⏎О;ТЦ_61…` неоднозначна принципиально,
 * и восстановить её не может никакой читатель. Проверять чтение на заведомо
 * испорченном файле значило бы проверять не то.
 *
 * Поэтому кавычки здесь ставятся по RFC 4180 — как ставит их Excel, — а
 * значения берутся из книги без изменений. Ячейки НЕ размножаются по
 * объединениям: настоящий экспорт пишет объединённое значение один раз, и
 * разбор обязан обойтись без него.
 *
 * ПРОВЕРЯЮТСЯ ОБА РАЗДЕЛИТЕЛЯ И ОБА ФОРМАТА ЧИСЛА
 *
 * Русский Excel сохраняет CSV с точкой с запятой и числами вида `18 038,61`;
 * веб-выгрузка — с запятой и `18038.61`. Любой из двух прошёл бы и на жёстко
 * назначенном разделителе; расхождение между ними и есть то, что определение
 * обязано вынести. Замерено на этой же смете: до нормализации разрядов из
 * сорока четырёх позиций читалась ОДНА, и разбор при этом рапортовал успех.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import XLSX from "xlsx";

import { ParserRegistry } from "@modules/documents/parser-registry";
import { parseLsr } from "@modules/documents/parsers/grand-smeta";
import { classifyDocument } from "@modules/workflow/classify-document";
import { describeDocument } from "@platform/execution/check-ports";
import { docxAdapter, pdfAdapter } from "@platform/storage/adapters";
import { detectFileFormat, parsableSheetFormats, readSheetOf } from "@platform/storage/sheet-reader";

const ИСТОЧНИК = "reference-system/input-1/РИМ Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx";

/** Позиций во всех разделах: одна цифра, по которой видно расхождение разбора. */
function позиций(документ: ReturnType<typeof parseLsr>): number {
  return документ.sections.reduce((сумма, раздел) => сумма + раздел.positions.length, 0);
}

/** Кавычки по RFC 4180: обязательны при разделителе, кавычке или переводе строки. */
function ячейка(value: string, delimiter: string): string {
  const нужны = value.includes(delimiter) || value.includes('"') || /[\r\n]/.test(value);

  return нужны ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Число так, как показывает его русский Excel: пробел в разрядах, запятая в
 * дроби. Ровно та запись, на которой разбор терял сорок три позиции из
 * сорока четырёх.
 */
function поРусски(value: string): string {
  const [целая = "", дробная] = value.split(".");
  const разряды = целая.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  return дробная === undefined ? разряды : `${разряды},${дробная}`;
}

/**
 * Выгрузка книги в CSV — по ячейкам, без размножения объединений.
 *
 * `локаль` решает, писать ли числа машинными или так, как их видит человек:
 * оба варианта приезжают от клиентов, и оба обязаны читаться.
 */
function выгрузить(
  лист: XLSX.WorkSheet,
  delimiter: string,
  локаль: "машинная" | "русская",
): string {
  const range = XLSX.utils.decode_range(лист["!ref"] as string);
  const записи: string[] = [];

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const строка: string[] = [];

    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = лист[XLSX.utils.encode_cell({ r: row, c: column })] as
        | { t?: string; v?: unknown }
        | undefined;

      const raw = cell?.v === undefined || cell.v === null ? "" : String(cell.v);
      const число = cell?.t === "n" && raw !== "";

      строка.push(ячейка(число && локаль === "русская" ? поРусски(raw) : raw, delimiter));
    }

    записи.push(строка.join(delimiter));
  }

  return записи.join("\r\n");
}

describe("смета в CSV", () => {
  let каталог = "";
  let сТочкойЗапятой = "";
  let сЗапятой = "";

  beforeAll(async () => {
    каталог = await mkdtemp(join(tmpdir(), "csv-гейт-"));
    сТочкойЗапятой = join(каталог, "ЛСР выгрузка Excel.csv");
    сЗапятой = join(каталог, "ЛСР выгрузка веб.csv");

    // Выгрузка настоящей сметы, а не сборка таблицы: содержимое остаётся тем,
    // что прислал заказчик, — вместе с запятыми в наименованиях работ.
    const книга = XLSX.read(await readFile(ИСТОЧНИК), { type: "buffer" });
    const лист = книга.Sheets[книга.SheetNames[0] ?? ""];

    if (лист === undefined) throw new Error(`в книге ${ИСТОЧНИК} нет листов`);

    await writeFile(сТочкойЗапятой, выгрузить(лист, ";", "русская"), "utf8");
    await writeFile(сЗапятой, выгрузить(лист, ",", "машинная"), "utf8");
  });

  afterAll(async () => {
    await rm(каталог, { recursive: true, force: true });
  });

  it("опознаётся таблицей по содержимому, а не по расширению", async () => {
    const detection = await detectFileFormat(сТочкойЗапятой);

    expect(detection.format).toBe("csv");
    expect(detection.supported).toBe(true);
    expect(parsableSheetFormats()).toContain("csv");
  });

  it("обход объекта считает её ЛОКАЛЬНОЙ СМЕТОЙ, а не рабочей документацией", async () => {
    // Щель, на которой проваливался `.xls`: файл принят дверью, посчитан в
    // числе документов и молча уехал в «рабочую документацию» — то есть в
    // категорию, от которой позиций никто не ждёт.
    const описание = await describeDocument(
      сТочкойЗапятой,
      "ЛСР выгрузка Excel.csv",
      new ParserRegistry([pdfAdapter, docxAdapter]),
    );

    expect(описание.kind).toBe("лср");
    // Причина у разобранного файла означала бы «принят и не прочитан».
    expect(описание.reason).toBeUndefined();
  });

  it("даёт те же позиции и тот же итог, что и книга", async () => {
    const изКниги = parseLsr(await readSheetOf(ИСТОЧНИК));
    const изВыгрузки = parseLsr(await readSheetOf(сТочкойЗапятой));

    expect(позиций(изВыгрузки)).toBe(позиций(изКниги));
    expect(позиций(изВыгрузки)).toBeGreaterThan(0);
    expect(изВыгрузки.form).toBe(изКниги.form);
    expect(изВыгрузки.sections.length).toBe(изКниги.sections.length);
    expect(изВыгрузки.declaredTotal).toBe(изКниги.declaredTotal);

    // До копейки: §12.1б требует расхождения ровно 0 ₽, и читатель, теряющий
    // копейку на разборе числа, этого не даст.
    expect(изВыгрузки.sections[0]?.positions.map((позиция) => позиция.total)).toEqual(
      изКниги.sections[0]?.positions.map((позиция) => позиция.total),
    );
  });

  it("разделитель определяется: запятая даёт тот же разбор, что точка с запятой", async () => {
    // Наименования работ полны запятых. Назначь мы разделитель жёстко — один
    // из двух файлов разложился бы по колонкам неверно, сдвинув все суммы.
    const изЗапятой = parseLsr(await readSheetOf(сЗапятой));
    const изТочки = parseLsr(await readSheetOf(сТочкойЗапятой));

    expect(позиций(изЗапятой)).toBe(позиций(изТочки));
    expect(изЗапятой.declaredTotal).toBe(изТочки.declaredTotal);
  });

  it("ССРСС в выгрузке остаётся сводным расчётом, а не локальной сметой", () => {
    // Форму задаёт имя государственной формы, контейнер тут ни при чём: иначе
    // сводный расчёт сверялся бы сам с собой.
    expect(
      classifyDocument("Сводный сметный расчёт.csv", { supported: true, format: "csv" }, parsableSheetFormats()),
    ).toBe("ссрсс");
  });
});
