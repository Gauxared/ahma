/**
 * Расчётная выгрузка (ТЗ §10: Excel с рабочими формулами, листом параметров
 * и подсвеченными вводимыми значениями).
 *
 * Книга описывается как ЧИСТЫЕ ДАННЫЕ, а рендерит их платформа. Причина та же,
 * что у чтения: логика выгрузки не должна знать про библиотеку, а проверять
 * структуру книги на её же рендере — значит проверять библиотеку, а не себя.
 *
 * Два инварианта, которые здесь и обеспечиваются:
 *  · §12.1д — числа без маркера статуса источника в выгрузках: 0. Тип ячейки
 *    не даёт вывести число без маркера;
 *  · итог — рабочая формула со ссылками на ячейки, а не посчитанное значение.
 *    §10 требует именно рабочих формул, и при этом у каждой формульной ячейки
 *    остаётся след с ожидаемым результатом, чтобы расхождение было видно.
 */
import { escapeFormulaInjection } from "@contracts/index.js";
import type {
  AccuracyMarker,
  Artifact,
  DecimalString,
  FormulaTrace,
  Money,
  Valued,
} from "@contracts/index.js";

export const TEMPLATE_VERSION = "calculation-workbook-1" as const;

/**
 * Экранирование текста из чужих документов.
 *
 * Реализация ОДНА — в талии (`@contracts`), и она же стоит в писателе книги.
 * Здесь только имя, привычное модулю выгрузки: две реализации одного контроля
 * безопасности хуже одной, потому что расходятся они молча, а замечают это на
 * той стороне, где книгу открывают.
 */
export const escapeSpreadsheetText = escapeFormulaInjection;

export type CellStyle = "header" | "input" | "total" | "note";

export type Cell =
  | { readonly kind: "text"; readonly value: string; readonly style?: CellStyle }
  | { readonly kind: "empty" }
  | {
      readonly kind: "number";
      readonly value: DecimalString;
      /** Маркер статуса источника — обязателен по §12.1д. */
      readonly marker: string;
      readonly style?: CellStyle;
    }
  | {
      readonly kind: "formula";
      readonly formula: string;
      readonly trace: FormulaTrace;
      /** Значение, которое формула обязана дать; расхождение — дефект. */
      readonly expected: DecimalString;
      readonly marker: string;
      readonly style?: CellStyle;
    };

export interface SheetSpec {
  readonly name: string;
  readonly columnWidths: readonly number[];
  readonly rows: readonly (readonly Cell[])[];
}

export interface WorkbookMetadata {
  readonly templateVersion: string;
  readonly generatorVersion: string;
  readonly artifactId: string;
  readonly inputHashes: readonly string[];
  readonly producedAt: string;
}

export interface WorkbookSpec {
  readonly sheets: readonly SheetSpec[];
  readonly metadata: WorkbookMetadata;
}

export interface PositionForExport {
  readonly ordinal: string;
  readonly name: string;
  readonly basis: string;
  readonly unit: string;
  /** Пусто — суммы у позиции нет: смета без стоимостной части. */
  readonly amount?: Valued<Money> | undefined;
}

export interface SectionForExport {
  readonly number: string;
  readonly name: string;
  readonly positions: readonly PositionForExport[];
  /** Пусто — итог раздела не сложить: суммы известны не у всех позиций. */
  readonly total?: Valued<Money> | undefined;
}

export interface ParameterForExport {
  readonly id: string;
  readonly value: DecimalString;
  readonly effectiveFrom: string;
  readonly source: string;
}

export interface CalculationSource {
  readonly documentPath: string;
  readonly artifact: Artifact<unknown>;
  readonly sections: readonly SectionForExport[];
  /** Пусто — итог сметы не сложить. Книга тогда считает только объёмы. */
  readonly documentTotal?: Valued<Money> | undefined;
  readonly parameters: readonly ParameterForExport[];
  readonly accuracy: AccuracyMarker;
  readonly generatorVersion: string;
}

/** Человекочитаемый маркер происхождения значения (§9, §12.1д). */
function markerOf(valued: Valued<unknown>): string {
  if (valued.provenance.kind === "formula") {
    return `расчёт: ${valued.provenance.trace.formulaId}`;
  }

  const ref = valued.provenance.ref;
  const place = ref.locator.kind === "row" ? `, строка ${ref.locator.row}` : "";
  const stale = valued.reviewDue === true ? ", ТРЕБУЕТ ПРОВЕРКИ" : "";

  return `${ref.status === "fact" ? "факт" : ref.status === "benchmark" ? "ориентир" : "нет данных"}: ${ref.sourceId}${place}${stale}`;
}

function text(value: string, style?: CellStyle): Cell {
  return style === undefined
    ? { kind: "text", value: escapeSpreadsheetText(value) }
    : { kind: "text", value: escapeSpreadsheetText(value), style };
}

const EMPTY: Cell = { kind: "empty" };

function numberCell(valued: Valued<Money>, style?: CellStyle): Cell {
  const base = { kind: "number" as const, value: valued.value.amount, marker: markerOf(valued) };
  return style === undefined ? base : { ...base, style };
}

/**
 * Строит книгу из канонического артефакта.
 *
 * Повторный разбор документа здесь запрещён: выгрузка обязана показывать то же,
 * что показал расчёт, иначе Excel и результат Проверки разойдутся.
 */
export function buildCalculationWorkbook(source: CalculationSource): WorkbookSpec {
  const rows: Cell[][] = [];

  rows.push([text("Расчётная выгрузка", "header")]);
  rows.push([text("Документ"), text(source.documentPath)]);
  rows.push([
    text("Точность оценки"),
    text(`${source.accuracy.range} — ${source.accuracy.basis}`),
    text("Договорная эвристика, а не подтверждённая точность", "note"),
  ]);
  rows.push([EMPTY]);

  rows.push([
    text("№", "header"),
    text("Обоснование", "header"),
    text("Наименование", "header"),
    text("Ед.", "header"),
    text("Сумма, ₽", "header"),
    text("Источник значения", "header"),
  ]);

  const sectionTotalRows: number[] = [];

  for (const section of source.sections) {
    rows.push([text(`Раздел ${section.number}. ${section.name}`, "header")]);

    const firstDataRow = rows.length + 1;

    for (const position of section.positions) {
      rows.push([
        text(position.ordinal),
        text(position.basis),
        text(position.name),
        text(position.unit),
        // Сумма позиции пришла из документа — вводимое значение, подсвечивается.
        // Её может не быть вовсе: в смете без стоимостной части позиция несёт
        // шифр, единицу и объём, а денег в ней нет. Пустая ячейка честнее нуля,
        // который сложился бы формулой SUM ниже.
        position.amount === undefined ? text("—") : numberCell(position.amount, "input"),
        text(position.amount === undefined ? "суммы в смете нет" : markerOf(position.amount)),
      ]);
    }

    const lastDataRow = rows.length;

    if (section.total === undefined) {
      /**
       * Итог раздела не сложить — и формулу SUM ставить нельзя.
       *
       * Excel сложил бы пустые ячейки в ноль и показал «Всего по разделу
       * 0,00 ₽»: число, выглядящее посчитанным, на смете, где считать нечего.
       */
      rows.push([
        EMPTY,
        EMPTY,
        text(`Всего по разделу ${section.number}`, "total"),
        EMPTY,
        text("—", "total"),
        text("итог не сложить: суммы известны не у всех позиций"),
      ]);
      continue;
    }

    if (section.total.provenance.kind !== "formula") {
      throw new Error(
        `Итог раздела ${section.number} обязан быть вычисленным значением со следом формулы`,
      );
    }

    rows.push([
      EMPTY,
      EMPTY,
      text(`Всего по разделу ${section.number}`, "total"),
      EMPTY,
      {
        kind: "formula",
        // Рабочая формула со ссылками на ячейки: §10 требует именно её.
        formula: `SUM(E${firstDataRow}:E${lastDataRow})`,
        trace: section.total.provenance.trace,
        expected: section.total.value.amount,
        marker: markerOf(section.total),
        style: "total",
      },
      text(markerOf(section.total)),
    ]);

    sectionTotalRows.push(rows.length);
  }

  if (source.documentTotal === undefined) {
    /**
     * Формулу сложения итогов разделов ставить нельзя: разделы своих итогов не
     * дали, и Excel сложил бы пустоту в «0,00 ₽» — число, выглядящее
     * посчитанным, на смете, где считать нечего.
     */
    rows.push([
      EMPTY,
      EMPTY,
      text("ВСЕГО по смете", "total"),
      EMPTY,
      text("—", "total"),
      text("итог не сложить: в смете нет стоимостной части"),
    ]);
  } else {
    const итог = source.documentTotal;

    if (итог.provenance.kind !== "formula") {
      throw new Error("Итог по смете обязан быть вычисленным значением со следом формулы");
    }

    const след = итог.provenance.trace;

    rows.push([
      EMPTY,
      EMPTY,
      text("ВСЕГО по смете", "total"),
      EMPTY,
      {
        kind: "formula",
        formula: sectionTotalRows.map((row) => `E${row}`).join("+"),
        trace: след,
        expected: итог.value.amount,
        marker: markerOf(итог),
        style: "total",
      },
      text(markerOf(итог)),
    ]);
  }

  const parameterRows: Cell[][] = [
    [text("Параметры расчёта", "header")],
    [text("Ставки задаются параметром с датой начала действия (ТЗ §6.4)", "note")],
    [EMPTY],
    [text("Параметр", "header"), text("Значение", "header"), text("Действует с", "header"), text("Источник", "header")],
  ];

  for (const parameter of source.parameters) {
    parameterRows.push([
      text(parameter.id),
      { kind: "number", value: parameter.value, marker: `параметр: ${parameter.source}`, style: "input" },
      text(parameter.effectiveFrom),
      text(parameter.source),
    ]);
  }

  const provenanceRows: Cell[][] = [
    [text("Происхождение выгрузки", "header")],
    [text("Шаблон"), text(TEMPLATE_VERSION)],
    [text("Версия генератора"), text(source.generatorVersion)],
    [text("Артефакт"), text(source.artifact.id)],
    [text("Операция"), text(`${source.artifact.operation.id} v${source.artifact.operation.version}`)],
    [text("Класс полноты"), text(source.artifact.completeness)],
    [text("Сформировано"), text(source.artifact.producedAt)],
    [EMPTY],
    [text("Хэши входов", "header")],
    ...source.artifact.inputHashes.map((hash) => [text(hash)]),
  ];

  return {
    sheets: [
      { name: "Расчёт", columnWidths: [6, 26, 52, 8, 16, 46], rows },
      { name: "Параметры", columnWidths: [24, 14, 14, 40], rows: parameterRows },
      { name: "Источники", columnWidths: [22, 70], rows: provenanceRows },
    ],
    metadata: {
      templateVersion: TEMPLATE_VERSION,
      generatorVersion: source.generatorVersion,
      artifactId: source.artifact.id,
      inputHashes: [...source.artifact.inputHashes],
      producedAt: source.artifact.producedAt,
    },
  };
}

/** Все следы формул книги — их надо сохранить рядом с выгрузкой (§12.1д). */
export function tracesOf(workbook: WorkbookSpec): readonly FormulaTrace[] {
  return workbook.sheets
    .flatMap((sheet) => sheet.rows.flat())
    .filter((cell): cell is Extract<Cell, { kind: "formula" }> => cell.kind === "formula")
    .map((cell) => cell.trace);
}
