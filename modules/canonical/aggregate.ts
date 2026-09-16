/**
 * Декомпозиция и агрегация состава работ — ADR-R-013, ТЗ §5.2.
 *
 * Дословно ADR: «декомпозиция и агрегация состава: одно КП свёртывает то, что
 * другое разбивает».
 *
 * ЧТО ЭТО ЗА ЗАДАЧА
 *
 * Один подрядчик пишет «устройство подстилающего слоя из щебня — 1110 м³,
 * 2 664 000 ₽» одной строкой. Второй разбивает то же самое на «поставку щебня»
 * и «укладку с трамбовкой». Сравнивать построчно нельзя: у первого одна
 * строка, у второго две, и любое построчное сопоставление даёт либо потерю,
 * либо двойной счёт.
 *
 * §5.2 требует «сопоставление наименований, единиц измерения, объёмов И
 * СОСТАВА РАБОТ» — состав это и есть.
 *
 * ГЛАВНЫЙ ИНВАРИАНТ: ДЕНЬГИ НЕ ИСЧЕЗАЮТ И НЕ ПОЯВЛЯЮТСЯ
 *
 * Сумма по группе в точности равна сумме её строк, а сумма всего — сумме групп
 * и несопоставленных. Агрегация, теряющая копейку, теряет её из предложения
 * подрядчика, то есть меняет то, что он предложил.
 *
 * ОБЪЁМЫ — ОТДЕЛЬНАЯ И БОЛЕЕ ТРУДНАЯ ВЕЛИЧИНА, ЧЕМ ДЕНЬГИ
 *
 * Рубли складываются всегда: рубль есть рубль. С объёмами сложнее, и здесь
 * различаются два случая.
 *
 *  · Строки с ОДИНАКОВЫМ объёмом описывают разные ВИДЫ РАБОТ над одним и тем
 *    же предметом — поставку и укладку одного и того же щебня. Сложить их
 *    значит удвоить материал.
 *  · Строки с РАЗНЫМИ объёмами описывают разные ЧАСТИ работы — два участка по
 *    555 м³. Их складывать нужно.
 *
 * Правило выведено из того, как устроены сами КП, и в пограничных случаях
 * ошибается — поэтому итог несёт пояснение, а не голое число.
 *
 * РАЗНЫЕ РАЗМЕРНОСТИ НЕ СКЛАДЫВАЮТСЯ ВОВСЕ
 *
 * «Поставка щебня, м³» и «укладка, м²» — не слагаемые. Полученное число не
 * имело бы физического смысла, и это хуже отказа: у отказа виден повод, у
 * бессмысленного числа — нет.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString } from "@contracts/index.js";

import { convert, parseUnit, unitsAreComparable } from "./units.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export interface OfferLine {
  /** Номер строки в предложении: по нему возвращаются к исходному документу. */
  readonly line: string;
  /** Каноническая позиция. Отсутствует, когда строка не сопоставлена. */
  readonly canonicalId?: string;
  readonly quantity: string;
  readonly unit: string;
  readonly amount: string;
}

export interface AggregatedGroup {
  readonly canonicalId: string;
  readonly lines: readonly OfferLine[];
  /** Сумма строк группы. Всегда вычислима: рубль есть рубль. */
  readonly amount: DecimalString;
  /** Объём группы. Отсутствует, когда строки в разных размерностях. */
  readonly quantity?: DecimalString;
  readonly unit?: string;
  /** Почему объём такой. Голое число здесь обманывало бы. */
  readonly quantityNote: string;
  /** Разбита ли работа на несколько строк в этом предложении. */
  readonly decomposed: boolean;
}

export interface Aggregation {
  readonly groups: readonly AggregatedGroup[];
  readonly unmatched: readonly OfferLine[];
  readonly total: DecimalString;
  readonly matchedAmount: DecimalString;
  readonly unmatchedAmount: DecimalString;
  readonly note: string;
}

function money(value: Decimal): DecimalString {
  return decimal(value.toFixed(2));
}

/** Число без хвостовых нулей: объёмы в КП пишут как «1110», а не «1110.00». */
function quantityOf(value: Decimal): DecimalString {
  return decimal(value.toString());
}

function sumAmounts(lines: readonly OfferLine[]): Decimal {
  return lines.reduce((sum, line) => sum.plus(new Decimal(line.amount)), new Decimal(0));
}

/**
 * Объём группы.
 *
 * Возвращает `undefined`, когда строки в разных размерностях: складывать их
 * нельзя, а придумывать общее число — тем более.
 */
function groupQuantity(lines: readonly OfferLine[]): {
  quantity?: Decimal;
  unit?: string;
  note: string;
} {
  const first = lines[0]!;

  const mixed = lines.some((line) => !unitsAreComparable(line.unit, first.unit));
  if (mixed) {
    const units = [...new Set(lines.map((line) => line.unit))].join(", ");
    return {
      note:
        `объём не сложен: строки в разных размерностях (${units}). ` +
        "Сумма таких величин не имеет физического смысла; деньги при этом суммированы",
    };
  }

  // Общая единица — каноническая для размерности: «км» и «м» сводятся к «м».
  // Поле называется `unit`, а не `canonical`: у нераспознанной единицы там
  // остаётся исходный текст, и это верно — «антенна» сопоставима сама с собой.
  const target = parseUnit(first.unit).unit;
  const converted = lines.map((line) => new Decimal(convert(line.quantity, line.unit, target)));

  const allEqual = converted.every((value) => value.equals(converted[0]!));

  if (lines.length > 1 && allEqual) {
    // Одинаковый объём означает разные ВИДЫ РАБОТ над одним предметом:
    // поставка и укладка одного и того же щебня. Сложить — удвоить материал.
    return {
      quantity: converted[0]!,
      unit: target,
      note:
        `объём ${quantityOf(converted[0]!)} ${target} совпадает во всех ${lines.length} строках: ` +
        "строки описывают разные виды работ над одним предметом, объём не удваивается",
    };
  }

  const total = converted.reduce((sum, value) => sum.plus(value), new Decimal(0));

  return {
    quantity: total,
    unit: target,
    note:
      lines.length === 1
        ? `объём одной строки: ${quantityOf(total)} ${target}`
        : `объёмы строк различаются и сложены как части одной работы: ${quantityOf(total)} ${target}`,
  };
}

export function aggregateByCanonical(lines: readonly OfferLine[]): Aggregation {
  const matched = lines.filter(
    (line): line is OfferLine & { canonicalId: string } => line.canonicalId !== undefined,
  );
  const unmatched = lines.filter((line) => line.canonicalId === undefined);

  const byCanonical = new Map<string, OfferLine[]>();
  for (const line of matched) {
    byCanonical.set(line.canonicalId, [...(byCanonical.get(line.canonicalId) ?? []), line]);
  }

  const groups: AggregatedGroup[] = [...byCanonical.entries()].map(([canonicalId, groupLines]) => {
    const { quantity, unit, note } = groupQuantity(groupLines);

    const base = {
      canonicalId,
      lines: groupLines,
      amount: money(sumAmounts(groupLines)),
      quantityNote: note,
      // Детализация — сама по себе сведение: подрядчик, разбивший работу,
      // показал её состав, и это довод в переговорах.
      decomposed: groupLines.length > 1,
    };

    // Объём и единица приходят и уходят ВМЕСТЕ: объём без единицы — число без
    // смысла, и допускать такую пару в типе значит разрешить её появление.
    return quantity === undefined || unit === undefined
      ? base
      : { ...base, quantity: quantityOf(quantity), unit };
  });

  const matchedAmount = sumAmounts(matched);
  const unmatchedAmount = sumAmounts(unmatched);

  return {
    groups,
    unmatched,
    total: money(matchedAmount.plus(unmatchedAmount)),
    matchedAmount: money(matchedAmount),
    unmatchedAmount: money(unmatchedAmount),
    note:
      lines.length === 0
        ? "строк нет: агрегировать нечего"
        : `строк ${lines.length}, групп ${groups.length}` +
          (unmatched.length > 0
            ? `, несопоставленных ${unmatched.length} на ${money(unmatchedAmount)} ₽ — в расчёт разброса не входят (§5.2)`
            : ""),
  };
}
