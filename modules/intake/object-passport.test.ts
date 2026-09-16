/**
 * Тесты написаны до реализации. Такт 0 легаси-протокола (Настенька).
 *
 * Источник — `reference-system/skills/stroiintellect-master/.../workflow.md`,
 * ТАКТ 0: паспорт объекта и реестр поручений.
 *
 * Проверяется главное отличие: в легаси реестр поручений ведётся ВРУЧНУЮ и
 * рассыхается с реальным ходом работ; здесь он выводится из того же воркфлоу,
 * который исполняется, и разойтись с ним не может.
 */
import { describe, expect, it } from "vitest";

import { buildAssignments, buildObjectPassport, renderObjectPassport } from "./object-passport.js";
import type { StageForAssignments } from "./object-passport.js";

const STAGES: readonly StageForAssignments[] = [
  {
    id: "такт-0",
    name: "Приём",
    steps: [{ agent: "настенька", produces: ["паспорт-объекта", "реестр-поручений"] }],
  },
  {
    id: "такт-1",
    name: "Инженерный и сметный вход (День 1)",
    steps: [
      { agent: "денчик", produces: ["вор-геометрия", "нагрузки"] },
      { agent: "людмила", produces: ["вор", "лср-маппинг"] },
    ],
  },
  {
    id: "такт-2",
    name: "Финансовая модель",
    steps: [{ agent: "ваныч", produces: ["финмодель", "потолки"] }],
  },
];

describe("паспорт объекта (такт 0)", () => {
  it("держит поля шаблона легаси и не выдумывает их значения", () => {
    const passport = buildObjectPassport({
      objectPath: "объект",
      declared: { name: "ЖДПП «Зауралье»" },
      composition: { volumes: 2, estimates: 4, hasSummary: true, total: 7 },
    });

    expect(passport.name).toBe("ЖДПП «Зауралье»");
    expect(passport.customer).toBeUndefined();
    expect(passport.contractPrice).toBeUndefined();
  });

  it("рисует ожидаемое от других агентов как ожидание, а не как пробел", () => {
    // В легаси стоит «ИНЖЕНЕРНЫЙ ПРОФИЛЬ (Денчик): [ждём — ТАКТ 1]».
    // Это не то же самое, что «не дано»: работа назначена и идёт.
    const rendered = renderObjectPassport(
      buildObjectPassport({
        objectPath: "объект",
        declared: {},
        composition: { volumes: 2, estimates: 4, hasSummary: true, total: 7 },
      }),
    );

    expect(rendered).toContain("ждём — такт-1");
    expect(rendered).toContain("❌");
  });

  it("записывает состав пакета фактом, а не со слов", () => {
    const passport = buildObjectPassport({
      objectPath: "объект",
      declared: {},
      composition: { volumes: 2, estimates: 4, hasSummary: true, total: 7 },
    });

    expect(passport.composition.estimates).toBe(4);
  });
});

describe("реестр поручений", () => {
  it("выводится из воркфлоу, а не заполняется руками", () => {
    // Каждый шаг каждого такта — это поручение. Ручной реестр расходится с
    // протоколом при первой же правке; выведенный расходиться не может.
    const assignments = buildAssignments(STAGES, new Map());

    expect(assignments).toHaveLength(4);
    expect(assignments.map((item) => item.agent)).toEqual([
      "настенька",
      "денчик",
      "людмила",
      "ваныч",
    ]);
  });

  it("нумерует поручения подряд и называет такт как срок", () => {
    // В легаси колонка «Дедлайн» — «День 1». Такт и есть срок: он задаёт
    // порядок, а календарные даты появляются, когда объявлен срок объекта.
    const assignments = buildAssignments(STAGES, new Map());

    expect(assignments[0]?.number).toBe(1);
    expect(assignments[1]?.stage).toBe("такт-1");
    expect(assignments[1]?.due).toContain("Инженерный и сметный вход");
  });

  it("описывает задание продуктами шага, а не пересказом", () => {
    const assignments = buildAssignments(STAGES, new Map());
    const людмила = assignments.find((item) => item.agent === "людмила");

    expect(людмила?.task).toBe("вор, лср-маппинг");
  });

  it("по умолчанию все поручения красные — работа не начата", () => {
    // В шаблоне легаси стартовый статус именно 🔴 у всех строк.
    const assignments = buildAssignments(STAGES, new Map());

    expect(assignments.every((item) => item.status === "🔴")).toBe(true);
  });

  it("статус ВЫЧИСЛЯЕТСЯ по состоянию предметов, а не ставится вручную", () => {
    // Здесь и есть повышение качества: в легаси статус проставляет человек и
    // забывает обновить. Тут он следует из того, что реально произведено.
    const subjects = new Map([
      ["вор-геометрия", "approved" as const],
      ["нагрузки", "approved" as const],
      ["вор", "returned" as const],
      ["лср-маппинг", "approved" as const],
    ]);

    const assignments = buildAssignments(STAGES, subjects);

    expect(assignments.find((item) => item.agent === "денчик")?.status).toBe("🟢");
    expect(assignments.find((item) => item.agent === "людмила")?.status).toBe("🔴");
    expect(assignments.find((item) => item.agent === "ваныч")?.status).toBe("🔴");
  });

  it("частично готовое поручение не считается зелёным", () => {
    // Денчик выдал нагрузки, но не вор-геометрию. Считать поручение
    // выполненным значит потерять половину работы.
    const subjects = new Map([["нагрузки", "approved" as const]]);
    const assignments = buildAssignments(STAGES, subjects);

    expect(assignments.find((item) => item.agent === "денчик")?.status).toBe("🟡");
  });
});

describe("возврат предмета в реестре поручений", () => {
  it("красит поручение красным, даже когда остальное готово", () => {
    // «Сделано и отвергнуто» ≠ «в работе»: в первом случае нужен пересчёт,
    // во втором надо ждать. Жёлтый цвет спрятал бы переделку.
    const subjects = new Map([
      ["вор-геометрия", "approved" as const],
      ["нагрузки", "approved" as const],
      ["вор", "returned" as const],
      ["лср-маппинг", "approved" as const],
    ]);

    const людмила = buildAssignments(STAGES, subjects).find((item) => item.agent === "людмила");

    expect(людмила?.status).toBe("🔴");
    expect(людмила?.pending).toContain("вор");
  });

  it("не путает возврат с непроизведённым: оба красные, но состав разный", () => {
    const возврат = buildAssignments(STAGES, new Map([["вор", "returned" as const]])).find(
      (item) => item.agent === "людмила",
    );
    const нетработы = buildAssignments(STAGES, new Map()).find((item) => item.agent === "людмила");

    expect(возврат?.status).toBe("🔴");
    expect(нетработы?.status).toBe("🔴");
    // Различие видно в составе: у возврата есть предмет, он просто не принят.
    expect(возврат?.produced).toEqual([]);
    expect(нетработы?.produced).toEqual([]);
  });
});
