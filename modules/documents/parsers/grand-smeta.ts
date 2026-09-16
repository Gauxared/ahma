/**
 * Разбор локального сметного расчёта из выгрузки ГРАНД-Сметы
 * по Приказу Минстроя № 421/пр (Методика 2020).
 *
 * Форма — государственная, поэтому разбор обобщается на любую смету этого
 * формата, а не только на курганский комплект. Встречаются две формы:
 *
 *   Приложение № 4 — базисно-индексный метод, итог позиции в колонке «всего»;
 *   Приложение № 3 — ресурсно-индексный, между базисным и текущим уровнем
 *                    добавлены колонки индекса, и «всего» уезжает правее.
 *
 * Поэтому колонки НЕ зашиваются: итоговая колонка находится по подзаголовку.
 * Зашитая «колонка N» молча дала бы ноль позиций на второй форме — а молчаливый
 * ноль запрещён инвариантом «неизвестное не превращается в ноль» (ТЗ §9).
 *
 * Числа берутся как десятичные строки: §12.1б требует расхождения ровно 0 ₽,
 * а двоичная плавающая точка этого не даёт.
 */
import type { CodeSystem, ItemCode } from "@contracts/index.js";

import { Decimal } from "decimal.js";

import { cellNumber } from "../cell-number.js";
import { normalize, rowNumbers, type Sheet } from "../sheet.js";

/**
 * Форма сметы. Две первые — приложения приказа 421/пр, третья означает «формы
 * приказа в документе нет, таблица прочитана по шапке колонок»
 * (`any-estimate.ts`). Третье значение обязано существовать: иначе разбор
 * произвольной сметы выдавал бы себя за форменный, и человек не отличил бы
 * колонку, названную документом, от колонки, угаданной нами.
 */
export type LsrForm = "appendix-3" | "appendix-4" | "any-layout";

export interface LsrPosition {
  readonly ordinal: string;
  readonly code: ItemCode | undefined;
  /** Обоснование как оно записано, даже если это не нормативный шифр. */
  readonly basis: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity: string | undefined;
  readonly unitCost: string | undefined;
  /**
   * Итог позиции в рублях — колонка «всего».
   *
   * ПУСТО — ЭТО НЕ НОЛЬ. Встречаются сметы, где стоимостной части нет вовсе:
   * шифр, наименование, единица и объём есть, денежные колонки пусты (см.
   * `withoutPrices`). Ноль, подставленный сюда, сложился бы в сходимости и
   * соврал бы о стоимости объекта, а «неизвестно» сложить нельзя — и это
   * правильный ответ.
   */
  readonly total: string | undefined;
  readonly row: number;
}

export interface LsrSection {
  readonly number: string;
  readonly name: string;
  readonly positions: readonly LsrPosition[];
  /** Итог раздела, как он объявлен в документе. */
  readonly declaredTotal: string | undefined;
  readonly row: number | undefined;
}

export interface LsrDocument {
  readonly form: LsrForm;
  readonly sheet: string;
  readonly totalColumn: string;
  readonly quantityColumn: string | undefined;
  readonly unitCostColumn: string | undefined;
  readonly sections: readonly LsrSection[];
  /**
   * В документе НЕТ СТОИМОСТНОЙ ЧАСТИ: в итоговой колонке нет ни одного числа —
   * ни по позициям, ни по разделам, ни по смете.
   *
   * Это свойство документа, а не дефект строки, и различать их обязательно.
   * Позиция без итога в смете, где деньги есть, — дыра, которую нельзя молча
   * принять. Позиция без итога в смете, где денег нет нигде, — факт с объёмом,
   * который нельзя потерять: заказчик ждёт такие позиции в отчёте, а само
   * отсутствие цен — отдельной находкой.
   */
  readonly withoutPrices: boolean;
  /** Итог документа: строка «ВСЕГО по смете». */
  readonly declaredTotal: string | undefined;
  readonly declaredTotalRow: number | undefined;
  /**
   * Заявленная в шапке сметная стоимость. Она номинирована в ТЫС. РУБ., тогда
   * как таблица — в рублях: две шкалы внутри одного документа.
   */
  readonly headerTotalThousands: string | undefined;
  readonly issues: readonly ParseIssue[];
}

export interface ParseIssue {
  readonly severity: "blocking" | "warning";
  readonly message: string;
  readonly row?: number;
}

export class LsrParseError extends Error {
  constructor(
    message: string,
    readonly sheet: string,
  ) {
    super(`${sheet}: ${message}`);
    this.name = "LsrParseError";
  }
}

/**
 * Порядок ОТ ДЛИННОГО К КОРОТКОМУ обязателен.
 *
 * «ГЭСНм08-03-572-06» начинается и с «ГЭСН», и с «ГЭСНм». Если короткий
 * префикс проверить первым, шифр разберётся как ГЭСН с кодом «м08-03-572-06»,
 * которого нет ни в одном справочнике. Именно это давало ноль сопоставлений
 * на курганском СОТВ, где все 44 позиции — монтажные.
 */
const CODE_SYSTEMS: readonly CodeSystem[] = [
  "ГЭСНмр",
  "ГЭСНм",
  "ГЭСНп",
  "ГЭСНр",
  "ГЭСН",
  "ФЕРмр",
  "ФЕРм",
  "ФЕРп",
  "ФЕРр",
  "ФЕР",
  "ТЕРмр",
  "ТЕРм",
  "ТЕРп",
  "ТЕРр",
  "ТЕР",
  "ФССЦпг",
  "ФССЦ",
  "ФСБЦ",
];

/**
 * Порядковый номер позиции. Не всегда чистое число: в курганском СОТВ
 * встречается «76 О» — суффикс отмечает оборудование. Требование «только цифры»
 * молча теряло такие позиции.
 */
const ORDINAL = /^\d+(?:\s*\S{1,3})?$/;

const HEADER_MARKER = "№ п/п";
const POSITION_TOTAL = "всего по позиции";
const SECTION_TOTAL = /всего по разделу\s+(\d+)/i;
const SECTION_START = /^раздел\s+(\d+)\.?\s*(.*)$/i;
const DOCUMENT_TOTAL = /всего по смете/i;

/**
 * Шифр нормативной базы из обоснования (кодовый путь канонизации, ADR-R-013).
 *
 * Строки вида «Пр/812-049.3-1» — это обоснование накладных расходов и сметной
 * прибыли, а не расценка: шифра у них нет, и это нормально.
 */
export function parseItemCode(basis: string): ItemCode | undefined {
  const text = normalize(basis);

  for (const system of CODE_SYSTEMS) {
    if (text.startsWith(system)) {
      // ГЭСН пишет шифр слитно («ГЭСНм08-03-572-06»), ФСБЦ — через дефис
      // («ФСБЦ-08.3.05.02-0021»). Разделитель не часть кода: оставленный
      // дефис не совпал бы ни с одной записью каталога.
      const code = text.slice(system.length).replace(/^[-\s]+/, "").trim();
      return code === "" ? undefined : { system, code };
    }
  }

  return undefined;
}

interface Layout {
  readonly headerRow: number;
  /** Первая строка данных: после шапки, подзаголовка и строки нумерации колонок. */
  readonly firstDataRow: number;
  readonly totalColumn: string;
  readonly quantityColumn: string | undefined;
  /** «На единицу измерения» — объём до коэффициентов. */
  readonly baseQuantityColumn: string | undefined;
  readonly coefficientColumn: string | undefined;
  readonly unitCostColumn: string | undefined;
  readonly form: LsrForm;
}

/**
 * Находит раскладку колонок по подзаголовку таблицы.
 *
 * Итоговая колонка — та, чей подзаголовок равен ровно «всего». Колонка
 * «всего с учетом коэффициентов» — это количество, её легко перепутать.
 */
function detectLayout(sheet: Sheet): Layout {
  const numbers = rowNumbers(sheet);
  const headerRow = numbers.find((row) => normalize(sheet.rows.get(row)?.get("A")) === HEADER_MARKER);

  if (headerRow === undefined) {
    throw new LsrParseError(
      `не найдена шапка таблицы (ячейка A со значением «${HEADER_MARKER}»). ` +
        "Возможно, это не локальный сметный расчёт по форме 421/пр",
      sheet.name,
    );
  }

  for (const row of numbers.filter((n) => n > headerRow && n <= headerRow + 5)) {
    const cells = sheet.rows.get(row);
    if (cells === undefined) continue;

    let total: string | undefined;
    let quantity: string | undefined;
    let baseQuantity: string | undefined;
    let coefficient: string | undefined;
    let unitCost: string | undefined;

    for (const [column, raw] of cells) {
      const text = normalize(raw).toLowerCase();

      if (/^всего с уч[её]том коэффициент/.test(text)) {
        // Это КОЛИЧЕСТВО с коэффициентами, а не деньги: перепутать легко.
        quantity = column;
      } else if (text === "на единицу измерения") {
        /**
         * БАЗОВЫЙ ОБЪЁМ — запасной источник количества.
         *
         * Замерено на книгах пакета Нижнего Тагила: «всего с учётом
         * коэффициентов» заполнена у четырёх позиций из двадцати, а в другой
         * книге — ни у одной. Читая только её, разбор оставлял без объёма
         * почти все позиции, и в смете без цен от них не оставалось ничего,
         * кроме шифра.
         *
         * Подзаголовок сравнивается ТОЧНО: «на единицу измерения в базисном
         * уровне цен» — это деньги, и спутать их с количеством нельзя.
         */
        baseQuantity = column;
      } else if (text === "коэффициенты") {
        coefficient = column;
        // \b здесь неприменим: в JS границы слова считаются по ASCII, и после
        // кириллического «всего» её нет. Проверяем пробел или конец строки.
      } else if (/^всего(?:\s|$)/.test(text)) {
        // В базисно-индексной форме подзаголовок «всего», в ресурсно-индексной —
        // «всего в текущем уровне цен». Обе — итог позиции в рублях.
        total = column;
      } else if (/^на единицу измерения в текущем/.test(text) || text === "на единицу") {
        unitCost = column;
      }
    }

    if (total !== undefined) {
      // В ресурсно-индексной форме между базисом и текущим уровнем добавлен
      // индекс, поэтому «всего» стоит правее, чем в базисно-индексной.
      const form: LsrForm = columnIndex(total) > columnIndex("N") ? "appendix-3" : "appendix-4";
      return {
        headerRow,
        // Ниже подзаголовка идёт строка нумерации колонок (1, 2, 3 …). Она
        // выглядит как позиция: число в A и непустое B. Разбор начинаем после неё.
        firstDataRow: numberingRowAfter(sheet, row) ?? row,
        totalColumn: total,
        quantityColumn: quantity,
        baseQuantityColumn: baseQuantity,
        coefficientColumn: coefficient,
        unitCostColumn: unitCost,
        form,
      };
    }
  }

  throw new LsrParseError(
    "в подзаголовке таблицы не найдена колонка «всего» — раскладка формы не распознана",
    sheet.name,
  );
}

/**
 * Находит строку нумерации колонок (A=1, B=2, C=3 …) сразу под подзаголовком.
 * Без её пропуска она распознаётся как основная строка позиции.
 */
function numberingRowAfter(sheet: Sheet, subHeaderRow: number): number | undefined {
  for (const row of rowNumbers(sheet).filter((n) => n > subHeaderRow && n <= subHeaderRow + 3)) {
    const cells = sheet.rows.get(row);
    if (cells === undefined) continue;

    const values = [...cells.values()].map((value) => normalize(value));
    const allSmallIntegers = values.length >= 4 && values.every((value) => /^\d{1,2}$/.test(value));

    if (allSmallIntegers) return row;
  }

  return undefined;
}

function columnIndex(column: string): number {
  let index = 0;
  for (const character of column) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index;
}

/** Число из ячейки. Правило одно на оба разбора — см. `cell-number.ts`. */
const numeric = cellNumber;

/**
 * Объём позиции: сколько единиц работы или материала.
 *
 * Источников два, и порядок между ними не произволен. Написанная в документе
 * колонка «всего с учётом коэффициентов» ГЛАВНЕЕ: это утверждение самой сметы,
 * с её округлениями. Считаем сами только когда её нет — а нет её часто: на
 * книгах пакета Нижнего Тагила она заполнена у четырёх позиций из двадцати, а
 * в соседней книге ни у одной.
 *
 * Коэффициент при этом НЕ игнорируется. Взять «на единицу измерения» сырым
 * значило бы занизить объём ровно во столько раз, во сколько написан
 * коэффициент, — и молча: число стоит на месте, оно просто не то.
 */
function positionQuantity(
  cells: ReadonlyMap<string, string>,
  layout: Layout,
): string | undefined {
  const записанный =
    layout.quantityColumn === undefined ? undefined : numeric(cells.get(layout.quantityColumn));
  if (записанный !== undefined) return записанный;

  const базовый =
    layout.baseQuantityColumn === undefined ? undefined : numeric(cells.get(layout.baseQuantityColumn));
  if (базовый === undefined) return undefined;

  const коэффициент =
    layout.coefficientColumn === undefined ? undefined : numeric(cells.get(layout.coefficientColumn));
  if (коэффициент === undefined) return базовый;

  // `toFixed` здесь не нужен: хвост нулей исказил бы вид объёма («11.50» там,
  // где в документе «11.5»), а точность десятичного умножения он не меняет.
  return new Decimal(базовый).times(коэффициент).toString();
}

/** Заявленная в шапке сметная стоимость (в тыс. руб.). */
function headerTotal(sheet: Sheet, beforeRow: number): string | undefined {
  for (const row of rowNumbers(sheet).filter((n) => n < beforeRow)) {
    const cells = sheet.rows.get(row);
    if (cells === undefined) continue;

    const label = normalize(cells.get("A")).toLowerCase();
    if (label !== "сметная стоимость") continue;

    for (const [, raw] of cells) {
      const value = numeric(raw);
      if (value !== undefined) return value;
    }
  }

  return undefined;
}

export function parseLsr(sheet: Sheet): LsrDocument {
  const layout = detectLayout(sheet);
  const issues: ParseIssue[] = [];

  const sections: LsrSection[] = [];
  let current: { number: string; name: string; row: number; positions: LsrPosition[] } | undefined;
  let declaredSectionTotal: string | undefined;

  // Черновик позиции: основная строка встречается раньше строки «Всего по позиции».
  let draft: { ordinal: string; basis: string; name: string; unit: string; quantity: string | undefined; row: number } | undefined;

  let documentTotal: string | undefined;
  let documentTotalRow: number | undefined;

  /** Встретилось ли в итоговой колонке хоть одно число — по позиции, разделу или смете. */
  let moneySeen = false;
  /** Строки «Всего по позиции», в которых суммы не оказалось. */
  const безСуммы: number[] = [];

  const flushSection = (): void => {
    if (current === undefined) return;
    sections.push({
      number: current.number,
      name: current.name,
      positions: current.positions,
      declaredTotal: declaredSectionTotal,
      row: current.row,
    });
    declaredSectionTotal = undefined;
  };

  for (const row of rowNumbers(sheet).filter((n) => n > layout.firstDataRow)) {
    const cells = sheet.rows.get(row);
    if (cells === undefined) continue;

    const a = normalize(cells.get("A"));
    const b = normalize(cells.get("B"));
    const c = normalize(cells.get("C"));
    const label = `${a} ${c}`;

    const sectionStart = SECTION_START.exec(a);
    if (sectionStart !== null) {
      flushSection();
      current = { number: sectionStart[1] ?? "", name: normalize(sectionStart[2]), row, positions: [] };
      draft = undefined;
      continue;
    }

    const sectionTotal = SECTION_TOTAL.exec(label);
    if (sectionTotal !== null) {
      const value = numeric(cells.get(layout.totalColumn));
      if (value !== undefined) {
        declaredSectionTotal = value;
        moneySeen = true;
      }
      continue;
    }

    if (DOCUMENT_TOTAL.test(label)) {
      const value = numeric(cells.get(layout.totalColumn));
      if (value !== undefined) {
        documentTotal = value;
        documentTotalRow = row;
        moneySeen = true;
      }
      continue;
    }

    // Итог позиции закрывает черновик.
    if (c.toLowerCase() === POSITION_TOTAL) {
      const total = numeric(cells.get(layout.totalColumn));
      if (total !== undefined) moneySeen = true;

      if (draft === undefined) {
        issues.push({ severity: "blocking", message: "итог позиции без основной строки", row });
        continue;
      }

      /**
       * Позиция БЕЗ СУММЫ здесь принимается, а решение о ней откладывается.
       *
       * Что это — дыра в оценённой смете или смета без стоимостной части —
       * по одной строке не видно: ответ даёт весь документ. Раньше строка
       * отбрасывалась сразу, и на пакете, где денег нет нигде, терялись все
       * позиции до последней.
       */
      if (total === undefined) безСуммы.push(row);

      if (current === undefined) {
        // Позиция вне раздела: в форме 421/пр так быть не должно.
        issues.push({ severity: "warning", message: "позиция вне раздела", row: draft.row });
        current = { number: "0", name: "", row: draft.row, positions: [] };
      }

      const unitCost =
        layout.unitCostColumn === undefined ? undefined : numeric(cells.get(layout.unitCostColumn));

      current.positions.push({
        ordinal: draft.ordinal,
        code: parseItemCode(draft.basis),
        basis: draft.basis,
        name: draft.name,
        unit: draft.unit,
        quantity: draft.quantity,
        unitCost,
        total,
        row: draft.row,
      });

      draft = undefined;
      continue;
    }

    // Основная строка позиции: порядковый номер и непустое обоснование.
    if (ORDINAL.test(a) && b !== "") {
      draft = {
        ordinal: a,
        basis: b,
        name: c,
        unit: normalize(cells.get("H")),
        quantity: positionQuantity(cells, layout),
        row,
      };
    }
  }

  flushSection();

  if (draft !== undefined) {
    issues.push({ severity: "warning", message: "основная строка позиции без итога", row: draft.row });
  }

  if (sections.length === 0) {
    issues.push({ severity: "blocking", message: "не найдено ни одного раздела" });
  }

  /**
   * РАЗВЯЗКА: одна и та же пустая ячейка значит разное в разных документах.
   *
   * Денег нет НИГДЕ — значит стоимостной части у сметы нет как таковой.
   * Позиции остаются: шифр, наименование, единица и объём — это факты, и они
   * нужны в отчёте. Сказано об этом ОДИН раз про документ: построчно это
   * замечание занимало пол-экрана и вытесняло всё остальное.
   *
   * Деньги есть, а у отдельной позиции итога нет — это дыра в оценённой смете.
   * Такую позицию принять нельзя: её сумма участвовала бы в сходимости как
   * неизвестная, хотя должна быть числом.
   */
  const withoutPrices = !moneySeen && безСуммы.length > 0;
  const итоговыеРазделы = withoutPrices
    ? sections
    : sections.map((раздел) => ({
        ...раздел,
        positions: раздел.positions.filter((позиция) => позиция.total !== undefined),
      }));

  if (withoutPrices) {
    /**
     * ПРЕДУПРЕЖДЕНИЕ, А НЕ БЛОКИРОВКА — и разница здесь принципиальная.
     *
     * `blocking` в этом разборе означает «разбор не удался»: обход отказывает
     * документу целиком и не берёт из него ничего. Но разбор УДАЛСЯ: шифры,
     * наименования, единицы и объёмы прочитаны, двести тридцать одна позиция
     * на пакете Нижнего Тагила. Отказать такому документу значило бы выбросить
     * всё прочитанное из-за того, чего в нём и не было.
     *
     * Серьёзность самой находки задаёт не разбор, а обход: он выдаёт по флагу
     * `withoutPrices` критичное замечание с денежным весом от НМЦК — так это и
     * стоит в эталоне заказчика (находка №1, красная).
     */
    issues.push({
      severity: "warning",
      message:
        "смета без стоимостной части: шифры, наименования, единицы и объёмы есть, " +
        `денежных колонок нет (${безСуммы.length} позиций). ` +
        "Построчная проверка расценок, индексов и двойного счёта по ней невозможна",
    });
  } else {
    for (const row of безСуммы) {
      issues.push({ severity: "blocking", message: "строка «Всего по позиции» без суммы", row });
    }
  }

  return {
    form: layout.form,
    sheet: sheet.name,
    totalColumn: layout.totalColumn,
    quantityColumn: layout.quantityColumn,
    unitCostColumn: layout.unitCostColumn,
    sections: итоговыеРазделы,
    withoutPrices,
    declaredTotal: documentTotal,
    declaredTotalRow: documentTotalRow,
    headerTotalThousands: headerTotal(sheet, layout.headerRow),
    issues,
  };
}
