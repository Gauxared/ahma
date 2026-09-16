/**
 * Тесты написаны до реализации по ADR-R-024 и ADR-R-027.
 *
 * Проверяется утверждение, ради которого снапшот существует: «повтор прогона
 * разрешает те же хэши и даёт тот же ответ». Пока это утверждение не сведено к
 * одному сравнению, воспроизводимость держится на честном слове.
 */
import { describe, expect, it } from "vitest";

import { buildSnapshot, snapshotDigest } from "./snapshot.js";
import type { SnapshotInput } from "./snapshot.js";

const BASE: SnapshotInput = {
  objectPath: "объект",
  producedAt: "2026-08-28",
  documents: [
    { path: "объект/ЛСР-1.xlsx", contentHash: "a".repeat(64) },
    { path: "объект/ЛСР-2.xlsx", contentHash: "b".repeat(64) },
  ],
  configs: [
    { path: "config/routing.json", contentHash: "c".repeat(64) },
    { path: "config/workflows/full-check.json", contentHash: "d".repeat(64) },
  ],
  operations: [
    { id: "parse-estimate", version: 1 },
    { id: "check-convergence", version: 1 },
  ],
  formulas: [{ id: "calculation.object-total", version: 1 }],
  prompts: [{ agent: "людмила", contentHash: "e".repeat(64) }],
  models: [{ provider: "openai-compatible", model: "qwen3-coder" }],
  knowledgeScope: ["reference-base", "object-documents"],
  degradations: [],
};

describe("снапшот Проверки", () => {
  it("два прогона на тех же входах дают один отпечаток", () => {
    // Само утверждение ADR-R-027, сведённое к одному сравнению.
    expect(snapshotDigest(buildSnapshot(BASE))).toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("не зависит от порядка перечисления входов", () => {
    // Порядок обхода Map или файловой системы не должен просачиваться в
    // отпечаток: иначе «тот же прогон» перестаёт быть тем же на другой машине.
    const переставленный: SnapshotInput = {
      ...BASE,
      documents: [...BASE.documents].reverse(),
      configs: [...BASE.configs].reverse(),
      operations: [...BASE.operations].reverse(),
    };

    expect(snapshotDigest(buildSnapshot(переставленный))).toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("меняется, если изменился хоть один документ", () => {
    const другой: SnapshotInput = {
      ...BASE,
      documents: [BASE.documents[0]!, { path: "объект/ЛСР-2.xlsx", contentHash: "f".repeat(64) }],
    };

    expect(snapshotDigest(buildSnapshot(другой))).not.toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("меняется, если изменилась конфигурация", () => {
    const другой: SnapshotInput = {
      ...BASE,
      configs: [{ path: "config/routing.json", contentHash: "0".repeat(64) }, BASE.configs[1]!],
    };

    expect(snapshotDigest(buildSnapshot(другой))).not.toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("меняется, если поднялась версия формулы", () => {
    // Иначе пересчёт по новой формуле выдал бы себя за прежний прогон.
    const другой: SnapshotInput = {
      ...BASE,
      formulas: [{ id: "calculation.object-total", version: 2 }],
    };

    expect(snapshotDigest(buildSnapshot(другой))).not.toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("меняется, если сменилась модель", () => {
    const другой: SnapshotInput = {
      ...BASE,
      models: [{ provider: "openai-compatible", model: "другая-модель" }],
    };

    expect(snapshotDigest(buildSnapshot(другой))).not.toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("меняется, если изменился промпт агента", () => {
    const другой: SnapshotInput = {
      ...BASE,
      prompts: [{ agent: "людмила", contentHash: "9".repeat(64) }],
    };

    expect(snapshotDigest(buildSnapshot(другой))).not.toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("меняется, если прогон шёл с деградацией", () => {
    // Прогон без каталога позиций и прогон с ним — РАЗНЫЕ прогоны. Если
    // деградация не входит в отпечаток, они выглядят одинаковыми, а результаты
    // у них разные.
    const деградировавший: SnapshotInput = {
      ...BASE,
      degradations: [{ capability: "canonical-items", reason: "каталог не собран" }],
    };

    expect(snapshotDigest(buildSnapshot(деградировавший))).not.toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("НЕ меняется от времени прогона", () => {
    // Иначе повтор никогда не совпадёт сам с собой, и утверждение
    // воспроизводимости станет непроверяемым.
    const позже: SnapshotInput = { ...BASE, producedAt: "2027-01-01" };

    expect(snapshotDigest(buildSnapshot(позже))).toBe(snapshotDigest(buildSnapshot(BASE)));
  });

  it("сохраняет время прогона в самом снапшоте, хоть и вне отпечатка", () => {
    // Отпечаток отвечает «те же ли входы»; снапшот — ещё и «когда это было».
    expect(buildSnapshot(BASE).producedAt).toBe("2026-08-28");
  });

  it("отпечаток — sha256, пригодный для сравнения строк", () => {
    expect(snapshotDigest(buildSnapshot(BASE))).toMatch(/^[0-9a-f]{64}$/);
  });
});
