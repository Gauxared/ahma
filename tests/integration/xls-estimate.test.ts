/**
 * Смета в СТАРОМ двоичном формате даёт позиции — веха Д1б плана демо.
 *
 * ПОЧЕМУ ЭТО ГЛАВНЫЙ ГЕЙТ ВЕХИ
 *
 * Замер по клиентским кейсам: `.xls` в них десятки. До Д1б такой файл
 * принимался дверью загрузки, доходил до обхода и объявлялся неразобранным —
 * честно и бесполезно. Сто смет в старом формате давали «документов 100,
 * позиций 0» и вердикт по пустому обходу.
 *
 * ФАЙЛ БЕРЁТСЯ НАСТОЯЩИЙ, А НЕ СОБРАННЫЙ ИЗ ТРЁХ ЯЧЕЕК
 *
 * Курганская ЛСР пересохраняется в BIFF8 — ровно то, что делает клиент со
 * старым Excel, — и разбирается тем же `parseLsr`, что и `.xlsx`. Набор на
 * выдуманной книге из трёх ячеек прошёл бы и на неверном читателе: у
 * настоящей сметы шапка в объединённых ячейках, подзаголовки колонок и
 * форматированные числа, и ломается именно на них.
 *
 * ЧТО ИМЕННО СВЕРЯЕТСЯ
 *
 * Не «позиций больше нуля», а РАВЕНСТВО разбора двух форматов: одна и та же
 * смета обязана дать одни и те же позиции и один и тот же итог. Иначе `.xls`
 * читался бы «как-нибудь» — а неверно прочитанная смета хуже непрочитанной:
 * она выглядит результатом.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import XLSX from "xlsx";
import { readFile } from "node:fs/promises";

import { parseLsr } from "@modules/documents/parsers/grand-smeta";
import { classifyDocument } from "@modules/workflow/classify-document";
import { ParserRegistry } from "@modules/documents/parser-registry";
import { describeDocument } from "@platform/execution/check-ports";
import { docxAdapter, pdfAdapter } from "@platform/storage/adapters";
import { detectFileFormat, parsableSheetFormats, readSheetOf } from "@platform/storage/sheet-reader";

const ИСТОЧНИК = "reference-system/input-1/РИМ Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx";

describe("смета в старом двоичном формате", () => {
  let каталог = "";
  let старая = "";

  beforeAll(async () => {
    каталог = await mkdtemp(join(tmpdir(), "xls-гейт-"));
    старая = join(каталог, "РИМ Курган СОТВ - ЛСР.xls");

    // Пересохранение настоящей сметы в BIFF8. Именно пересохранение, а не
    // сборка: содержимое остаётся тем, что прислал заказчик.
    const книга = XLSX.read(await readFile(ИСТОЧНИК), { type: "buffer" });
    await writeFile(старая, XLSX.write(книга, { type: "buffer", bookType: "biff8" }) as Buffer);
  });

  afterAll(async () => {
    await rm(каталог, { recursive: true, force: true });
  });

  it("опознаётся книгой по содержимому, а не по расширению", async () => {
    const detection = await detectFileFormat(старая);

    expect(detection.format).toBe("xls");
    expect(detection.supported).toBe(true);
    expect(parsableSheetFormats()).toContain("xls");
  });

  it("обход объекта считает её ЛОКАЛЬНОЙ СМЕТОЙ, а не рабочей документацией", async () => {
    const описание = await describeDocument(
      старая,
      "РИМ Курган СОТВ - ЛСР.xls",
      new ParserRegistry([pdfAdapter, docxAdapter]),
    );

    expect(описание.kind).toBe("лср");
    // Причины быть не должно: причина у разобранного файла означала бы, что он
    // принят и не прочитан.
    expect(описание.reason).toBeUndefined();
  });

  it("даёт те же позиции и тот же итог, что и .xlsx", async () => {
    const изНового = parseLsr(await readSheetOf(ИСТОЧНИК));
    const изСтарого = parseLsr(await readSheetOf(старая));

    const позиций = (документ: typeof изНового): number =>
      документ.sections.reduce((сумма, раздел) => сумма + раздел.positions.length, 0);

    expect(позиций(изСтарого)).toBe(позиций(изНового));
    expect(позиций(изСтарого)).toBeGreaterThan(0);
    expect(изСтарого.form).toBe(изНового.form);
    expect(изСтарого.sections.length).toBe(изНового.sections.length);
    expect(изСтарого.declaredTotal).toBe(изНового.declaredTotal);

    // Суммы позиций сходятся до копейки: §12.1б требует расхождения ровно 0 ₽,
    // и читатель, теряющий копейку на форматировании, этого не даст.
    expect(изСтарого.sections[0]?.positions.map((позиция) => позиция.total)).toEqual(
      изНового.sections[0]?.positions.map((позиция) => позиция.total),
    );
  });

  it("ССРСС в старом формате остаётся сводным расчётом, а не локальной сметой", () => {
    // Форму задаёт имя государственной формы, контейнер тут ни при чём. Ошибка
    // здесь дала бы сверку сводного расчёта с самим собой.
    expect(
      classifyDocument("Сводный сметный расчёт.xls", { supported: true, format: "xls" }, parsableSheetFormats()),
    ).toBe("ссрсс");
  });

  /**
   * ГРАНИЦУ §14 ДЕРЖИТ РЕЕСТР, А ОБХОД ЕЁ ТОЛЬКО ПЕРЕДАЁТ.
   *
   * До Д1б правило «PDF без текстового слоя — скан, распознавание вне объёма»
   * было записано ДВАЖДЫ: в `ParserRegistry` и внутри обхода. Две записи одного
   * правила расходятся молча, а сам реестр в продакшене не создавался ни разу.
   *
   * Проверяется здесь именно передача вердикта: правило порога живёт в
   * `pdf-reader.test.ts` на настоящих чертежах, а решение «что делает обход,
   * когда реестр сказал отказ» — тут.
   */
  it("скан помечается СКАНОМ и уходит на распознавание, а не в отказ", async () => {
    /**
     * ПРАВИЛО ИЗМЕНИЛОСЬ 6 сентября 2026, и этот набор менялся вместе с ним.
     *
     * Было: PDF без текстового слоя — отказ со ссылкой на §14 договора,
     * исключающий распознавание. Набор это и охранял.
     *
     * Стало (Т2.2б): распознавание — ключевое требование к системе, и его надо
     * выполнить, даже если распознаёт внешняя модель. Скан получает СВОЙ вид:
     * обход по нему знает, что файл надо отправить зрением, а не назвать
     * нечитаемым.
     *
     * Отдельный вид нужен и читателю отчёта: «скан, прочитан зрением» и «файл
     * не открывается» — разные исходы с разной ценой.
     */
    const скан = join(каталог, "смета-скан.pdf");
    await writeFile(скан, Buffer.from("%PDF-1.7\n%\xd0\xd4\xc5\xd8\n", "binary"));

    const реестр = new ParserRegistry([
      { format: "pdf", parse: () => ({ kind: "разобран", positions: 0, textLength: 0 }) },
    ]);

    const описание = await describeDocument(скан, "смета-скан.pdf", реестр);

    expect(описание.kind).toBe("скан");
    expect(описание.reason, "уровень доверия обязан быть назван сразу").toContain("ориентир");
    expect(описание.reason).not.toContain("§14");
  });

  it("рабочая документация с текстовым слоем остаётся документацией", async () => {
    // Настоящий курганский чертёжный комплект: три тысячи знаков на страницу.
    const описание = await describeDocument(
      "reference-system/input-1/КУРГАН ЭОМ 07.04.2025.pdf",
      "КУРГАН ЭОМ 07.04.2025.pdf",
      new ParserRegistry([pdfAdapter, docxAdapter]),
    );

    expect(описание.kind).toBe("рабочая-документация");
    expect(описание.reason).toBeUndefined();
  });

  it("читатель книг отказывается от файла, который книгой не является, НАЗЫВАЯ формат", async () => {
    // Раньше здесь выходила внутренняя ошибка распаковщика ZIP («Can't find
    // end of central directory»): она не называет настоящую причину — что
    // команду навели не на книгу.
    const непонятный = join(каталог, "чертёж.pdf");
    await writeFile(непонятный, Buffer.from("%PDF-1.7\n%\xd0\xd4\xc5\xd8\n", "binary"));

    await expect(readSheetOf(непонятный)).rejects.toThrow(/формат pdf/);
  });
});
