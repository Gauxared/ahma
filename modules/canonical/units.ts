/**
 * Единицы измерения и размерный анализ (ТЗ §5.2, ADR-R-013).
 *
 * ТЗ требует приводить позиции разных предложений к сопоставимому виду по
 * наименованиям, единицам измерения, объёмам и составу работ. Единицы — самая
 * механическая часть этой задачи и единственная, где возможен точный ответ.
 *
 * Два правила, оба выведены из курганских данных:
 *
 *  1. Числовой префикс — это множитель расценки, а не часть единицы. «100 м2»
 *     означает сто квадратных метров на единицу расценки; хранить его как
 *     единицу «100 м2» значит сделать несопоставимыми две одинаковые позиции.
 *  2. Перевод между размерностями запрещён. Метры в килограммы не переводятся,
 *     и подставлять сюда число нельзя: это ошибка данных, а не округление.
 *
 * Нераспознанная единица («антенна», «компл») не отбрасывается и не
 * приравнивается к штукам: она сопоставима только сама с собой. Инвариант §9
 * «неизвестное не превращается в ноль» относится и к единицам.
 */
import { Decimal } from "decimal.js";

import type { UnitCode } from "@contracts/index.js";

/** Класс эквивалентности: перевод возможен только внутри одного класса. */
export type Dimension = "count" | "set" | "length" | "area" | "volume" | "mass" | "ratio" | "unknown";

interface UnitDefinition {
  readonly canonical: UnitCode;
  readonly dimension: Dimension;
  /** Множитель к канонической единице своей размерности. */
  readonly toCanonical: string;
}

/**
 * Реестр единиц. Намеренно небольшой: сюда попадает то, что действительно
 * встречается в сметах, а не полный справочник СИ.
 */
const UNITS = new Map<string, UnitDefinition>(
  (
    [
      // Счётные
      ["шт", "шт", "count", "1"],
      ["шт.", "шт", "count", "1"],
      ["штук", "шт", "count", "1"],
      // Комплект — НЕ штука: сравнение комплекта со штуками ошибочно.
      ["компл", "компл", "set", "1"],
      ["компл.", "компл", "set", "1"],
      ["комплект", "компл", "set", "1"],
      // Длина
      ["м", "м", "length", "1"],
      ["пм", "м", "length", "1"],
      ["п.м", "м", "length", "1"],
      ["пог.м", "м", "length", "1"],
      ["пог. м", "м", "length", "1"],
      ["погм", "м", "length", "1"],
      ["км", "м", "length", "1000"],
      ["мм", "м", "length", "0.001"],
      ["см", "м", "length", "0.01"],
      // Площадь
      ["м2", "м2", "area", "1"],
      ["кв.м", "м2", "area", "1"],
      ["га", "м2", "area", "10000"],
      // Объём
      ["м3", "м3", "volume", "1"],
      ["куб.м", "м3", "volume", "1"],
      ["л", "м3", "volume", "0.001"],
      // Масса
      ["кг", "кг", "mass", "1"],
      ["т", "кг", "mass", "1000"],
      ["г", "кг", "mass", "0.001"],
      ["ц", "кг", "mass", "100"],
      // Доли
      ["%", "%", "ratio", "1"],
    ] as const
  ).map(([written, canonical, dimension, factor]) => [
    written,
    { canonical: canonical as UnitCode, dimension: dimension as Dimension, toCanonical: factor },
  ]),
);

export interface ParsedUnit {
  /** Распознана ли единица реестром. */
  readonly resolved: boolean;
  /** Каноническая единица либо исходный текст, если распознать не удалось. */
  readonly unit: UnitCode;
  readonly dimension: Dimension;
  /** Числовой префикс расценки, умноженный на перевод к канонической единице. */
  readonly multiplier: string;
  readonly raw: string;
  readonly reason?: string;
}

/** Числовой префикс расценки: «100 м2», «1000 м», «10 шт». */
const PREFIXED = /^(\d+(?:[.,]\d+)?)\s*(.+)$/;

function decimalString(value: Decimal): string {
  // Убираем хвостовые нули: «1000», а не «1000.000».
  return value.toFixed(6).replace(/\.?0+$/, "") || "0";
}

export function parseUnit(raw: string): ParsedUnit {
  const text = raw.replace(/\s+/g, " ").trim();

  if (text === "") {
    return {
      resolved: false,
      unit: "" as UnitCode,
      dimension: "unknown",
      multiplier: "1",
      raw,
      reason: "единица измерения не указана в документе",
    };
  }

  let prefix = new Decimal(1);
  let body = text;

  const prefixed = PREFIXED.exec(text);
  if (prefixed !== null) {
    prefix = new Decimal((prefixed[1] ?? "1").replace(",", "."));
    body = (prefixed[2] ?? "").trim();
  }

  const definition = UNITS.get(body.toLowerCase());

  if (definition === undefined) {
    return {
      resolved: false,
      // Нераспознанная единица сохраняется как есть: она сопоставима сама с собой.
      unit: body as UnitCode,
      dimension: "unknown",
      multiplier: decimalString(prefix),
      raw,
      reason: `единица «${body}» отсутствует в реестре — перевод невозможен, сопоставление только с такой же`,
    };
  }

  return {
    resolved: true,
    unit: definition.canonical,
    dimension: definition.dimension,
    multiplier: decimalString(prefix.times(new Decimal(definition.toCanonical))),
    raw,
  };
}

export class DimensionError extends Error {
  constructor(from: string, to: string) {
    super(`Единицы «${from}» и «${to}» имеют разные размерности: перевод невозможен`);
    this.name = "DimensionError";
  }
}

function definitionOf(unit: string): UnitDefinition {
  const found = UNITS.get(unit.toLowerCase());

  return (
    found ?? {
      canonical: unit as UnitCode,
      dimension: "unknown",
      toCanonical: "1",
    }
  );
}

/**
 * Сопоставимы ли единицы. Нераспознанные сопоставимы только сами с собой:
 * «антенна» и «шт» — разные предметы, и приравнивать их нельзя.
 */
export function unitsAreComparable(from: string, to: string): boolean {
  const a = definitionOf(from);
  const b = definitionOf(to);

  if (a.dimension === "unknown" || b.dimension === "unknown") {
    return from.trim().toLowerCase() === to.trim().toLowerCase();
  }

  return a.dimension === b.dimension;
}

/** Перевод значения между единицами одной размерности. Иначе — отказ. */
export function convert(value: string, from: string, to: string): string {
  if (!unitsAreComparable(from, to)) {
    throw new DimensionError(from, to);
  }

  const a = definitionOf(from);
  const b = definitionOf(to);

  const inCanonical = new Decimal(value).times(new Decimal(a.toCanonical));
  return decimalString(inCanonical.dividedBy(new Decimal(b.toCanonical)));
}

/** Единицы, известные реестру, — для отчётов и диагностики. */
export function knownUnits(): readonly string[] {
  return [...UNITS.keys()];
}
