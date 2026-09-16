/**
 * Происхождение значений (ADR-R-025, ADR-R-027).
 *
 * ТЗ §9 требует, чтобы у каждого числа был статус источника либо FormulaTrace,
 * а §12.1д принимает «числа без маркера статуса источника в выгрузках — 0».
 * Поэтому в талии нет голого числа: наружу отдаётся `Valued<T>`, собрать который
 * без происхождения невозможно. Это делает нарушение §12.1д ошибкой компиляции,
 * а не находкой на приёмке.
 */
import type { IsoDate, IsoDateTime, Money, Quantity, RoundingMode, Sha256, UnitCode, DecimalString } from "./primitives.js";

/** Статус значения по ТЗ §7: факт · ориентир · нет данных. */
export type SourceStatus = "fact" | "benchmark" | "no_data";

/** Где именно в источнике лежит значение. */
export type Locator =
  | { readonly kind: "cell"; readonly sheet: string; readonly ref: string }
  | { readonly kind: "row"; readonly sheet: string; readonly row: number }
  | { readonly kind: "page"; readonly page: number }
  | { readonly kind: "range"; readonly sheet: string; readonly from: string; readonly to: string }
  | { readonly kind: "record"; readonly recordId: string };

/**
 * Как значение попало в систему. `ocr_unconfirmed` (ADR-R-019) отделён намеренно:
 * §14 исключает распознавание сканов из объёма, поэтому такие значения видимо
 * маркируются и не идут в зачёт §12.1а без протокола.
 *
 * `agent_normalized` — Т11. Позиция получена из документа, форму которого
 * детерминированный разбор не знает: калькуляция своей вёрстки, ведомость
 * объёмов, смета контракта по 44-ФЗ, спецификация в PDF. Структуру распознала
 * роль, значения взяты из документа, координата листа и строки названа.
 *
 * ТАКАЯ ПОЗИЦИЯ СЧИТАЕТСЯ НАРАВНЕ С РАЗОБРАННОЙ — решение владельца 08.09.2026.
 * Она идёт в сходимость, в гейты и в межсметные дубли, потому что иначе
 * система знает о смете и не учитывает то, что знает. Отличается она ОДНИМ:
 * уровнем доверия, и он помечается словом рядом с числом — читатель обязан
 * видеть, что структуру назвала модель, а не форма 421/пр.
 */
export type Acquisition = "parsed" | "imported" | "confirmed_by_human" | "ocr_unconfirmed" | "agent_normalized";

/** Уровень доверия словами человека — для экрана, книг пакета и вердикта. */
export function acquisitionLabel(acquisition: Acquisition): string {
  switch (acquisition) {
    case "parsed":
      return "факт · разобрано из файла";
    case "agent_normalized":
      return "ориентир · структуру распознала роль, значения из документа";
    case "ocr_unconfirmed":
      return "ориентир · прочитано с изображения страницы";
    case "confirmed_by_human":
      return "факт · подтверждено человеком";
    case "imported":
      return "факт · загружено из справочника";
  }
}

/** Ссылка на измеренное значение в источнике. */
export interface SourceRef {
  readonly sourceId: string;
  /** Хэш содержимого записи — основа воспроизводимости (ADR-R-027). */
  readonly contentHash: Sha256;
  readonly locator: Locator;
  readonly status: SourceStatus;
  readonly acquisition: Acquisition;
  /** Год, к которому относится значение (ТЗ §7, обязательное поле числовой строки). */
  readonly year?: number;
  readonly checkedAt: IsoDate;
  /** ТЗ §7: значения старше 90 дней помечаются как требующие проверки. */
  readonly staleAfterDays: number;
}

/** Ссылка на вычисленное значение (ТЗ §6.4: числа считает расчётный модуль). */
export interface FormulaTrace {
  readonly formulaId: string;
  readonly formulaVersion: number;
  readonly inputs: Readonly<Record<string, DecimalString | Quantity | Money>>;
  readonly output: DecimalString;
  readonly unit?: UnitCode;
  readonly rounding: RoundingMode;
}

export type Provenance =
  | { readonly kind: "source"; readonly ref: SourceRef }
  | { readonly kind: "formula"; readonly trace: FormulaTrace };

/**
 * Значение вместе с происхождением. Единственный способ вынести число из модуля.
 */
export interface Valued<T> {
  readonly value: T;
  readonly provenance: Provenance;
  /** Выставляется, когда значение старше `staleAfterDays` (ТЗ §7). */
  readonly reviewDue?: boolean;
}

export function fromSource<T>(value: T, ref: SourceRef, at: IsoDate): Valued<T> {
  const due = isReviewDue(ref, at);
  return due ? { value, provenance: { kind: "source", ref }, reviewDue: true } : { value, provenance: { kind: "source", ref } };
}

export function fromFormula<T>(value: T, trace: FormulaTrace): Valued<T> {
  return { value, provenance: { kind: "formula", trace } };
}

/** ТЗ §7: значение старше порога свежести выводится с признаком во всех расчётах. */
export function isReviewDue(ref: SourceRef, at: IsoDate): boolean {
  const checked = Date.parse(ref.checkedAt);
  const now = Date.parse(at);
  if (Number.isNaN(checked) || Number.isNaN(now)) {
    return false;
  }
  const days = (now - checked) / 86_400_000;
  return days > ref.staleAfterDays;
}

/**
 * Значение, полученное распознаванием, не подтверждено (ADR-R-019).
 * Используется, чтобы исключить такие позиции из зачёта §12.1а.
 */
export function isOcrUnconfirmed(provenance: Provenance): boolean {
  return provenance.kind === "source" && provenance.ref.acquisition === "ocr_unconfirmed";
}

export type { IsoDateTime };
