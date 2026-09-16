/**
 * Адаптеры разбора для `ParserRegistry` — роадмап M4.
 *
 * Реестр живёт в доменном модуле и знает только о ФОРМЕ выхода. Сами адаптеры
 * собираются здесь, потому что каждому нужна своя библиотека, а домен-модуль о
 * библиотеках не знает (ADR-R-025).
 *
 * РАЗНЫЕ ФОРМАТЫ ДАЮТ РАЗНОЕ, И ЭТО НЕ СГЛАЖИВАЕТСЯ
 *
 * Смета даёт ПОЗИЦИИ. Договор и рабочая документация дают ТЕКСТ. Притвориться,
 * что docx возвращает ноль позиций, значило бы поставить его в один ряд с
 * пустой сметой — исход, неотличимый от находки «в смете ничего нет».
 * Поэтому у текстовых адаптеров позиций именно ноль, а полезная нагрузка —
 * текст, и вызывающий обязан спросить у результата, что он получил.
 */
import { decodeText } from "@modules/documents/csv.js";
import type { AdapterOutcome, ParserAdapter } from "@modules/documents/parser-registry.js";

import JSZip from "jszip";

import { readDocxText } from "./docx-reader.js";
import { readPdfText } from "./pdf-reader.js";

/** Что вернул текстовый адаптер: текст документа для чтения агентами. */
export interface TextPayload {
  readonly kind: "текст";
  readonly text: string;
  readonly source: "docx" | "pdf" | "txt" | "xml" | "rtf" | "doc" | "pptx" | "odf";
  /**
   * Страниц в источнике. Нужна сжатию текста РД: колонтитул отличается от
   * содержания тем, что повторяется на доле СТРАНИЦ, а не просто часто.
   *
   * У Word страница — понятие вёрстки, а не файла, и честнее объявить одну,
   * чем вычислять правдоподобную.
   */
  readonly pages: number;
}

export const docxAdapter: ParserAdapter = {
  format: "docx",
  async parse(input): Promise<AdapterOutcome> {
    const read = await readDocxText(input.bytes);

    // Пустой docx — не ошибка чтения, но и не прочитанный документ. Отдать его
    // как разобранный значило бы сказать «в договоре ничего нет».
    if (!read.hasText) {
      throw new Error("документ Word не содержит текста: читать нечего");
    }

    return {
      kind: "разобран",
      positions: 0,
      textLength: read.text.length,
      payload: { kind: "текст", text: read.text, source: "docx", pages: 1 } satisfies TextPayload,
    };
  },
};

/**
 * Сколько текста считаем документом.
 *
 * Файл в десяток символов — не пояснительная записка, а обрывок; отдав его
 * агенту, мы добавили бы в запрос шум и заплатили бы за него токенами.
 */
const TEXT_MIN = 40;

/** Общая часть простого текста: читаем байты как текст и объявляем страницы. */
function textOutcome(bytes: Buffer, source: "txt" | "xml"): AdapterOutcome {
  const text = decodeText(bytes);

  if (text.trim().length < TEXT_MIN) {
    throw new Error(`файл содержит ${text.trim().length} символов текста: читать нечего`);
  }

  return {
    kind: "разобран",
    positions: 0,
    textLength: text.length,
    // Страница у простого текста одна: делить его на страницы — значит
    // назвать координату, которой в файле нет. Сжатие текста РД от этого не
    // страдает, оно ищет повторы на ДОЛЕ страниц, а при одной странице
    // повторов не находит и оставляет текст как есть.
    payload: { kind: "текст", text, source, pages: 1 } satisfies TextPayload,
  };
}

/**
 * Простой текст (`.txt`) — §8.1 требует принимать его первой волной.
 *
 * ПОЗИЦИЙ ЗДЕСЬ НОЛЬ, И ЭТО НЕ ОТГОВОРКА. Пояснительная записка, письмо
 * заказчика, перечень замечаний — это проза, и позиции из неё извлекала бы
 * модель, а не разбор: у чисел не было бы координаты, а §12.1д требует
 * обратного. Таблица с разделителем сюда не попадает — определитель формата
 * отправляет её в `csv`, где она читается книгой.
 */
export const plainTextAdapter: ParserAdapter = {
  format: "текст",
  parse(input): AdapterOutcome {
    return textOutcome(input.bytes, "txt");
  },
};

/**
 * XML неизвестной схемы.
 *
 * РАЗБОРА В ПОЗИЦИИ ЗДЕСЬ НЕТ И НЕ БУДЕТ, ПОКА НЕТ ОБРАЗЦА. Схема выгрузки
 * ГРАНД-Сметы в контуре отсутствует, и парсер, написанный по догадке, давал бы
 * не отказ, а правдоподобные числа без основания — худший из исходов.
 *
 * Но отдать содержимое агенту можно честно: это не разбор, а чтение. Агент
 * видит XML как текст, называет то, что в нём написано, и не притворяется, что
 * позиции посчитаны, — в отчёте документ остаётся с прежним статусом.
 */
export const xmlAdapter: ParserAdapter = {
  format: "xml",
  parse(input): AdapterOutcome {
    return textOutcome(input.bytes, "xml");
  },
};

/**
 * Выгрузка ГРАНД-Сметы: тот же текст, но статус документа другой.
 *
 * Отличие от `xmlAdapter` не в чтении, а в том, ЧЕГО ОТ ФАЙЛА ЖДУТ. Это
 * опознанная смета, которую мы не разложили в позиции, и в отчёте она обязана
 * остаться «не разобранной» с причиной, чтобы никто не счёл её итоги учтёнными
 * (`ПРЕТЕНДУЮТ_НА_КНИГУ` в классификаторе). Текст при этом доходит до агентов —
 * прочитать смету глазами лучше, чем не прочитать вовсе.
 */
export const grandSmetaXmlAdapter: ParserAdapter = {
  format: "grand-smeta-xml",
  parse(input): AdapterOutcome {
    return textOutcome(input.bytes, "xml");
  },
};

export const pdfAdapter: ParserAdapter = {
  format: "pdf",
  async parse(input): Promise<AdapterOutcome> {
    const read = await readPdfText(input.bytes);

    // Текстового слоя нет — реестр превратит это в отказ со ссылкой на §14.
    // Бросать здесь исключение нельзя: отказ по §14 — это ГРАНИЦА ОБЪЁМА, а
    // исключение читалось бы как поломка разбора.
    return {
      kind: "разобран",
      positions: 0,
      textLength: read.hasTextLayer ? read.text.length : 0,
      payload: { kind: "текст", text: read.text, source: "pdf", pages: read.pages } satisfies TextPayload,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ЛЮБОЙ ВХОД (spec-demo-stage-1 А11): форматы, в которых заказчик присылает
// документы и которые до 07.09.2026 отвергались на двери. Каждый читается
// текстом — приближённо там, где точного разбора нет, и приближение названо в
// самом тексте, чтобы роль не приняла его за разбор.
// ─────────────────────────────────────────────────────────────────────────────

/** Управляющие группы RTF, чьё содержимое не текст документа. */
const RTF_SKIP_GROUPS =
  /^\\(?:\*|fonttbl|colortbl|stylesheet|info|pict|header[lrf]?|footer[lrf]?|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|themedata|colorschememapping|datastore|latentstyles|mmathPr|filetbl|revtbl|nonshppict|shppict|object)/;

/**
 * RTF → текст. Группы служебных таблиц выбрасываются, `\'hh` декодируется
 * кодовой страницей из `\ansicpg` (по умолчанию 1251 — русский Word), `\uN`
 * даёт символ напрямую, `\par`/`\line`/`\cell` становятся переносами.
 */
export function rtfToText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const codepage = /\\ansicpg(\d+)/.exec(raw)?.[1] ?? "1251";
  let decoder: TextDecoder;

  try {
    decoder = new TextDecoder(`windows-${codepage}`);
  } catch {
    decoder = new TextDecoder("windows-1251");
  }

  const parts: string[] = [];
  let pending: number[] = [];
  const flush = (): void => {
    if (pending.length > 0) {
      parts.push(decoder.decode(Uint8Array.from(pending)));
      pending = [];
    }
  };

  const skip: boolean[] = [];
  const skipping = (): boolean => skip[skip.length - 1] === true;
  let unicodeSkip = 1;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i]!;

    if (ch === "{") {
      skip.push(skipping() || RTF_SKIP_GROUPS.test(raw.slice(i + 1, i + 24)));
      i += 1;
      continue;
    }

    if (ch === "}") {
      skip.pop();
      i += 1;
      continue;
    }

    if (ch === "\\") {
      const next = raw[i + 1] ?? "";

      if (next === "'") {
        const byte = Number.parseInt(raw.slice(i + 2, i + 4), 16);
        if (!skipping() && Number.isFinite(byte)) pending.push(byte);
        i += 4;
        continue;
      }

      if (!/[a-zA-Z]/.test(next)) {
        // `\{`, `\}`, `\\` — сами знаки; `\~` — неразрывный пробел; `\-`, `\_` — переносы.
        if (!skipping()) {
          if (next === "{" || next === "}" || next === "\\") pending.push(next.charCodeAt(0));
          else if (next === "~") pending.push(0x20);
          else if (next === "\n" || next === "\r") pending.push(0x0a);
        }
        i += 2;
        continue;
      }

      const match = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i, i + 40));
      if (match === null) {
        i += 1;
        continue;
      }

      const word = match[1]!;
      const param = match[2] === undefined ? undefined : Number.parseInt(match[2], 10);
      i += match[0].length;

      if (skipping()) {
        if (word === "bin" && param !== undefined && param > 0) i += param;
        continue;
      }

      if (word === "par" || word === "line" || word === "row" || word === "sect" || word === "page") {
        pending.push(0x0a);
      } else if (word === "tab" || word === "cell") {
        pending.push(0x09);
      } else if (word === "uc" && param !== undefined) {
        unicodeSkip = param;
      } else if (word === "u" && param !== undefined) {
        flush();
        parts.push(String.fromCodePoint(param < 0 ? param + 65536 : param));
        // После `\uN` идёт запасной символ для старых читателей — он пропускается.
        let left = unicodeSkip;
        while (left > 0 && i < raw.length) {
          if (raw[i] === "\\" && raw[i + 1] === "'") i += 4;
          else if (raw[i] === "\\") break;
          else i += 1;
          left -= 1;
        }
      } else if (word === "bin" && param !== undefined && param > 0) {
        i += param;
      }
      continue;
    }

    if (!skipping() && ch !== "\r" && ch !== "\n") pending.push(ch.charCodeAt(0));
    i += 1;
  }

  if (pending.length > 0) flush();
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const rtfAdapter: ParserAdapter = {
  format: "rtf",
  parse(input): AdapterOutcome {
    const text = rtfToText(input.bytes);

    if (text.trim().length < TEXT_MIN) {
      throw new Error(`RTF содержит ${text.trim().length} символов текста: читать нечего`);
    }

    return {
      kind: "разобран",
      positions: 0,
      textLength: text.length,
      payload: { kind: "текст", text, source: "rtf", pages: 1 } satisfies TextPayload,
    };
  },
};

const DOC_NOTE =
  "[ПРИБЛИЖЕНИЕ: текст извлечён из двоичного .doc без разбора структуры документа — порядок фрагментов может отличаться от печатного, таблицы даны построчно]";

const printable16 = (code: number): boolean =>
  code === 0x09 ||
  code === 0x0a ||
  code === 0x0d ||
  (code >= 0x20 && code < 0x7f) ||
  code === 0xa0 ||
  code === 0xab ||
  code === 0xbb ||
  code === 0xb0 ||
  code === 0xb7 ||
  (code >= 0x400 && code <= 0x45f) ||
  (code >= 0x2010 && code <= 0x2026) ||
  code === 0x2116 ||
  code === 0x20bd;

/**
 * Word 97–2003 → текст без разбора структуры файла.
 *
 * Текст документа лежит в потоке `WordDocument` либо однобайтовой кодовой
 * страницей, либо UTF-16LE — какой именно, файл решает сам. Здесь берутся
 * длинные последовательности печатных знаков в обоих прочтениях, и остаётся то
 * прочтение, которое дало больше текста. Это приближение, и оно названо в
 * первой строке результата.
 */
export function docToText(bytes: Buffer): string {
  const runs16: string[] = [];
  let current: number[] = [];

  const flush16 = (): void => {
    if (current.length >= 24) runs16.push(String.fromCharCode(...current).trim());
    current = [];
  };

  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i]! | (bytes[i + 1]! << 8);
    if (printable16(code)) current.push(code);
    else flush16();
  }
  if (current.length > 0) flush16();

  const decoded = new TextDecoder("windows-1251").decode(bytes);
  const runs8 = decoded
    .split(/[^\p{L}\p{N}\p{P}\p{Zs}\t\n\r№₽°·«»]+/u)
    .map((run) => run.trim())
    .filter((run) => run.length >= 40 && /[а-яА-ЯёЁa-zA-Z]{3}/.test(run));

  const wins16 = runs16.join("").length >= runs8.join("").length;
  const lines = (wins16 ? runs16 : runs8).filter((line, index, all) => line !== "" && all.indexOf(line) === index);

  return lines.length === 0 ? "" : `${DOC_NOTE}\n\n${lines.join("\n")}`;
}

export const docAdapter: ParserAdapter = {
  format: "doc",
  parse(input): AdapterOutcome {
    const text = docToText(input.bytes);

    if (text.length <= DOC_NOTE.length + TEXT_MIN) {
      throw new Error("документ Word 97–2003 не дал читаемого текста: возможно, только изображения или шифрование");
    }

    return {
      kind: "разобран",
      positions: 0,
      textLength: text.length,
      payload: { kind: "текст", text, source: "doc", pages: 1 } satisfies TextPayload,
    };
  },
};

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

/**
 * Снимает разметку XML, сохраняя строки: абзац — перенос, ячейка — табуляция,
 * строка таблицы — перенос. Абзац внутри ячейки не рвёт строку таблицы.
 */
function xmlToLines(xml: string, paragraphEnd: RegExp, cellEnd: RegExp, rowEnd: RegExp): string {
  return xml
    .replace(rowEnd, "\u0001")
    .replace(cellEnd, "\t")
    .replace(paragraphEnd, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\n+\t/g, "\t")
    .replace(/\t+\u0001/g, "\n")
    .replace(/\u0001/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Презентация PowerPoint: текст слайдов по порядку, слайд — заголовком. */
export const pptxAdapter: ParserAdapter = {
  format: "pptx",
  async parse(input): Promise<AdapterOutcome> {
    const zip = await JSZip.loadAsync(input.bytes);
    const slides = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number.parseInt(/\d+/.exec(a.slice(11))![0], 10) - Number.parseInt(/\d+/.exec(b.slice(11))![0], 10));

    const parts: string[] = [];

    for (const [index, name] of slides.entries()) {
      const xml = await zip.file(name)!.async("string");
      const text = xmlToLines(xml, /<\/a:p>/g, /<\/a:tc>/g, /<\/a:tr>/g);
      if (text !== "") parts.push(`— слайд ${index + 1} —\n${text}`);
    }

    const text = parts.join("\n\n");

    if (text.trim().length < TEXT_MIN) {
      throw new Error("презентация не содержит текста: читать нечего");
    }

    return {
      kind: "разобран",
      positions: 0,
      textLength: text.length,
      payload: { kind: "текст", text, source: "pptx", pages: Math.max(1, slides.length) } satisfies TextPayload,
    };
  },
};

/** OpenDocument (odt, ods, odp): текст `content.xml` с абзацами и ячейками. */
export const odfAdapter: ParserAdapter = {
  format: "odf",
  async parse(input): Promise<AdapterOutcome> {
    const zip = await JSZip.loadAsync(input.bytes);
    const content = zip.file("content.xml");

    if (content === null) throw new Error("в документе OpenDocument нет content.xml: читать нечего");

    const xml = (await content.async("string")).replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n");
    const text = xmlToLines(xml, /<\/text:(?:p|h)>/g, /<\/table:table-cell>/g, /<\/table:table-row>/g);

    if (text.trim().length < TEXT_MIN) {
      throw new Error("документ OpenDocument не содержит текста: читать нечего");
    }

    return {
      kind: "разобран",
      positions: 0,
      textLength: text.length,
      payload: { kind: "текст", text, source: "odf", pages: 1 } satisfies TextPayload,
    };
  },
};
