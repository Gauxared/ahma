/**
 * Детерминированные проверки сметы (ТЗ §6.4, §5.1 «Сметчик»).
 *
 * Портированы из промпта Людмилы v9.6: часть 3.1 «Чеклист полноты ЛСР»
 * и 3.8 «MVP-проверка сметы». Все они арифметические, поэтому считает их
 * расчётный модуль. Модели остаётся то, что ТЗ §6.4 ей и отводит:
 * классификация расхождения, оценка существенности и формулировка вывода.
 *
 * Разделение не формальное. Если долю нерасшифрованного комплекта посчитает
 * модель, число попадёт в реестр нарушений без следа формулы и нарушит §12.1д.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { AccuracyMarker, DecimalString } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/** Позиция в том виде, в каком её проверяет Сметчик. */
export interface PositionForCheck {
  readonly ordinal: string;
  readonly section: string;
  readonly name: string;
  readonly basis: string;
  readonly unit: string;
  /** Пусто — сумма НЕИЗВЕСТНА (смета без стоимостной части), а не равна нулю. */
  readonly amount: string | undefined;
  readonly row: number;
}

export interface DuplicateFinding {
  readonly basis: string;
  readonly amount: DecimalString;
  readonly rows: readonly number[];
  readonly ordinals: readonly string[];
}

export interface NegativeFinding {
  readonly ordinal: string;
  readonly name: string;
  readonly amount: DecimalString;
  readonly row: number;
}

export interface LumpSumFinding {
  readonly ordinal: string;
  readonly name: string;
  readonly amount: DecimalString;
  /** Доля от итога сметы. */
  readonly share: DecimalString;
  readonly row: number;
}

export interface EstimateCheckReport {
  readonly positions: number;
  /**
   * Итог сметы. Пусто, когда сумма известна не у всех позиций: сложить нельзя,
   * а сумма известной части — число, похожее на правду и отличающееся от
   * настоящего ровно на то, чего мы не знаем.
   */
  readonly total: DecimalString | undefined;
  /** Сколько позиций пришло без суммы — чтобы исключение было видно, а не молчаливо. */
  readonly withoutAmount: number;
  readonly duplicates: readonly DuplicateFinding[];
  readonly negatives: readonly NegativeFinding[];
  readonly unexplainedLumpSums: readonly LumpSumFinding[];
}

/** Единицы, за которыми может прятаться нерасшифрованный объём. */
const LUMP_SUM_UNITS = new Set(["компл", "компл.", "комплект", "шт компл"]);

/** Порог из промпта: комплект от 5% итога подлежит расшифровке. */
const LUMP_SUM_THRESHOLD = "0.05";

function share(amount: Decimal, total: Decimal): Decimal {
  return total.isZero() ? new Decimal(0) : amount.dividedBy(total);
}

export function checkEstimate(positions: readonly PositionForCheck[]): EstimateCheckReport {
  /**
   * ДЕНЕЖНЫЕ ПРОВЕРКИ ИДУТ ТОЛЬКО ПО ПОЗИЦИЯМ С СУММАМИ.
   *
   * Дубль — совпадение шифра И суммы; отрицательная позиция — знак суммы; доля
   * комплекта — отношение к итогу. Без суммы ни одна из трёх не определена, и
   * взять её нулём значило бы не «проверить осторожно», а выдумать результат:
   * две позиции без сумм стали бы «дублем на 0,00 ₽».
   */
  const сСуммой = positions.filter(
    (position): position is PositionForCheck & { amount: string } => position.amount !== undefined,
  );
  const безСуммы = positions.length - сСуммой.length;

  // Итог существует, только когда известны ВСЕ слагаемые (см. `convergence.ts`).
  const total =
    безСуммы > 0
      ? undefined
      : сСуммой.reduce(
          (accumulator, position) => accumulator.plus(new Decimal(position.amount)),
          new Decimal(0),
        );

  // Дубль — совпадение шифра И суммы. Один шифр на разных объёмах это норма,
  // а вот та же расценка с той же суммой дважды — кандидат в двойной счёт.
  const groups = new Map<string, (typeof сСуммой)[number][]>();
  for (const position of сСуммой) {
    const key = `${position.basis}|${new Decimal(position.amount).toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }

  const duplicates: DuplicateFinding[] = [...groups.values()]
    .filter((group) => group.length > 1 && group[0]!.basis !== "")
    .map((group) => ({
      basis: group[0]!.basis,
      amount: decimal(new Decimal(group[0]!.amount).toFixed(2)),
      rows: group.map((position) => position.row),
      ordinals: group.map((position) => position.ordinal),
    }));

  const negatives: NegativeFinding[] = сСуммой
    .filter((position) => new Decimal(position.amount).isNegative())
    .map((position) => ({
      ordinal: position.ordinal,
      name: position.name,
      amount: decimal(new Decimal(position.amount).toFixed(2)),
      row: position.row,
    }));

  const threshold = new Decimal(LUMP_SUM_THRESHOLD);

  // Доля от итога без итога не считается: порог 5% не к чему приложить.
  const unexplainedLumpSums: LumpSumFinding[] = (total === undefined ? [] : сСуммой)
    .filter((position) => LUMP_SUM_UNITS.has(position.unit.trim().toLowerCase()))
    .map((position) => ({ position, ratio: share(new Decimal(position.amount), total!) }))
    .filter((entry) => entry.ratio.greaterThanOrEqualTo(threshold))
    .map((entry) => ({
      ordinal: entry.position.ordinal,
      name: entry.position.name,
      amount: decimal(new Decimal(entry.position.amount).toFixed(2)),
      share: decimal(entry.ratio.toFixed(2)),
      row: entry.position.row,
    }));

  return {
    positions: positions.length,
    total: total === undefined ? undefined : decimal(total.toFixed(2)),
    withoutAmount: безСуммы,
    duplicates,
    negatives,
    unexplainedLumpSums,
  };
}

export interface TopPositionEntry {
  readonly ordinal: string;
  readonly section: string;
  readonly name: string;
  readonly basis: string;
  readonly amount: DecimalString;
  readonly share: DecimalString;
  readonly row: number;
}

export interface TopPositions {
  readonly positions: readonly TopPositionEntry[];
  /** Какую долю итога покрывает отобранное. */
  readonly coverage: DecimalString;
}

/**
 * MVP-проверка из промпта: перед полным пересчётом смотрим позиции свыше доли
 * порога. По практике Людмилы ТОП-5 таких позиций даёт 70–80% финансовой
 * картины, и полный пересчёт нужен, только если по ним картина меняется.
 */
export function topPositionsByShare(
  positions: readonly PositionForCheck[],
  options: { minShare: string; limit: number },
): TopPositions {
  /**
   * ДОЛЯ ОТ ИТОГА ТРЕБУЕТ ИТОГА. Если сумма известна не у всех позиций, итога
   * нет — и «крупнейших по доле» не существует. Посчитать доли по известной
   * части значило бы завысить каждую: знаменатель оказался бы меньше
   * настоящего на всё, чего мы не знаем.
   */
  const сСуммой = positions.filter(
    (position): position is PositionForCheck & { amount: string } => position.amount !== undefined,
  );

  if (сСуммой.length !== positions.length) {
    return { positions: [], coverage: decimal("0.00") };
  }

  const total = сСуммой.reduce(
    (accumulator, position) => accumulator.plus(new Decimal(position.amount)),
    new Decimal(0),
  );

  if (total.isZero()) {
    return { positions: [], coverage: decimal("0.00") };
  }

  const minShare = new Decimal(options.minShare);

  const selected = сСуммой
    .map((position) => ({ position, ratio: share(new Decimal(position.amount), total) }))
    .filter((entry) => entry.ratio.greaterThanOrEqualTo(minShare))
    .sort((a, b) => b.ratio.comparedTo(a.ratio))
    .slice(0, options.limit);

  const coverage = selected.reduce((accumulator, entry) => accumulator.plus(entry.ratio), new Decimal(0));

  return {
    positions: selected.map((entry) => ({
      ordinal: entry.position.ordinal,
      section: entry.position.section,
      name: entry.position.name,
      basis: entry.position.basis,
      amount: decimal(new Decimal(entry.position.amount).toFixed(2)),
      share: decimal(entry.ratio.toFixed(2)),
      row: entry.position.row,
    })),
    coverage: decimal(coverage.toFixed(2)),
  };
}

/**
 * Маркер точности (Людмила 3.4, ТЗ §9 и REQ-TZ-RESULT-02).
 *
 * Оговорка обязательна в каждой оценке, и она НЕ означает подтверждённой
 * точности — это договорная эвристика, что и фиксируется полем `heuristic`.
 */
export function accuracyMarker(context: { hasEstimate: boolean }): AccuracyMarker {
  return context.hasEstimate
    ? { range: "±3–5%", basis: "оценка выполнена по локальному сметному расчёту", heuristic: true }
    : { range: "±10–15%", basis: "оценка выполнена без локального сметного расчёта", heuristic: true };
}
