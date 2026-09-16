/**
 * Примитивы узкой талии (ADR-R-025).
 *
 * Числа на границах модулей передаются десятичными СТРОКАМИ. Двоичная плавающая
 * точка на денежных значениях делает недостижимым §12.1б («расхождение суммы
 * разделов с итогом источника — 0 ₽»), поэтому `number` для сумм и объёмов
 * в контрактах не используется вовсе.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Десятичное число как строка: "12.5", "-0.01", "104976702.48". */
export type DecimalString = Brand<string, "DecimalString">;

/** SHA-256 в нижнем регистре, 64 hex-символа (ADR-R-027). */
export type Sha256 = Brand<string, "Sha256">;

/** Дата в формате ISO-8601, например "2026-08-24". */
export type IsoDate = Brand<string, "IsoDate">;

/** Момент времени в формате ISO-8601 с зоной. */
export type IsoDateTime = Brand<string, "IsoDateTime">;

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDecimalString(value: string): value is DecimalString {
  return DECIMAL_PATTERN.test(value);
}

export function isSha256(value: string): value is Sha256 {
  return SHA256_PATTERN.test(value);
}

export function isIsoDate(value: string): value is IsoDate {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/** Приводит строку к `DecimalString` или выбрасывает — использовать на границе ввода. */
export function decimal(value: string): DecimalString {
  if (!isDecimalString(value)) {
    throw new TypeError(`Не десятичное число: ${JSON.stringify(value)}`);
  }
  return value;
}

export function sha256(value: string): Sha256 {
  const normalized = value.toLowerCase();
  if (!isSha256(normalized)) {
    throw new TypeError(`Не SHA-256: ${JSON.stringify(value)}`);
  }
  return normalized;
}

export function isoDate(value: string): IsoDate {
  if (!isIsoDate(value)) {
    throw new TypeError(`Не дата ISO-8601: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Канонический код единицы измерения. Единицы источника («100 м2», «т»)
 * приводятся к каноническим на входе; в талии ходят только канонические
 * (ADR-R-013, размерный анализ).
 */
export type UnitCode = Brand<string, "UnitCode">;

/**
 * Приводит строку к `UnitCode`. Единица — это идентификатор из реестра, а не
 * произвольный текст, поэтому конструктор явный: случайно подставить сюда
 * наименование позиции нельзя.
 */
export function unitCode(value: string): UnitCode {
  const normalized = value.trim();
  if (normalized === "") {
    throw new TypeError("Пустой код единицы измерения");
  }
  return normalized as UnitCode;
}

/** Физическая величина в канонической единице. */
export interface Quantity {
  readonly value: DecimalString;
  readonly unit: UnitCode;
}

export type CurrencyCode = "RUB";

/**
 * Шкала, в которой значение было ЗАЯВЛЕНО в источнике.
 *
 * Появилась из измеренного факта: ЛСР Кургана номинированы в рублях, а ССРСС —
 * в тыс. руб с точностью до копеек, отчего сумма ЛСР и итог ССРСС расходятся на
 * 7.52 ₽ при нулевом расхождении внутри каждой ЛСР. Шкала нужна, чтобы это
 * расхождение объяснялось, а не гасилось молча.
 */
export type MoneyScale = "unit" | "thousand" | "million";

const SCALE_FACTOR: Readonly<Record<MoneyScale, bigint>> = {
  unit: 1n,
  thousand: 1_000n,
  million: 1_000_000n,
};

/** Как значение выглядело в источнике: шкала и число знаков после запятой. */
export interface StatedAs {
  readonly scale: MoneyScale;
  readonly fractionDigits: number;
}

/**
 * Денежная величина.
 *
 * `amount` ВСЕГДА в базовых единицах (рублях) — арифметика никогда не имеет дела
 * со шкалой. Шкала живёт в `statedAs` как свойство источника и используется для
 * рендеринга и для объяснения расхождений округления.
 */
export interface Money {
  readonly amount: DecimalString;
  readonly currency: CurrencyCode;
  readonly statedAs?: StatedAs;
}

export function money(amount: string, currency: CurrencyCode = "RUB", statedAs?: StatedAs): Money {
  return statedAs === undefined
    ? { amount: decimal(amount), currency }
    : { amount: decimal(amount), currency, statedAs };
}

/**
 * Гранулярность округления источника в базовых единицах.
 *
 * Для ССРСС (`thousand`, 2 знака) — 10 ₽: значение не может быть точнее.
 * Расхождение в пределах гранулярности объясняется шкалой, а не считается
 * ошибкой сходимости.
 */
export function roundingGranularity(statedAs: StatedAs): DecimalString {
  const factor = SCALE_FACTOR[statedAs.scale];
  const divisor = 10n ** BigInt(Math.max(0, statedAs.fractionDigits));

  if (factor % divisor === 0n) {
    return (factor / divisor).toString() as DecimalString;
  }

  // Гранулярность мельче базовой единицы: 1 / (divisor / factor).
  const inverse = divisor / factor;
  const digits = inverse.toString().length - 1;
  return `0.${"0".repeat(digits - 1)}1` as DecimalString;
}

export type RoundingMode = "half-up" | "half-even" | "down" | "up";
