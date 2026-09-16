/**
 * Тесты написаны до реализации по спецификации T2 (docs/m1-tasks.md).
 *
 * Проверяется не разбор — он покрыт в T1 — а операционные свойства: артефакт
 * с хэшами входов, класс полноты по точке входа, поведение при неразрешённой
 * способности и воспроизводимость повторного прогона.
 */
import { describe, expect, it } from "vitest";

import { isoDate, money, sha256 } from "@contracts/index.js";
import type { MappedPosition, MappingSummary } from "@contracts/index.js";
import { sheetFrom } from "../sheet.js";
import type { Sheet } from "../sheet.js";
import { CapabilityRegistry } from "@platform/extensions/capabilities.js";
import { OperationRunner } from "@platform/execution/operation-runner.js";

import { PARSE_ESTIMATE, createParseEstimateOperation } from "./parse-estimate.js";
import type { MappingSummarizer, ParseEstimateBody, PositionMapper } from "./parse-estimate.js";

const HASH = sha256("e".repeat(64));

/** Минимальная смета формы 421/пр: шапка, подзаголовок, нумерация, раздел, позиция. */
function miniSheet(): Sheet {
  return sheetFrom("ЛСР-мини", [
    [1, { A: "Сметная стоимость", D: "18.04", E: "тыс.руб." }],
    [2, { A: "№ п/п", B: "Обоснование", C: "Наименование работ и затрат", H: "Единица измерения" }],
    [3, { I: "на единицу", J: "коэффициенты", K: "всего с учетом коэффициентов", L: "на единицу", M: "коэффициенты", N: "всего" }],
    [4, { A: "1", B: "2", C: "3", H: "4", I: "5", J: "6", K: "7", L: "8", M: "9" }],
    [5, { A: "Раздел 1. Оборудование" }],
    [6, { A: "1", B: "ГЭСНм08-03-572-06", C: "Блок управления", H: "шт", I: "2", K: "2" }],
    [7, { C: "Всего по позиции", L: "9019.31", N: "18038.61" }],
    [8, { C: "Всего по разделу 1 Оборудование", N: "18038.61" }],
    [9, { C: "ВСЕГО по смете", N: "18038.61" }],
  ]);
}

/**
 * Заглушка сопоставителя. Тест проверяет операционные свойства, а не качество
 * канонизации — оно покрыто тестами T1. Заглушка позволяет смоделировать
 * и наличие каталога, и его отсутствие.
 */
function mapper(catalogueAvailable: boolean): PositionMapper {
  return (position, source) => ({
    ordinal: position.ordinal,
    sourceName: position.name,
    // Заглушка работает со сметой С ЦЕНАМИ: набор проверяет операционные
    // свойства, а смету без стоимостной части держит отдельный набор
    // `parsers/estimate-without-prices.test.ts`.
    amount: {
      value: money(position.total ?? "0.00"),
      provenance: {
        kind: "source",
        ref: {
          sourceId: source.sourceId,
          contentHash: source.contentHash,
          locator: { kind: "row", sheet: source.sheet, row: position.row },
          status: "fact",
          acquisition: "parsed",
          checkedAt: source.checkedAt,
          staleAfterDays: 90,
        },
      },
    },
    mapping:
      catalogueAvailable && position.code !== undefined
        ? {
            kind: "by_code",
            code: position.code,
            item: { id: "block", name: position.name, unit: "шт" as never, codes: [position.code] },
          }
        : { kind: "unmatched", reason: "каталог канонических позиций недоступен" },
  });
}

const summarize: MappingSummarizer = (positions): MappingSummary => ({
  total: positions.length,
  byCode: positions.filter((position: MappedPosition) => position.mapping.kind === "by_code").length,
  unmatched: positions.filter((position: MappedPosition) => position.mapping.kind === "unmatched").length,
  unitIssues: positions.filter((position: MappedPosition) => position.unitIssue !== undefined).length,
});

function makeRunner(options: { withCatalogue: boolean; withDocuments?: boolean }) {
  const capabilities = new CapabilityRegistry();

  // Разбор требует ДОСТУПА к сметным документам объекта: это сырьё, которое
  // даёт источник. Без него операция не стартует — так область знания
  // перестаёт быть декоративной (ADR-R-024, R-026).
  if (options.withDocuments !== false) {
    capabilities.declare({
      sourceId: "object-documents",
      capability: "estimate_documents",
      enabled: true,
    });
  }

  if (options.withCatalogue) {
    capabilities.declare({ sourceId: "reference-base", capability: "canonical_items", enabled: true });
  }

  const runner = new OperationRunner(capabilities);
  runner.register(
    createParseEstimateOperation({
      loadDocument: async () => ({ sheets: [miniSheet()], contentHash: HASH }),
      mapPosition: mapper(options.withCatalogue),
      summarize,
      today: () => isoDate("2026-08-24"),
    }),
  );

  return runner;
}

const CONTEXT = {
  tenantId: "t-1",
  entryPoint: "single" as const,
  subjects: new Map(),
  now: "2026-08-24T12:00:00Z",
};

describe("операция разбора сметы (ADR-R-022)", () => {
  it("объявлена без предусловий и провозглашает позиции сметы", () => {
    expect(PARSE_ESTIMATE.id).toBe("parse-estimate");
    expect(PARSE_ESTIMATE.kind).toBe("io");
    expect(PARSE_ESTIMATE.preconditions).toEqual([]);
    expect(PARSE_ESTIMATE.provides).toContain("estimate_positions");
  });

  it("выдаёт артефакт с хэшем содержимого файла в inputHashes (ADR-R-027)", async () => {
    const outcome = await makeRunner({ withCatalogue: true }).run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: "/tmp/лср.xlsx" },
      CONTEXT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.inputHashes).toEqual([HASH]);
    expect(outcome.artifact.operation.id).toBe("parse-estimate");
  });

  it("помечает одиночный вызов классом полноты single", async () => {
    const outcome = await makeRunner({ withCatalogue: true }).run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: "/tmp/лср.xlsx" },
      CONTEXT,
    );

    expect(outcome.ok && outcome.artifact.completeness).toBe("single");
  });

  it("разбирает позиции и сохраняет объявленные итоги", async () => {
    const outcome = await makeRunner({ withCatalogue: true }).run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: "/tmp/лср.xlsx" },
      CONTEXT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const body = outcome.artifact.body;
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0]?.positions).toHaveLength(1);
    expect(body.declaredTotal).toBe("18038.61");
    expect(body.summary.byCode).toBe(1);
  });

  it("повторный прогон даёт идентичное тело артефакта", async () => {
    const runner = makeRunner({ withCatalogue: true });

    const first = await runner.run<unknown, ParseEstimateBody>("parse-estimate", { documentPath: "/a.xlsx" }, CONTEXT);
    const second = await runner.run<unknown, ParseEstimateBody>("parse-estimate", { documentPath: "/a.xlsx" }, CONTEXT);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.artifact.body).toEqual(second.artifact.body);
      // Идентификатор и время у артефактов разные — это разные прогоны.
      expect(first.artifact.id).not.toBe(second.artifact.id);
    }
  });
});

describe("поведение без справочника канонических позиций (ADR-R-026)", () => {
  it("идёт с объявленной деградацией, а не падает", async () => {
    const outcome = await makeRunner({ withCatalogue: false }).run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: "/tmp/лср.xlsx" },
      CONTEXT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.degradations.map((d) => d.capability)).toContain("canonical_items");
  });

  it("без справочника все позиции честно несопоставлены", async () => {
    const outcome = await makeRunner({ withCatalogue: false }).run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: "/tmp/лср.xlsx" },
      CONTEXT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.body.summary.byCode).toBe(0);
    expect(outcome.artifact.body.summary.unmatched).toBe(1);
  });
});

describe("разбор без доступа к документам объекта (ADR-R-024)", () => {
  it("не стартует и называет недостающую способность", async () => {
    // Источник документов выключен областью знания. Разбор обязан отказать,
    // а не «прочитать файл всё равно»: иначе область знания декоративна.
    const runner = makeRunner({ withCatalogue: true, withDocuments: false });

    const outcome = await runner.run(
      "parse-estimate",
      { documentPath: "смета.xlsx" },
      CONTEXT,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.blocks).toContainEqual({
      kind: "missing_capability",
      capability: "estimate_documents",
    });
  });
});
