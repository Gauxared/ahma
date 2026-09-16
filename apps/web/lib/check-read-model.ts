/**
 * Read-модель рабочего экрана Проверки (веха Ф1 трека, поверхность `S-05`).
 *
 * ЧТО ЛЕЖИТ В БАЗЕ, А ЧТО ВЫЧИСЛЯЕТСЯ
 *
 * База хранит только ИСПОЛНЕННЫЕ шаги и конечное состояние предметов гейтов.
 * Заблокированных шагов в ней нет вовсе — блокировка не событие, а следствие
 * состояния предметов, и записывать её значило бы завести вторую истину,
 * способную разойтись с первой.
 *
 * Поэтому статус нестартовавшего шага здесь ВЫЧИСЛЯЕТСЯ — тем же предикатом
 * `startable`, которым пользуется протокол. Не копией правил, а именно им:
 * копия разошлась бы с оригиналом на первой же правке критических правил, и
 * разошлась бы молча.
 *
 * Каждая строка несёт признак `derived`, и экран обязан его показывать.
 * «Заблокирован» прочитанный и «заблокирован» вычисленный — разные утверждения:
 * первое говорит, что так было, второе — что так есть сейчас.
 */
import { loadWorkflows } from "@platform/config/workflow-loader";
import { join } from "node:path";

import { capabilitiesOfWorkflow, personToCapability } from "@platform/config/workflow-capabilities";
import { loadAgentRoster } from "@platform/config/agent-roster";
import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { startable, type Block, type SubjectState, type SubjectStatus } from "@modules/workflow/protocol";

import { agentRoster } from "./agent-roles.js";

export type StepStatus = "исполнен" | "не реализован" | "заблокирован" | "не выполнялся";

export interface StepRow {
  readonly agent: string;
  /** Предметы, которые шаг создаёт или обновляет. */
  readonly produces: readonly string[];
  readonly status: StepStatus;
  readonly attempts: number | null;
  readonly doneAt: Date | null;
  /** Непусто только у заблокированного: чего именно не хватает и чем это грозит. */
  readonly blocks: readonly Block[];
  /** Статус вычислен по конечному состоянию предметов, а не прочитан из базы. */
  readonly derived: boolean;
}

export interface StageRow {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly StepRow[];
}

export interface SubjectRow {
  readonly id: string;
  readonly status: SubjectStatus;
  readonly returnedCount: number;
  readonly reason: string | null;
  readonly updatedAt: Date;
}


/** Гейт обхода: договорный критерий с собственным объяснением. */
export interface GateRow {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly passed: boolean;
}

export interface DocumentRow {
  readonly path: string;
  readonly kind: string;
  readonly status: string;
  readonly reason: string | null;
  /**
   * Что взято из документа, если позиций из него не извлекают.
   *
   * Без этого «позиций 0» — единственное, что видит человек о файле в четыре
   * мегабайта, и читается это как «пусто». Здесь стоит обратное: страниц,
   * знаков текстового слоя и листов, ушедших агентам картинками.
   */
  readonly readout: { readonly pages: number; readonly chars: number; readonly sheets: number | null } | null;
}

/**
 * Канонический артефакт операции.
 *
 * `parsed: false` — тело операции этот экран разбирать не умеет. Показать его
 * «как-нибудь» нельзя: чужая структура, выведенная наугад, читалась бы как
 * результат. Поэтому неразобранное честно называется неразобранным.
 */
/**
 * ОТКУДА ВЗЯТО ЗАМЕЧАНИЕ — веха Д3 плана демо.
 *
 * Задача показа называет это «одной из главных особенностей продукта»: клиент
 * нажимает на вывод и должен дойти до листа и строки исходного файла, а не до
 * абзаца прозы.
 *
 * Слова, а не ключи артефакта. `fact` и `parsed` — внутренние имена контракта;
 * человеку нужны «факт» и «разобрано из файла». Утечка внутреннего имени на
 * экран уже стоила этому треку выговора (`Ф-113`).
 */
export interface FindingSourceView {
  /**
   * Файл, из которого взято ЭТО значение.
   *
   * Не то же, что `ReviewFindingView.document`: тот — предмет агента, и у
   * объектного агента он пуст по существу (предмет — папка объекта). А позиция
   * свой файл знает: с `Ф-152` каждая строка доказательства несёт собственный
   * `sourceId`. До экрана он не доходил, и половина сильных находок стояла с
   * координатой «лист «ЛСР», строка 240» без ответа на вопрос «в каком файле».
   *
   * Пусто, когда `sourceId` указывает не на файл (папка объекта) — называть
   * папку файлом хуже, чем промолчать.
   */
  readonly document: string | null;
  /** Готовая формулировка: «лист „Раздел 1“, строка 12» либо «страница 4». */
  readonly where: string;
  /** Лист и строка отдельно — по ним строится переход к позиции сметы. */
  readonly sheet: string | null;
  readonly row: number | null;
  /** Уровень доверия по ТЗ §7: факт · ориентир · нет данных. */
  readonly status: string;
  /** Как значение попало в систему. Распознавание отделено намеренно (§14). */
  readonly acquisition: string;
  /**
   * Отпечаток ПРОВЕРЕННОЙ версии файла — графа «версия» формы результата.
   *
   * Он лежал в артефакте с самого начала и на экран не доходил, а переход к
   * строке искал ПОСЛЕДНЮЮ ревизию документа по имени файла. Смету перезалили
   * после прогона — и ссылка «откуда взято» вела к другим строкам: тихий разрыв
   * ровно в том месте, которое задача называет главной особенностью продукта.
   */
  readonly contentHash: string | null;
}

/**
 * Сумма, к которой относится замечание, — графа «значение» формы результата.
 *
 * ЭТО НЕ «ДЕНЬГИ ПОД РИСКОМ», И ПУТАТЬ НЕЛЬЗЯ
 *
 * Оболочка агента берёт из ответа модели НОМЕР позиции, находит её в разборе и
 * кладёт сюда сумму этой позиции — из расчётного модуля, а не из ответа модели.
 * То есть это «сколько стоит строка, о которой идёт речь», а не «сколько мы
 * потеряем».
 *
 * Проверка на курганском прогоне: пять замечаний разных агентов об одной дорогой
 * позиции несут одну и ту же сумму, а сумма всех величин по объекту — 509 млн ₽
 * против сметных 105 млн. Складывать их нельзя, называть риском нельзя;
 * упорядочивать по ним — можно, и подпись обязана называть их тем, что они есть.
 */
export interface FindingAmountView {
  /** Разряжённая сумма с копейками: «824 009,97». */
  readonly text: string;
  /** Число для упорядочивания. Показу не отдаётся. */
  readonly value: number;
  readonly currency: string;
}

/** Класс отклонения по ТЗ §5.2 — графа «вывод/риск» рядом с важностью. */
const DEVIATION_WORD: Readonly<Record<string, string>> = {
  market_movement: "движение рынка",
  technical_solution: "техническое решение",
  quantity_error: "ошибка в объёме",
  rate_overstatement: "завышение расценки",
  double_count: "двойной учёт",
};

export interface ReviewFindingView {
  readonly severity: string;
  readonly statement: string;
  readonly basis: string;
  /**
   * Сумма позиции, к которой относится замечание. `null` — модель позиции не
   * назвала, и величины у замечания нет вовсе.
   */
  readonly amount: FindingAmountView | null;
  /**
   * Класс отклонения словом человека. `null` — агент его не объявил.
   *
   * Не выводится из важности: «критично» говорит, насколько это тяжело, а
   * «двойной учёт» — что именно не так. Досчитать второе из первого нельзя.
   */
  readonly deviation: string | null;
  /**
   * Файл, в котором замечание найдено, — именем, а не путём.
   *
   * Без него до строки не дойти: координата говорит «лист „Раздел 1“, строка
   * 12», а строка 12 есть в каждой смете объекта. Разрез по агенту склеивает
   * записи разных документов, и путь при склейке терялся.
   *
   * Пусто у выводов об объекте целиком: у них предмет — не файл.
   */
  readonly document: string;
  /**
   * `null` — координаты нет, и это ЗАКОННО: вывод об объекте целиком к строке
   * не привязан. Экран помечает такое замечание словом «основание текстовое»,
   * а не показывает так же, как замечание со следом.
   */
  readonly source: FindingSourceView | null;
}

/** Что проверить человеку: вопрос, владелец, срок (ТЗ §9). */
/**
 * Режим прогона СЛОВОМ, а не идентификатором базы.
 *
 * `queued` на экране уже был однажды исправлен (`Ф-170`): английский
 * идентификатор человеку не говорит ничего. С появлением агентного режима
 * (Т9.1) та же ошибка вернулась бы под именем `agentic` — а разница между
 * режимами это то, что читатель обязан понять с первого взгляда: они дают
 * разной глубины разбор за разное время.
 *
 * Неизвестное значение показывается КАК ЕСТЬ: ключ хуже слова, но лучше
 * молчания — по нему видно, что режим объявлен, и видно, какого перевода нет.
 */
const РЕЖИМ_СЛОВОМ: Readonly<Record<string, string>> = {
  express: "быстрый",
  standard: "конвейер",
  expert: "эксперт",
  agentic: "агентный · цикл с инструментами",
  /**
   * Название режима — тем, что он ДЕЛАЕТ, а не тем, на чём сделан.
   *
   * «Codex SDK» — имя чужой библиотеки: заказчику оно ничего не говорит, а
   * системе добавляет обещание, которого она не давала. Решение владельца
   * 09.09.2026: из интерфейса убрать. В коде и документации имя остаётся —
   * там оно и уместно.
   */
  codex: "агенты · экипаж ролей",
};

export function режимСловом(mode: string): string {
  return РЕЖИМ_СЛОВОМ[mode] ?? mode;
}

export interface OpenQuestionView {
  readonly question: string;
  readonly owner: string;
  readonly dueBy: string;
}

export interface ReviewDocumentView {
  readonly path: string;
  readonly verdict: string;
  readonly findings: readonly ReviewFindingView[];
}

/**
 * Класс вердикта, объявленный САМИМ агентом светофором в первом знаке.
 *
 * Модель ставит `🔴`, `🟡` или `🟢` в начало вердикта, и это единственное во
 * всём ответе, что можно прочитать не читая. Интерфейс это выбрасывал: знак
 * оставался внутри абзаца, где он ничем не отличается от прочей типографики.
 *
 * `null` — агент класса НЕ ОБЪЯВЛЯЛ, и это отдельное состояние, а не «зелёный
 * по умолчанию». Из четырёх вердиктов сметчика по курганскому объекту знак есть
 * у трёх; додумать четвёртый значило бы приписать агенту вывод, которого он не
 * делал.
 */
export type VerdictLight = "красный" | "жёлтый" | "зелёный";

export interface AgentVerdictView {
  /**
   * Предмет вердикта — имя сметы либо пусто у вывода об объекте целиком.
   *
   * ЭТО И БЫЛА ГЛАВНАЯ ПОТЕРЯ. Вердикты склеивались в одну строку через `; `, а
   * список предметов лежал рядом отдельным полем: по четырём вердиктам и
   * четырём именам файлов нельзя было сказать, какой вердикт о какой смете.
   * Экран показывал полторы тысячи знаков сплошной прозой в колонке шириной
   * триста сорок пикселей — и это ровно то место, ради которого экран открывают.
   */
  readonly subject: string;
  readonly light: VerdictLight | null;
  /** Текст вердикта без знака светофора: знак стал состоянием, а не типографикой. */
  readonly text: string;
}

/**
 * Замечания одного агента.
 *
 * ЭТОГО ПРЕДСТАВЛЕНИЯ НЕ БЫЛО, И ЭТО БЫЛА ГЛАВНАЯ ПОТЕРЯ ВЕБА
 *
 * Ядро несёт `capability` у каждой записи обзора — то есть КТО сказал
 * (`modules/workflow/check-object.ts`). Read-модель группировала записи по пути
 * документа и `capability` роняла: на курганском объекте девять агентов выдали
 * 176 замечаний, а экран показывал их одной строкой таблицы.
 *
 * Из-за этого нельзя было построить ни доску кросс-валидации — то, на чём
 * держатся все три прототипа заказчика, — ни пакет заказчику, где документ
 * собирается ПО АГЕНТУ. Данные лежали в артефакте всё это время.
 */
export interface ReviewAgentView {
  /** Способность из манифеста: `estimate_review`, `finance_model`, … */
  readonly capability: string;
  /** Вердикты агента — ПО ОДНОМУ НА ПРЕДМЕТ, а не склеенные в абзац. */
  readonly verdicts: readonly AgentVerdictView[];
  /** По каким документам агент высказался. */
  readonly subjects: readonly string[];
  readonly findings: readonly ReviewFindingView[];
  readonly bySeverity: readonly (readonly [string, number])[];
  /** Отказ агента: он запускался и не смог, а это не то же, что «замечаний нет». */
  readonly errors: readonly string[];
  /** Что агент просит проверить человеку: с владельцем и сроком (Д3). */
  readonly openQuestions: readonly OpenQuestionView[];
  /**
   * Предметные листы заключения — так, как их описал агент по ЭТОМУ объекту.
   *
   * Названия и колонки не заданы конфигурацией: эталонный пакет снят с одного
   * объекта, и его «КС_геометрия» бессмысленна для жилого дома.
   */
  readonly sheets: readonly AgentSheetView[];
}

/** Один предметный лист заключения. */
export interface AgentSheetView {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** Обзор сметчика: заполняется, только если агент отработал. */
export interface ReviewView {
  readonly findings: number;
  readonly failed: number;
  readonly bySeverity: readonly (readonly [string, number])[];
  readonly documents: readonly ReviewDocumentView[];
  /** Те же записи, сгруппированные по тому, КТО их дал. */
  readonly agents: readonly ReviewAgentView[];
}

export interface ArtifactView {
  /** Заполнено только у операции `compare-offers`. */
  readonly comparison: ComparisonView | null;
  /** Заполнено, только если обзор запрашивали и агент отработал. */
  readonly review: ReviewView | null;
  readonly id: string;
  readonly operationId: string;
  readonly operationVersion: number;
  readonly completeness: string;
  readonly producedAt: Date;
  readonly parsed: boolean;
  /**
   * Отпечатки входов прогона.
   *
   * Нужны выгрузке: лист «Не покрыто» каждого документа пакета утверждает либо
   * «входы такие-то», либо «прогон не записал хэши входов». Второе утверждение
   * обязано быть проверенным, а не значением по умолчанию, — иначе документ
   * сообщает о невоспроизводимости прогона, которая, возможно, ложна.
   */
  readonly inputHashes: readonly string[];
  readonly verdict: string | null;
  readonly gates: readonly GateRow[];
  readonly totals: readonly (readonly [string, number])[];
  readonly documents: readonly DocumentRow[];
}

/**
 * Итоги в порядке чтения, а не в порядке ключей JSON.
 *
 * Порядок полей объекта — свойство сериализации, и полагаться на него значит
 * получить «без шифра» раньше «позиций». Читаются они от общего к частному:
 * сколько документов → сколько из них смет → сколько позиций → как они разошлись.
 */
/**
 * Разбор тела `compare-offers`.
 *
 * Тело складывается целиком — это `ComparisonResult` платформы, — но приходит
 * из JSON, то есть `unknown`. Приводить его типом нельзя: артефакт мог быть
 * записан прошлой версией операции, и молчаливое приведение выдало бы чужую
 * структуру за свою. Проверяются только те поля, которые экран показывает.
 */
export interface ComparisonPositionView {
  readonly canonicalId: string;
  readonly quantity: string | null;
  readonly offers: readonly { readonly source: string; readonly amount: string }[];
  readonly comparable: number | null;
  readonly min: string | null;
  readonly median: string | null;
  readonly max: string | null;
  readonly ratio: string | null;
  readonly spreadReason: string | null;
  readonly excluded: readonly { readonly source: string; readonly reason: string }[];
  readonly anomalies: readonly {
    readonly source: string;
    readonly amount: string;
    readonly impact: string;
    readonly ratio: string;
  }[];
  readonly unitMin: string | null;
  readonly unitMedian: string | null;
  readonly unitMax: string | null;
  /** Почему цена за единицу не посчитана: причин две, и они разные. */
  readonly unitSpreadReason: string | null;
  readonly estimateUnitPrice: string | null;
  readonly estimateLow: string | null;
  readonly estimateHigh: string | null;
  readonly estimateTotal: string | null;
  readonly estimateSources: readonly string[];
  /** Причина, по которой оценка не построена: пустой ячейки здесь быть не может. */
  readonly estimateReason: string | null;
  readonly deviationCategory: string | null;
  readonly deviationBasis: string | null;
  readonly deviationRemedy: string | null;
}

export interface ComparisonView {
  readonly objectName: string;
  readonly offersTotal: number;
  readonly ready: boolean;
  readonly contractors: readonly {
    readonly contractor: string;
    readonly note: string;
    readonly total: string;
    readonly matchedAmount: string;
  }[];
  readonly pending: readonly { readonly offerLine: string; readonly explanation: string }[];
  readonly unmatched: readonly { readonly offerLine: string; readonly explanation: string }[];
  readonly positions: readonly ComparisonPositionView[];
}

/** Уровень доверия словом (ТЗ §7). Одно место, а не литерал по экранам. */
const SOURCE_STATUS_WORD: Readonly<Record<string, string>> = {
  fact: "факт",
  benchmark: "ориентир",
  no_data: "нет данных",
};

/**
 * Способ получения словом.
 *
 * `ocr_unconfirmed` отделено намеренно и звучит тревожно: §14 исключает
 * распознавание сканов из объёма, и такое значение не идёт в зачёт §12.1а без
 * протокола. Назвать его просто «разобрано» значило бы спрятать оговорку,
 * которая и есть содержание.
 */
const ACQUISITION_WORD: Readonly<Record<string, string>> = {
  parsed: "разобрано из файла",
  imported: "загружено",
  confirmed_by_human: "подтверждено человеком",
  ocr_unconfirmed: "распознано, не подтверждено",
};

/**
 * Ссылка на источник замечания, приведённая к словам.
 *
 * Разбирается ПО ПОЛЯМ, как и всё остальное в этом файле: тело артефакта
 * приходит из JSON, и приведение типом выдало бы структуру прошлой версии
 * операции за свою.
 *
 * Локатор без известного вида даёт `null`, а не «источник неизвестного вида»:
 * подпись, которую нельзя прочитать, хуже отсутствия подписи — она обещает
 * след, до которого не дойти.
 */
export function viewFindingSource(value: unknown): FindingSourceView | null {
  const ref = asRecord(value);
  if (ref === undefined) return null;

  const locator = asRecord(ref["locator"]);
  if (locator === undefined) return null;

  const status = SOURCE_STATUS_WORD[asText(ref["status"]) ?? ""] ?? "уровень доверия не назван";
  const acquisition = ACQUISITION_WORD[asText(ref["acquisition"]) ?? ""] ?? "способ получения не назван";

  const sheet = asText(locator["sheet"]);
  const row = asNumber(locator["row"]);
  const kind = asText(locator["kind"]);
  const contentHash = asText(ref["contentHash"]);
  const общее = { status, acquisition, contentHash, document: файлИз(asText(ref["sourceId"])) };

  if (kind === "row" && sheet !== null && row !== null) {
    return { where: `лист «${sheet}», строка ${row}`, sheet, row, ...общее };
  }

  if (kind === "cell" && sheet !== null) {
    const ref2 = asText(locator["ref"]) ?? "—";
    return { where: `лист «${sheet}», клетка ${ref2}`, sheet, row: null, ...общее };
  }

  const page = asNumber(locator["page"]);
  if (kind === "page" && page !== null) {
    return { where: `страница ${page}`, sheet: null, row: null, ...общее };
  }

  /**
   * След до ПОЗИЦИИ, а не до строки.
   *
   * Так помечает себя реверс объёма: он работает с порядковыми номерами
   * позиций и строки книги не знает. Раньше на этом месте выдавался
   * `{ kind: "row", row: 0 }` — координата «строка 0», которой в книге нет и
   * которая на экране ничем не отличалась от настоящей.
   *
   * Правда меньшей точности лучше выдуманной точности: позиция названа, файл
   * назван, перехода к строке нет — и это видно.
   */
  const record = asText(locator["recordId"]);
  if (kind === "record" && record !== null) {
    return { where: `позиция № ${record}`, sheet: null, row: null, ...общее };
  }

  return null;
}

/**
 * Сумма позиции из `Valued<Money>`.
 *
 * Разбирается ПО ПОЛЯМ, как всё остальное в этом файле: тело артефакта приходит
 * из JSON. Нечисловая сумма даёт `null`, а не ноль: «позиция стоит 0 ₽» и
 * «величины нет» — разные утверждения, и первое из них было бы выдумкой.
 */
function viewAmount(value: unknown): FindingAmountView | null {
  const impact = asRecord(value);
  if (impact === undefined) return null;

  const money = asRecord(impact["value"]);
  if (money === undefined) return null;

  const raw = asText(money["amount"]);
  if (raw === null) return null;

  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;

  return {
    text: amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    value: amount,
    currency: money["currency"] === "RUB" ? "₽" : (asText(money["currency"]) ?? "₽"),
  };
}

/**
 * Ссылка на источник ЗАМЕЧАНИЯ либо на источник его суммы.
 *
 * У замечания с суммой координата лежит дважды: своим полем `source` и внутри
 * `impact.provenance.ref`. Второе появилось раньше первого и у части замечаний
 * осталось единственным — их писал прошлый воркер, до вехи Д3. Читать только
 * `source` значило бы потерять след у замечаний старых прогонов, а именно они
 * лежат в базе сейчас.
 */
function sourceOfFinding(item: Record<string, unknown>): FindingSourceView | null {
  const own = viewFindingSource(item["source"]);
  if (own !== null) return own;

  const impact = asRecord(item["impact"]);
  const provenance = impact === undefined ? undefined : asRecord(impact["provenance"]);

  return provenance === undefined ? null : viewFindingSource(provenance["ref"]);
}

/** Что обход взял из документа. Пусто — брать было нечего либо не спрашивали. */
function разбор(value: unknown): DocumentRow["readout"] {
  const item = asRecord(value);
  if (item === undefined) return null;

  const pages = asNumber(item["pages"]);
  const chars = asNumber(item["chars"]);
  if (pages === null || chars === null) return null;

  return { pages, chars, sheets: asNumber(item["sheets"]) };
}

/** Имя файла из пути внутри партии. Путь на экране не нужен, имя — нужно. */
function документИз(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Имя файла из `sourceId`, если это вообще файл.
 *
 * У объектного агента `sourceId` может указывать на папку объекта — тогда
 * последний сегмент пути это шифр объекта, а не документ. Показать его как имя
 * файла значило бы дать неверный ответ на главный вопрос продукта. Признак
 * файла — расширение из тех, что система принимает.
 */
function файлИз(sourceId: string | null): string | null {
  if (sourceId === null) return null;

  const имя = документИз(sourceId);

  return /\.(xlsx|xlsm|xls|csv|txt|xml|pdf|docx)$/i.test(имя) ? имя : null;
}

const LIGHT_SIGN: Readonly<Record<string, VerdictLight>> = {
  "🔴": "красный",
  "🟡": "жёлтый",
  "🟠": "жёлтый",
  "🟢": "зелёный",
};

/**
 * Вердикт агента по одному предмету.
 *
 * Знак снимается ТОЛЬКО с начала строки. Тот же знак встречается и в середине
 * вердикта — там он часть фразы («риск 🔴 по срокам»), и вынести его в
 * состояние значило бы выдать оговорку внутри предложения за итог по смете.
 *
 * Суммы здесь НЕ трогаются: разрядка — дело показа, и делает её экран
 * (`formatAmountsInProse`). Выгрузки получают текст ровно таким, каким его
 * написал агент, — документ заказчику не место для наших типографских правок.
 */
export function viewVerdict(subject: string, raw: string): AgentVerdictView | undefined {
  const text = raw.trim();
  if (text === "") return undefined;

  const sign = [...text][0] ?? "";
  const light = LIGHT_SIGN[sign];

  return light === undefined
    ? { subject, light: null, text }
    : { subject, light, text: text.slice(sign.length).trim() };
}

/**
 * Вердикты одной строкой — для выгрузок, а не для экрана.
 *
 * Книги пакета и записка заказчику держат вердикт одной ячейкой: разложить его
 * там по предметам — отдельная работа над формой документа. Склейка осталась
 * ровно одна, здесь, и она выводится из разложенного представления. Обратно —
 * от строки к предметам — уже не восстановишь, и именно поэтому склейка теперь
 * последняя, а не первая.
 */
export function verdictText(verdicts: readonly AgentVerdictView[]): string {
  return verdicts.map((verdict) => verdict.text).join("; ");
}

/** Замечание, приведённое к виду экрана. Один разбор на три места чтения. */
function viewFinding(item: Record<string, unknown>, document: string): ReviewFindingView {
  const deviation = asText(item["deviation"]);

  return {
    severity: asText(item["severity"]) ?? "—",
    statement: asText(item["statement"]) ?? "",
    basis: asText(item["basis"]) ?? "",
    amount: viewAmount(item["impact"]),
    // Неизвестный класс отклонения показывается КАК ЕСТЬ, а не отбрасывается:
    // ключ на экране хуже слова, но лучше молчания — по нему хотя бы видно, что
    // агент класс объявил, и видно, какого перевода не хватает.
    deviation: deviation === null ? null : (DEVIATION_WORD[deviation] ?? deviation),
    document,
    source: sourceOfFinding(item),
  };
}

/**
 * Предметные листы из ответа агента.
 *
 * Лист без строк или без колонок отбрасывается: заголовок без содержимого в
 * документе читается как «предмет проверен и пуст», а это утверждение, которого
 * агент не делал.
 */
function листыАгента(value: unknown): readonly AgentSheetView[] {
  return asList(value)
    .map(asRecord)
    .flatMap((item): AgentSheetView[] => {
      if (item === undefined) return [];

      const id = asText(item["id"]);
      const columns = asList(item["columns"]).map((cell) => asText(cell) ?? "");
      const rows = asList(item["rows"]).map((row) => asList(row).map((cell) => asText(cell) ?? ""));

      if (id === null || columns.length === 0 || rows.length === 0) return [];

      return [
        {
          id,
          title: asText(item["title"]) ?? id,
          purpose: asText(item["purpose"]) ?? "",
          columns,
          rows,
        },
      ];
    });
}

/**
 * ЛИСТ ОДНОГО АГЕНТА ПО НЕСКОЛЬКИМ ДОКУМЕНТАМ — ОДИН ЛИСТ, А НЕ ПЕРВЫЙ ИЗ ЧЕТЫРЁХ.
 *
 * ЧТО БЫЛО. Документный агент высказывается по КАЖДОЙ смете и каждый раз
 * возвращает свои листы. Сметчик на прогоне эталонного входа дал «Сходимость»
 * четырежды — по одной на каждую ЛСР. Сборка брала первый вхождение и молча
 * отбрасывала три остальных: книга показывала лист «Сходимость сметы» с одной
 * сметой из четырёх и не говорила об этом ни слова.
 *
 * Это худший вид потери: заголовок обещает предмет целиком, таблица под ним
 * заполнена, и отличить «проверена одна» от «проверены все» нельзя ничем.
 *
 * ЧТО СТАЛО. Одинаковые по `id` листы сводятся в один, и первой колонкой
 * встаёт ДОКУМЕНТ. Так устроен и эталонный пакет: «Чеклист_ЛСР» — один лист на
 * все сметы, а не четыре листа подряд.
 *
 * КОЛОНКИ СОВМЕЩАЮТСЯ ПО ИМЕНИ, А НЕ ПО НОМЕРУ. Замерено на том же прогоне: у
 * «Сходимости» по первой смете четыре колонки, по второй — пять. Совмещение по
 * порядку сдвинуло бы значения на одну графу — числа встали бы под чужими
 * заголовками, и таблица врала бы, оставаясь заполненной. Графа, которой у
 * документа не было, помечается прочерком: пусто читалось бы как ноль (§9).
 */
function сведённыеЛисты(
  собранные: readonly { readonly subject: string; readonly sheet: AgentSheetView }[],
): readonly AgentSheetView[] {
  const поId = new Map<string, { readonly subject: string; readonly sheet: AgentSheetView }[]>();

  for (const item of собранные) {
    const known = поId.get(item.sheet.id);
    if (known === undefined) поId.set(item.sheet.id, [item]);
    else known.push(item);
  }

  return [...поId.values()].map((группа) => {
    const первый = группа[0]!;
    if (группа.length === 1) return первый.sheet;

    // Порядок колонок — порядок первого появления: он же порядок обхода, и
    // читатель видит лист первой сметы таким, каким его дал агент.
    const колонки: string[] = [];
    for (const { sheet } of группа)
      for (const column of sheet.columns) if (!колонки.includes(column)) колонки.push(column);

    const rows: string[][] = [];
    for (const { subject, sheet } of группа) {
      for (const row of sheet.rows) {
        const поИмени = new Map(sheet.columns.map((column, index) => [column, row[index] ?? ""]));
        rows.push([subject, ...колонки.map((column) => поИмени.get(column) ?? "—")]);
      }
    }

    return {
      id: первый.sheet.id,
      title: первый.sheet.title,
      purpose:
        `${первый.sheet.purpose} · сведено по ${группа.length} документам; ` +
        "первая графа — документ, прочерк означает, что такой графы у документа не было",
      columns: ["Документ", ...колонки],
      rows,
    };
  });
}

/** Открытые вопросы агента. Без владельца и срока вопрос — не поручение (§9). */
function viewOpenQuestions(value: unknown): readonly OpenQuestionView[] {
  return asList(value)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => ({
      question: asText(item["question"]) ?? "",
      owner: asText(item["owner"]) ?? "владелец не назван",
      dueBy: asText(item["dueBy"]) ?? "срок не назван",
    }))
    .filter((question) => question.question !== "");
}

const SEVERITY_ORDER: readonly (readonly [string, string])[] = [
  ["critical", "критические"],
  ["high", "высокие"],
  ["medium", "средние"],
  ["low", "низкие"],
  ["info", "сведения"],
];

function viewReview(value: unknown): ReviewView | null {
  const review = asRecord(value);
  if (review === undefined) return null;

  const severities = asRecord(review["bySeverity"]) ?? {};

  return {
    findings: asNumber(review["findings"]) ?? 0,
    failed: asNumber(review["failed"]) ?? 0,
    // Порядок важности задан явно: по алфавиту «critical» встал бы после
    // «high», и глаз читал бы не то, что нужно читать первым.
    bySeverity: SEVERITY_ORDER.filter(([key]) => typeof severities[key] === "number").map(
      ([key, word]) => [word, severities[key] as number] as const,
    ),
    documents: groupByDocument(asList(review["documents"])),
    agents: groupByAgent(asList(review["documents"])),
  };
}

/**
 * Обзор группируется ПО АГЕНТУ — второй разрез тех же записей.
 *
 * Не вместо разреза по документу, а рядом: «что не так с этой сметой» и «что
 * сказал экономист» — разные вопросы, и оба задают. Общее у них одно: терять
 * `capability` нельзя ни в том, ни в другом.
 *
 * Запись без `capability` попадает в группу `без-агента`, а не отбрасывается:
 * такие записи ставит сам обход объекта (сверка ЛСР со сводным расчётом), и
 * молча их терять значило бы занизить число замечаний на экране относительно
 * числа в артефакте.
 */
export function groupByAgent(rows: readonly unknown[]): readonly ReviewAgentView[] {
  const byAgent = new Map<
    string,
    {
      verdicts: AgentVerdictView[];
      subjects: string[];
      findings: ReviewFindingView[];
      errors: string[];
      questions: OpenQuestionView[];
      sheets: { subject: string; sheet: AgentSheetView }[];
    }
  >();

  for (const raw of rows) {
    const row = asRecord(raw);
    if (row === undefined) continue;

    const capability = asText(row["capability"]) ?? "без-агента";
    const bucket =
      byAgent.get(capability) ?? { verdicts: [], subjects: [], findings: [], errors: [], questions: [], sheets: [] };

    // Предмет читается ДО вердикта: вердикт им подписывается, и без подписи он
    // снова стал бы куском абзаца, о котором неизвестно, к какой смете он.
    const subject = (asText(row["path"]) ?? "").split("/").pop() ?? "";

    const verdict = viewVerdict(
      // У вывода об объекте целиком предмет — путь папки, а не файл, и
      // подписывать им вердикт значило бы назвать объект документом.
      asText(row["scope"]) === "объект" ? "" : subject,
      asText(row["verdict"]) ?? "",
    );

    if (verdict !== undefined && !bucket.verdicts.some((known) => known.text === verdict.text)) {
      bucket.verdicts.push(verdict);
    }

    if (subject !== "" && !bucket.subjects.includes(subject)) bucket.subjects.push(subject);

    const error = asText(row["error"]) ?? "";
    if (error !== "" && !bucket.errors.includes(error)) bucket.errors.push(error);

    for (const item of asList(row["findings"])) {
      const finding = asRecord(item);
      if (finding === undefined) continue;
      bucket.findings.push(viewFinding(finding, asText(row["scope"]) === "объект" ? "" : subject));
    }

    for (const question of viewOpenQuestions(row["openQuestions"])) {
      // Один и тот же вопрос по четырём сметам агент задаёт четыре раза; в
      // реестре поручений он один. Сверка по тексту и владельцу: срок у
      // повтора тот же, а если разошёлся — это уже другое поручение.
      if (!bucket.questions.some((known) => known.question === question.question && known.owner === question.owner)) {
        bucket.questions.push(question);
      }
    }

    for (const sheet of листыАгента(row["sections"])) {
      bucket.sheets.push({ subject, sheet });
    }

    byAgent.set(capability, bucket);
  }

  return [...byAgent.entries()]
    .map(([capability, bucket]) => ({
      capability,
      verdicts: bucket.verdicts,
      subjects: bucket.subjects,
      findings: bucket.findings,
      bySeverity: countBySeverity(bucket.findings),
      errors: bucket.errors,
      openQuestions: bucket.questions,
      sheets: сведённыеЛисты(bucket.sheets),
    }))
    // Тяжёлое сверху: агент с критичными замечаниями важнее агента с одним
    // «низким», а число замечаний — плохой порядок сам по себе.
    .sort((left, right) => weightOf(right) - weightOf(left) || left.capability.localeCompare(right.capability, "ru"));
}

/**
 * Счёт по важности. Экспортирован, потому что появился второй читатель: ход
 * прогона считает то же самое по тем же правилам, и вторая реализация
 * разошлась бы с первой в порядке важностей — то есть в том, что читают первым.
 */
export function countBySeverity(findings: readonly ReviewFindingView[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();

  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  return SEVERITY_ORDER.filter(([key]) => counts.has(key)).map(([key, word]) => [word, counts.get(key) as number] as const);
}

/**
 * Вес агента для порядка на экране.
 *
 * Вес важности выводится из `SEVERITY_ORDER`, а не задаётся вторым списком:
 * порядок важности в этом файле уже объявлен один раз, и второе его объявление
 * разошлось бы с первым при первой же правке. Неизвестная важность весит как
 * самая слабая — придумывать ей место было бы догадкой.
 *
 * Отказ агента весит как одно критичное замечание: «агент не смог» — это не
 * «замечаний нет», и наверх такой агент попасть обязан.
 */
function weightOf(agent: ReviewAgentView): number {
  const top = SEVERITY_ORDER.length;
  const weightOfSeverity = (severity: string): number => {
    const index = SEVERITY_ORDER.findIndex(([key]) => key === severity);
    return index === -1 ? 1 : top - index;
  };

  let weight = agent.errors.length > 0 ? top : 0;

  for (const finding of agent.findings) {
    weight += weightOfSeverity(finding.severity);
  }

  return weight;
}

/**
 * Обзор ГРУППИРУЕТСЯ ПО ДОКУМЕНТУ, а не отдаётся как пришёл.
 *
 * В `review.documents` один файл встречается по разу на агента: четыре агента —
 * четыре записи об одной смете. Экран показывал её четырьмя разделами подряд,
 * а React жаловался на повторяющийся ключ — жалоба была верной, и содержание
 * тоже врало: читатель видел четыре документа там, где документ один.
 *
 * Замечания склеиваются, вердикты — тоже, через точку с запятой: у каждого
 * агента свой, и терять их нельзя.
 */
function groupByDocument(rows: readonly unknown[]): readonly ReviewDocumentView[] {
  const byPath = new Map<string, { verdicts: string[]; findings: ReviewFindingView[] }>();

  for (const raw of rows) {
    const row = asRecord(raw);
    if (row === undefined) continue;

    const path = (asText(row["path"]) ?? "—").split("/").pop() ?? "—";
    const verdict = asText(row["verdict"]) ?? "";
    const findings = asList(row["findings"])
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== undefined)
      .map((item) => viewFinding(item, asText(row["scope"]) === "объект" ? "" : path));

    const bucket = byPath.get(path);

    if (bucket === undefined) {
      byPath.set(path, { verdicts: verdict === "" ? [] : [verdict], findings: [...findings] });
      continue;
    }

    if (verdict !== "" && !bucket.verdicts.includes(verdict)) bucket.verdicts.push(verdict);
    bucket.findings.push(...findings);
  }

  return [...byPath.entries()].map(([path, bucket]) => ({
    path,
    verdict: bucket.verdicts.join("; "),
    findings: bucket.findings,
  }));
}

const TOTAL_ORDER: readonly (readonly [string, string])[] = [
  ["documents", "документов"],
  ["checked", "проверено смет"],
  ["skipped", "пропущено"],
  ["failed", "отказов разбора"],
  ["positions", "позиций из смет"],
  /**
   * Позиции, выписанные ролями, — ОТДЕЛЬНОЙ ПЛИТКОЙ.
   *
   * Замерено на прогоне владельца 09.09.2026: на комплекте без единой сметы
   * формы 421/пр свод показывал «позиций 0» при пятидесяти строках в базе.
   * Складывать их с разобранными в одно число нельзя — у них разный уровень
   * доверия, — а прятать нельзя тем более.
   */
  ["agentPositions", "позиций от ролей"],
  ["byCode", "с нормативным шифром"],
  ["unmatched", "без шифра"],
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Разбор тела артефакта `check-object`.
 *
 * Тело хранится как JSON, то есть на входе — `unknown`, и притворяться, что это
 * типизированная структура, нельзя: артефакт мог быть записан прошлой версией
 * операции. Каждое поле проверяется, а не приводится.
 */

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Разбор тела сравнения — экспортирован, потому что появился второй читатель.
 *
 * Экран сравнения КП по объекту (`/objects/[code]/offers`) читает те же
 * артефакты, что рабочий экран Проверки. Второй разбор того же тела разошёлся бы
 * с первым при первой правке формата.
 */
export function viewComparison(body: Record<string, unknown>): ComparisonView {
  const contractors = asList(body["contractors"])
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== undefined)
    .map((row) => ({
      contractor: asText(row["contractor"]) ?? "—",
      note: asText(row["note"]) ?? "",
      total: asText(row["total"]) ?? "—",
      matchedAmount: asText(row["matchedAmount"]) ?? "—",
    }));

  const ledger = (key: string) =>
    asList(body[key])
      .map(asRecord)
      .filter((row): row is Record<string, unknown> => row !== undefined)
      .map((row) => ({
        offerLine: asText(row["offerLine"]) ?? "—",
        explanation: asText(row["explanation"]) ?? "",
      }));

  const positions = asList(body["positions"])
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== undefined)
    .map((row): ComparisonPositionView => {
      const spread = asRecord(row["spread"]) ?? {};
      const unit = asRecord(row["unitSpread"]) ?? {};

      /**
       * Статистика отдаётся, ТОЛЬКО если расчёт объявил её посчитанной.
       *
       * `spread` при одном предложении возвращает `computable: false` и при
       * этом заполняет min/median/max — разброс одного значения. Командная
       * строка их не печатает, потому что ветвится по `computable`; первая
       * версия этой read-модели отдавала их безусловно, и экран показал бы
       * «медиана 800,00 ₽» там, где система говорит «разброс не считается».
       *
       * Поймано гейтом паритета, а не глазами.
       */
      const stat = (source: Record<string, unknown>, key: string): string | null =>
        source["computable"] === true ? asText(source[key]) : null;
      const estimate = asRecord(row["estimate"]) ?? {};
      const range = asRecord(estimate["range"]) ?? {};
      const deviation = asRecord(row["deviation"]);

      return {
        canonicalId: asText(row["canonicalId"]) ?? "—",
        quantity: asText(row["quantity"]),
        offers: asList(row["offers"])
          .map(asRecord)
          .filter((offer): offer is Record<string, unknown> => offer !== undefined)
          .map((offer) => ({ source: asText(offer["source"]) ?? "—", amount: asText(offer["amount"]) ?? "—" })),
        comparable: asNumber(spread["comparable"]),
        min: stat(spread, "min"),
        median: stat(spread, "median"),
        max: stat(spread, "max"),
        ratio: stat(spread, "ratio"),
        spreadReason: spread["computable"] === true ? null : (asText(spread["reason"]) ?? "причина не названа"),
        excluded: asList(spread["unmatched"])
          .map(asRecord)
          .filter((item): item is Record<string, unknown> => item !== undefined)
          .map((item) => ({ source: asText(item["source"]) ?? "—", reason: asText(item["reason"]) ?? "" })),
        anomalies: asList(spread["anomalies"])
          .map(asRecord)
          .filter((item): item is Record<string, unknown> => item !== undefined)
          .map((item) => ({
            source: asText(item["source"]) ?? "—",
            amount: asText(item["amount"]) ?? "—",
            impact: asText(item["impact"]) ?? "—",
            ratio: asText(item["ratio"]) ?? "—",
          })),
        unitMin: stat(unit, "min"),
        unitMedian: stat(unit, "median"),
        unitMax: stat(unit, "max"),
        unitSpreadReason: unit["computable"] === true ? null : (asText(unit["reason"]) ?? "причина не названа"),
        estimateUnitPrice: estimate["computable"] === true ? asText(estimate["unitPrice"]) : null,
        estimateLow: asText(range["low"]),
        estimateHigh: asText(range["high"]),
        estimateTotal: asText(estimate["total"]),
        estimateSources: asList(estimate["sources"]).filter((item): item is string => typeof item === "string"),
        estimateReason: estimate["computable"] === true ? null : (asText(estimate["reason"]) ?? "причина не названа"),
        deviationCategory: deviation === undefined ? null : asText(deviation["category"]),
        deviationBasis: deviation === undefined ? null : asText(deviation["basis"]),
        deviationRemedy: deviation === undefined ? null : asText(deviation["remedy"]),
      };
    });

  return {
    objectName: asText(body["objectName"]) ?? "—",
    offersTotal: asNumber(body["offersTotal"]) ?? contractors.length,
    ready: body["ready"] === true,
    contractors,
    pending: ledger("pending"),
    unmatched: ledger("unmatched"),
    positions,
  };
}

function viewArtifact(row: {
  readonly id: string;
  readonly operationId: string;
  readonly operationVersion: number;
  readonly completeness: string;
  readonly producedAt: Date;
  readonly inputHashes: readonly string[];
  readonly body: unknown;
}): ArtifactView {
  const empty = {
    comparison: null as ComparisonView | null,
    review: null as ReviewView | null,
    id: row.id,
    operationId: row.operationId,
    operationVersion: row.operationVersion,
    completeness: row.completeness,
    producedAt: row.producedAt,
    inputHashes: row.inputHashes,
    verdict: null,
    gates: [] as readonly GateRow[],
    totals: [] as readonly (readonly [string, number])[],
    documents: [] as readonly DocumentRow[],
  };

  const body = asRecord(row.body);
  if (body === undefined) {
    return { ...empty, parsed: false };
  }

  if (row.operationId === "compare-offers") {
    return { ...empty, parsed: true, comparison: viewComparison(body) };
  }

  if (row.operationId !== "check-object") {
    return { ...empty, parsed: false };
  }

  const gates: GateRow[] = (Array.isArray(body["gates"]) ? body["gates"] : [])
    .map(asRecord)
    .filter((gate): gate is Record<string, unknown> => gate !== undefined)
    .map((gate) => ({
      id: asText(gate["id"]) ?? "—",
      name: asText(gate["name"]) ?? "—",
      detail: asText(gate["detail"]) ?? "",
      passed: gate["passed"] === true,
    }));

  const totalsRecord = asRecord(body["totals"]) ?? {};
  const totals = TOTAL_ORDER.filter(([key]) => typeof totalsRecord[key] === "number").map(
    ([key, word]) => [word, totalsRecord[key] as number] as const,
  );

  const documents: DocumentRow[] = (Array.isArray(body["documents"]) ? body["documents"] : [])
    .map(asRecord)
    .filter((document): document is Record<string, unknown> => document !== undefined)
    .map((document) => ({
      path: (asText(document["path"]) ?? "—").split("/").pop() ?? "—",
      kind: asText(document["kind"]) ?? "—",
      status: asText(document["status"]) ?? "—",
      reason: asText(document["reason"]),
      readout: разбор(document["readout"]),
    }));

  return { ...empty, parsed: true, verdict: asText(body["verdict"]), gates, totals, documents, review: viewReview(body["review"]) };
}

/**
 * Прогон одного агента по одному предмету — ход прогона, а не его результат.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ АРТЕФАКТА. Артефакт появляется один раз, в конце, и
 * содержит всё. Эти строки появляются по одной, в момент, когда агент
 * высказался, и содержат только его слова. Первое отвечает на вопрос «что дал
 * прогон», второе — «что уже готово», и на встрече с клиентом второй вопрос
 * задают первым: полный прогон идёт тридцать шесть минут.
 */
export interface AgentRunRow {
  /** Способность агента: `estimate_review`, `finance_model`, … */
  readonly capability: string;
  /**
   * Имя агента: им подписаны замечания в протоколах заказчика.
   *
   * Берётся из реестра — того же, что у доски агентов. Показывать в ленте
   * `estimate_review` значило бы просить читателя переводить способность в
   * человека, а на встрече говорят «сметчик высказался», а не
   * «estimate_review завершился». Реестр не знает способность — остаётся сама
   * способность: это меньше сведений, но не ложь.
   */
  readonly person: string;
  /** Предмет: путь сметы либо путь объекта. */
  readonly subject: string;
  /** Этап прогона, в котором агент работал. */
  readonly phase: string;
  /** документ | объект | синтез — почему предметов один или четыре. */
  readonly scope: string | null;
  readonly status: "выполняется" | "исполнен" | "отказ";
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly verdict: string | null;
  readonly findings: readonly ReviewFindingView[];
  readonly bySeverity: readonly (readonly [string, number])[];
  /** Что агент просит проверить человеку. Видно во время прогона (Д2 + Д3). */
  readonly openQuestions: readonly OpenQuestionView[];
  readonly error: string | null;
}

export interface CheckCard {
  readonly id: string;
  readonly objectCode: string;
  readonly objectName: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly mode: string;
  readonly status: string;
  readonly completeness: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  /** Чем прогон занят сейчас. Пусто у не начавшегося и у завершённого. */
  readonly phase: string | null;
  readonly documentsTotal: number | null;
  readonly documentsDone: number | null;
  /** Прогон идёт: показывать по мере готовности имеет смысл только тогда. */
  readonly live: boolean;
  /**
   * СКОЛЬКО ПРОВЕРОК ВПЕРЕДИ В ОЧЕРЕДИ.
   *
   * Воркер один, и поставленная Проверка ждёт, пока освободится. До 09.09.2026
   * экран говорил «в очереди» и молчал о том, сколько ждать: владелец так и
   * сказал — «жду в очереди, и непонятно, когда закончится». Число впереди
   * стоящих отвечает на это честно: точного времени не знает никто, а «перед
   * вами две проверки» — знание, с которым можно решать.
   */
  readonly queueAhead: number;
  /** Ход прогона по агентам, свежий сверху. */
  readonly runs: readonly AgentRunRow[];
  readonly stages: readonly StageRow[];
  readonly subjects: readonly SubjectRow[];
  readonly artifactsTotal: number;
  readonly agentRunsTotal: number;
  readonly artifacts: readonly ArtifactView[];
  /** Воркфлоу не нашёлся в конфигурации: такты показать нечем, и это сказано прямо. */
  readonly workflowMissing: boolean;
  /**
   * БЫСТРЫЙ ПРОХОД: воркфлоу этой Проверки зовёт не всех агентов реестра.
   *
   * Считается тем же расчётом, которым воркер решает, кого звать
   * (`capabilitiesOfWorkflow`), а не по режиму записи и не по имени воркфлоу.
   * Второй признак «быстроты» разошёлся бы с первым, и экран сообщал бы
   * «быстрый проход» о прогоне, в котором работали все девять, — или наоборот.
   */
  readonly fast: boolean;
  /** Кого реестр знает, а этот воркфлоу не зовёт. Пусто у полного прогона. */
  readonly notInvited: readonly string[];
}

function isSubjectStatus(value: string): value is SubjectStatus {
  return value === "draft" || value === "returned" || value === "approved";
}

/**
 * Замечания из прогона агента.
 *
 * В базе это `Json`, то есть `unknown`: строку мог записать прошлый воркер.
 * Проверяется каждое поле — тем же способом, что и тело артефакта, и по той же
 * причине. Приведение типом выдало бы чужую структуру за свою.
 */
function viewRunFindings(value: unknown, document: string): readonly ReviewFindingView[] {
  return asList(value)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => viewFinding(item, document));
}

/** Признанный статус прогона агента. Чужое значение не выдаётся за своё. */
function runStatus(value: string): AgentRunRow["status"] | undefined {
  return value === "выполняется" || value === "исполнен" || value === "отказ" ? value : undefined;
}

/** Признанные значения статуса шага в базе; чужое значение не выдаётся за своё. */
function persistedStatus(value: string): StepStatus | undefined {
  return value === "исполнен" || value === "не реализован" || value === "заблокирован" ? value : undefined;
}

export async function readCheck(tenant: string, objectCode: string, checkId: string): Promise<CheckCard | undefined> {
  if (tenant === "") {
    throw new Error("Арендатор не задан: просмотр не показывает данные без контекста доступа.");
  }

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const stored = await withTenant(db, tenant, async (tx) => {
      // Проверка ищется вместе с объектом: шифр в адресе обязан совпасть с
      // владельцем проверки, иначе чужая проверка открывалась бы по прямой
      // ссылке под видом своей.
      const check = await tx.check.findFirst({
        where: { id: checkId, object: { code: objectCode } },
        include: {
          object: { select: { code: true, name: true } },
          steps: true,
          subjects: true,
          artifacts: { orderBy: { producedAt: "desc" } },
          // Ход прогона: свежий сверху, но у начатых `finishedAt` пуст, и
          // сортировка только по нему поставила бы работающих в конец —
          // именно тех, о ком спрашивают в первую очередь.
          runs: { orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }] },
          // Живая задача очереди: ею определяется, идёт ли прогон. Статуса
          // недостаточно — Проверка, поставленная в день без воркера, остаётся
          // `queued` навсегда, и опрашивать её экраном значит греть батарею
          // ради строки, которая уже не изменится.
          jobs: { where: { status: { in: ["queued", "running"] } }, select: { id: true }, take: 1 },
          _count: { select: { artifacts: true, runs: true } },
        },
      });

      if (check === null) return undefined;

      /**
       * СКОЛЬКО ПРОВЕРОК СТОИТ ПЕРЕД ЭТОЙ.
       *
       * Воркер один, и поставленная Проверка ждёт, пока он освободится. Экран
       * говорил «в очереди» и молчал о том, сколько ждать: владелец 09.09.2026
       * — «жду в очереди, и непонятно, когда закончится». Точного времени не
       * знает никто, а «перед вами две проверки» — знание, с которым можно
       * решать: ждать или снять чужую.
       *
       * Считается по задачам очереди, а не по Проверкам: очередь — это задачи,
       * и воркер берёт их в порядке создания. Идущая чужая задача тоже входит:
       * она держит единственного воркера.
       */
      const ahead =
        check.status === "queued"
          ? await tx.job.count({
              where: {
                type: "check",
                status: { in: ["queued", "running"] },
                createdAt: { lt: check.createdAt },
              },
            })
          : 0;

      return { ...check, ahead };
    });

    if (stored === undefined) return undefined;

    const subjects: SubjectRow[] = stored.subjects
      .filter((subject) => isSubjectStatus(subject.status))
      .map((subject) => ({
        id: subject.subjectId,
        status: subject.status as SubjectStatus,
        returnedCount: subject.returnedCount,
        reason: subject.reason,
        updatedAt: subject.updatedAt,
      }))
      .sort((left, right) => left.id.localeCompare(right.id, "ru"));

    /**
     * Ход прогона по агентам.
     *
     * Строка с непризнанным статусом ОТБРАСЫВАЕТСЯ, а не показывается «как
     * есть»: «выполняется» на экране — обещание, что работа идёт, и выдавать за
     * него чужое слово нельзя. Отброшенное при этом не теряется молча — оно
     * видно расхождением с `agentRunsTotal`, который считает все строки.
     */
    const roster = agentRoster();

    const runs: AgentRunRow[] = stored.runs.flatMap((run): AgentRunRow[] => {
      const status = runStatus(run.status);
      if (status === undefined) return [];

      // Предмет объектного агента — путь объекта, а не файл: именем документа
      // он не является, и подставлять его значило бы обещать переход к строке
      // файла, которого нет.
      const findings = viewRunFindings(run.findings, run.scope === "документ" ? документИз(run.subject) : "");
      const error = asRecord(run.error);

      return [
        {
          capability: run.agentId,
          person: roster.get(run.agentId)?.person ?? run.agentId,
          subject: run.subject,
          phase: run.stage,
          scope: run.scope,
          status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          verdict: run.verdict,
          findings,
          bySeverity: countBySeverity(findings),
          openQuestions: viewOpenQuestions(run.questions),
          error: error === undefined ? null : (asText(error["message"]) ?? "причина не названа"),
        },
      ];
    });

    const subjectStates = new Map<string, SubjectState>(
      subjects.map((subject) => [
        subject.id,
        { id: subject.id, status: subject.status, returnedCount: subject.returnedCount },
      ]),
    );

    // Отображение «имя человека → способность» берётся ОДНО на систему: доска
    // тактов называет шаги именами, а прогоны агентов — способностями.
    const ролиПоИмени = personToCapability(loadAgentRoster(join(process.cwd(), "config", "agents")).roster);

    const workflow = loadWorkflows("config/workflows").find((bundle) => bundle.value.id === stored.workflowId);
    // Кого зовёт этот воркфлоу — ТОТ ЖЕ расчёт, что у воркера. Одна реализация,
    // два потребителя: иначе экран и исполнитель разошлись бы в том, кого в
    // прогоне не было, и разошлись бы молча.
    const invited = capabilitiesOfWorkflow(stored.workflowId);

    const stages: StageRow[] = (workflow?.value.stages ?? []).map((stage) => ({
      id: stage.id,
      name: stage.name,
      steps: stage.steps.map((step): StepRow => {
        const done = stored.steps.find((row) => row.stage === stage.id && row.agent === step.agent);
        const read = done === undefined ? undefined : persistedStatus(done.status);

        if (done !== undefined && read !== undefined) {
          return {
            agent: step.agent,
            produces: step.produces,
            status: read,
            attempts: done.attempts,
            doneAt: done.doneAt,
            blocks: [],
            derived: false,
          };
        }

        /**
         * ШАГ, ЧЕЙ АГЕНТ ОТРАБОТАЛ, — ИСПОЛНЕН, ДАЖЕ ЕСЛИ ЗАПИСИ ШАГА НЕТ.
         *
         * Записи шагов пишет `CheckRunRepository`, а его зовёт только командная
         * строка (`si протокол --run`). На пути клиента — веб и воркер — шаги в
         * базу не попадают вовсе, и доска показывала «настенька не выполнялся»
         * ровно тогда, когда Настенька отработала и дала девять замечаний.
         *
         * Это ложное утверждение об уже сделанной работе, и на встрече оно
         * читается как «конвейер не пошёл». Взять его неоткуда, кроме как из
         * прогонов агентов, — они и есть свидетельство того, что шаг случился.
         *
         * `derived: true` остаётся: состояние выведено, а не прочитано из
         * записи шага, и экран обязан это показывать. Возвраты и попытки
         * отсюда не восстановить — их знает только протокол.
         */
        const capability = ролиПоИмени.get(step.agent.toLowerCase());
        const отработал =
          capability !== undefined && runs.some((run) => run.capability === capability && run.status === "исполнен");

        if (отработал) {
          return {
            agent: step.agent,
            produces: step.produces,
            status: "исполнен",
            attempts: null,
            doneAt: null,
            blocks: [],
            derived: true,
          };
        }

        const gate = startable({ agent: step.agent, produces: step.produces, requires: step.requires }, subjectStates);

        return {
          agent: step.agent,
          produces: step.produces,
          status: gate.ok ? "не выполнялся" : "заблокирован",
          attempts: null,
          doneAt: null,
          blocks: gate.ok ? [] : gate.blocks,
          derived: true,
        };
      }),
    }));

    return {
      id: stored.id,
      objectCode: stored.object.code,
      objectName: stored.object.name,
      workflowId: stored.workflowId,
      workflowName: workflow?.value.name ?? stored.workflowId,
      mode: режимСловом(String(stored.mode)),
      status: String(stored.status),
      completeness: stored.completeness,
      createdAt: stored.createdAt,
      startedAt: stored.startedAt,
      finishedAt: stored.finishedAt,
      phase: stored.phase,
      documentsTotal: stored.documentsTotal,
      documentsDone: stored.documentsDone,
      // «Живой» — тот, чей исход ещё не наступил И у кого есть чем его наступить.
      // `awaiting_human` в это входит: прогон на паузе продолжится. Прогон без
      // живой задачи — нет: он не идёт, а числится (см. `liveCheckId`).
      live:
        (stored.status === "queued" || stored.status === "running" || stored.status === "awaiting_human") &&
        stored.jobs.length > 0,
      queueAhead: stored.ahead,
      runs,
      stages,
      subjects,
      artifactsTotal: stored._count.artifacts,
      agentRunsTotal: stored._count.runs,
      artifacts: stored.artifacts.map((artifact) => viewArtifact(artifact)),
      workflowMissing: workflow === undefined,
      fast: invited.shorterThanRoster,
      notInvited: invited.notInvited,
    };
  } finally {
    await db.$disconnect();
  }
}

/** Проверки объекта для перехода из карточки. */
export async function listChecks(
  tenant: string,
  objectCode: string,
): Promise<readonly { readonly id: string; readonly workflowId: string; readonly createdAt: Date }[]> {
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) =>
      tx.check.findMany({
        where: { object: { code: objectCode } },
        select: { id: true, workflowId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
