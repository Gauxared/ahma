/**
 * Тесты написаны до реализации по ADR-R-012.
 *
 * Источник правды — легаси-промпт Дирижёра
 * `reference-system-new/Выход/СтройИнтеллект.Plus_ДИРИЖЁР_v9.8.txt`, ЧАСТЬ 3.
 *
 * Проверяется то, что в оригинале держится только на дисциплине модели:
 * «что не дано — помечай ❌» и «НЕ угадывай». Здесь недостающее поле не может
 * быть угадано по устройству типа, а маршрут на неполных данных не может быть
 * построен по устройству функции.
 */
import { describe, expect, it } from "vitest";

import { buildPassport, renderPassport } from "./passport.js";

describe("паспорт входа", () => {
  it("собирает пять полей легаси-протокола", () => {
    const passport = buildPassport({
      documents: [
        { name: "КУРГАН_СОТ.pdf", kind: "рабочая-документация" },
        { name: "ЛСР-1.xlsx", kind: "лср" },
        { name: "ЛСР-2.xlsx", kind: "лср" },
        { name: "ССРСС.xlsx", kind: "ссрсс" },
      ],
      declared: { domain: "сети", side: "подрядчик", goal: "полное сопровождение" },
    });

    expect(passport.domain).toBe("сети");
    expect(passport.side).toBe("подрядчик");
    expect(passport.goal).toBe("полное сопровождение");
  });

  it("выводит стадию из состава пакета, а не спрашивает её", () => {
    // «есть РД+сметы» — это факт о папке, а не мнение. Выводимое не спрашиваем.
    const passport = buildPassport({
      documents: [
        { name: "РД.pdf", kind: "рабочая-документация" },
        { name: "ЛСР.xlsx", kind: "лср" },
      ],
      declared: {},
    });

    expect(passport.stage).toBe("рд-и-сметы");
  });

  it("различает предпроект без смет и пакет с РД", () => {
    const безСмет = buildPassport({
      documents: [{ name: "РД.pdf", kind: "рабочая-документация" }],
      declared: {},
    });
    expect(безСмет.stage).toBe("есть-рд");

    const пусто = buildPassport({ documents: [], declared: {} });
    expect(пусто.stage).toBe("предпроект");
  });

  it("считает состав пакета, а не пересказывает его", () => {
    const passport = buildPassport({
      documents: [
        { name: "т1.pdf", kind: "рабочая-документация" },
        { name: "т2.pdf", kind: "рабочая-документация" },
        { name: "ЛСР-1.xlsx", kind: "лср" },
        { name: "ЛСР-2.xlsx", kind: "лср" },
        { name: "ЛСР-3.xlsx", kind: "лср" },
        { name: "ССРСС.xlsx", kind: "ссрсс" },
      ],
      declared: {},
    });

    expect(passport.composition.volumes).toBe(2);
    expect(passport.composition.estimates).toBe(3);
    expect(passport.composition.hasSummary).toBe(true);
  });

  it("НЕ угадывает домен, если он не объявлен", () => {
    // Главное свойство. В легаси это инструкция «помечай ❌», которую модель
    // может нарушить; здесь поле просто отсутствует, и подставить его нечем.
    const passport = buildPassport({
      documents: [{ name: "ЛСР.xlsx", kind: "лср" }],
      declared: {},
    });

    expect(passport.domain).toBeUndefined();
    expect(passport.side).toBeUndefined();
  });

  it("перечисляет невыведенные поля, а не прячет их", () => {
    const passport = buildPassport({ documents: [], declared: {} });

    expect(passport.missing).toContain("domain");
    expect(passport.missing).toContain("side");
    expect(passport.missing).toContain("goal");
  });

  it("рисует невыведенное знаком ❌ ровно как оригинал", () => {
    const passport = buildPassport({
      documents: [{ name: "ЛСР.xlsx", kind: "лср" }],
      declared: { domain: "вода" },
    });

    const rendered = renderPassport(passport);

    expect(rendered).toContain("домен: вода");
    expect(rendered).toContain("сторона стола: ❌");
  });
});
