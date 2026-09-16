/**
 * Оболочка модельного агента — ADR-R-011, ТЗ §9, §12.1д, §12.2.
 *
 * ЗАЧЕМ ОНА
 *
 * Сметчик был единственным из девяти агентов, обращающимся к модели, и стоил
 * 411 строк. Восемь остальных тем же способом — это ещё три тысячи строк с
 * восемью схемами вывода и восемью разборщиками ответа. ADR-R-011 требовал
 * «реестр агентов N-арный с первого дня»: по чек-листам и протоколу он N-арен,
 * по ИСПОЛНЕНИЮ был штучным.
 *
 * ЧТО ЗДЕСЬ ОБЩЕЕ
 *
 * Всё, что одинаково у любого из девяти:
 *
 *  · строгая схема вывода — вердикт, замечания, открытые вопросы;
 *  · отбраковка замечания без основания (§9) с сохранением отброшенного;
 *  · подстановка суммы влияния ИЗ РАСЧЁТНОГО МОДУЛЯ, а не из ответа (§12.1д);
 *  · обезличивание перед выходом наружу (§8.3);
 *  · метрики прогона для нормативов §11 и бюджета ADR-R-020.
 *
 * ЧТО ОСТАЁТСЯ У АГЕНТА
 *
 * Три вещи, и сводить их к общему знаменателю нельзя: какие детерминированные
 * проверки сложить ему на вход, как их изложить и откуда брать суммы. Это и
 * есть то, чем Денчик отличается от Ваныча.
 *
 * ЧЕГО ОБОЛОЧКА НЕ ДЕЛАЕТ
 *
 * Не считает и не толкует. Число, пришедшее от модели, в результат не попадает
 * никогда: влияние берётся по порядковому номеру из данных расчётного модуля.
 * Иначе §12.1д держался бы на том, что модель не соврёт.
 */
import type {
  AccuracyMarker,
  DeviationKind,
  Money,
  OpenQuestion,
  OperationDefinition,
  Severity,
  Sha256,
  SourceRef,
  Valued,
} from "@contracts/index.js";
import { money } from "@contracts/index.js";

import { checkDepth, describeDepth } from "./depth-mode.js";
import type { DepthMode } from "./depth-mode.js";
import { raiseVerdictColour } from "./verdict-colour.js";

/**
 * Строгая схема вывода — общая для всех девяти агентов.
 *
 * Каждое свойство перечислено в `required`: провайдер отвергает схему с
 * необязательными полями (измерено на настоящем endpoint в M0). Отсутствие
 * значения выражается пустой строкой, а не отсутствием ключа.
 *
 * Схема ОДНА на всех намеренно. Девять схем означали бы девять поводов
 * напороться на то же ограничение провайдера и девять разборщиков ответа; а
 * различаются агенты не формой вывода, а предметом рассуждения.
 */
export const AGENT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings", "openQuestions", "options", "sections"],
  properties: {
    verdict: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "statement", "basis", "deviation", "impactOrdinal"],
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "info"] },
          statement: { type: "string" },
          basis: { type: "string" },
          deviation: {
            type: "string",
            enum: [
              "market_movement",
              "technical_solution",
              "quantity_error",
              "rate_overstatement",
              "double_count",
              "none",
            ],
          },
          /** Порядковый номер позиции; сумму подставляет расчётный модуль. */
          impactOrdinal: { type: "string" },
        },
      },
    },
    /**
     * Варианты решения. Пусто во всех режимах, кроме «эксперт», где §5.4 требует
     * не менее трёх. Поле обязательное: провайдер отвергает схему с
     * необязательными свойствами, а пустой массив — честное «вариантов нет».
     */
    options: {
      type: "array",
      items: { type: "string" },
    },
    openQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "owner", "dueBy"],
        properties: {
          question: { type: "string" },
          owner: { type: "string" },
          dueBy: { type: "string" },
        },
      },
    },
    /**
     * ПРЕДМЕТНЫЕ ЛИСТЫ ЗАКЛЮЧЕНИЯ — ОТ ОБЪЕКТА, А НЕ ОТ КОНФИГУРАЦИИ.
     *
     * В эталонном пакете у каждого документа своя разметка: у ГИПа
     * «Нормпрофиль», «КС_геометрия», «Сверка_состава»; у сметчика «Свод_ЛСР»,
     * «НР_СП», «Конъюнктура». Соблазн — вписать этот список в манифесты.
     *
     * ЭТОГО ДЕЛАТЬ НЕЛЬЗЯ, и причина не в гибкости. Эталон снят с ОДНОГО
     * объекта — железнодорожного переезда с контактной сетью. «КС_геометрия»
     * бессмысленна для жилого дома, «Проверка_ЭОМ» — для земляных работ. Агент,
     * обязанный заполнить лист про предмет, которого на объекте нет, начнёт его
     * ВЫДУМЫВАТЬ, и выдуманное будет выглядеть анализом. Пустой лист с чужим
     * названием хуже отсутствующего.
     *
     * Поэтому лист целиком описывает сам агент: заголовок, назначение, колонки
     * и строки. Устойчивость даёт не список названий, а КАРКАС РОЛИ — то, что
     * агент обязан дать при любом объекте (`requiredSections` манифеста).
     * Каркас проверяется, предметные листы — нет: их состав определяется тем,
     * что пришло на вход.
     */
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "purpose", "columns", "rows"],
        properties: {
          /** Устойчивый ключ листа: по нему сверяется каркас роли. */
          id: { type: "string" },
          title: { type: "string" },
          /** Зачем этот лист — идёт в шапку, чтобы таблица не осталась без вопроса. */
          purpose: { type: "string" },
          columns: { type: "array", items: { type: "string" } },
          rows: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
} as const;

/**
 * Каркас роли: лист, который агент обязан дать при ЛЮБОМ объекте.
 *
 * Это не список предметных листов, а перечень вопросов, на которые роль
 * отвечает всегда: сметчик — про сходимость и влияние на маржу, снабженец —
 * про сроки поставки. Он не зависит от того, переезд это или жилой дом.
 *
 * Отсутствие такого листа — не «агент решил иначе», а пробел, и он попадает на
 * лист «Чего здесь нет».
 */
export interface RequiredSection {
  readonly id: string;
  readonly title: string;
  /** Почему роль обязана это дать. Идёт в промпт. */
  readonly why: string;
  /**
   * Шапка листа, заданная РОЛЬЮ, а не объектом.
   *
   * Документный агент смотрит каждую смету отдельно и каждый раз придумывает
   * заголовки заново: на прогоне эталонного входа «Сходимость» вышла с графами
   * «Вывод» на одной смете и «Статус» на другой, «Значение» на одной и «Сумма»
   * на другой. Сведение четырёх смет в один лист даёт тогда восемь граф, из
   * которых половина в каждой строке — прочерк.
   *
   * Шапка каркасного листа от объекта не зависит: сходимость везде описывается
   * показателем, значением, расхождением и основанием. Задать её — значит
   * получить таблицу вместо лоскутов. Предметных листов это НЕ КАСАЕТСЯ: их
   * колонки знает только агент, увидевший объект.
   */
  readonly columns?: readonly string[];
}

/** Предметный лист, как его описал агент по ЭТОМУ объекту. */
export interface AgentSection {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ReviewFinding {
  readonly severity: Severity;
  readonly statement: string;
  readonly basis: string;
  readonly deviation: DeviationKind | undefined;
  readonly impact: Valued<Money> | undefined;
  /**
   * ГДЕ В ИСХОДНОМ ДОКУМЕНТЕ ЛЕЖИТ ТО, О ЧЁМ ЗАМЕЧАНИЕ (веха Д3 плана демо).
   *
   * До этого координата ВЫЧИСЛЯЛАСЬ и терялась: она жила внутри
   * `impact.provenance.ref.locator`, то есть существовала только у замечаний с
   * денежным влиянием. Замечание без суммы — а таких большинство у ГИПа и ПТО —
   * доходило до экрана абзацем прозы, и на вопрос «откуда» ответить было нечем.
   *
   * Теперь ссылка на источник стоит на самом замечании и несёт всё, что нужно
   * читателю: лист и строку (`locator`), уровень доверия (`status`) и способ
   * получения (`acquisition`). Та же ссылка кладётся внутрь `impact`, когда
   * сумма есть, — одно вычисление, два потребителя.
   *
   * `undefined` — модель не назвала позицию либо назвала несуществующую.
   * Это ЗАКОННЫЙ исход, а не сбой: замечание об отсутствии сметы к строке не
   * привязано вовсе. Но и молчать о разнице нельзя — экран помечает такое
   * замечание словом «основание текстовое».
   */
  readonly source: SourceRef | undefined;
}

export interface RejectedFinding {
  readonly statement: string;
  readonly reason: string;
}

export interface AgentRunMetrics {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

export interface AgentTurn {
  readonly output: unknown;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

/** Что режим глубины сказал о форме ответа (§5.4). */
export interface DepthOutcome {
  readonly mode: DepthMode;
  /**
   * Нарушения формы. Они НЕ отменяют содержание: отвергнуть разбор из-за
   * шестнадцатой строки значит выбросить работу, верную по существу. Но и
   * молчать нельзя — режим это контракт на форму, а не пожелание к стилю.
   */
  readonly violations: readonly string[];
}

export interface AgentReviewBody {
  readonly documentPath: string;
  readonly verdict: string;
  /** Варианты решения (§5.4, режим «эксперт»). */
  readonly options: readonly string[];
  readonly depth: DepthOutcome;
  readonly findings: readonly ReviewFinding[];
  readonly rejected: readonly RejectedFinding[];
  readonly openQuestions: readonly OpenQuestion[];
  /** Предметные листы заключения. Пусто у агента, который их не объявлял. */
  readonly sections: readonly AgentSection[];
  readonly accuracy: AccuracyMarker;
  readonly run: AgentRunMetrics;
}

/**
 * Откуда оболочка берёт числа.
 *
 * Модель называет ПОРЯДКОВЫЙ НОМЕР позиции, оболочка находит по нему сумму,
 * посчитанную расчётным модулем, и её же кладёт в результат вместе со ссылкой
 * на строку документа.
 *
 * Номер, которого нет в таблице, оставляет влияние ПУСТЫМ. Подставить ноль
 * значило бы сказать «влияния нет» там, где мы просто не знаем, к чему это
 * относится, — а неизвестное не превращается в ноль (ТЗ §9).
 */
/**
 * Позиция, на которую сослалась модель, — с ЕЁ СОБСТВЕННЫМ документом.
 *
 * ЗАЧЕМ ДОКУМЕНТ У КАЖДОЙ ПОЗИЦИИ, А НЕ ОДИН НА АГЕНТА
 *
 * Документный агент работает по одной смете, и общего `sourceId` ему хватает.
 * ОБЪЕКТНЫЙ — снабженец, договорник, подрядчик, исполнительная — работает по
 * всему объекту: его позиции приходят из четырёх разных смет, а `sourceId` был
 * один на всех, и это был путь ПАПКИ объекта. Отпечаток при этом брался у
 * ПЕРВОГО документа обхода (`documentHashes[0]`).
 *
 * Замерено на курганском прогоне: из 72 замечаний с координатой 63 приходили от
 * объектных агентов, то есть у 63 из 72 ссылка «откуда взято» называла не тот
 * файл. Переход при этом работал — вёл в первый документ объекта — и в 20
 * случаях приводил в «строки не нашлось», а в остальных мог показать ЧУЖУЮ
 * строку как источник. Второе хуже первого: оно выглядит как ответ.
 *
 * Поля необязательны: у документного агента они пусты, и берётся общий
 * источник. Разделять два вида агента здесь было бы разделением там, где
 * разница только в том, знает ли позиция свой файл.
 */
export interface EvidenceRow {
  /**
   * Сумма позиции. НЕОБЯЗАТЕЛЬНА: в смете без стоимостной части её нет, а
   * координата строки есть — и она нужнее. Замечание со ссылкой в документ
   * работает на встрече; замечание без ссылки не показать.
   */
  readonly amount?: string | undefined;
  /**
   * Строка исходного листа. `undefined` — строка неизвестна, и координаты у
   * замечания не будет вовсе.
   *
   * Ноль в этом поле означал бы «строка ноль», которой в книге не существует, —
   * и на экране он ничем не отличался бы от настоящей координаты.
   */
  readonly row?: number | undefined;
  /** Файл этой позиции. Пусто у агента, работающего по одному документу. */
  readonly sourceId?: string | undefined;
  /** Отпечаток ЭТОГО файла. Пусто там же, где и `sourceId`. */
  readonly contentHash?: Sha256 | undefined;
}

export interface AgentEvidence {
  readonly amounts: ReadonlyMap<string, EvidenceRow>;
  readonly sourceId: string;
  readonly contentHash: Sha256;
  /** Лист документа для ссылки на строку. */
  readonly sheet: string;
}

export interface AgentRunRequest {
  /**
   * Операция, от имени которой идёт обращение.
   *
   * Нужна журналу обращений к моделям (§12.1л): запись «обратились к модели»
   * без указания процесса не отвечает на вопрос Регламента передачи данных —
   * КАКОЙ процесс и какие сведения выносил.
   */
  readonly operationId: string;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly outputSchema: Record<string, unknown>;
  /**
   * Листы рабочей документации изображениями.
   *
   * НАБЛЮДЕНИЯ С ЧЕРТЕЖА — НЕ ФАКТЫ. Модель читает подписи растра, и читает их
   * с ошибками: на замере суммарная мощность «315 кВт» прочиталась как «31,5».
   * Поэтому всё, что агент возьмёт с листа, обязано идти уровнем доверия
   * «ориентир», а не «факт», — и промпт агента говорит это прямо.
   *
   * Числа расчёта здесь не меняются ничем: их по-прежнему считает расчётный
   * модуль, а модель называет позицию (§12.1д).
   */
  readonly images?: readonly string[] | undefined;
  /**
   * Что обезличить перед выходом наружу (ТЗ §8.3, §12.1л).
   *
   * Агент НЕ обезличивает сам: он не знает, во внешний контур пойдёт запрос или
   * к модели внутри него, а обезличивать данные для собственной модели значило
   * бы ухудшать проверку без нужды. Здесь называется предмет, решение принимает
   * композиционный корень.
   *
   * Наименования работ сюда не входят намеренно: это предмет проверки, а не
   * сведения о заказчике. Спрятав их, мы выполнили бы §11 и уничтожили §5.2.
   */
  readonly anonymize: {
    readonly knownEntities: readonly { readonly value: string; readonly kind: string }[];
    readonly salt: string;
  };
}

export interface AgentSpec<TInput> {
  readonly definition: OperationDefinition;
  /**
   * Режим глубины по умолчанию (§5.4). «Стандарт», если не задан.
   *
   * Запрос может его переопределить: режим выбирают на конкретную Проверку, а
   * не на всю сборку. До этого режим принимался командной строкой, печатался и
   * НЕ ВЛИЯЛ НИ НА ЧТО — агент о нём не знал, ответ не проверялся.
   */
  readonly depth?: DepthMode;
  /** Системный промпт агента — портированный из легаси v9.x. */
  readonly prompt: string;
  /**
   * Опорная база агента, уже отрисованная блоком.
   *
   * Отдаётся функцией, а не строкой, по двум причинам. Книга заказчика лежит
   * на смонтированном томе и читается асинхронно, а сборка платформы
   * синхронна. И читать её на старте незачем: агент без настроенной модели не
   * запускается вовсе, а книга ГИПа — 183 норматива.
   *
   * Вернуть `undefined` — режим `[БЕЗ БАЗЫ]` самого легаси: агент отвечает
   * общими знаниями модели, и об этом обязан знать и он сам, и читатель
   * отчёта. Молчаливая работа без опоры — это ссылка на отменённую норму,
   * звучащая убедительно.
   */
  readonly referenceBase?: () => Promise<string | undefined>;

  /** Как изложить модели то, что уже посчитал расчётный модуль. */
  readonly buildPrompt: (input: TInput) => string;
  /**
   * Каркас роли: листы, которые агент обязан дать при ЛЮБОМ объекте.
   *
   * Пусто — агент предметных листов не ведёт (так у планировщика, чей ответ
   * целиком укладывается в замечания). Не пусто — требования уходят в промпт
   * ОДНИМ текстом с проверкой, чтобы они не разошлись.
   */
  readonly requiredSections?: readonly RequiredSection[];
  /** Откуда брать суммы влияния и ссылки на строки. */
  readonly evidence: (input: TInput) => AgentEvidence;
  /**
   * Листы рабочей документации изображениями. Пусто у восьми агентов из девяти.
   *
   * Отдельно от промпта, потому что путь у них разный: промпт обезличивается и
   * получает расписку, изображение — нет и не может (§8.3). Куда именно они
   * уйдут и уйдут ли вообще, решает композиционный корень: он один знает адрес
   * модели.
   */
  readonly images?: (input: TInput) => readonly string[];
  /**
   * Маркер точности считает расчётный модуль. Агент его не выводит и не
   * импортирует напрямую: между модулями ходит только талия (ADR-R-025).
   */
  readonly accuracy: (input: TInput) => AccuracyMarker;
  readonly runAgent: (request: AgentRunRequest) => Promise<AgentTurn>;
}

interface ModelFinding {
  severity: Severity;
  statement: string;
  basis: string;
  deviation: string;
  impactOrdinal: string;
}

interface ModelOutput {
  verdict: string;
  findings: ModelFinding[];
  openQuestions: OpenQuestion[];
  options?: string[];
  sections?: { id: string; title: string; purpose: string; columns: string[]; rows: string[][] }[];
}

/**
 * Требования к листам заключения — в промпт.
 *
 * ДВЕ ЧАСТИ, И ВТОРАЯ ВАЖНЕЕ ПЕРВОЙ.
 *
 * Первая — каркас роли: на что агент отвечает всегда. Он не зависит от объекта
 * и потому перечислен списком.
 *
 * Вторая — предметные листы, и здесь агенту сказано ПРИДУМАТЬ их самому под то,
 * что он видит. Это не послабление: список названий, снятый с одного объекта,
 * заставил бы его заполнять «Проверку ЭОМ» там, где электрики нет, а
 * заполненный наугад лист выглядит анализом.
 */
function требованияКЛистам(required: readonly RequiredSection[]): string {
  const lines = [
    "",
    "",
    "ЛИСТЫ ЗАКЛЮЧЕНИЯ (`sections`).",
    "",
    "Разложи разбор по листам, как это делает инженер в рабочей книге: один лист —",
    "один вопрос. У каждого укажи `id` (латиницей, устойчивый), `title`, `purpose`",
    "(зачем лист), `columns` (шапка таблицы) и `rows` (строки, по колонкам).",
    "",
    "ЛИСТ — ЭТО ТАБЛИЦА, А ЗАМЕЧАНИЕ — ТРЕВОГА. Лист показывает, что посчитано:",
    "величины, источники, сходится или нет. Замечание говорит, что с этим не так и",
    "чего это стоит. Не пересказывай замечания строками листа и не подменяй листом",
    "замечание: их читают разные люди и в разное время.",
    "",
    "ЛИСТЫ ВЫБИРАЕШЬ ТЫ, ПО ЭТОМУ ОБЪЕКТУ. Не бывает универсального набора: у",
    "переезда с контактной сетью и у жилого дома проверяется разное. Лист, для",
    "которого на объекте нет предмета, НЕ ЗАВОДИ — пустая таблица с уверенным",
    "названием читается как выполненная проверка.",
    "",
    "`id` — ИМЯ ВОПРОСА, А НЕ ИМЯ ЭТОГО ДОКУМЕНТА. Ты смотришь документы объекта",
    "по одному, и один и тот же вопрос встретится в нескольких. Задавая ему на",
    "каждом документе новое имя — `composition_check`, потом `completeness_check`,",
    "потом `composition_check_detail`, — ты получишь в книге четыре листа об одном",
    "вместо одной таблицы по четырём документам. Один вопрос — один `id`, всегда",
    "тот же. Различает документы система, а не имя листа.",
  ];

  if (required.length > 0) {
    lines.push(
      "",
      "НО ЭТИ ЛИСТЫ ОБЯЗАТЕЛЬНЫ ПРИ ЛЮБОМ ОБЪЕКТЕ — это твоя роль, а не предмет:",
    );
    for (const item of required) {
      lines.push(`  · id «${item.id}» — ${item.title}: ${item.why}`);
      if (item.columns !== undefined && item.columns.length > 0) {
        lines.push(`      колонки ровно эти и в этом порядке: ${item.columns.join(" | ")}`);
      }
    }
    lines.push(
      "",
      "Если по объекту дать такой лист нечем, всё равно заведи его и напиши в",
      "строках, ЧЕГО НЕ ХВАТИЛО. Отсутствие листа читается как забывчивость,",
      "названная нехватка — как результат проверки.",
    );

    if (required.some((item) => item.columns !== undefined && item.columns.length > 0)) {
      lines.push(
        "",
        "ШАПКУ ЭТИХ ЛИСТОВ НЕ МЕНЯЙ. Ты смотришь документы по одному, и заголовки,",
        "придуманные заново на каждом, разойдутся между собой: «Вывод» на одном и",
        "«Статус» на другом. Свести такие листы в одну таблицу нельзя — выйдет",
        "лоскут из прочерков. Своё называй В СТРОКАХ, а не в шапке.",
      );
    }
  }

  return lines.join("\n");
}

/**
 * Ответ не по схеме — отказ, а не подстановка пустого.
 *
 * Молча вернуть пустой вердикт значило бы выдать «замечаний нет» там, где
 * модель ответила непонятно. Имя агента в отказе обязательно: при девяти
 * агентах «ответ не по схеме» без имени не говорит ничего.
 */
function assertShape(output: unknown, agentId: string): asserts output is ModelOutput {
  const value = output as Partial<ModelOutput> | null;

  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.verdict !== "string" ||
    !Array.isArray(value.findings) ||
    !Array.isArray(value.openQuestions)
  ) {
    throw new Error(
      `Ответ модели не соответствует схеме вывода агента «${agentId}»: отсутствуют обязательные поля`,
    );
  }
}

/**
 * Названия, которые нельзя выпускать наружу, выведенные из пути документа.
 *
 * `objects/КРГ-1/сметы/смета-1.xlsx` → «КРГ-1». Служебные части пути
 * («objects», «сметы») отбрасываются: они одинаковы у всех и ничего не выдают,
 * а вот попав в словарь, замостили бы полтекста псевдонимами.
 *
 * Род «Объект», а не «Организация»: код стройки, названный компанией, увёл бы
 * модель рассуждать об участнике там, где речь о самом объекте.
 */
export function entitiesOf(
  documentPath: string,
): readonly { readonly value: string; readonly kind: string }[] {
  const SERVICE = new Set(["objects", "объекты", "сметы", "договоры", "кп", "входящие", "docs"]);

  return [
    ...new Set(
      documentPath
        .split(/[/\\]/u)
        .map((part) => part.replace(/\.[a-zа-я0-9]+$/iu, "").trim())
        .filter((part) => part.length >= 3 && !SERVICE.has(part.toLowerCase())),
    ),
  ].map((value) => ({ value, kind: "Объект" }));
}

/**
 * Системный промпт с опорной базой — либо с объявленным её отсутствием.
 *
 * Молчание здесь было бы худшим из вариантов: агент, не знающий, что базы нет,
 * отвечает так же уверенно, как агент с базой, и отличить эти два ответа
 * читателю нечем.
 */
function withReferenceBase(prompt: string, base: string | undefined): string {
  if (base === undefined || base.trim() === "") {
    return (
      `${prompt}\n\n[БЕЗ БАЗЫ] Опорная база не подключена. Ссылайся только на то, что видишь ` +
      "во входных данных; нормативные утверждения помечай как непроверенные и не выдавай " +
      "статус нормы за установленный."
    );
  }

  return `${prompt}\n\n${base}`;
}

export function createAgentOperation<
  TInput extends { readonly documentPath: string; readonly depth?: DepthMode },
>(
  spec: AgentSpec<TInput>,
): {
  definition: OperationDefinition;
  run: (input: TInput) => Promise<{ body: AgentReviewBody; inputHashes: readonly Sha256[] }>;
} {
  return {
    definition: spec.definition,

    run: async (input: TInput) => {
      const evidence = spec.evidence(input);

      // Режим запроса важнее режима сборки: его выбирают на Проверку.
      const depth = input.depth ?? spec.depth ?? "стандарт";

      const base = spec.referenceBase === undefined ? undefined : await spec.referenceBase();

      const turn = await spec.runAgent({
        operationId: spec.definition.id,
        // Опорная база — ЧАСТЬ системного промпта, а не пользовательского:
        // это знание агента, а не данные задачи. Отсутствие объявляется
        // агенту прямо — иначе он не отличит «нормы не нашёл» от «норм нет».
        systemPrompt: withReferenceBase(spec.prompt, base),
        // Требования режима идут в ПРОМПТ, а не только в проверку. Ловить
        // нарушение, о котором агента не предупредили, — это ловушка, а не
        // контракт.
        prompt:
          `${spec.buildPrompt(input)}\n\nРЕЖИМ ОТВЕТА: ${describeDepth(depth)}.` +
          требованияКЛистам(spec.requiredSections ?? []),
        outputSchema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        ...(spec.images === undefined ? {} : { images: spec.images(input) }),
        // Путь документа несёт наименование объекта — ту самую связку, что
        // привязывает цены к конкретному заказчику. Соль — отпечаток документа:
        // одинаковые псевдонимы при повторной проверке того же документа,
        // разные — для разных.
        anonymize: {
          knownEntities: entitiesOf(input.documentPath),
          salt: evidence.contentHash,
        },
      });

      assertShape(turn.output, spec.definition.id);

      const findings: ReviewFinding[] = [];
      const rejected: RejectedFinding[] = [];

      for (const finding of turn.output.findings) {
        if (finding.basis.trim() === "") {
          // ТЗ §9: без основания вывод не выдаётся. Но и молча терять его нельзя
          // — иначе мы скрываем, что модель что-то сказала.
          rejected.push({ statement: finding.statement, reason: "замечание без основания" });
          continue;
        }

        const source = evidence.amounts.get(finding.impactOrdinal.trim());

        /**
         * Ссылка на источник считается ОДИН раз и служит двум потребителям:
         * сумме влияния и самому замечанию.
         *
         * Раньше она собиралась внутри `impact` и вместе с ним исчезала, когда
         * суммы не было. Замечание при этом никуда не исчезало — оно доходило
         * до экрана без координаты, и отличить его от замечания со следом было
         * нельзя.
         */
        /**
         * ДО СТРОКИ — ТОЛЬКО КОГДА СТРОКА ИЗВЕСТНА.
         *
         * Здесь стояло `row: source.row` без проверки, а реверс объёма кладёт в
         * это поле НОЛЬ, объявляя тем самым «строка неизвестна». Ноль доезжал
         * до экрана координатой «лист «ЛСР», строка 0» и ничем не отличался от
         * настоящей: обещал след и приводил в никуда.
         *
         * Когда строки нет, след не пропадает, а становится грубее: ссылка на
         * ПОЗИЦИЮ по её порядковому номеру. Это правда меньшей точности, и она
         * лучше и выдуманной строки, и молчания — сумма влияния при этом
         * сохраняет провенанс, без которого её нельзя вынести из модуля.
         *
         * Источник берётся У ПОЗИЦИИ, если она его знает, и только иначе —
         * общий. У объектного агента позиции приходят из разных смет, и общий
         * источник называл бы файл, к которому строка не относится.
         */
        const ordinal = finding.impactOrdinal.trim();

        const ref: SourceRef | undefined =
          source === undefined
            ? undefined
            : {
                sourceId: source.sourceId ?? evidence.sourceId,
                contentHash: source.contentHash ?? evidence.contentHash,
                locator:
                  source.row === undefined || source.row <= 0
                    ? { kind: "record", recordId: ordinal }
                    : { kind: "row", sheet: evidence.sheet, row: source.row },
                status: "fact",
                acquisition: "parsed",
                checkedAt: new Date().toISOString().slice(0, 10) as never,
                staleAfterDays: 90,
              };

        findings.push({
          severity: finding.severity,
          statement: finding.statement,
          basis: finding.basis,
          // «none» означает ОТСУТСТВИЕ вида отклонения, а не вид с таким именем.
          deviation: finding.deviation === "none" ? undefined : (finding.deviation as DeviationKind),
          /**
           * СУММА ВЛИЯНИЯ И КООРДИНАТА — РАЗНЫЕ ВЕЩИ, и связывать их нельзя.
           *
           * Раньше замечание получало ссылку только вместе с деньгами. На
           * пакете без стоимостной части это дало «показывать нечего» при
           * двухстах сорока девяти замечаниях: суммы нет ни у одной позиции,
           * значит и координаты нет ни у одной, значит на встрече показать
           * нечего — хотя строка в книге известна у каждой.
           */
          impact:
            source === undefined || ref === undefined || source.amount === undefined
              ? undefined
              : {
                  // Сумма влияния — из расчётного модуля, не из ответа модели.
                  value: money(source.amount),
                  provenance: { kind: "source", ref },
                },
          source: ref,
        });
      }

      const options = turn.output.options ?? [];

      // Форма ответа сверяется с контрактом режима (§5.4). Считается по тому,
      // что реально уехало в результат: вердикт и формулировки замечаний.
      //
      // Числа с источником: у выпущенных замечаний основание есть всегда —
      // оболочка отбраковала те, у которых его нет. Проверка это подтверждает,
      // а не дублирует: если отбраковка когда-нибудь сломается, режим
      // «стандарт» заметит это раньше человека.
      const answerText = [turn.output.verdict, ...findings.map((finding) => finding.statement)].join(
        "\n",
      );
      const numbers = (answerText.match(/\d+(?:[.,]\d+)?/gu) ?? []).length;

      const depthCheck = checkDepth(depth, {
        text: answerText,
        numbers,
        numbersWithSource: numbers,
        options: options.length,
      });

      return {
        body: {
          documentPath: input.documentPath,
          /**
           * Цвет вердикта поднимается по СОБСТВЕННЫМ находкам агента.
           *
           * Замерено по боевой базе 09.09.2026: два прогона конвейера дали
           * «🟢 арифметически принимаем» при четырёх и одной находке уровня
           * critical/high. Читатель сводки видит кружок, а не текст под ним.
           */
          verdict: raiseVerdictColour(turn.output.verdict, findings.map((finding) => finding.severity)),
          options,
          depth: { mode: depth, violations: depthCheck.violations },
          findings,
          rejected,
          openQuestions: turn.output.openQuestions,
          /**
           * Листы отдаются КАК ЕСТЬ, без сведения к объявленному списку.
           *
           * Пустые отбрасываются: лист без единой строки — это не «предмет
           * проверен и пуст», а «агент завёл заголовок и не заполнил», и в
           * документе он читался бы как проверенная пустота.
           */
          sections: (turn.output.sections ?? []).filter((section) => section.rows.length > 0),
          accuracy: spec.accuracy(input),
          run: {
            provider: turn.provider,
            model: turn.model,
            inputTokens: turn.inputTokens,
            outputTokens: turn.outputTokens,
            latencyMs: turn.latencyMs,
          },
        },
        inputHashes: [evidence.contentHash] as readonly Sha256[],
      };
    },
  };
}
