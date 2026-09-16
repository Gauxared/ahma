/**
 * ИНСТРУМЕНТЫ АГЕНТА — то, чем настоящий агент отличается от ролевого промпта.
 *
 * ЧТО ЗДЕСЬ ИСПРАВЛЯЕТСЯ
 *
 * Требование агентности записано в архитектуре давно: `ADR-V3-002` — рантайм
 * вокруг агентных threads, `ADR-V3-007` — супервизор с исследовательскими
 * ветвями. Сделано было иное: десять ролей, по одному вызову модели на роль,
 * поля `tools` в запросе нет, обработки `tool_calls` нет ни строки. Профиль
 * модели при этом объявлял `"toolCalling": "prompted"` — возможность, которой
 * не пользовался никакой код.
 *
 * Разница не в словах. Агент без инструментов получает готовый материал и
 * больше ничего попросить не может: ни «покажи лист 42», ни «подними норматив
 * по этому шифру», ни «пересчитай вот это». Он вынужден отвечать по тому, что
 * ему положили, — и если положили сжатую выжимку, его «в документации этого
 * нет» оказывается утверждением о нашем бюджете, а не о документации.
 *
 * ИНСТРУМЕНТЫ ТОЛЬКО ЧИТАЮТ И СЧИТАЮТ (Т9.2)
 *
 * Ни один инструмент не меняет данные. Агент, переписывающий смету, — это не
 * проверка, а редактирование под свой вывод. Поэтому в контракте нет ни одного
 * действия, изменяющего состояние: только чтение разобранного, поиск в
 * справочнике и ДЕТЕРМИНИРОВАННЫЙ пересчёт.
 *
 * ПЕРЕСЧЁТ ВОЗВРАЩАЕТ РЕЗУЛЬТАТ КОДА, А НЕ ПРОСИТ МОДЕЛЬ ПОСЧИТАТЬ
 *
 * `ADR-V3-010` в силе и здесь: «LLM сопоставляет и объясняет, но не является
 * источником итоговой арифметики». Инструмент сходимости считает сам и отдаёт
 * готовое число; модель им пользуется, но не производит его.
 *
 * ИМЕНА ИНСТРУМЕНТОВ ЛАТИНИЦЕЙ, И ЭТО НЕ ВКУС
 *
 * Провайдеры требуют `^[a-zA-Z0-9_-]+$` для имени инструмента — то же правило,
 * что для имени схемы, на котором я уже спотыкался: кириллическое имя даёт 400
 * от апстрима. Описания и доводы при этом по-русски: их читает модель, а не
 * валидатор.
 */

/** Схема довода инструмента — тот же JSON Schema, что у структурированного вывода. */
export type ToolSchema = Record<string, unknown>;

/**
 * Инструмент, как его видит модель и как его исполняет система.
 *
 * `call` возвращает ТЕКСТ, а не объект: в диалог с моделью результат уходит
 * строкой, и решать, как её отформатировать, должен тот, кто знает предмет, а
 * не общий сериализатор. Таблица позиций, свёрнутая в JSON, читается моделью
 * хуже, чем та же таблица строками.
 */
export interface AgentTool {
  /** Латиницей: требование провайдеров. */
  readonly name: string;
  /** Зачем инструмент нужен — по-русски, это читает модель. */
  readonly description: string;
  readonly parameters: ToolSchema;
  readonly call: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Что агент попросил и что получил — звено цепочки доказательности (Т9.4).
 *
 * Без этой записи агентный режим теряет главное свойство системы: «откуда
 * СтройИнтеллект это взял». У агента ответ на этот вопрос ДЛИННЕЕ, чем у
 * ролевого промпта, а не короче: он включает, что агент смотрел по своей
 * инициативе.
 *
 * `resultDigest` — а не сам результат: ответ инструмента бывает в десятки
 * килобайт, и складывать его в артефакт целиком значило бы раздуть артефакт
 * содержимым, которое уже лежит в разобранных позициях. Хранится размер и
 * отпечаток: по ним видно, что вернулось непустое и что именно.
 */
export interface ToolCallRecord {
  readonly tool: string;
  readonly arguments: string;
  readonly resultChars: number;
  readonly resultDigest: string;
  readonly failed?: string;
}

/** Данные, из которых собираются инструменты. Приходят портами обхода. */
export interface ToolSources {
  /** Разобранные позиции по документу: номер, шифр, наименование, объём, сумма. */
  readonly positionsOf: (documentPath: string) => Promise<readonly ToolPosition[]>;
  /** Лист книги строками: номер строки и значения по колонкам. */
  readonly sheetOf: (documentPath: string, sheet?: string) => Promise<readonly string[]>;
  /** Норматив по шифру из справочника ФСНБ. */
  readonly normOf: (code: string) => Promise<string | undefined>;
  /** Текст документа постранично. */
  readonly textOf: (documentPath: string, page: number) => Promise<string | undefined>;
  /** Список документов объекта с их состоянием. */
  readonly documents: () => Promise<readonly string[]>;
  /** Детерминированный пересчёт сходимости по документу. */
  readonly convergenceOf: (documentPath: string) => Promise<string>;
}

export interface ToolPosition {
  /** Номер по форме: бывает «1.1», поэтому строка, а не число. */
  readonly ordinal: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity: string;
  readonly amount: string;
}

const МАКСИМУМ_ЗНАКОВ = 24_000;

/**
 * Ответ инструмента обрезается, и обрезка НАЗЫВАЕТСЯ.
 *
 * Молча укоротить таблицу — значит дать агенту неполные данные под видом
 * полных: он скажет «позиции 90 в смете нет», имея в виду наш предел. Это тот
 * же изъян, что был у бюджета текста РД, и он уже стоил неверного вывода.
 */
function ограничить(текст: string, что: string): string {
  if (текст.length <= МАКСИМУМ_ЗНАКОВ) return текст;

  return (
    `${текст.slice(0, МАКСИМУМ_ЗНАКОВ)}\n\n[ОБРЕЗАНО: ${что} длиннее ${МАКСИМУМ_ЗНАКОВ} знаков. ` +
    "Показано начало. Запроси конкретный диапазон, если нужно дальше.]"
  );
}

/** Строка таблицы позиций — так, как её читает модель. */
function строкой(p: ToolPosition): string {
  return `${p.ordinal}\t${p.code}\t${p.name}\t${p.unit}\t${p.quantity}\t${p.amount}`;
}

/**
 * Набор инструментов агента.
 *
 * Набор ОДИН для всех ролей, и это осознанно: сметчику и ГИПу нужны те же
 * данные, они задают им разные вопросы. Разделять набор по ролям значило бы
 * решать за агента, что ему смотреть, — то есть вернуть ровно то ограничение,
 * от которого агентность и избавляет.
 */
export function buildAgentTools(sources: ToolSources): readonly AgentTool[] {
  return [
    {
      name: "list_documents",
      description:
        "Перечислить документы объекта с их состоянием разбора. Начни с него, если не знаешь, что есть на объекте.",
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
      call: async () => {
        const список = await sources.documents();
        return список.length === 0 ? "документов нет" : список.join("\n");
      },
    },
    {
      name: "read_positions",
      description:
        "Прочитать разобранные позиции сметы: номер, шифр, наименование, единица, количество, сумма. " +
        "Это ФАКТ — разобрано из файла, а не прочитано зрением.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["document"],
        properties: {
          document: { type: "string", description: "путь или имя файла сметы" },
          from: { type: "number", description: "с какого номера позиции" },
          to: { type: "number", description: "по какой номер позиции включительно" },
        },
      },
      call: async (args) => {
        const все = await sources.positionsOf(String(args["document"] ?? ""));
        if (все.length === 0) return "позиций из этого документа не извлечено";

        const от = typeof args["from"] === "number" ? args["from"] : 1;
        const до = typeof args["to"] === "number" ? args["to"] : Number.MAX_SAFE_INTEGER;
        // Номер позиции бывает «1.1»: сравнивается его числовая часть, а
        // нечисловые номера из диапазона не выпадают молча.
        const срез = все.filter((p) => {
          const n = Number.parseFloat(p.ordinal);
          return Number.isNaN(n) ? true : n >= от && n <= до;
        });

        if (срез.length === 0) return `в диапазоне ${от}…${до} позиций нет; всего позиций ${все.length}`;

        return ограничить(
          `позиций всего ${все.length}, показано ${срез.length}\n` +
            "№\tшифр\tнаименование\tед.\tкол-во\tсумма, ₽\n" +
            срез.map(строкой).join("\n"),
          "таблица позиций",
        );
      },
    },
    {
      name: "read_sheet",
      description:
        "Прочитать лист книги строками — как он лежит в файле, до всякого разбора. " +
        "Нужен, когда разбор в позиции не удался или когда надо увидеть шапку и итоги.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["document"],
        properties: {
          document: { type: "string" },
          sheet: { type: "string", description: "имя листа; без него берётся первый" },
        },
      },
      call: async (args) => {
        const строки = await sources.sheetOf(
          String(args["document"] ?? ""),
          typeof args["sheet"] === "string" ? args["sheet"] : undefined,
        );
        return строки.length === 0
          ? "лист пуст или книга не читается"
          : ограничить(строки.join("\n"), "лист книги");
      },
    },
    {
      name: "lookup_norm",
      description:
        "Поднять норматив по шифру из справочника ФСНБ-2022: наименование и единица измерения. " +
        "Нужен, чтобы проверить, та ли расценка применена.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["code"],
        properties: { code: { type: "string", description: "шифр, например ГЭСНм20-03-035-03" } },
      },
      call: async (args) => {
        const код = String(args["code"] ?? "");
        const найдено = await sources.normOf(код);
        // «Не найден» — это ответ, а не пустота: агент должен знать, что шифра
        // в справочнике нет, а не думать, что инструмент промолчал.
        return найдено ?? `шифр «${код}» в справочнике ФСНБ-2022 не найден`;
      },
    },
    {
      name: "read_text_page",
      description:
        "Прочитать страницу текста документа (пояснительная записка, договор, ТЗ, подшивка РД). " +
        "Уровень доверия — текстовый слой файла.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["document", "page"],
        properties: { document: { type: "string" }, page: { type: "number" } },
      },
      call: async (args) => {
        const текст = await sources.textOf(
          String(args["document"] ?? ""),
          typeof args["page"] === "number" ? args["page"] : 1,
        );
        return текст === undefined || текст.trim() === ""
          ? "у этого документа такой страницы нет или её текстовый слой пуст"
          : ограничить(текст, "страница документа");
      },
    },
    {
      name: "recompute_convergence",
      description:
        "Пересчитать сходимость сметы: итог против суммы разделов и позиций. " +
        "СЧИТАЕТ КОД, а не модель: возвращается готовое число с расхождением в рублях.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["document"],
        properties: { document: { type: "string" } },
      },
      call: async (args) => sources.convergenceOf(String(args["document"] ?? "")),
    },
  ];
}
