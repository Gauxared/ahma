/**
 * Тесты написаны до реализации. Правила 3.1 и 3.2 промпта Марины
 * (`Марина_Снаб_v9.6.txt`):
 *
 *   3.1. СТАНДАРТ 3+ КП — АБСОЛЮТНОЕ ПРАВИЛО. Минимум 3 КП на каждую
 *        позицию > 100 тыс. руб. Цена без логистики до объекта = НЕ КП.
 *
 *   3.2. КАРТА ЛИД-ТАЙМОВ — ПЕРВЫЕ 4 ЧАСА НА ОБЪЕКТЕ (Такт 3):
 *        топ-5 ТМЦ по стоимости → крайний срок заказа.
 *        Статусы: 🔴 ГОРИТ (≤14 дн) · 🟡 СРОЧНО (2–6 нед) · 🟢 ПЛАНОВЫЙ (>6 нед).
 *        Урок Школы №19: витражи на 250 млн с лид-таймом 12–16 недель видны
 *        за 4 часа — или теряются месяцы.
 */
import { describe, expect, it } from "vitest";

import { buildLeadTimeMap } from "./lead-time.js";
import type { ProcurementItem } from "./lead-time.js";

const СЕГОДНЯ = "2026-09-01";

describe("карта лид-таймов (Марина 3.2)", () => {
  it("считает крайний срок заказа: нужна к минус лид-тайм", () => {
    const карта = buildLeadTimeMap(
      [{ name: "витражи", amount: "250000000", neededBy: "2027-01-01", leadTimeWeeks: 16, quotes: 3 }],
      СЕГОДНЯ,
    );

    // 2027-01-01 минус 16 недель = 2026-09-11.
    expect(карта.items[0]?.orderBy).toBe("2026-09-11");
  });

  it("красит позицию, до заказа которой две недели или меньше", () => {
    const карта = buildLeadTimeMap(
      [{ name: "витражи", amount: "250000000", neededBy: "2027-01-01", leadTimeWeeks: 16, quotes: 3 }],
      СЕГОДНЯ,
    );

    // От 01.09 до 11.09 — десять дней.
    expect(карта.items[0]?.status).toBe("🔴 ГОРИТ");
    expect(карта.items[0]?.daysToOrder).toBe(10);
  });

  it("различает три статуса протокола по порогам", () => {
    const карта = buildLeadTimeMap(
      [
        { name: "горит", amount: "1000000", neededBy: "2026-09-15", leadTimeWeeks: 1, quotes: 3 },
        { name: "срочно", amount: "1000000", neededBy: "2026-11-01", leadTimeWeeks: 4, quotes: 3 },
        { name: "плановый", amount: "1000000", neededBy: "2027-06-01", leadTimeWeeks: 4, quotes: 3 },
      ],
      СЕГОДНЯ,
    );

    expect(карта.items.map((item) => item.status)).toEqual([
      "🔴 ГОРИТ",
      "🟡 СРОЧНО",
      "🟢 ПЛАНОВЫЙ",
    ]);
  });

  it("НАЗЫВАЕТ просроченный заказ просроченным, а не «горящим»", () => {
    // Срок заказа уже прошёл: это не «успеть бы», а «поздно» — и разговор
    // про перенос сроков, а не про ускорение закупки.
    const карта = buildLeadTimeMap(
      [{ name: "опоздали", amount: "1000000", neededBy: "2026-09-10", leadTimeWeeks: 8, quotes: 3 }],
      СЕГОДНЯ,
    );

    expect(карта.items[0]?.status).toBe("⚫ ПРОСРОЧЕН");
    expect(карта.items[0]?.daysToOrder).toBeLessThan(0);
  });

  it("сортирует по стоимости: дорогое видно первым", () => {
    const карта = buildLeadTimeMap(
      [
        { name: "мелочь", amount: "50000", neededBy: "2027-01-01", leadTimeWeeks: 2, quotes: 3 },
        { name: "витражи", amount: "250000000", neededBy: "2027-01-01", leadTimeWeeks: 16, quotes: 3 },
      ],
      СЕГОДНЯ,
    );

    expect(карта.items[0]?.name).toBe("витражи");
  });
});

describe("стандарт трёх КП (Марина 3.1)", () => {
  it("требует три КП на позицию дороже ста тысяч", () => {
    const карта = buildLeadTimeMap(
      [{ name: "кабель", amount: "500000", neededBy: "2027-01-01", leadTimeWeeks: 4, quotes: 2 }],
      СЕГОДНЯ,
    );

    expect(карта.items[0]?.quotesOk).toBe(false);
    expect(карта.quotesMissing).toHaveLength(1);
  });

  it("не требует трёх КП на позицию дешевле порога", () => {
    // Правило названо абсолютным, но с порогом: «на каждую позицию
    // > 100 тыс. руб.». Требовать три КП на гайки — тратить время.
    const карта = buildLeadTimeMap(
      [{ name: "гайки", amount: "90000", neededBy: "2027-01-01", leadTimeWeeks: 2, quotes: 1 }],
      СЕГОДНЯ,
    );

    expect(карта.items[0]?.quotesOk).toBe(true);
    expect(карта.quotesMissing).toEqual([]);
  });

  it("ровно сто тысяч — ещё не «дороже ста тысяч»", () => {
    const карта = buildLeadTimeMap(
      [{ name: "на грани", amount: "100000", neededBy: "2027-01-01", leadTimeWeeks: 2, quotes: 1 }],
      СЕГОДНЯ,
    );

    expect(карта.items[0]?.quotesOk).toBe(true);
  });

  it("сводит горящее отдельно: с него начинается разговор", () => {
    const карта = buildLeadTimeMap(
      [
        { name: "витражи", amount: "250000000", neededBy: "2026-10-01", leadTimeWeeks: 16, quotes: 3 },
        { name: "спокойное", amount: "1000000", neededBy: "2027-06-01", leadTimeWeeks: 2, quotes: 3 },
      ],
      СЕГОДНЯ,
    );

    expect(карта.urgent.map((item) => item.name)).toEqual(["витражи"]);
  });
});
