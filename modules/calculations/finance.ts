/**
 * Финансовый блок — ТЗ §6.4: проценты и график выборки кредита, БДДС и
 * кассовые разрывы, пеня от ключевой ставки.
 *
 * СТАВКА ПРИХОДИТ АРГУМЕНТОМ, А НЕ ЖИВЁТ В КОДЕ
 *
 * ТЗ §6.4 дословно: «Ставка налога на добавленную стоимость и ключевая ставка
 * задаются параметром с датой, начиная с которой значение действует.
 * Единственное значение в коде не зашивается.»
 *
 * Ставка передаётся В КАЖДЫЙ ПЕРИОД, а не один раз на весь график: у кредита,
 * выбираемого год, периоды попадают по разные стороны от решения совета
 * директоров. Одна ставка на весь график дала бы неверные проценты с видом
 * точного расчёта — худший вид ошибки, потому что он не выглядит ошибкой.
 *
 * ПЕНЯ СЧИТАЕТСЯ НЕ ТАК, КАК ПРОЦЕНТЫ
 *
 * У процентов по кредиту годовая ставка делится на базу года и умножается на
 * дни. У пени доля ставки (1/300, 1/130) — это доля ЗА ДЕНЬ просрочки, и
 * деления на базу года нет. Разделить ещё и на 365 значило бы занизить пеню
 * в 365 раз, оставив её похожей на правильную.
 *
 * КАССОВЫЙ РАЗРЫВ — ЭТО НАХОДКА, А НЕ ОШИБКА
 *
 * Отрицательный остаток не подлежит исправлению внутри расчёта: подтянуть его
 * к нулю значит скрыть ровно то, ради чего строят БДДС. Расчёт называет первый
 * период разрыва — до него решение ещё есть — и наибольшую глубину, потому что
 * именно она равна требуемому финансированию.
 */
import { Decimal } from "decimal.js";

import { decimal, unitCode } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const CREDIT_FORMULA = "calculation.credit-schedule" as const;
export const CREDIT_VERSION = 1 as const;

export const CASH_FLOW_FORMULA = "calculation.cash-flow" as const;
export const CASH_FLOW_VERSION = 1 as const;

export const PENALTY_FORMULA = "calculation.penalty" as const;
export const PENALTY_VERSION = 1 as const;

function money(value: Decimal): DecimalString {
  return decimal(value.toFixed(2));
}

/** Доля вида «1/300» или десятичная дробь: договор пишет и так, и так. */
function resolveShare(share: string): Decimal {
  const ratio = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(share.trim());

  if (ratio !== null) {
    const denominator = new Decimal(ratio[2]!);
    if (denominator.isZero()) {
      throw new Error(`Доля ставки ${share} невычислима: знаменатель равен нулю`);
    }
    return new Decimal(ratio[1]!).dividedBy(denominator);
  }

  return new Decimal(share);
}

export interface CreditInterest {
  readonly interest: DecimalString;
  readonly trace: FormulaTrace;
}

/**
 * Проценты за один период выборки.
 *
 * `basis` — база года по договору (365 или 360; в високосный год 366). Это
 * условие договора, а не свойство календаря, поэтому оно приходит аргументом.
 */
export function creditInterest(input: {
  readonly principal: string;
  readonly annualRate: string;
  readonly days: number;
  readonly basis: number;
}): CreditInterest {
  if (input.basis <= 0) {
    throw new Error(`База года ${input.basis} недопустима: деление на неё невычислимо`);
  }

  const interest = money(
    new Decimal(input.principal)
      .times(input.annualRate)
      .times(input.days)
      .dividedBy(input.basis),
  );

  return {
    interest,
    trace: {
      formulaId: CREDIT_FORMULA,
      formulaVersion: CREDIT_VERSION,
      inputs: {
        principal: decimal(input.principal),
        annualRate: decimal(input.annualRate),
        days: decimal(String(input.days)),
        basis: decimal(String(input.basis)),
      },
      output: interest,
      unit: unitCode("RUB"),
      rounding: "half-up",
    },
  };
}

export interface CashPeriodInput {
  readonly period: string;
  readonly inflow: string;
  readonly outflow: string;
}

export interface CashPeriod {
  readonly period: string;
  readonly opening: DecimalString;
  readonly inflow: DecimalString;
  readonly outflow: DecimalString;
  readonly closing: DecimalString;
  readonly trace: FormulaTrace;
}

export interface CashGap {
  readonly period: string;
  /** Сколько денег не хватает: положительная величина недостатка. */
  readonly shortfall: DecimalString;
}

export interface CashFlow {
  readonly periods: readonly CashPeriod[];
  readonly gaps: readonly CashGap[];
  /** Первый период разрыва: до него решение ещё есть. */
  readonly firstGapAt?: string;
  /** Наибольшая глубина разрыва — она же требуемое финансирование. */
  readonly peakShortfall: DecimalString;
  /** Строился ли БДДС вообще: пустой набор периодов не доказывает отсутствия разрывов. */
  readonly measured: boolean;
  readonly note: string;
}

export function cashFlow(input: {
  readonly opening: string;
  readonly periods: readonly CashPeriodInput[];
}): CashFlow {
  const periods: CashPeriod[] = [];
  const gaps: CashGap[] = [];

  let balance = new Decimal(input.opening);
  let peak = new Decimal(0);

  for (const entry of input.periods) {
    const opening = balance;
    const closing = opening.plus(entry.inflow).minus(entry.outflow);

    periods.push({
      period: entry.period,
      opening: money(opening),
      inflow: decimal(entry.inflow),
      outflow: decimal(entry.outflow),
      closing: money(closing),
      trace: {
        formulaId: CASH_FLOW_FORMULA,
        formulaVersion: CASH_FLOW_VERSION,
        inputs: { opening: money(opening), inflow: decimal(entry.inflow), outflow: decimal(entry.outflow) },
        output: money(closing),
        unit: unitCode("RUB"),
        rounding: "half-up",
      },
    });

    // Ноль на счёте — не разрыв: платить нечем только при отрицательном остатке.
    if (closing.isNegative()) {
      const shortfall = closing.negated();
      gaps.push({ period: entry.period, shortfall: money(shortfall) });
      if (shortfall.greaterThan(peak)) {
        peak = shortfall;
      }
    }

    balance = closing;
  }

  const measured = input.periods.length > 0;

  const note = !measured
    ? "БДДС не построен: периоды не заданы, отсутствие разрывов не доказано"
    : gaps.length === 0
      ? `разрывов нет на горизонте ${input.periods.length} периодов`
      : `разрывов ${gaps.length}, первый в ${gaps[0]!.period}, наибольшая потребность ${money(peak)} ₽`;

  const base = {
    periods,
    gaps,
    peakShortfall: money(peak),
    measured,
    note,
  };

  return gaps.length === 0 ? base : { ...base, firstGapAt: gaps[0]!.period };
}

export interface Penalty {
  readonly amount: DecimalString;
  /** Доля ставки в договорной записи: «1/300» — не число, но именно её защищают. */
  readonly shareAsStated: string;
  readonly cappedByContract: boolean;
  readonly trace: FormulaTrace;
}

/**
 * Пеня от ключевой ставки.
 *
 * `share` — доля ставки за день просрочки по договору: 1/300 обычно для
 * заказчика, 1/130 для подрядчика. Это условие договора, а не константа.
 *
 * `capAtDebt` — договорный потолок «пеня не более суммы долга». Без него пеня
 * за долгую просрочку превышает долг: число, верное арифметически и неверное
 * юридически. Поэтому потолок применяется ТОЛЬКО когда он объявлен, и факт
 * его применения виден в результате.
 */
export function penalty(input: {
  readonly debt: string;
  readonly keyRate: string;
  readonly share: string;
  readonly days: number;
  readonly capAtDebt?: boolean;
}): Penalty {
  const resolved = resolveShare(input.share);
  const debt = new Decimal(input.debt);

  const raw = debt.times(input.keyRate).times(resolved).times(input.days);

  const capped = input.capAtDebt === true && raw.greaterThan(debt);
  const amount = money(capped ? debt : raw);

  return {
    amount,
    shareAsStated: input.share,
    cappedByContract: capped,
    trace: {
      formulaId: PENALTY_FORMULA,
      formulaVersion: PENALTY_VERSION,
      inputs: {
        debt: decimal(input.debt),
        keyRate: decimal(input.keyRate),
        // В след идёт РАЗРЕШЁННОЕ число: след обязан воспроизводиться
        // арифметически, а «1/300» — запись условия, а не значение.
        share: decimal(resolved.toFixed(20)),
        days: decimal(String(input.days)),
      },
      output: amount,
      unit: unitCode("RUB"),
      rounding: "half-up",
    },
  };
}
