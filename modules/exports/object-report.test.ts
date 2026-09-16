/**
 * Тесты написаны до реализации.
 *
 * Разбор по объекту — итоговый документ MVP. Проверяется не вёрстка, а три
 * обязательства: у каждого числа есть маркер источника (§12.1д), итог объекта
 * вычисляется формулой со следом, и непокрытое объявлено, а не умолчано.
 */
import { describe, expect, it } from "vitest";

import { decimal, isoDate, sha256 } from "@contracts/index.js";
import type { Artifact } from "@contracts/index.js";
import { buildObjectReport } from "./object-report.js";
import type { ObjectReportSource } from "./object-report.js";
import { tracesOf } from "./calculation-workbook.js";

const ARTIFACT: Artifact<unknown> = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: "00000000-0000-0000-0000-000000000000",
  operation: { id: "check-object", version: 1 },
  completeness: "full",
  inputHashes: [sha256("a".repeat(64))],
  degradations: [],
  producedAt: "2026-08-28T00:00:00.000Z" as Artifact["producedAt"],
  body: {},
};

type Check = Omit<ObjectReportSource, "objectTotal" | "artifact" | "generatorVersion" | "producedAt">;

const CHECK: Check = {
  objectPath: "объект",
  documents: [
    {
      path: "объект/СОТВ.xlsx",
      kind: "лср",
      status: "проверен",
      positions: 44,
      byCode: 42,
      converged: true,
      delta: "0.00",
      documentTotal: "14198884.54",
    },
    {
      path: "объект/ЭОМ.xlsx",
      kind: "лср",
      status: "проверен",
      positions: 54,
      byCode: 54,
      converged: true,
      delta: "0.00",
      documentTotal: "89532565.11",
    },
    {
      path: "объект/чертежи.pdf",
      kind: "рабочая-документация",
      status: "не поддержан",
      reason: "рабочая документация, а не сметный расчёт",
    },
  ],
  totals: { documents: 3, checked: 2, skipped: 1, failed: 0, positions: 98, byCode: 96, unmatched: 2 },
  gates: [{ id: "§12.1б", name: "сходимость внутри ЛСР равна 0 ₽", passed: true, detail: "сошлось смет: 2" }],
  verdict: "принято",
};

function build(check: Check = CHECK) {
  // След задан здесь, а не позаимствован у расчётного модуля: тест выгрузки
  // проверяет ОТОБРАЖЕНИЕ готового значения, а не чужое сложение. Модули
  // разговаривают только узкой талией контрактов (ADR-R-025).
  const totals = check.documents
    .filter((document) => document.status === "проверен")
    .map((document) => [document.path, document.documentTotal ?? "0.00"] as const);

  const sum = totals
    .reduce((accumulator, [, amount]) => accumulator + Math.round(Number(amount) * 100), 0);

  return buildObjectReport({
    ...check,
    objectPath: "объект",
    objectTotal: {
      value: { amount: decimal((sum / 100).toFixed(2)), currency: "RUB" },
      provenance: {
        kind: "formula",
        trace: {
          formulaId: "calculation.object-total",
          formulaVersion: 1,
          inputs: Object.fromEntries(totals.map(([path, amount]) => [path, decimal(amount)])),
          output: decimal((sum / 100).toFixed(2)),
          rounding: "half-up",
        },
      },
    },
    artifact: ARTIFACT,
    generatorVersion: "1.0.0",
    producedAt: isoDate("2026-08-28"),
  });
}

function cellsOf(workbook: ReturnType<typeof build>, sheetName: string) {
  const sheet = workbook.sheets.find((candidate) => candidate.name.startsWith(sheetName));
  if (sheet === undefined) throw new Error(`Лист ${sheetName} не найден`);
  return sheet.rows.flat();
}

describe("разбор по объекту", () => {
  it("ни одно число не выведено без маркера источника", () => {
    // §12.1д. Нарушение здесь означает число, происхождение которого
    // не восстановить из самой выгрузки.
    for (const sheet of build().sheets) {
      for (const cell of sheet.rows.flat()) {
        if (cell.kind === "number" || cell.kind === "formula") {
          expect(cell.marker).not.toBe("");
        }
      }
    }
  });

  it("итог объекта — формула со следом, а не вписанное число", () => {
    const workbook = build();
    const traces = tracesOf(workbook);

    expect(traces.length).toBeGreaterThan(0);

    const objectTotal = traces.find((trace) => trace.formulaId === "calculation.object-total");
    expect(objectTotal?.output).toBe("103731449.65");
    expect(Object.keys(objectTotal?.inputs ?? {})).toHaveLength(2);
  });

  it("показывает каждую смету объекта со своим итогом", () => {
    const values = cellsOf(build(), "03").map((cell) => {
      if (cell.kind === "number") return cell.value as string;
      if (cell.kind === "formula") return cell.expected as string;
      return "";
    });

    expect(values).toContain("14198884.54");
    expect(values).toContain("89532565.11");
  });

  it("предъявляет пропущенные документы с причиной", () => {
    const texts = cellsOf(build(), "02")
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    expect(texts).toContain("чертежи.pdf");
    expect(texts).toContain("рабочая документация");
  });

  it("всегда содержит лист непокрытого, и он не пуст", () => {
    // Умолчать о границах разбора — значит выдать частичный результат
    // за полный. Лист обязателен, даже когда всё сошлось.
    const notCovered = cellsOf(build(), "05").filter(
      (cell) => cell.kind === "text" && cell.value.trim() !== "",
    );

    expect(notCovered.length).toBeGreaterThan(3);
  });

  it("экранирует текст, который Excel принял бы за формулу", () => {
    const withInjection: Check = {
      ...CHECK,
      documents: [
        {
          path: "=HYPERLINK(\"http://зло\")",
          kind: "рабочая-документация",
          status: "не поддержан",
          reason: "=cmd|' /c calc'!A1",
        },
      ],
    };

    const texts = cellsOf(build(withInjection), "02")
      .filter((cell) => cell.kind === "text")
      .map((cell) => (cell.kind === "text" ? cell.value : ""));

    for (const text of texts) {
      expect(text.startsWith("=")).toBe(false);
    }
  });

  it("выводит замечания сметчика с основанием, когда обзор был", () => {
    const withReview: Check = {
      ...CHECK,
      review: {
        documents: [
          {
            path: "объект/СОТВ.xlsx",
            verdict: "смета обоснована",
            findings: [
              { severity: "critical", statement: "позиция не расшифрована", basis: "поз. 89, доля 0.06" },
            ],
          },
        ],
        findings: 1,
        bySeverity: { critical: 1 },
      },
    };

    const texts = cellsOf(build(withReview), "04")
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    expect(texts).toContain("позиция не расшифрована");
    expect(texts).toContain("поз. 89");
  });

  it("РАЗЛИЧАЕТ агентов, а не сваливает их в кучу под одним путём", () => {
    // Шесть объектных агентов имеют путём папку объекта. Прежняя редакция
    // группировала по пути и давала один безымянный блок вместо шести — на
    // экране это выглядело как «input-1 — …, input-1 — …».
    const девять: Check = {
      ...CHECK,
      roster: [
        { capability: "finance_model", person: "Ваныч", role: "Эконом", scope: "объект", order: 4 },
        { capability: "contract_audit", person: "Виктор", role: "Договорник", scope: "объект", order: 8 },
      ],
      degradations: [{ capability: "estimate_review", reason: "модель не настроена" }],
      review: {
        documents: [
          {
            path: "объект",
            scope: "объект",
            capability: "finance_model",
            verdict: "маржа у нуля",
            findings: [{ severity: "high", statement: "выручка не задана", basis: "договор" }],
          },
          {
            path: "объект",
            scope: "объект",
            capability: "contract_audit",
            verdict: "аудит невозможен",
            findings: [{ severity: "high", statement: "текста договора нет", basis: "состав работ" }],
          },
        ],
        findings: 2,
        bySeverity: { high: 2 },
      },
    };

    const texts = cellsOf(build(девять), "04")
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    expect(texts).toContain("Ваныч — Эконом");
    expect(texts).toContain("Виктор — Договорник");
    // Вердикты не склеены в одну строку через «; ».
    expect(texts).toContain("маржа у нуля");
    expect(texts).toContain("аудит невозможен");
    // Лист больше не приписывает всё сметчику.
    expect(texts).not.toContain("ЗАМЕЧАНИЯ СМЕТЧИКА");
  });

  it("ПЕЧАТАЕТ агента, который не отработал, вместе с причиной", () => {
    // Пропавший блок читался бы как «этой темы у объекта нет».
    const сОдним: Check = {
      ...CHECK,
      roster: [
        { capability: "finance_model", person: "Ваныч", role: "Эконом", scope: "объект", order: 4 },
      ],
      degradations: [{ capability: "finance_model", reason: "модель не настроена" }],
      review: { documents: [], findings: 0, bySeverity: {} },
    };

    const texts = cellsOf(build(сОдним), "04")
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    expect(texts).toContain("Ваныч — Эконом");
    expect(texts).toContain("не выполнен");
    expect(texts).toContain("модель не настроена");
  });

  it("лист «Не покрыто» считает молчащих агентов ПО ФАКТУ, а не по памяти", () => {
    // Прежняя редакция утверждала «реализован один агент — сметчик» ещё долго
    // после того, как заработали все девять. Лист, заведённый ради честности,
    // начал врать первым.
    const все: Check = {
      ...CHECK,
      roster: [
        { capability: "finance_model", person: "Ваныч", role: "Эконом", scope: "объект", order: 4 },
        { capability: "contract_audit", person: "Виктор", role: "Договорник", scope: "объект", order: 8 },
      ],
      degradations: [{ capability: "contract_audit", reason: "модель не настроена" }],
      review: {
        documents: [
          { path: "объект", scope: "объект", capability: "finance_model", verdict: "готово", findings: [] },
        ],
        findings: 0,
        bySeverity: {},
      },
    };

    const texts = cellsOf(build(все), "05")
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    // Отработавший не объявляется непокрытым; молчащий — объявляется с причиной.
    expect(texts).not.toContain("Ваныч");
    expect(texts).toContain("Виктор — Договорник");
    expect(texts).toContain("модель не настроена");
    expect(texts).not.toContain("реализован один агент");
  });

  it("не создаёт лист замечаний, когда обзор не запрашивали", () => {
    // Пустой лист «Замечания» читался бы как «замечаний нет»,
    // хотя сметчик не работал вовсе.
    const names = build().sheets.map((sheet) => sheet.name);
    expect(names.some((name) => name.includes("Замечания"))).toBe(false);
  });
});

describe("разбор по объекту: сверка со сводным расчётом", () => {
  const summary = {
    path: "объект/ССРСС.xlsx",
    label: "Итого по Главам 1-9",
    declaredThousands: "104976.71",
    declaredRubles: "104976710.00",
    delta: "7.52",
    granularity: "10",
    explainedByScale: true,
  };

  it("показывает расхождение вместе с гранулярностью шкалы", () => {
    const texts = cellsOf(build({ ...CHECK, summary }), "03")
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    expect(texts).toContain("Итого по Главам 1-9");
    expect(texts).toContain("гранулярность шкалы 10 ₽");
    expect(texts).toContain("объясняется округлением источника");
  });

  it("убирает ССРСС из непокрытого, когда сверка выполнена", () => {
    // Объявлять непокрытым то, что покрыто, так же неверно,
    // как умалчивать о пробеле.
    const texts = cellsOf(build({ ...CHECK, summary }), "05")
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    expect(texts).not.toContain("ССРСС");
  });

  it("возвращает ССРСС в непокрытое, если разбор отказал", () => {
    const texts = cellsOf(
      build({ ...CHECK, summary: { path: summary.path, error: "не найдена шапка" } }),
      "05",
    )
      .map((cell) => (cell.kind === "text" ? cell.value : ""))
      .join(" | ");

    expect(texts).toContain("ССРСС");
    expect(texts).toContain("не найдена шапка");
  });
});
