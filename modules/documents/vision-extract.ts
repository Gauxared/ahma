/**
 * РАСПОЗНАВАНИЕ ЗРЕНИЕМ — сканы (Т2.2б) и таблицы из PDF (Т2.2а).
 *
 * ПОЧЕМУ ЭТО ПОЯВИЛОСЬ ПОЗДНО И ПОЧЕМУ ПОЯВИЛОСЬ
 *
 * Оба требования долго стояли в документе как «чего нет»: сканы — со ссылкой на
 * §14 договора, исключающий распознавание; таблицы — как «требует решения
 * владельца». Владелец 6 сентября 2026 снял оба: это ключевые требования к
 * системе, и их надо выполнить, даже если распознаёт внешняя модель.
 *
 * Формулировка «требует решения владельца» была к тому же неточной по сути:
 * решения не требовалось, требовалась работа. Отдельно стоит признать, что
 * прежняя оценка «таблицы из PDF не выходят» делалась ТОЛЬКО по текстовому
 * слою — и там она верна: `getTable` на курганской подшивке вернул 214 «таблиц»,
 * и все 214 оказались рамками листа. Но со зрением путь другой, и его не
 * попробовали.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО МОДУЛЯ: УРОВЕНЬ ДОВЕРИЯ НЕ ПОДМЕНЯЕТСЯ
 *
 * Разобранное из файла — «факт»: у него есть лист и строка, его можно открыть и
 * показать пальцем. Прочитанное с изображения — «ориентир»: у него есть номер
 * страницы и не больше. Смешать их значило бы обесценить след, на котором стоит
 * вся система (§12.1д).
 *
 * Поэтому смета, которую можно разобрать по форме 421/пр, разбирается ею, а не
 * читается зрением. Зрение — для того, чего иначе не прочесть вовсе.
 */

/** Уровень доверия к прочитанному. Совпадает с тем, что показывает экран. */
export type VisionTrust = "ориентир";

/** Строка таблицы, прочитанная с изображения страницы. */
export interface VisionRow {
  readonly ordinal: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity: string;
  readonly amount: string;
}

export interface VisionPage {
  /** Номер страницы в исходном документе — единственная координата зрения. */
  readonly page: number;
  /** Сплошной текст страницы, если это не таблица. */
  readonly text: string;
  /** Строки таблицы, если модель её распознала. */
  readonly rows: readonly VisionRow[];
  /** Что модель сказала о самой странице: «спецификация», «чертёж», «пусто». */
  readonly kind: string;
}

export interface VisionExtraction {
  readonly document: string;
  readonly pages: readonly VisionPage[];
  readonly trust: VisionTrust;
  /** Сколько страниц не удалось прочитать и почему — не молчим о пропусках. */
  readonly skipped: readonly { readonly page: number; readonly reason: string }[];
}

/**
 * Строгая схема ответа: то же правило, что у агентов.
 *
 * В строгом структурированном выводе НЕТ необязательных полей — каждое свойство
 * обязано быть в `required`. Проверено боем: провайдер отвергает схему, где это
 * не так, и отвергает целиком, а не по полю.
 */
export const VISION_PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text", "rows"],
  properties: {
    kind: {
      type: "string",
      description: "что на странице: спецификация, ведомость, чертёж, текст, пусто",
    },
    text: {
      type: "string",
      description: "сплошной текст страницы; пустая строка, если страница только таблица",
    },
    rows: {
      type: "array",
      description: "строки таблицы, если она есть; пустой массив, если таблицы нет",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ordinal", "code", "name", "unit", "quantity", "amount"],
        properties: {
          ordinal: { type: "string" },
          code: { type: "string", description: "шифр расценки или артикул; пустая строка, если нет" },
          name: { type: "string" },
          unit: { type: "string" },
          quantity: { type: "string" },
          amount: { type: "string", description: "сумма; пустая строка, если в таблице её нет" },
        },
      },
    },
  },
} as const;

/**
 * Промпт распознавания.
 *
 * Требование «не додумывай» здесь не вежливость, а условие пригодности: модель,
 * дописавшая правдоподобный шифр за нечитаемый, выдаёт данные, которые
 * невозможно отличить от прочитанных. Пустая ячейка полезнее выдуманной.
 */
export const VISION_PROMPT = [
  "Перед тобой ИЗОБРАЖЕНИЕ страницы строительного документа.",
  "",
  "Прочитай её и верни строго по схеме:",
  "  · kind — что это за страница: спецификация, ведомость объёмов, кабельный",
  "    журнал, чертёж, пояснительный текст, пусто;",
  "  · text — сплошной текст страницы, если он есть;",
  "  · rows — строки ТАБЛИЦЫ, если таблица на странице есть.",
  "",
  "НЕ ДОДУМЫВАЙ. Ячейку, которую не разобрать, оставляй пустой строкой. Шифр,",
  "прочитанный наполовину, — это не шифр: пустое поле честнее правдоподобного.",
  "Выдуманное число невозможно отличить от прочитанного, и оно уйдёт в отчёт",
  "как факт.",
  "",
  "Если на странице таблицы нет — верни rows пустым массивом, а не пересказывай",
  "текст строками таблицы.",
].join("\n");

export interface VisionReader {
  /** Просит модель прочитать одну страницу-картинку. Возвращает ответ по схеме. */
  readonly read: (dataUrl: string) => Promise<unknown>;
}

export interface VisionRequest {
  readonly document: string;
  /** Страницы как `data:image/png;base64,…` вместе с их номерами. */
  readonly pages: readonly { readonly page: number; readonly dataUrl: string }[];
  readonly reader: VisionReader;
}

/**
 * Читает страницы зрением и приводит ответы к общему виду.
 *
 * Отказ на ОДНОЙ странице не отменяет остальные и не прячется: он попадает в
 * `skipped` с причиной. Молча пропустить страницу значило бы отдать неполное
 * распознавание под видом полного — тот же изъян, что зелёный вердикт на
 * неполном обходе.
 */
export async function extractByVision(request: VisionRequest): Promise<VisionExtraction> {
  const pages: VisionPage[] = [];
  const skipped: { page: number; reason: string }[] = [];

  for (const { page, dataUrl } of request.pages) {
    try {
      const ответ = (await request.reader.read(dataUrl)) as {
        kind?: unknown;
        text?: unknown;
        rows?: unknown;
      };

      const rows = Array.isArray(ответ.rows)
        ? ответ.rows
            .map((r): VisionRow => {
              const o = (r ?? {}) as Record<string, unknown>;
              return {
                ordinal: String(o["ordinal"] ?? ""),
                code: String(o["code"] ?? ""),
                name: String(o["name"] ?? ""),
                unit: String(o["unit"] ?? ""),
                quantity: String(o["quantity"] ?? ""),
                amount: String(o["amount"] ?? ""),
              };
            })
            // Строка без наименования — это не строка таблицы, а обрывок рамки.
            // Именно такие 214 «таблиц» и вернул разбор текстового слоя.
            .filter((r) => r.name.trim() !== "")
        : [];

      pages.push({
        page,
        text: String(ответ.text ?? ""),
        rows,
        kind: String(ответ.kind ?? "не определено"),
      });
    } catch (cause) {
      skipped.push({ page, reason: (cause as Error).message });
    }
  }

  return { document: request.document, pages, trust: "ориентир", skipped };
}

/**
 * Сводка распознанного для агента — с ОБЪЯВЛЕННЫМ уровнем доверия.
 *
 * Пометка идёт первой строкой, а не сноской внизу: агент, прочитавший таблицу и
 * узнавший об «ориентире» через две тысячи знаков, уже сделал вывод.
 */
export function visionBrief(extraction: VisionExtraction): string {
  if (extraction.pages.length === 0 && extraction.skipped.length === 0) return "";

  const части: string[] = [
    `[ПРОЧИТАНО ЗРЕНИЕМ С ИЗОБРАЖЕНИЙ СТРАНИЦ, уровень доверия «ориентир»: ` +
      `координаты строки нет, есть только номер страницы. Разбором из файла это не подтверждено.]`,
    `Документ: ${extraction.document.split("/").pop() ?? extraction.document}`,
  ];

  for (const page of extraction.pages) {
    части.push("", `— страница ${page.page} (${page.kind})`);

    if (page.rows.length > 0) {
      части.push("№\tшифр\tнаименование\tед.\tкол-во\tсумма");
      for (const r of page.rows) {
        части.push(`${r.ordinal}\t${r.code}\t${r.name}\t${r.unit}\t${r.quantity}\t${r.amount}`);
      }
    }

    if (page.text.trim() !== "") части.push(page.text.trim());
  }

  if (extraction.skipped.length > 0) {
    части.push(
      "",
      `[НЕ ПРОЧИТАНО ${extraction.skipped.length} страниц: ` +
        extraction.skipped.map((s) => `${s.page} — ${s.reason}`).join("; ") +
        "]",
    );
  }

  return части.join("\n");
}
