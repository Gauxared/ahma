/**
 * Сметный разбор по объекту — итоговый документ MVP.
 *
 * Соответствует листу `03_Сметный_анализ` эталонного выхода
 * `reference-system/output-1/`, но покрывает НЕ ВСЁ его содержание: пересчёт
 * индексов, конъюнктурный анализ, финансовый результат и передачи остальным
 * восьми агентам опираются на данные и модули, которых пока нет.
 *
 * Поэтому лист «Не покрыто» обязателен и строится всегда. Умолчать о границах
 * разбора — значит выдать частичный результат за полный, а это ровно то, что
 * запрещает ADR-R-022 (подмена класса полноты) и инвариант ТЗ §9.
 *
 * Числа выводятся только с маркером статуса источника, итог объекта — формулой
 * со следом (§12.1д). Складывает расчётный модуль, а не эта выгрузка: выгрузка
 * не имеет права заводить собственные числа.
 */
import type { Artifact, IsoDate, Money, Valued } from "@contracts/index.js";

import { escapeSpreadsheetText } from "./calculation-workbook.js";
import { foldByAgent } from "./by-agent.js";
import type { AgentIdentityForReport } from "./by-agent.js";
import type { Cell, CellStyle, SheetSpec, WorkbookSpec } from "./calculation-workbook.js";

/**
 * Вход выгрузки объявлен здесь целиком и НЕ импортирует типы из workflow или
 * calculations: модули разговаривают только узкой талией контрактов
 * (ADR-R-025). Отображение результата Проверки в эту форму делает
 * композиционный корень — единственное место, знающее обе стороны.
 *
 * Следствие важнее формальности: выгрузка ничего не вычисляет. Итог объекта
 * приходит готовым `Valued<Money>` со следом формулы, посчитанным расчётным
 * модулем. Выгрузка, заводящая собственные числа, — это второй источник правды.
 */
export interface DocumentForReport {
  readonly path: string;
  readonly kind: string;
  readonly status: string;
  readonly positions?: number;
  readonly byCode?: number;
  readonly converged?: boolean;
  /** Пусто — сверять было нечего, а не «расхождения нет». */
  readonly delta?: string | undefined;
  readonly documentTotal?: string | undefined;
  readonly reason?: string | undefined;
}

export interface GateForReport {
  readonly id: string;
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface FindingForReport {
  readonly severity: string;
  readonly statement: string;
  readonly basis: string;
}

export interface DocumentReviewForReport {
  readonly path: string;
  /**
   * Смета или объект целиком. Без него путь объектного агента выглядит путём
   * документа, и читатель решает, что финмодель построена по одной смете.
   */
  readonly scope?: "документ" | "объект";
  /** Какой агент смотрел. Без него все девять сливаются в один блок. */
  readonly capability?: string;
  /** Нарушения контракта формы §5.4 — не замечания к смете, но и не пустяк. */
  readonly depthViolations?: readonly string[];
  readonly verdict?: string;
  readonly findings: readonly FindingForReport[];
  readonly error?: string;
}

export interface ReviewForReport {
  readonly documents: readonly DocumentReviewForReport[];
  readonly findings: number;
  readonly bySeverity: Readonly<Record<string, number>>;
}

/** Сверка суммы смет со сводным сметным расчётом. */
export interface SummaryForReport {
  readonly path: string;
  readonly label?: string;
  readonly declaredThousands?: string;
  readonly declaredRubles?: string;
  readonly delta?: string;
  readonly granularity?: string;
  readonly explainedByScale?: boolean;
  readonly error?: string;
}

export interface ObjectTotals {
  readonly documents: number;
  readonly checked: number;
  readonly skipped: number;
  readonly failed: number;
  readonly positions: number;
  readonly byCode: number;
  readonly unmatched: number;
}

export interface ObjectReportSource {
  readonly objectPath: string;
  readonly verdict: string;
  readonly documents: readonly DocumentForReport[];
  readonly totals: ObjectTotals;
  readonly gates: readonly GateForReport[];
  /** Посчитан расчётным модулем; выгрузка его только показывает. */
  readonly objectTotal: Valued<Money>;
  readonly review?: ReviewForReport;
  /**
   * Кто стоит за каждой способностью. Приходит ДАННЫМИ из композиционного
   * корня: реестр живёт в платформе, а выгрузка не должна о ней знать.
   *
   * Пустой список означает, что реестр не передан, и лист замечаний честно
   * скажет об этом вместо того, чтобы подписать всех первым попавшимся именем.
   */
  readonly roster?: readonly AgentIdentityForReport[];
  /** Объявленные деградации прогона — отсюда причина «агент не выполнен». */
  readonly degradations?: readonly { capability: string; reason: string }[];
  readonly summary?: SummaryForReport;
  readonly artifact: Artifact<unknown>;
  readonly generatorVersion: string;
  readonly producedAt: IsoDate;
}

export const OBJECT_REPORT_TEMPLATE = "object-report@1" as const;

/** Маркер статуса источника. Разобранная смета — это документ заказчика. */
const FROM_DOCUMENT = "из документа объекта";
const COMPUTED = "вычислено, след формулы сохранён";

const EMPTY: Cell = { kind: "empty" };

function text(value: string, style?: CellStyle): Cell {
  // Экранирование обязательно: наименования и причины приходят из документов
  // заказчика, и текст, начинающийся с «=», Excel исполнит как формулу.
  return style === undefined
    ? { kind: "text", value: escapeSpreadsheetText(value) }
    : { kind: "text", value: escapeSpreadsheetText(value), style };
}

function money(value: string, marker: string, style?: CellStyle): Cell {
  return style === undefined
    ? { kind: "number", value: value as never, marker }
    : { kind: "number", value: value as never, marker, style };
}

/**
 * ДЕНЬГИ, КОТОРЫХ В ДОКУМЕНТЕ НЕТ — СЛОВОМ, А НЕ НУЛЁМ.
 *
 * `0,00 ₽` и «неизвестно» — противоположные утверждения, и в выгрузке заказчику
 * разница стоит дороже всего. «Расхождение 0,00 ₽» читается как ДОКАЗАННАЯ
 * сходимость: смета сошлась, проверять нечего. На деле это значило «сверять
 * было нечем»: у сметы без стоимостной части нет ни итога, ни расхождения с
 * ним.
 *
 * Тот же изъян уже ловили на экране 6 сентября — там десять неизвестных итогов
 * сложились в 0 ₽ и гейт объявил «Δ 86 778 920,38 ₽». На экране починили, а в
 * КНИГЕ, которую заказчик уносит со встречи, ноль остался.
 *
 * ТЗ §9: неизвестное не превращается в ноль. Здесь это правило и применяется.
 */
function moneyOrUnknown(value: string | undefined, marker: string, style?: CellStyle): Cell {
  if (value === undefined) {
    return style === undefined
      ? { kind: "text", value: "не определено" }
      : { kind: "text", value: "не определено", style };
  }

  return money(value, marker, style);
}

function checkedEstimates(source: ObjectReportSource): readonly DocumentForReport[] {
  return source.documents.filter((document) => document.status === "проверен");
}

function conclusionSheet(source: ObjectReportSource): SheetSpec {
  const check = source;

  const rows: Cell[][] = [
    [text("СМЕТНЫЙ РАЗБОР ПО ОБЪЕКТУ", "header")],
    [text(`Объект: ${source.objectPath}`)],
    [text(`Дата разбора: ${source.producedAt}`)],
    [EMPTY],
    [text("ВЕРДИКТ ПРОВЕРКИ", "header")],
    [
      text("Проверка по критериям §12.1"),
      text(check.verdict.toUpperCase(), "total"),
    ],
    [
      text(
        "Вердикт отвечает на вопрос «система корректно обработала объект», " +
          "а не «сметы хороши». Оценка самих смет — на листе замечаний.",
        "note",
      ),
    ],
    [EMPTY],
    [text("ГЕЙТЫ ПРИЁМКИ", "header")],
    [text("Критерий", "header"), text("Итог", "header"), text("Подробности", "header")],
  ];

  for (const gate of check.gates) {
    rows.push([
      text(`${gate.id} ${gate.name}`),
      text(gate.passed ? "пройден" : "НЕ ПРОЙДЕН", gate.passed ? undefined : "total"),
      text(gate.detail),
    ]);
  }

  rows.push([EMPTY]);
  rows.push([text("СОСТАВ ПРОВЕРКИ", "header")]);
  rows.push([text("Документов в папке"), money(String(check.totals.documents), FROM_DOCUMENT)]);
  rows.push([text("Смет проверено"), money(String(check.totals.checked), FROM_DOCUMENT)]);
  rows.push([text("Отказов разбора"), money(String(check.totals.failed), FROM_DOCUMENT)]);
  rows.push([text("Пропущено (не сметы)"), money(String(check.totals.skipped), FROM_DOCUMENT)]);
  rows.push([text("Позиций извлечено"), money(String(check.totals.positions), FROM_DOCUMENT)]);
  rows.push([
    text("в т.ч. с нормативным шифром"),
    money(String(check.totals.byCode), FROM_DOCUMENT),
    text("остальные — конъюнктурный анализ, шифра не имеют"),
  ]);

  if (check.review !== undefined) {
    rows.push([EMPTY]);
    rows.push([text("ЗАМЕЧАНИЯ СМЕТЧИКА", "header")]);
    rows.push([text("Всего замечаний"), money(String(check.review.findings), FROM_DOCUMENT)]);
    for (const [severity, count] of Object.entries(check.review.bySeverity)) {
      rows.push([text(`  уровня ${severity}`), money(String(count), FROM_DOCUMENT)]);
    }
  }

  return { name: "01_Заключение", columnWidths: [46, 20, 70], rows };
}

function compositionSheet(source: ObjectReportSource): SheetSpec {
  const rows: Cell[][] = [
    [text("СОСТАВ ОБЪЕКТА", "header")],
    [
      text(
        "Показаны ВСЕ документы папки, включая те, что не подлежат сметной проверке: " +
          "их пропуск обязан быть виден, иначе неполный обход выглядит полным.",
        "note",
      ),
    ],
    [EMPTY],
    [
      text("Документ", "header"),
      text("Вид", "header"),
      text("Статус", "header"),
      text("Позиций", "header"),
      text("Итог, ₽", "header"),
      text("Примечание", "header"),
    ],
  ];

  for (const document of source.documents) {
    const name = document.path.split("/").pop() ?? document.path;

    rows.push([
      text(name),
      text(document.kind),
      text(document.status),
      document.positions === undefined ? EMPTY : money(String(document.positions), FROM_DOCUMENT),
      document.documentTotal === undefined ? EMPTY : money(document.documentTotal, FROM_DOCUMENT),
      text(document.reason ?? (document.converged === true ? "сходимость 0 ₽" : "")),
    ]);
  }

  return { name: "02_Состав_объекта", columnWidths: [52, 24, 16, 10, 18, 60], rows };
}

function summarySheet(source: ObjectReportSource): SheetSpec {
  const estimates = checkedEstimates(source);

  if (source.objectTotal.provenance.kind !== "formula") {
    throw new Error("Итог объекта обязан быть вычисленным значением со следом формулы");
  }

  const trace = source.objectTotal.provenance.trace;

  const rows: Cell[][] = [
    [text("СВОД СМЕТ ОБЪЕКТА", "header")],
    [text("Источник каждой строки — «ВСЕГО по смете» соответствующего ЛСР", "note")],
    [EMPTY],
    [
      text("Смета", "header"),
      text("Позиций", "header"),
      text("По шифру", "header"),
      text("ВСЕГО, ₽", "header"),
      text("Расхождение, ₽", "header"),
    ],
  ];

  const totalRows: number[] = [];

  for (const document of estimates) {
    rows.push([
      text(document.path.split("/").pop() ?? document.path),
      // ноль-осознанно: счётчик позиций, а не сумма. Смета проверена, значит
      // разбор состоялся, и «ноль позиций» — измеренный факт, а не пробел.
      money(String(document.positions ?? 0), FROM_DOCUMENT),
      money(String(document.byCode ?? 0), FROM_DOCUMENT),
      moneyOrUnknown(document.documentTotal, FROM_DOCUMENT),
      // Пусто — сверять было нечем; ноль здесь читался бы как «сошлось».
      moneyOrUnknown(document.delta, COMPUTED),
    ]);

    // Номер строки в книге: заголовки выше плюс единица за счёт нумерации с 1.
    totalRows.push(rows.length);
  }

  rows.push([
    text(`СУММА ${estimates.length} СМЕТ`, "total"),
    EMPTY,
    EMPTY,
    {
      kind: "formula",
      formula: totalRows.map((row) => `D${row}`).join("+"),
      trace,
      expected: source.objectTotal.value.amount,
      marker: COMPUTED,
      style: "total",
    },
    EMPTY,
  ]);

  const summary = source.summary;

  if (summary !== undefined) {
    rows.push([EMPTY]);
    rows.push([text("СВЕРКА СО СВОДНЫМ СМЕТНЫМ РАСЧЁТОМ", "header")]);
    rows.push([
      text(
        "ССРСС номинирован в ТЫС. РУБ., локальные сметы — в рублях. Расхождение " +
          "округления неизбежно и предъявляется явно, а не гасится.",
        "note",
      ),
    ]);

    if (summary.error !== undefined) {
      rows.push([text("Сводный расчёт не разобран"), text(summary.error, "total")]);
    } else {
      rows.push([
        text(summary.label ?? "Итог сводного расчёта"),
        EMPTY,
        EMPTY,
        moneyOrUnknown(summary.declaredRubles, "из сводного расчёта, приведено из тыс. руб."),
      ]);
      rows.push([
        text("Расхождение"),
        EMPTY,
        EMPTY,
        moneyOrUnknown(summary.delta, COMPUTED),
        text(
          `гранулярность шкалы ${summary.granularity ?? "?"} ₽ — ` +
            (summary.explainedByScale === true
              ? "объясняется округлением источника"
              : "ВНЕ гранулярности, требует разбора"),
        ),
      ]);
    }
  }

  return { name: "03_Свод_смет", columnWidths: [52, 10, 12, 20, 60], rows };
}

/**
 * Замечания ПО АГЕНТАМ, а не по документам.
 *
 * Прежняя редакция звалась «ЗАМЕЧАНИЯ СМЕТЧИКА» и группировала по пути
 * документа. Пока агент был один, это совпадало с правдой. С девятью — нет:
 * шесть объектных агентов имеют путём папку объекта и сваливались в одну кучу,
 * а документный агент, посмотревший четыре сметы, распадался на четыре
 * безымянных блока. Читатель книги не мог узнать, кто именно что сказал.
 *
 * Агент, не отработавший вовсе, ПЕЧАТАЕТСЯ с причиной. Отсутствие блока
 * читалось бы как «этой темы у объекта нет».
 */
function findingsSheet(source: ObjectReportSource): SheetSpec | undefined {
  const review = source.review;
  // Лист не создаётся вовсе, если обзора не было: пустой лист «Замечания»
  // читался бы как «замечаний нет», хотя агенты не работали.
  if (review === undefined) return undefined;

  const sections = foldByAgent({
    roster: source.roster ?? [],
    outcomes: review.documents,
    ...(source.degradations === undefined ? {} : { degradations: source.degradations }),
  });

  const rows: Cell[][] = [
    [text("ЗАМЕЧАНИЯ АГЕНТОВ", "header")],
    [text("У каждого замечания обязательно основание (ТЗ §9): без основания нет вывода", "note")],
    [
      text(
        `Агентов в раскладе: ${sections.length}; ` +
          `отработало: ${sections.filter((section) => section.status === "выполнен").length}`,
        "note",
      ),
    ],
    [EMPTY],
  ];

  for (const section of sections) {
    const { identity } = section;

    rows.push([
      text(`${identity.person} — ${identity.role}`, "header"),
      text(section.status, "total"),
      text(identity.scope === "документ" ? "предмет: сметы объекта" : `предмет: ${identity.scope}`, "note"),
    ]);

    // Причина печатается и при «не выполнен», и при «отказе»: без неё читатель
    // видит агента без замечаний и решает, что тот посмотрел и промолчал.
    if (section.reason !== undefined) {
      rows.push([EMPTY, text(section.reason, "note")]);
      rows.push([EMPTY]);
      continue;
    }

    for (const subject of section.subjects) {
      if (subject.verdict !== undefined) {
        rows.push([EMPTY, text(`${subject.subject}: ${subject.verdict}`, "note")]);
      }
    }

    if (section.depthViolations.length > 0) {
      // Нарушение контракта формы §5.4 — это НЕ замечание к смете, и смешивать
      // их значит выдать «ответ длиннее обещанного» за находку по объекту.
      rows.push([EMPTY, text(`нарушен контракт формы: ${section.depthViolations.join("; ")}`, "note")]);
    }

    if (section.findings.length === 0) {
      rows.push([EMPTY, text("замечаний нет", "note")]);
      rows.push([EMPTY]);
      continue;
    }

    rows.push([
      text("Важность", "header"),
      text("Замечание", "header"),
      text("Основание", "header"),
      text("Сумма под угрозой, ₽", "header"),
      text("Смета", "header"),
    ]);

    for (const finding of section.findings) {
      rows.push([
        text(finding.severity),
        text(finding.statement),
        text(finding.basis),
        // Сумму считает система по номеру позиции, а не модель. Её отсутствие
        // печатается словами: ноль сказал бы, что нарушение бесплатно (§9).
        finding.impact === undefined
          ? text("не определена", "note")
          : money(finding.impact, FROM_DOCUMENT),
        text(finding.document ?? "объект целиком"),
      ]);
    }

    rows.push([EMPTY]);
  }

  return { name: "04_Замечания_агентов", columnWidths: [16, 74, 74, 22, 26], rows };
}

/**
 * Границы разбора. Лист строится ВСЕГДА, даже когда все гейты пройдены:
 * молчание о непокрытом превращает частичный результат в мнимо полный.
 */
function coverageSheet(source: ObjectReportSource): SheetSpec {
  const sections = foldByAgent({
    roster: source.roster ?? [],
    outcomes: source.review?.documents,
    ...(source.degradations === undefined ? {} : { degradations: source.degradations }),
  });
  const silent = sections.filter((section) => section.status !== "выполнен");

  const rows: Cell[][] = [
    [text("ЧТО ЭТОТ РАЗБОР НЕ ПОКРЫВАЕТ", "header")],
    [
      text(
        "Перечень обязателен. Он отвечает на вопрос «чего в этом документе нет», " +
          "чтобы отсутствие раздела не читалось как отсутствие проблемы.",
        "note",
      ),
    ],
    [EMPTY],
    [text("Предмет", "header"), text("Почему не покрыт", "header")],
    [
      text("Рабочая документация (PDF)"),
      text("текст читается, но с составом сметы не сверяется: пропуск оборудования проектом не ловится"),
    ],
    [
      text("Пересчёт индексов на текущий период"),
      text("параметры индексов не заведены; сметы взяты в том уровне цен, в каком составлены"),
    ],
    [
      text("Конъюнктурный анализ цен"),
      text("сверка позиций с коммерческими предложениями и опорной базой не выполнена"),
    ],
    [
      text("Ставка НДС и её изменение"),
      text("расчёт разрыва по НДС есть, но в Проверку не подключён: даты договора на входе нет"),
    ],
    [
      text("Двойной счёт МЕЖДУ сметами"),
      text("совпадения шифра и суммы ищутся внутри одного документа; межсметный дубль не ловится"),
    ],
  ];

  // Кто из агентов промолчал — считается по ФАКТУ прогона, а не перечисляется
  // руками. Прежняя редакция утверждала «реализован один агент — сметчик» и
  // «расчётный модуль экономиста отсутствует» ещё долго после того, как
  // заработали все девять: список границ пережил сами границы. Лист, ради
  // честности и заведённый, начал врать первым.
  if (silent.length > 0) {
    for (const section of silent) {
      rows.push([
        text(`Заключение: ${section.identity.person} — ${section.identity.role}`),
        text(`${section.status}: ${section.reason ?? "причина не объявлена"}`),
      ]);
    }
  } else if (sections.length > 0) {
    rows.push([
      text("Заключения агентов"),
      text(`покрыто: отработали все ${sections.length}`, "note"),
    ]);
  }

  rows.push([
    text("Передачи смежникам"),
    text("открытые вопросы агент формулирует, но адресная передача по конвейеру не собирается"),
  ]);

  // Строка про ССРСС появляется, только если сверка НЕ выполнена: объявлять
  // непокрытым то, что покрыто, так же неверно, как умалчивать о пробеле.
  if (source.summary === undefined || source.summary.error !== undefined) {
    rows.splice(4, 0, [
      text("Сводный сметный расчёт (ССРСС)"),
      text(
        source.summary?.error === undefined
          ? "сверка сумм смет с главами 1-9 не выполнялась"
          : `сводный расчёт не разобран: ${source.summary.error}`,
      ),
    ]);
  }

  if (source.totals.unmatched > 0) {
    rows.push([
      text("Позиции без нормативного шифра"),
      text(
        `${source.totals.unmatched} шт. — обоснованы конъюнктурным анализом; ` +
          "текстовое сопоставление с каталогом не реализовано",
      ),
    ]);
  }

  return { name: "05_Не_покрыто", columnWidths: [46, 96], rows };
}


export function buildObjectReport(source: ObjectReportSource): WorkbookSpec {
  const sheets: SheetSpec[] = [
    conclusionSheet(source),
    compositionSheet(source),
    summarySheet(source),
  ];

  const findings = findingsSheet(source);
  if (findings !== undefined) sheets.push(findings);

  sheets.push(coverageSheet(source));

  return {
    sheets,
    metadata: {
      templateVersion: OBJECT_REPORT_TEMPLATE,
      generatorVersion: source.generatorVersion,
      artifactId: source.artifact.id,
      inputHashes: source.artifact.inputHashes,
      producedAt: source.producedAt,
    },
  };
}
