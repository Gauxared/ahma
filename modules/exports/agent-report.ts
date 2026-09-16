/**
 * Заключение одного агента — книга на каждого, кто высказался.
 *
 * ПОЧЕМУ ОДИН СБОРЩИК, А НЕ ВОСЕМЬ
 *
 * Пакет заказчику в `reference-system/output-1` — десять документов, и девять
 * из них соответствуют девяти агентам один в один: инженерное заключение — ГИП,
 * сметный анализ — сметчик, себестоимость — эконом, снабжение — снабженец,
 * подрядный анализ — подряд, ПТО — ПТО, договорной анализ — договорник,
 * организационный протокол — администратор, итоговая записка — руководитель.
 *
 * У всех девяти ОДНА структура выхода: вердикт, замечания с важностью и
 * основанием, перечень предметов. Восемь почти одинаковых сборщиков разошлись бы
 * при первой правке, и заказчик получил бы девять документов разного устройства
 * от одной системы.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ
 *
 * Нет чисел в рублях по замечаниям. В прототипах у каждой находки стоит эффект
 * («−60,3 млн ₽»), и это правильная цель — но `impact` в контракте агента сегодня
 * не типизирован, а `basis` агент возвращает прозой. Приделать провенанс к тексту
 * значило бы изобразить то, чего система не умеет объяснить (`Ф-ADR-006`).
 * Поэтому лист «Основания» показывает прозу как прозу, а лист «Чего здесь нет»
 * называет отсутствие рублёвого эффекта прямо.
 */
import { escapeSpreadsheetText } from "./calculation-workbook.js";
import type { Cell, CellStyle, SheetSpec, WorkbookSpec } from "./calculation-workbook.js";

/** Замечание агента в том виде, в каком его несёт артефакт. */
export interface AgentFinding {
  readonly severity: string;
  readonly statement: string;
  readonly basis: string;
  /**
   * Сумма под угрозой. `null` или отсутствие — величины у замечания нет.
   *
   * Нужна, чтобы упорядочить находки ПО ДЕНЕЖНОМУ ВЕСУ, а не только по
   * важности: «критично на 12 миллионов» и «критично без суммы» читаются
   * первым и вторым, а не в порядке, в котором их выдала модель.
   */
  readonly amount?: { readonly text: string; readonly value: number } | null;
  /** К какому документу относится. Пусто — вывод об объекте целиком. */
  readonly document?: string;
}

/**
 * Предметный лист заключения — так, как его описал агент по ЭТОМУ объекту.
 *
 * Ни названия, ни колонки не заданы конфигурацией: эталонный пакет снят с
 * одного объекта, и его «КС_геометрия» бессмысленна для жилого дома. Форму
 * держит не список названий, а порядок документа: резюме → предметные листы →
 * замечания → поручения → чего здесь нет.
 */
export interface AgentSheet {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** Поручение человеку: вопрос, адресат и срок. Без адресата это не поручение. */
export interface AgentTask {
  readonly question: string;
  readonly owner: string;
  readonly dueBy: string;
}

export interface AgentReportSource {
  /** Название документа пакета — как в `output-1`. */
  readonly title: string;
  /** Способность из манифеста: она и есть личность агента в артефакте. */
  readonly capability: string;
  /** Роль агента, если реестр её знает. Без реестра остаётся способность. */
  readonly role?: string;
  readonly objectName: string;
  readonly objectCode: string;
  readonly verdict: string;
  readonly subjects: readonly string[];
  readonly findings: readonly AgentFinding[];
  /** Отказы агента: он запускался и не смог — это не «замечаний нет». */
  readonly errors: readonly string[];
  /**
   * Что агент просит проверить человеку.
   *
   * В пакете этого не было вовсе, и это был самый заметный пропуск: «что
   * проверить человеку» — графа формы результата и одно из обещаний брифа, а в
   * выгруженном документе от неё не оставалось следа. На прогоне эталонного
   * входа таких поручений семьдесят два.
   *
   * В эталонном пакете лист называется «Передачи смежникам» и стоит почти в
   * каждом документе — той же цели он и служит: заключение заканчивается не
   * выводом, а тем, кто и что делает дальше.
   */
  readonly tasks: readonly AgentTask[];
  /** Предметные листы, как их дал агент. Пусто — агент их не ведёт. */
  readonly sheets: readonly AgentSheet[];
  /**
   * Каркас роли: что агент обязан дать при любом объекте.
   *
   * Нужен, чтобы отличить «предмета на объекте нет» от «агент не ответил».
   * Первое нормально и в документе не упоминается; второе попадает на лист
   * «Чего здесь нет».
   */
  readonly requiredSheets: readonly { readonly id: string; readonly title: string }[];
  readonly artifactId: string;
  readonly inputHashes: readonly string[];
  readonly producedAt: string;
  readonly generatorVersion: string;
}

const TEMPLATE_VERSION = "1.0.0";

function text(value: string, style?: CellStyle): Cell {
  return style === undefined
    ? { kind: "text", value: escapeSpreadsheetText(value) }
    : { kind: "text", value: escapeSpreadsheetText(value), style };
}

function head(value: string): Cell {
  return { kind: "text", value: escapeSpreadsheetText(value), style: "header" };
}

/** Порядок важности — тот же, что на экранах: тяжёлое сверху. */
const SEVERITY_ORDER: readonly string[] = ["critical", "high", "medium", "low", "info"];

const SEVERITY_WORD: Readonly<Record<string, string>> = {
  critical: "критично",
  high: "высокая",
  medium: "средняя",
  low: "низкая",
  info: "сведение",
};

function sortFindings(findings: readonly AgentFinding[]): readonly AgentFinding[] {
  const place = (severity: string): number => {
    const index = SEVERITY_ORDER.indexOf(severity);
    // Неизвестная важность встаёт в конец, а не в начало: догадываться о её
    // весе значило бы поднять наверх то, о чём мы ничего не знаем.
    return index === -1 ? SEVERITY_ORDER.length : index;
  };

  return [...findings].sort((left, right) => place(left.severity) - place(right.severity));
}

function verdictSheet(source: AgentReportSource): SheetSpec {
  const counts = new Map<string, number>();
  for (const finding of source.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  const rows: Cell[][] = [
    [head("Показатель"), head("Значение")],
    [text("Документ"), text(source.title)],
    [text("Объект"), text(`${source.objectName} · шифр ${source.objectCode}`)],
    [text("Агент"), text(source.role ?? source.capability)],
    [text("Способность"), text(source.capability)],
    [text("Вердикт агента"), text(source.verdict === "" ? "не выдан" : source.verdict, "total")],
    [text("Замечаний"), text(String(source.findings.length), "total")],
  ];

  for (const severity of SEVERITY_ORDER) {
    const count = counts.get(severity);
    if (count === undefined) continue;
    rows.push([text(`  из них ${SEVERITY_WORD[severity] ?? severity}`), text(String(count))]);
  }

  rows.push([text("Предметов рассмотрено"), text(String(source.subjects.length))]);
  rows.push([text("Отказов агента"), text(String(source.errors.length))]);

  /**
   * ТОП-НАХОДКИ — то, ради чего лист открывают.
   *
   * До этого резюме было карточкой учёта: сколько замечаний, сколько из них
   * критичных, откуда взялось. Сорок четыре замечания лежали листом дальше — в
   * порядке важности, но без веса и без адресата. Человек, открывший книгу,
   * видел числа и не видел НИ ОДНОЙ НАХОДКИ.
   *
   * В эталонном пакете это первое, что стоит после вердикта: «ТОП-НАХОДКИ (в
   * порядке денежного веса и риска)» — десять строк с фактом, статусом и тем,
   * кому идёт дальше по конвейеру.
   *
   * Порядок: сначала деньги, потом важность. «Критично на 12 миллионов» и
   * «критично без суммы» — разного веса, и порядок выдачи модели тут не судья.
   */
  const топ = топНаходки(source.findings);

  if (топ.length > 0) {
    rows.push([{ kind: "empty" }, { kind: "empty" }]);
    rows.push([
      head(`Главное — ${топ.length} ${топ.length === source.findings.length ? "находок" : `из ${source.findings.length}`}`),
      head("по денежному весу и важности"),
    ]);

    for (const [index, finding] of топ.entries()) {
      const вес = finding.amount == null ? "величина не определена" : `${finding.amount.text} ₽`;
      const где = finding.document === undefined || finding.document === "" ? "объект целиком" : finding.document;

      rows.push([
        text(`${index + 1}. ${SEVERITY_WORD[finding.severity] ?? finding.severity} · ${вес}`),
        text(`${finding.statement} — ${где}`),
      ]);
    }
  }

  rows.push([{ kind: "empty" }, { kind: "empty" }]);
  rows.push([
    text("Происхождение", "note"),
    text(`артефакт ${source.artifactId}, прогон ${source.producedAt}`, "note"),
  ]);

  return { name: "01_Вердикт", columnWidths: [34, 78], rows };
}

/** Сколько находок выносится в резюме. Десять — как в эталонном пакете. */
const ТОП = 10;

/**
 * Находки по весу: сначала деньги по убыванию, потом важность.
 *
 * Замечание без суммы НЕ приравнивается к нулю (§9): оно уходит вниз своей
 * группы, а не оценивается в ноль рублей рядом с теми, у кого сумма посчитана.
 */
function топНаходки(findings: readonly AgentFinding[]): readonly AgentFinding[] {
  const место = (severity: string): number => {
    const index = SEVERITY_ORDER.indexOf(severity);
    return index === -1 ? SEVERITY_ORDER.length : index;
  };

  return [...findings]
    .sort((left, right) => {
      const слева = left.amount?.value ?? -1;
      const справа = right.amount?.value ?? -1;
      if (слева !== справа) return справа - слева;
      return место(left.severity) - место(right.severity);
    })
    .slice(0, ТОП);
}

function findingsSheet(source: AgentReportSource): SheetSpec {
  const rows: Cell[][] = [[head("№"), head("Важность"), head("Замечание"), head("Основание")]];

  for (const [index, finding] of sortFindings(source.findings).entries()) {
    rows.push([
      text(String(index + 1)),
      text(SEVERITY_WORD[finding.severity] ?? finding.severity),
      text(finding.statement),
      // Основание обязательно по ТЗ §9. Пустое основание не прячется за
      // пустой ячейкой: пустая ячейка читается как «забыли заполнить».
      text(finding.basis === "" ? "основание не приведено агентом" : finding.basis),
    ]);
  }

  if (source.findings.length === 0) {
    rows.push([
      text("—"),
      text("—"),
      text(
        source.errors.length > 0
          ? "замечаний нет, потому что агент не отработал — см. лист «Отказы»"
          : "агент отработал и замечаний не нашёл",
      ),
      text("—"),
    ]);
  }

  return { name: "02_Замечания", columnWidths: [6, 14, 86, 86], rows };
}

function subjectsSheet(source: AgentReportSource): SheetSpec {
  const rows: Cell[][] = [[head("Предмет")]];

  for (const subject of source.subjects) rows.push([text(subject)]);
  if (source.subjects.length === 0) rows.push([text("предметов не было: агент не получил ни одного документа")]);

  return { name: "03_Предметы", columnWidths: [96], rows };
}

function refusalsSheet(source: AgentReportSource): SheetSpec | undefined {
  if (source.errors.length === 0) return undefined;

  const rows: Cell[][] = [[head("Отказ агента")]];
  for (const error of source.errors) rows.push([text(error)]);

  return { name: "05_Отказы", columnWidths: [110], rows };
}

/**
 * Предметные листы — по одному на вопрос, как в рабочей книге инженера.
 *
 * Нумерация сквозная и начинается с 02: 01 занят вердиктом. Номер в имени —
 * навигация, и книга, где листы идут вразнобой, читается как собранная наспех.
 */
function subjectSheets(source: AgentReportSource): readonly SheetSpec[] {
  return source.sheets.map((sheet, index) => {
    const номер = String(index + 2).padStart(2, "0");
    const rows: Cell[][] = [[head(sheet.title)], [text(sheet.purpose)], []];

    rows.push(sheet.columns.map((column) => head(column)));
    for (const row of sheet.rows) rows.push(row.map((cell) => text(cell)));

    return {
      // Имя листа в книге ограничено 31 знаком, и лишнее Excel молча обрежет —
      // два длинных названия схлопнулись бы в одно и книга бы не открылась.
      name: `${номер}_${транслит(sheet.id)}`.slice(0, 31),
      columnWidths: sheet.columns.map((column, index) => (index === 0 ? 42 : Math.max(16, column.length + 6))),
      rows,
    };
  });
}

/**
 * Имя листа книги: латиница, цифры и подчёркивание.
 *
 * Excel запрещает в имени листа `: \\ / ? * [ ]`, а `id` приходит от модели —
 * значит содержать может что угодно. Кириллицу оставляем: она допустима и
 * читается человеком, а вот запрещённое заменяем.
 */
function транслит(id: string): string {
  return id.replace(/[:\\/?*[\]]/g, "_").replace(/\s+/g, "_");
}

/**
 * Поручения человеку — «Передачи смежникам» эталонного пакета.
 *
 * Лист есть ВСЕГДА, даже пустой: отсутствие листа читается как «поручений не
 * предусмотрено», а пустой лист с объяснением — как «агент их не выдал». Это
 * разные утверждения, и второе — правда.
 */
function tasksSheet(source: AgentReportSource): SheetSpec {
  const rows: Cell[][] = [[head("№"), head("Что проверить"), head("Кому"), head("Срок")]];

  source.tasks.forEach((task, index) => {
    rows.push([
      text(String(index + 1)),
      text(task.question),
      text(task.owner === "" ? "адресат не назван агентом" : task.owner),
      text(task.dueBy === "" ? "срок не назван агентом" : task.dueBy),
    ]);
  });

  if (source.tasks.length === 0) {
    rows.push([text("—"), text("агент не выдал ни одного поручения по этому предмету"), text("—"), text("—")]);
  }

  return { name: "04_Поручения", columnWidths: [6, 86, 30, 18], rows };
}

/**
 * Лист «Чего здесь нет».
 *
 * Он есть в каждой книге и не пустует никогда: у любого заключения есть граница,
 * и названная граница честнее умолчания. Заказчик, не нашедший в книге рублей,
 * иначе решит, что система их посчитала и потеряла.
 */
function coverageSheet(source: AgentReportSource): SheetSpec {
  const rows: Cell[][] = [
    [head("Чего в этом документе нет"), head("Почему")],
    [
      text("Эффект замечания в рублях"),
      text(
        "агент возвращает основание прозой; типизированного влияния в его контракте нет, " +
          "а приделать провенанс к тексту значило бы изобразить расчёт, которого не было",
      ),
    ],
    [
      text("След формулы под числами"),
      text("числа этого документа — счётчики артефакта, а не расчёты: следа формулы у них нет"),
    ],
  ];

  /**
   * Обязательный лист, которого агент не дал, — ПРОБЕЛ, и он называется.
   *
   * Отличать надо от предметного листа, которого нет: тот отсутствует потому,
   * что на объекте нет предмета, и это нормально. А каркас роли — то, на что
   * агент отвечает при любом объекте, и его молчание здесь означает не «нечего
   * сказать», а «не ответил».
   */
  const данные = new Set(source.sheets.map((sheet) => sheet.id));
  const пропущено = source.requiredSheets.filter((required) => !данные.has(required.id));

  for (const required of пропущено) {
    rows.push([
      text(`Лист «${required.title}»`),
      text("агент обязан давать его при любом объекте и в этот раз не дал: пробел, а не отсутствие предмета"),
    ]);
  }

  if (source.inputHashes.length === 0) {
    rows.push([text("Отпечатки входов"), text("прогон не записал хэши входов: воспроизводимость подтвердить нечем")]);
  } else {
    rows.push([text("—"), text(`входы прогона: ${source.inputHashes.join(", ")}`)]);
  }

  return { name: "06_Не_покрыто", columnWidths: [40, 110], rows };
}

export function buildAgentReport(source: AgentReportSource): WorkbookSpec {
  /**
   * ПОРЯДОК ДОКУМЕНТА — ЭТО И ЕСТЬ ЕГО ФОРМА.
   *
   * Устойчивость даёт не список названий листов (он у каждого объекта свой), а
   * порядок: вердикт → предметный разбор → замечания → поручения → границы.
   * Заказчик, открывший второй документ, знает, где что искать, даже если
   * предметные листы в нём другие.
   */
  const предметные = subjectSheets(source);
  const sheets: SheetSpec[] = [verdictSheet(source), ...предметные, findingsSheet(source)];

  // Номера у замечаний и дальше зависят от числа предметных листов: сквозная
  // нумерация — навигация, а не украшение.
  let номер = предметные.length + 2;
  sheets[sheets.length - 1] = { ...sheets[sheets.length - 1]!, name: `${String(номер).padStart(2, "0")}_Замечания` };
  номер += 1;
  sheets.push({ ...subjectsSheet(source), name: `${String(номер).padStart(2, "0")}_Предметы` });
  номер += 1;
  sheets.push({ ...tasksSheet(source), name: `${String(номер).padStart(2, "0")}_Поручения` });
  номер += 1;

  const refusals = refusalsSheet(source);
  if (refusals !== undefined) {
    sheets.push({ ...refusals, name: `${String(номер).padStart(2, "0")}_Отказы` });
    номер += 1;
  }

  sheets.push({ ...coverageSheet(source), name: `${String(номер).padStart(2, "0")}_Не_покрыто` });

  return {
    sheets,
    metadata: {
      templateVersion: TEMPLATE_VERSION,
      generatorVersion: source.generatorVersion,
      artifactId: source.artifactId,
      inputHashes: source.inputHashes,
      producedAt: source.producedAt,
    },
  };
}
