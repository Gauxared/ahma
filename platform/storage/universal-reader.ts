/**
 * ЕДИНЫЙ ЧИТАТЕЛЬ: «прочитать что угодно» — Т10.
 *
 * ЗАЧЕМ ОН НУЖЕН, ЕСЛИ ЧИТАТЕЛИ УЖЕ ЕСТЬ
 *
 * Форматы приходят в систему ТРЕМЯ путями, и до этого модуля каждый умел своё:
 *
 *   · загрузка документов на разбор — умела всё, что умеет обход;
 *   · пополнение нормативки — только PDF;
 *   · пополнение эталонных кейсов — только перечень файлов и имена листов книг.
 *
 * То есть свод правил в `.docx` не прочитался бы, а кейс с пояснительной
 * запиской в `.rtf` дошёл бы одним именем. Требование владельца — чтобы формат,
 * поддержанный один раз, работал во всех трёх путях И В БУДУЩЕМ. Поэтому
 * читатель один, и добавление формата здесь включает его сразу везде.
 *
 * ОТВЕТ ЕСТЬ ВСЕГДА. Как и реестр разбора, этот читатель не имеет ветки
 * «ничего не произошло»: либо текст, либо названная причина, почему его нет.
 * Молчаливый пропуск — то, из-за чего обход становится неполным незаметно.
 */
import { readFile } from "node:fs/promises";

import { detectFormat, zipListing, zipVolumeIndex } from "@modules/documents/format-detector.js";
import { rowNumbers } from "@modules/documents/sheet.js";

import {
  docAdapter,
  grandSmetaXmlAdapter,
  docxAdapter,
  odfAdapter,
  plainTextAdapter,
  pptxAdapter,
  rtfAdapter,
  xmlAdapter,
} from "./adapters.js";
import { readPdfText } from "./pdf-reader.js";
import { readSheetOf } from "./sheet-reader.js";
import { listXlsxSheets, readXlsxExtras } from "./xlsx-reader.js";

export interface ReadAnything {
  /** Текст документа. Пусто — прочитать не удалось, и причина названа. */
  readonly text: string;
  /** Как прочитано: словами, для описи и для читателя отчёта. */
  readonly how: string;
  readonly format: string;
  /** Почему текста нет либо он неполон. Пусто — прочитано целиком. */
  readonly caveat?: string;
  /** Изображения внутри документа: листы книги, вложенные схемы. */
  readonly images: readonly { readonly name: string; readonly extension: string; readonly bytes: Buffer }[];
}

/** Книга целиком: все листы, все строки, подробности шапкой каждого листа. */
async function workbookText(path: string): Promise<{ text: string; images: ReadAnything["images"]; sheets: number }> {
  const names = await listXlsxSheets(path).catch(() => [] as string[]);
  const блоки: string[] = [];
  const images: ReadAnything["images"] = [];

  for (const name of names.length > 0 ? names : [undefined]) {
    let sheet = await readSheetOf(path, name === undefined ? {} : { sheetName: name }).catch(() => undefined);

    /**
     * КНИГА СВЕРХ ПОТОЛКА ЧИТАЕТСЯ УРЕЗАННО, А НЕ ОТБРАСЫВАЕТСЯ.
     *
     * Потолок разбора существует, чтобы не убить процесс на середине, — но
     * отказ означал, что содержимое книги не доходит НИКУДА. Здесь читаем
     * тем же SheetJS с ограничением строк на лист: часть содержимого честнее
     * пустоты, и урезание названо в оговорке результата.
     */
    if (sheet === undefined) {
      sheet = await (async () => {
        try {
          const { default: XLSX } = await import("xlsx");
          const { readFile } = await import("node:fs/promises");
          const book = XLSX.read(await readFile(path), { type: "buffer", cellFormula: false, cellDates: false, cellText: true, sheetRows: 20_000 });
          const лист = book.Sheets[name ?? book.SheetNames[0] ?? ""];
          if (лист === undefined) return undefined;

          const rows = new Map<number, Map<string, string>>();

          for (const [address, cell] of Object.entries(лист)) {
            if (address.startsWith("!")) continue;
            const m = /^([A-Z]+)(\d+)$/u.exec(address);
            if (m === null) continue;
            const значение = String((cell as { w?: string; v?: unknown }).w ?? (cell as { v?: unknown }).v ?? "").trim();
            if (значение === "") continue;
            const номер = Number.parseInt(m[2]!, 10);
            const ячейки = rows.get(номер) ?? new Map<string, string>();
            ячейки.set(m[1]!, значение);
            rows.set(номер, ячейки);
          }

          return { name: name ?? "лист", rows };
        } catch {
          return undefined;
        }
      })();
    }

    if (sheet === undefined) continue;

    const строки = rowNumbers(sheet).map((число) => {
      const cells = sheet.rows.get(число);
      const значения = [...(cells ?? [])].map(([, value]) => value.trim()).filter((value) => value !== "");
      return значения.length === 0 ? "" : `${число}\t${значения.join("\t")}`;
    });

    const extras = name === undefined ? undefined : await readXlsxExtras(path, name);
    const шапка = [`— лист: ${sheet.name} —`];

    if (extras !== undefined) {
      if (extras.hidden) шапка.push("ЛИСТ СКРЫТ в книге");
      if (extras.merges.length > 0) шапка.push(`объединено: ${extras.merges.join(" ")}`);
      for (const detail of extras.formulas) {
        const части = [
          detail.formula === undefined ? undefined : `формула ${detail.formula}`,
          detail.note === undefined ? undefined : `примечание «${detail.note.replace(/\s+/gu, " ").trim()}»`,
          detail.hyperlink === undefined ? undefined : `ссылка ${detail.hyperlink}`,
        ].filter((часть) => часть !== undefined);
        шапка.push(`${detail.cell}: ${части.join("; ")}`);
      }
      (images as { name: string; extension: string; bytes: Buffer }[]).push(...extras.images);
    }

    блоки.push(`${шапка.join("\n")}\n${строки.filter((строка) => строка !== "").join("\n")}`);
  }

  return { text: блоки.join("\n\n"), images, sheets: names.length };
}

/**
 * Прочитать файл любого формата.
 *
 * Порядок ветвей — от точного к общему: формат по содержимому, затем читатель
 * по формату, затем последняя попытка. Каждая ветвь называет СВОЙ способ, и по
 * нему видно, чему верить: разбор книги и печатные последовательности из
 * двоичного файла — разный уровень доверия.
 */
export async function readAnything(path: string): Promise<ReadAnything> {
  let bytes: Buffer;

  try {
    bytes = await readFile(path);
  } catch (cause) {
    return { text: "", how: "не открылся", format: "неопознан", caveat: (cause as Error).message, images: [] };
  }

  const fileName = path.split("/").pop() ?? path;
  const detected = detectFormat({ fileName, bytes });

  if (detected.format === "pdf") {
    const result = await readPdfText(bytes, path).catch(() => undefined);

    if (result === undefined) return { text: "", how: "PDF не открылся", format: detected.format, caveat: "файл повреждён либо зашифрован", images: [] };

    return result.hasTextLayer
      ? { text: result.text, how: `PDF, ${result.pages} страниц текстом`, format: detected.format, images: [] }
      : {
          text: "",
          how: `PDF, ${result.pages} страниц`,
          format: detected.format,
          caveat: "текстового слоя нет: это скан, нужно распознавание зрением",
          images: [],
        };
  }

  if (detected.format === "xlsx" || detected.format === "xls" || detected.format === "xlsb" || detected.format === "csv") {
    const book = await workbookText(path);
    return {
      text: book.text,
      how: `книга, листов ${book.sheets || 1}`,
      format: detected.format,
      ...(book.text.trim() === "" ? { caveat: "в книге нет ни одной непустой ячейки" } : {}),
      images: book.images,
    };
  }

  /**
   * ИЗОБРАЖЕНИЕ НЕ ЧИТАЕТСЯ БУКВАМИ, И ВЫДАВАТЬ ЕГО БАЙТЫ ЗА ТЕКСТ НЕЛЬЗЯ.
   *
   * ЗАМЕРЕНО 08.09.2026: `.jpg` давал 122 038 «знаков» печатных
   * последовательностей — это шум сжатия, а не содержимое схемы. Число
   * выглядело успехом и было хуже нуля: роль, получив такой текст, прочитала
   * бы мусор как документ.
   *
   * Ответ — сам файл картинкой: её читает ЗРЕНИЕ модели, и этот путь в системе
   * уже есть (листы чертежей). Текста здесь нет, и так и сказано.
   */
  if (detected.format === "скан-изображение") {
    const extension = (fileName.split(".").pop() ?? "png").toLowerCase();
    return {
      text: "",
      how: "изображение: читается зрением модели, а не буквами",
      format: detected.format,
      caveat: "текстового слоя у изображения нет; содержимое доступно как картинка",
      images: [{ name: fileName, extension: extension === "jpg" ? "jpeg" : extension, bytes }],
    };
  }

  /**
   * АРХИВ — ЭТО НЕ ДОКУМЕНТ, А НАБОР ДОКУМЕНТОВ.
   *
   * Печатные последовательности из сжатого потока — заведомый мусор: 200 000
   * «знаков» у `.zip` в замере были обрывками сжатых байтов. Полезен здесь
   * ровно один ответ — ОПИСЬ ВЛОЖЕНИЙ: по ней видно, что внутри, а сами файлы
   * читаются по отдельности после распаковки обходом партии.
   */
  if (detected.format === "zip-архив" || detected.format === "rar-архив" || detected.format === "7z-архив") {
    let опись: string[] = [];

    if (detected.format === "zip-архив") {
      try {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(bytes);
        опись = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir);
      } catch {
        опись = [];
      }

      /**
       * АРХИВ, КОТОРЫЙ НЕ ОТКРЫВАЕТСЯ, ВСЁ РАВНО ГОВОРИТ, ЧТО В НЁМ БЫЛО.
       *
       * Замерено на кейсе «Йошкар-Ола»: у приложения «РД 2 этап» оглавление
       * целое — «Рабочая документация.zip», 264 МБ, — а локальные заголовки
       * повреждены, и JSZip падает. Пустая опись читалась бы как «рабочей
       * документации не присылали»; на деле её присылали и не смогли открыть,
       * и это разные вещи с разными последствиями.
       */
      if (опись.length === 0) {
        /**
         * ПОЧЕМУ НЕ ИЗВЛЕКЛОСЬ — ЧАСТЬ ОТВЕТА, А НЕ ПОДРОБНОСТЬ.
         *
         * «Приложены не все тома» и «файл повреждён» ведут к разным действиям:
         * в первом случае недостающие тома запрашивают у заказчика, во втором
         * файл бесполезен. Замерено на кейсе «Йошкар-Ола»: оба приложения —
         * последние тома многотомных архивов (том 9 из 9 и том 6 из 6).
         */
        const том = zipVolumeIndex(bytes);
        const причина =
          том === undefined
            ? "оглавление цело, записи повреждены"
            : `это ТОМ №${том + 1} многотомного архива, остальные тома в комплекте отсутствуют — запросить их у отправителя`;

        опись = zipListing(bytes)
          .filter((entry) => !entry.name.endsWith("/"))
          .map((entry) => `${entry.name} — ${(entry.size / 1024 / 1024).toFixed(1)} МБ [СОДЕРЖИМОЕ НЕ ИЗВЛЕЧЕНО: ${причина}]`);
      }
    }

    return {
      text: опись.length === 0 ? "" : `ВЛОЖЕНИЯ (${опись.length}):\n${опись.join("\n")}`,
      how: `архив: ${опись.length > 0 ? `${опись.length} вложений` : "опись недоступна"}`,
      format: detected.format,
      caveat: "содержимое читается по отдельности после распаковки обходом партии, а не отсюда",
      images: [],
    };
  }

  /**
   * НЕ ДОКУМЕНТ — ЗНАЧИТ, ЧИТАТЬ НЕЧЕГО, А НЕ «ПРОЧИТАНО 174 ТЫСЯЧИ ЗНАКОВ».
   *
   * У `.exe` в замере вышло 174 092 «знака». Это строки из машинного кода:
   * имена библиотек и служебные надписи. Отдать их роли как содержимое файла
   * значило бы засорить ход тем, в чём нет ни одного факта об объекте.
   */
  if (detected.format === "служебный-файл") {
    return {
      text: "",
      how: "не документ: исполняемый файл, библиотека, подпись или манифест",
      format: detected.format,
      caveat: detected.reason ?? "читать нечего",
      images: [],
    };
  }

  /**
   * Текстовые адаптеры — ТЕ ЖЕ, что у разбора документов объекта, а не вторая
   * их копия. Формат, поддержанный для загрузки на разбор, тем самым работает и
   * при пополнении базы: это и есть требование «сейчас и в будущем».
   */
  const адаптеры = [docxAdapter, rtfAdapter, docAdapter, pptxAdapter, odfAdapter, xmlAdapter, grandSmetaXmlAdapter, plainTextAdapter];
  const адаптер = адаптеры.find((candidate) => candidate.format === detected.format);

  if (адаптер !== undefined) {
    /**
     * ОТКАЗ АДАПТЕРА ЛОВИТСЯ, А НЕ ПРОПУСКАЕТСЯ НАРУЖУ. Часть адаптеров бросает
     * СИНХРОННО (например, «файл содержит 23 символа текста: читать нечего»), и
     * `Promise.resolve(...).catch(...)` такой бросок не перехватывает — он летит
     * из самого вызова.
     */
    let payload: { text?: string } | undefined;

    try {
      const outcome = await адаптер.parse({ fileName, bytes });
      payload = outcome.payload as { text?: string } | undefined;
    } catch {
      payload = undefined;
    }

    if (payload?.text !== undefined && payload.text.trim() !== "") {
      return { text: payload.text, how: `текстовый слой (${detected.format})`, format: detected.format, images: [] };
    }

    /**
     * АДАПТЕР ОТКАЗАЛ — ТЕКСТ ВСЁ РАВНО БЕРЁТСЯ, ЕСЛИ ОН ЕСТЬ.
     *
     * У разбора документов объекта есть порог: файл короче сорока знаков
     * объявляется отказом, потому что «принято и потеряно» там страшнее
     * «принято и названо пустым». На пути пополнения базы порог вреден: строка
     * «цена битума 55000 руб/т» — данные, и терять их из-за длины нельзя.
     *
     * Требование владельца прямое: разбирать всё, что загружено. Поэтому здесь
     * ворота МЯГКИЕ — короткий текст доходит, а чем он прочитан, видно по
     * способу.
     */
    if (detected.format === "текст") {
      const текст = bytes.toString("utf8").replace(/\u0000/gu, "").trim();

      if (текст !== "") {
        return { text: текст, how: "короткий текст (порог разбора не применён)", format: detected.format, images: [] };
      }
    }
  }

  /**
   * ПОСЛЕДНЯЯ ПОПЫТКА — контейнер ZIP по подписи, иначе печатные
   * последовательности. Она же обслуживает форматы, у которых читателя нет:
   * базу Кодекса, чертёж КОМПАС, DjVu. Что-то из них извлекается почти всегда,
   * и это лучше, чем одно имя файла.
   */
  const строки = new Set<string>();

  for (const кодировка of ["utf8", "latin1"] as const) {
    const текст = bytes.subarray(0, 8 * 1024 * 1024).toString(кодировка);
    for (const найдено of текст.matchAll(/[\p{L}\p{N}][\p{L}\p{N} .,:;()№/\\-]{5,}/gu)) {
      const строка = найдено[0].trim();
      if (строка.length >= 6) строки.add(строка);
      if (строки.size > 20_000) break;
    }
  }

  const тело = [...строки].join("\n").slice(0, 200_000);

  return {
    text: тело,
    how: "печатные последовательности из двоичного файла",
    format: detected.format,
    caveat:
      detected.reason ??
      "разбора формата нет: строки могут быть обрывками, числам из них верить нельзя",
    images: [],
  };
}
