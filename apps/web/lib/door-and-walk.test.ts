/**
 * ДВЕРЬ И ОБХОД ОБЯЗАНЫ ДОГОВОРИТЬСЯ.
 *
 * Замер показал щель, которая опаснее любого отказа: `.xls` принимался дверью
 * загрузки, попадал в папку объекта, считался в числе документов — и молча
 * становился «рабочей документацией», то есть не сметой. Сто смет в старом
 * формате давали бы «документов 100, позиций 0» и вердикт по пустому обходу.
 *
 * Отказ на двери — честен. Разбор — честен. «Принято и названо неразобранным» —
 * честно. Запрещено четвёртое: принято и молча переложено в другую категорию.
 *
 * Этот набор — единственное место, где две стороны сверяются между собой.
 * Поодиночке каждая проходит свои проверки: белый список расширений
 * содержателен, классификатор содержателен, а щель живёт РОВНО МЕЖДУ НИМИ.
 *
 * ПОСЛЕ Д1б СВЕРКА ИДЁТ ПО ФОРМАТАМ, А НЕ ПО РАСШИРЕНИЯМ
 *
 * Классификатор больше не смотрит на имя, чтобы решить «книга ли это»: книгу
 * узнаёт содержимое, а список читаемых книг приходит из реестра читателей.
 * Поэтому здесь объявлена таблица «расширение → формат, который даст
 * определитель». Что определитель даёт именно это, проверяет
 * `modules/documents/format-detector.test.ts` на настоящих подписях файлов;
 * здесь проверяется договорённость, а не определение.
 */
import { describe, expect, it } from "vitest";

import { awaitingParser, classifyDocument } from "@modules/workflow/classify-document";
import { parsableSheetFormats } from "@platform/storage/sheet-reader";

import { ACCEPTED } from "./uploads.js";

/**
 * Что определитель формата скажет о настоящем файле с таким расширением.
 *
 * `supported: false` означает «формат опознан и разбору не подлежит» — у таких
 * причина приходит от самого определителя, а не от отсутствия адаптера.
 */
const ОЖИДАЕМЫЙ_ФОРМАТ: Readonly<Record<string, { format: string; supported: boolean }>> = {
  ".xlsx": { format: "xlsx", supported: true },
  ".xls": { format: "xls", supported: true },
  ".pdf": { format: "pdf", supported: true },
  ".docx": { format: "docx", supported: true },
  ".xml": { format: "grand-smeta-xml", supported: true },
  /**
   * Таблица с разделителем читается КНИГОЙ, а не отдаётся агенту прозой:
   * §8.1 требует принимать CSV как источник сметных данных.
   */
  ".csv": { format: "csv", supported: true },
  /**
   * `.txt` определяется по СОДЕРЖИМОМУ и потому двоится: таблица с
   * разделителем под этим именем станет `csv`, проза — `текст`. Здесь объявлен
   * второй случай, потому что именно он у `.txt` обычен, а первый уже покрыт
   * строкой `.csv` — расширение на выбор формата не влияет.
   */
  ".txt": { format: "текст", supported: true },
  // Любой вход (А11): форматы заказчика, которые дверь раньше отвергала.
  ".doc": { format: "doc", supported: true },
  ".rtf": { format: "rtf", supported: true },
  ".pptx": { format: "pptx", supported: true },
  ".odt": { format: "odf", supported: true },
  ".ods": { format: "odf", supported: true },
  ".odp": { format: "odf", supported: true },
  // Изображения определитель называет сканом: обход читает их зрением
  // (`describeDocument` перехватывает до классификатора), классификатору же
  // они — «не разобран» с причиной, и это второй честный ответ.
  ".png": { format: "скан-изображение", supported: false },
  ".jpg": { format: "скан-изображение", supported: false },
  ".jpeg": { format: "скан-изображение", supported: false },
  ".tif": { format: "скан-изображение", supported: false },
  ".tiff": { format: "скан-изображение", supported: false },
  ".bmp": { format: "скан-изображение", supported: false },
};

/**
 * Формат, который документ по своей природе, а не смета.
 *
 * `текст` здесь потому, что пояснительная записка — документ: позиций от неё
 * никто не ждёт, а прочитать её агенту полезно.
 */
const DOCUMENTATION = new Set(["pdf", "docx", "текст", "doc", "rtf", "pptx", "odf"]);

describe("дверь загрузки и обход папки", () => {
  const parsable = parsableSheetFormats();

  it("у каждого принятого дверью формата есть либо разбор, либо названная причина", () => {
    for (const extension of ACCEPTED) {
      const ожидание = ОЖИДАЕМЫЙ_ФОРМАТ[extension];

      // Расширение принято дверью и не описано здесь — это и есть щель: никто
      // не знает, чем оно станет внутри.
      expect(ожидание, `${extension} принят дверью, а чем он станет внутри — не объявлено`).toBeDefined();
      if (ожидание === undefined) continue;

      const detection = { supported: ожидание.supported, format: ожидание.format };
      const kind = classifyDocument(`смета${extension}`, detection, parsable);
      const reason = awaitingParser(ожидание.format, parsable as readonly string[]);

      if ((parsable as readonly string[]).includes(ожидание.format)) {
        expect(kind, `${extension} принят дверью, но обход не считает его сметой`).toBe("лср");
        expect(reason, `${extension} разбирается — причина «нет адаптера» ему не нужна`).toBeUndefined();
        continue;
      }

      if (DOCUMENTATION.has(ожидание.format)) {
        expect(kind, `${extension} — документ, а не смета`).toBe("рабочая-документация");
        continue;
      }

      // Всё остальное: принято дверью, разбора нет — значит обязано быть
      // названо неразобранным С ПРИЧИНОЙ. Именно здесь `.xls` и проваливался
      // в «рабочую документацию» молча.
      expect(kind, `${extension} принят дверью и молча ушёл в «${kind}» вместо «не-разобран»`).toBe(
        "не-разобран",
      );

      const причина = ожидание.supported ? reason : "формат опознан и разбору не подлежит";
      expect(причина, `${extension} назван неразобранным без причины`).toBeTypeOf("string");
      expect((причина ?? "").length, `причина по ${extension} пуста`).toBeGreaterThan(10);
    }
  });

  it("старый двоичный Excel теперь РАЗБИРАЕТСЯ, а не ждёт адаптера", () => {
    // Веха Д1б. Проверка отдельная, потому что это смена поведения: до неё
    // `.xls` был «принято и названо неразобранным» — честно и бесполезно.
    expect(parsable as readonly string[]).toContain("xls");
    expect(classifyDocument("смета.xls", { supported: true, format: "xls" }, parsable)).toBe("лср");
    expect(awaitingParser("xls", parsable)).toBeUndefined();
  });

  it("выгрузка XML принята, названа неразобранной и НЕ обещает написанного парсера", () => {
    // Здесь стояло «адаптер ГРАНД-Сметы написан, но не подключён» — а его не
    // существовало вовсе. Утверждение переехало в план демо и прожило там
    // неделю. Причина теперь называет то, что есть: разбора нет.
    const причина = awaitingParser("grand-smeta-xml", parsable);

    expect(classifyDocument("смета.xml", { supported: true, format: "grand-smeta-xml" }, parsable)).toBe(
      "не-разобран",
    );
    expect(причина).toContain("разбора у него нет");
    expect(причина).not.toContain("написан");
  });

  it("формат без чтения не объявлен читаемым, а попав внутрь — назван неразобранным", () => {
    // Дверь с А11 принимает любой файл; перечень ACCEPTED — это то, что
    // система ЧИТАЕТ. Чертёж и исполняемый файл в него не входят: обещать их
    // чтение нечем.
    for (const extension of [".dwg", ".rvt", ".exe"]) {
      expect((ACCEPTED as readonly string[]).includes(extension)).toBe(false);
    }
    // Чертёж внутрь не попадает, а попав — он документ, а не смета: позиций от
    // него никто не ждёт.
    expect(classifyDocument("план.dwg", { supported: false, format: "dwg" }, parsable)).toBe("не-разобран");
  });

  it("ССРСС по имени опознаётся раньше, чем ЛСР", () => {
    // Проверка стоит здесь, потому что порядок ветвей в классификаторе я уже
    // однажды менял: новая ветка «нет адаптера» встала ПЕРЕД проверкой книги,
    // и её место надо сторожить.
    expect(
      classifyDocument("Сводный сметный расчёт.xlsx", { supported: true, format: "xlsx" }, parsable),
    ).toBe("ссрсс");
    expect(classifyDocument("ЛСР-05.xlsx", { supported: true, format: "xlsx" }, parsable)).toBe("лср");
    // И то же для старого формата: форма узнаётся по имени независимо от
    // контейнера, иначе ССРСС в `.xls` стал бы локальной сметой.
    expect(
      classifyDocument("Сводный сметный расчёт.xls", { supported: true, format: "xls" }, parsable),
    ).toBe("ссрсс");
  });

  it("нечитаемое содержимое перекрывает расширение", () => {
    // Книга, которую не открыть, не станет сметой оттого, что названа сметой,
    // и не станет «ждущей адаптера» оттого, что у неё расширение `.xls`.
    expect(classifyDocument("смета.xlsx", { supported: false, reason: "битые байты" }, parsable)).toBe(
      "не-разобран",
    );
    expect(classifyDocument("смета.xls", { supported: false, reason: "битые байты" }, parsable)).toBe(
      "не-разобран",
    );
  });
});
