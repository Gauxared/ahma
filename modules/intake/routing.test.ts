/**
 * Тесты написаны до реализации по ADR-R-012 (ШАГИ 2–5 протокола Дирижёра).
 *
 * Главное, что здесь защищается: **маршрут на неполных данных не может быть
 * построен**. В легаси это инструкция «НЕ угадывай», которую модель нарушает
 * тем охотнее, чем правдоподобнее догадка. Здесь неполный паспорт даёт другой
 * тип результата, и маршрута в нём нет физически.
 */
import { describe, expect, it } from "vitest";

import { buildPassport } from "./passport.js";
import { route } from "./routing.js";
import type { RoutingTable } from "./routing.js";

const TABLE: RoutingTable = {
  requiredForRoute: ["domain", "side", "goal"],
  routes: [
    {
      id: "сторона-заказчика",
      when: { side: "заказчик" },
      configuration: "A",
      agent: "матвеич",
      criterion: "5) Сторона стола: заказчик/девелопер → Матвеич",
    },
    { id: "вода", when: { domain: "вода" }, configuration: "A", agent: "игнатыч", criterion: "2) Домен" },
    { id: "сети", when: { domain: "сети" }, configuration: "A", agent: "родионыч", criterion: "2) Домен" },
    {
      id: "крупный-пакет",
      when: { stage: "рд-и-сметы", volume: "большой" },
      configuration: "C",
      agent: "артемий",
      criterion: "4) Объём",
    },
    { id: "нет-профильного", when: {}, configuration: "C", agent: "артемий", criterion: "2) нет профильного Light" },
  ],
};

function passportOf(declared: Parameters<typeof buildPassport>[0]["declared"], documents: { name: string; kind: string }[] = []) {
  return buildPassport({ documents, declared });
}

describe("гейт неполных данных", () => {
  it("не выдаёт маршрут, когда домен и сторона не объявлены", () => {
    // ШАГ 4 легаси: «Если данных не хватает для честного маршрута — НЕ угадывай».
    const result = route(passportOf({}), TABLE);

    expect(result.kind).toBe("gate");
    expect(result).not.toHaveProperty("configuration");
  });

  it("возвращает ОДИН список недостающего с причиной по каждому пункту", () => {
    const result = route(passportOf({ domain: "вода" }), TABLE);

    expect(result.kind).toBe("gate");
    if (result.kind !== "gate") return;

    expect(result.missing.map((item) => item.field).sort()).toEqual(["goal", "side"]);
    for (const item of result.missing) {
      expect(item.why).not.toBe("");
      expect(item.who).not.toBe("");
    }
  });

  it("не принимает «в работе» и «нужно уточнить» как объявленное значение", () => {
    // Легаси прямо: «"В работе" и "нужно уточнить" как итог — не результат».
    const result = route(passportOf({ domain: "вода", side: "подрядчик", goal: "в работе" }), TABLE);

    expect(result.kind).toBe("gate");
    if (result.kind !== "gate") return;
    expect(result.missing.map((item) => item.field)).toContain("goal");
  });
});

describe("таблица маршрута", () => {
  const полный = { domain: "сети" as const, side: "подрядчик" as const, goal: "полное сопровождение" };

  it("ведёт профильный домен к своему Light-инженеру", () => {
    const result = route(passportOf(полный), TABLE);

    expect(result.kind).toBe("route");
    if (result.kind !== "route") return;

    expect(result.agent).toBe("родионыч");
    expect(result.configuration).toBe("A");
  });

  it("сторона заказчика перебивает профильный домен", () => {
    // В легаси строка «сторона ЗАКАЗЧИКА» стоит в таблице, и у заказчика линзы
    // зеркальны: домен этого не отменяет.
    const result = route(passportOf({ ...полный, side: "заказчик" }), TABLE);

    expect(result.kind).toBe("route");
    if (result.kind !== "route") return;
    expect(result.agent).toBe("матвеич");
  });

  it("крупный пакет РД+сметы уходит в оркестр", () => {
    const документы = [
      { name: "т1.pdf", kind: "рабочая-документация" },
      { name: "т2.pdf", kind: "рабочая-документация" },
      { name: "т3.pdf", kind: "рабочая-документация" },
      { name: "лср.xlsx", kind: "лср" },
    ];
    const result = route(passportOf({ ...полный, domain: "иное" }, документы), TABLE);

    expect(result.kind).toBe("route");
    if (result.kind !== "route") return;
    expect(result.configuration).toBe("C");
    expect(result.agent).toBe("артемий");
  });

  it("замыкающее правило ловит всё, что не подошло выше", () => {
    const result = route(passportOf({ ...полный, domain: "иное" }), TABLE);

    expect(result.kind).toBe("route");
    if (result.kind !== "route") return;
    expect(result.routeId).toBe("нет-профильного");
  });

  it("называет сработавший критерий, а не пересказывает решение", () => {
    // В легаси «ПОЧЕМУ: [1–2 строки по критериям]» пишет модель. Здесь причина —
    // это идентификатор правила, которое сработало: факт, а не проза.
    const result = route(passportOf({ ...полный, side: "заказчик" }), TABLE);

    if (result.kind !== "route") throw new Error("ожидался маршрут");
    expect(result.criterion).toContain("5) Сторона стола");
    expect(result.routeId).toBe("сторона-заказчика");
  });

  it("первое подошедшее правило выигрывает, порядок таблицы значим", () => {
    const result = route(passportOf({ domain: "вода", side: "заказчик", goal: "вердикт" }), TABLE);

    if (result.kind !== "route") throw new Error("ожидался маршрут");
    // «Вода» стоит ниже «стороны заказчика», значит побеждает сторона.
    expect(result.agent).toBe("матвеич");
  });
});
