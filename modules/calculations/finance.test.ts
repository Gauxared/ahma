/**
 * Тесты написаны до реализации. Финансовый блок §6.4, роадмап M4:
 * «проценты и график выборки кредита, БДДС и кассовые разрывы, пеня от
 * ключевой ставки».
 *
 * СТАВКА НЕ ЖИВЁТ В КОДЕ
 *
 * ТЗ §6.4 дословно: «Ставка налога на добавленную стоимость и ключевая ставка
 * задаются параметром с датой, начиная с которой значение действует.
 * Единственное значение в коде не зашивается.» Поэтому ставка приходит В
 * КАЖДЫЙ ПЕРИОД аргументом: у кредита, выбираемого год, периоды могут попасть
 * по разные стороны от решения совета директоров, и одна ставка на весь график
 * дала бы неверные проценты с видом точного расчёта.
 *
 * КАССОВЫЙ РАЗРЫВ — ЭТО НАХОДКА, А НЕ ОШИБКА
 *
 * Отрицательный остаток в БДДС не подлежит исправлению внутри расчёта.
 * Подтянуть его к нулю — значит скрыть ровно то, ради чего строят БДДС.
 */
import { describe, expect, it } from "vitest";

import { cashFlow, creditInterest, penalty } from "./finance.js";

describe("проценты по выбранному кредиту", () => {
  it("считает проценты за период по ставке и числу дней", () => {
    // 10 000 000 × 21% × 30/365
    const итог = creditInterest({
      principal: "10000000.00",
      annualRate: "0.21",
      days: 30,
      basis: 365,
    });

    expect(итог.interest).toBe("172602.74");
  });

  it("считает по базе 366 дней иначе, чем по 365", () => {
    // База года — условие договора, а не свойство календаря в коде.
    const по365 = creditInterest({ principal: "10000000.00", annualRate: "0.21", days: 30, basis: 365 });
    const по366 = creditInterest({ principal: "10000000.00", annualRate: "0.21", days: 30, basis: 366 });

    expect(по365.interest).not.toBe(по366.interest);
  });

  it("даёт нулевые проценты за нулевой срок — это вычисленный ноль, а не отсутствие данных", () => {
    const итог = creditInterest({ principal: "10000000.00", annualRate: "0.21", days: 0, basis: 365 });

    expect(итог.interest).toBe("0.00");
    expect(итог.trace.inputs.days).toBe("0");
  });

  it("несёт след со ставкой: число защищается без доступа к коду", () => {
    const итог = creditInterest({ principal: "10000000.00", annualRate: "0.21", days: 30, basis: 365 });

    expect(итог.trace.formulaId).toBe("calculation.credit-schedule");
    expect(итог.trace.inputs.annualRate).toBe("0.21");
  });
});

describe("график выборки кредита", () => {
  it("считает проценты по каждому периоду отдельно, а не по средней ставке", () => {
    // Периоды по разные стороны от решения по ключевой ставке: одна ставка на
    // весь график дала бы неверные проценты с видом точного расчёта.
    const первый = creditInterest({ principal: "10000000.00", annualRate: "0.21", days: 30, basis: 365 });
    const второй = creditInterest({ principal: "10000000.00", annualRate: "0.18", days: 30, basis: 365 });

    expect(первый.interest).not.toBe(второй.interest);
  });
});

describe("БДДС и кассовые разрывы", () => {
  const ПЕРИОДЫ = [
    { period: "2026-01", inflow: "10000000.00", outflow: "12000000.00" },
    { period: "2026-02", inflow: "15000000.00", outflow: "8000000.00" },
    { period: "2026-03", inflow: "5000000.00", outflow: "11000000.00" },
  ];

  it("ведёт остаток через периоды", () => {
    const бддс = cashFlow({ opening: "5000000.00", periods: ПЕРИОДЫ });

    expect(бддс.periods[0]?.closing).toBe("3000000.00");
    expect(бддс.periods[1]?.closing).toBe("10000000.00");
    expect(бддс.periods[2]?.closing).toBe("4000000.00");
  });

  it("переносит остаток периода в открывающий следующего", () => {
    const бддс = cashFlow({ opening: "5000000.00", periods: ПЕРИОДЫ });

    expect(бддс.periods[1]?.opening).toBe(бддс.periods[0]?.closing);
  });

  it("НАХОДИТ кассовый разрыв, а не выправляет его", () => {
    // Отрицательный остаток — то, ради чего строят БДДС. Подтянуть его к нулю
    // значит скрыть находку.
    const бддс = cashFlow({
      opening: "1000000.00",
      periods: [{ period: "2026-01", inflow: "1000000.00", outflow: "5000000.00" }],
    });

    expect(бддс.periods[0]?.closing).toBe("-3000000.00");
    expect(бддс.gaps).toHaveLength(1);
    expect(бддс.gaps[0]?.shortfall).toBe("3000000.00");
  });

  it("называет ПЕРВЫЙ период разрыва: до него решение ещё есть", () => {
    const бддс = cashFlow({
      opening: "0.00",
      periods: [
        { period: "2026-01", inflow: "1000000.00", outflow: "500000.00" },
        { period: "2026-02", inflow: "0.00", outflow: "2000000.00" },
        { period: "2026-03", inflow: "0.00", outflow: "1000000.00" },
      ],
    });

    expect(бддс.firstGapAt).toBe("2026-02");
    expect(бддс.gaps).toHaveLength(2);
  });

  it("считает наибольшую потребность в финансировании по глубине разрыва", () => {
    const бддс = cashFlow({
      opening: "0.00",
      periods: [
        { period: "2026-01", inflow: "0.00", outflow: "2000000.00" },
        { period: "2026-02", inflow: "0.00", outflow: "1000000.00" },
      ],
    });

    expect(бддс.peakShortfall).toBe("3000000.00");
  });

  it("не объявляет разрыв при нулевом остатке", () => {
    // Ноль на счёте — не разрыв: платить нечем только при отрицательном.
    const бддс = cashFlow({
      opening: "0.00",
      periods: [{ period: "2026-01", inflow: "1000000.00", outflow: "1000000.00" }],
    });

    expect(бддс.gaps).toHaveLength(0);
    expect(бддс.firstGapAt).toBeUndefined();
  });

  it("на пустом наборе периодов не утверждает отсутствие разрывов", () => {
    const бддс = cashFlow({ opening: "0.00", periods: [] });

    expect(бддс.measured).toBe(false);
    expect(бддс.note).toContain("не построен");
  });

  it("несёт след на каждый период", () => {
    const бддс = cashFlow({ opening: "5000000.00", periods: ПЕРИОДЫ });

    expect(бддс.periods[0]?.trace.formulaId).toBe("calculation.cash-flow");
    expect(бддс.periods[0]?.trace.inputs.opening).toBe("5000000.00");
  });
});

describe("пеня от ключевой ставки", () => {
  it("считает пеню по доле ставки за день", () => {
    // 1 000 000 × 21% × 1/300 × 30 дней = 21 000 ₽.
    //
    // Деления на базу года здесь НЕТ, в отличие от процентов по кредиту:
    // 1/300 — это доля ключевой ставки ЗА ДЕНЬ просрочки, а не годовая доля.
    // Разделить ещё и на 365 значило бы занизить пеню в 365 раз.
    const итог = penalty({ debt: "1000000.00", keyRate: "0.21", share: "1/300", days: 30 });

    expect(итог.amount).toBe("21000.00");
  });

  it("доля ставки — условие договора, а не константа", () => {
    // 1/130 применяется к подрядчику, 1/300 к заказчику: разные договоры,
    // одна формула.
    const строгая = penalty({ debt: "1000000.00", keyRate: "0.21", share: "1/130", days: 30 });
    const мягкая = penalty({ debt: "1000000.00", keyRate: "0.21", share: "1/300", days: 30 });

    expect(Number(строгая.amount)).toBeGreaterThan(Number(мягкая.amount));
  });

  it("принимает долю десятичной дробью наравне с записью через дробь", () => {
    const дробью = penalty({ debt: "1000000.00", keyRate: "0.21", share: "1/300", days: 30 });
    const десятичной = penalty({
      debt: "1000000.00",
      keyRate: "0.21",
      share: "0.0033333333333333333333333333333333",
      days: 30,
    });

    expect(дробью.amount).toBe(десятичной.amount);
  });

  it("ограничивает пеню суммой долга, когда это условие договора", () => {
    // Договорный потолок — частое условие. Без него пеня за долгую просрочку
    // превышает долг, и число, верное арифметически, неверно юридически.
    const итог = penalty({
      debt: "1000000.00",
      keyRate: "0.21",
      share: "1/130",
      days: 100000,
      capAtDebt: true,
    });

    expect(итог.amount).toBe("1000000.00");
    expect(итог.cappedByContract).toBe(true);
  });

  it("НЕ ограничивает пеню молча, когда потолка в договоре нет", () => {
    const итог = penalty({
      debt: "1000000.00",
      keyRate: "0.21",
      share: "1/130",
      days: 100000,
    });

    expect(Number(итог.amount)).toBeGreaterThan(1000000);
    expect(итог.cappedByContract).toBe(false);
  });

  it("несёт след с РАЗРЕШЁННОЙ долей, а условие договора — рядом", () => {
    // В след идёт число: он обязан воспроизводиться арифметически. Договорная
    // запись «1/300» — не число, и её место рядом со следом, а не внутри него.
    const итог = penalty({ debt: "1000000.00", keyRate: "0.21", share: "1/300", days: 30 });

    expect(итог.trace.formulaId).toBe("calculation.penalty");
    expect(итог.trace.inputs.keyRate).toBe("0.21");
    expect(итог.shareAsStated).toBe("1/300");
    expect(Number(итог.trace.inputs.share)).toBeCloseTo(1 / 300, 10);
  });
});
