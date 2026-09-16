/**
 * Свёртка по агентам — против «input-1 — input-1 —» на экране.
 *
 * Каждая проверка ниже описывает СВОЙ способ соврать читателю, и все они
 * наблюдались вживую: шесть агентов в одной куче, четыре вердикта через «; »,
 * находки Виктора за подписью сметчика, отказ агента, неотличимый от «замечаний
 * нет», и молчание о том, что агент вообще не запускался.
 */
import { describe, expect, it } from "vitest";

import { foldByAgent } from "./by-agent.js";
import type { AgentIdentityForReport, OutcomeForReport } from "./by-agent.js";

const РЕЕСТР: readonly AgentIdentityForReport[] = [
  { capability: "estimate_review", person: "Людмила", role: "Сметчик", scope: "документ", order: 2 },
  { capability: "finance_model", person: "Ваныч", role: "Эконом", scope: "объект", order: 4 },
  { capability: "contract_audit", person: "Виктор", role: "Договорник", scope: "объект", order: 8 },
];

function исход(over: Partial<OutcomeForReport> = {}): OutcomeForReport {
  return { path: "objects/КРГ-1", findings: [], ...over };
}

describe("девять записей всегда", () => {
  it("агент без исходов получает статус и ПРИЧИНУ, а не исчезает", () => {
    // Исчезнувший агент читается как «этой темы у объекта нет».
    const [, ваныч] = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [исход({ capability: "estimate_review", scope: "документ" })],
      degradations: [{ capability: "finance_model", reason: "выручка не задана" }],
    });

    expect(ваныч!.identity.person).toBe("Ваныч");
    expect(ваныч!.status).toBe("не выполнен");
    expect(ваныч!.reason).toBe("выручка не задана");
  });

  it("причина есть даже когда деградация не объявлена", () => {
    const [людмила] = foldByAgent({ roster: РЕЕСТР, outcomes: [] });

    expect(людмила!.reason).toMatch(/не объявлена деградацией/u);
  });

  it("порядок — конвейерный, а не алфавитный", () => {
    const порядок = foldByAgent({ roster: [...РЕЕСТР].reverse(), outcomes: [] });

    expect(порядок.map((section) => section.identity.person)).toEqual([
      "Людмила", "Ваныч", "Виктор",
    ]);
  });
});

describe("объектные агенты не схлопываются", () => {
  it("два агента с ОДНИМ путём дают две записи, а не одну", () => {
    // Ровно этот дефект давал на экране «input-1 — …, input-1 — …».
    const свёрнуто = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [
        исход({ capability: "finance_model", scope: "объект", verdict: "маржа у нуля" }),
        исход({ capability: "contract_audit", scope: "объект", verdict: "аудит невозможен" }),
      ],
    });

    const сработали = свёрнуто.filter((section) => section.status === "выполнен");
    expect(сработали).toHaveLength(2);
    expect(сработали.map((section) => section.identity.person)).toEqual(["Ваныч", "Виктор"]);
  });

  it("вердикты разных предметов НЕ склеиваются в строку", () => {
    // «принято; принято; не принято; принято» не читается вообще.
    const [людмила] = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [
        исход({ capability: "estimate_review", scope: "документ", path: "о/ЭОМ.xlsx", verdict: "сходится" }),
        исход({ capability: "estimate_review", scope: "документ", path: "о/СОТВ.xlsx", verdict: "не сходится" }),
      ],
    });

    expect(людмила!.subjects).toHaveLength(2);
    expect(людмила!.subjects.map((subject) => subject.verdict)).toEqual(["сходится", "не сходится"]);
    expect(людмила!.subjects.map((subject) => subject.subject)).toEqual(["ЭОМ.xlsx", "СОТВ.xlsx"]);
  });

  it("предмет объектного агента подписан «объект целиком», а не именем папки", () => {
    const [, ваныч] = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [исход({ capability: "finance_model", scope: "объект" })],
    });

    expect(ваныч!.subjects[0]!.subject).toBe("объект целиком");
  });
});

describe("отказ отличается от молчания", () => {
  it("агент, вернувший ошибку, получает статус «отказ» с причиной", () => {
    // Карточка с нулём находок неотличима от «посмотрел, замечаний нет».
    const [, ваныч] = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [исход({ capability: "finance_model", scope: "объект", error: "fetch failed" })],
    });

    expect(ваныч!.status).toBe("отказ");
    expect(ваныч!.reason).toBe("fetch failed");
  });

  it("выполненный без замечаний — это «выполнен», а не «не выполнен»", () => {
    const [, ваныч] = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [исход({ capability: "finance_model", scope: "объект", verdict: "всё чисто" })],
    });

    expect(ваныч!.status).toBe("выполнен");
    expect(ваныч!.findings).toHaveLength(0);
  });
});

describe("находки", () => {
  it("сортируются по важности, а не по порядку прихода", () => {
    const [людмила] = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [
        исход({
          capability: "estimate_review",
          scope: "документ",
          path: "о/ЭОМ.xlsx",
          findings: [
            { severity: "info", statement: "а", basis: "о" },
            { severity: "critical", statement: "б", basis: "о" },
            { severity: "medium", statement: "в", basis: "о" },
          ],
        }),
      ],
    });

    expect(людмила!.findings.map((finding) => finding.severity)).toEqual([
      "critical", "medium", "info",
    ]);
    expect(людмила!.bySeverity).toEqual([["critical", 1], ["medium", 1], ["info", 1]]);
  });

  it("документ несут только находки документного агента", () => {
    // У объектного «документ» был бы папкой, и читатель решил бы, что
    // финмодель построена по одной смете.
    const свёрнуто = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [
        исход({
          capability: "estimate_review", scope: "документ", path: "о/ЭОМ.xlsx",
          findings: [{ severity: "high", statement: "а", basis: "о" }],
        }),
        исход({
          capability: "finance_model", scope: "объект",
          findings: [{ severity: "high", statement: "б", basis: "о" }],
        }),
      ],
    });

    expect(свёрнуто[0]!.findings[0]!.document).toBe("ЭОМ.xlsx");
    expect(свёрнуто[1]!.findings[0]!.document).toBeUndefined();
  });
});

describe("деньги замечания доходят до выгрузки", () => {
  it("сумма под угрозой переносится ВМЕСТЕ со следом из сметы", () => {
    // Оболочка агента её вычисляет по номеру позиции, а все девять портов
    // выбрасывали: величина считалась и терялась по дороге к читателю.
    const [людмила] = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [
        исход({
          capability: "estimate_review",
          scope: "документ",
          path: "о/СОТВ.xlsx",
          findings: [
            {
              severity: "critical",
              statement: "анкеры без акта",
              basis: "поз. 29",
              deviation: "none",
              impact: { value: { amount: "10141552.64" } },
            },
            { severity: "high", statement: "без денежного следа", basis: "поз. 7" },
          ],
        }),
      ],
    });

    expect(людмила!.findings[0]!.impact).toBe("10141552.64");
    expect(людмила!.findings[0]!.deviation).toBe("none");
    // Отсутствие суммы — отсутствие поля, а НЕ ноль: ноль сказал бы, что
    // нарушение бесплатно.
    expect(людмила!.findings[1]!.impact).toBeUndefined();
  });
});

describe("исход без способности", () => {
  it("виден как «агент не назван», а не пропадает", () => {
    const свёрнуто = foldByAgent({
      roster: РЕЕСТР,
      outcomes: [исход({ verdict: "чей-то вердикт" })],
    });

    expect(свёрнуто).toHaveLength(4);
    expect(свёрнуто[3]!.identity.person).toBe("агент не назван");
    expect(свёрнуто[3]!.subjects[0]!.verdict).toBe("чей-то вердикт");
  });
});
