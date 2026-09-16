/**
 * Проверки перечня вкладок объекта.
 *
 * Главная здесь — «адреса попарно различны». Гейт, которого не было в рельсе,
 * пропустил пять пунктов, ведущих на один экран; вкладки — то же самое место, где
 * эта ошибка возможна, и заводится проверка сразу, а не после выговора.
 */
import { describe, expect, it } from "vitest";

import { objectTabHref, objectTabs, type ObjectTabKey } from "./object-tabs.js";

const KEYS: readonly ObjectTabKey[] = ["паспорт", "документы", "предложения", "проверка", "агенты", "пакет"];

describe("вкладки объекта", () => {
  it("адреса попарно различны — иначе две вкладки ведут на один экран", () => {
    const hrefs = objectTabs("KRG-1").map((tab) => tab.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("порядок — порядок работы, а не алфавит", () => {
    expect(objectTabs("KRG-1").map((tab) => tab.label)).toEqual([
      "Паспорт",
      "Документы",
      "Сравнение КП",
      "Проверка",
      "Агенты",
      "Пакет",
    ]);
  });

  it("адрес по ключу совпадает с адресом в перечне", () => {
    const tabs = objectTabs("KRG-1");

    for (const [index, key] of KEYS.entries()) {
      expect(objectTabHref("KRG-1", key)).toBe(tabs[index]?.href);
    }
  });

  it("шифр объекта кодируется — пробел и косая черта не ломают адрес", () => {
    // Шифр приходит из базы, а не из перечня, и «ЖД/ПП 1» — допустимое имя.
    // Без кодирования косая черта превратила бы шифр в лишний сегмент пути.
    expect(objectTabHref("ЖД/ПП 1", "агенты")).toBe(`/objects/${encodeURIComponent("ЖД/ПП 1")}/agents`);
  });

  it("счётчик показывается только там, где он передан", () => {
    const tabs = objectTabs("KRG-1", { документы: 4, агенты: 0 });
    const byLabel = new Map(tabs.map((tab) => [tab.label, tab.count]));

    expect(byLabel.get("Документы")).toBe(4);
    // Ноль на вкладке ПОКАЗЫВАЕТСЯ: «Агенты 0» отвечает на вопрос до нажатия.
    expect(byLabel.get("Агенты")).toBe(0);
    // А непереданный счётчик не превращается в ноль: «не знаю» и «нуль» — разное.
    expect(byLabel.has("Паспорт")).toBe(true);
    expect(byLabel.get("Паспорт")).toBeUndefined();
  });

  it("неизвестный ключ — ошибка сборки, а не ссылка в никуда", () => {
    // Пустая строка вместо адреса дала бы вкладку, ведущую на текущий экран:
    // она выглядит рабочей и никуда не ведёт.
    expect(() => objectTabHref("KRG-1", "финмодель" as ObjectTabKey)).toThrow(/не объявлена/);
  });
});
