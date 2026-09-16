/**
 * Тесты написаны до реализации.
 *
 * Проверяется утверждение M2: воркфлоу — это ДАННЫЕ, а не код. Значит загрузчик
 * обязан читать настоящие конфиги репозитория и отвергать неверные, а не только
 * работать на выдуманных примерах.
 */
import { describe, expect, it } from "vitest";

import { loadWorkflow, loadWorkflows, workflowSchema } from "./workflow-loader.js";

describe("загрузка воркфлоу из конфигурации", () => {
  it("читает оба воркфлоу репозитория", () => {
    // Второй воркфлоу существует ровно затем, чтобы доказать, что первый
    // не зашит в код. Один воркфлоу не доказывает ничего.
    const workflows = loadWorkflows("config/workflows");

    expect(workflows.map((workflow) => workflow.value.id).sort()).toEqual([
      "estimate-only",
      "full-check",
    ]);
  });

  it("переносит протокол тактов из легаси целиком", () => {
    const { value } = loadWorkflow("config/workflows/full-check.json");

    expect(value.stages.map((stage) => stage.id)).toEqual([
      "такт-0",
      "такт-1",
      "такт-2",
      "такт-3",
      "такт-4",
    ]);
  });

  it("сохраняет зависимость Людмилы от ВОР Денчика", () => {
    // ADR-R-002: SKILL.md легаси пишет «ТАКТ 1 ПАРАЛЛЕЛЬНО», но workflow.md —
    // «Людмила принимает ВОР от Денчика». Взято второе, и это должно быть
    // видно в конфиге, а не спрятано в коде.
    const { value } = loadWorkflow("config/workflows/full-check.json");
    const такт1 = value.stages.find((stage) => stage.id === "такт-1");
    const людмила = такт1?.steps.find((step) => step.agent === "людмила");

    expect(людмила?.requires).toContain("вор-геометрия:approved");
  });

  it("держит Ваныча за ВОР — критическое правило протокола", () => {
    const { value } = loadWorkflow("config/workflows/full-check.json");
    const ваныч = value.stages
      .flatMap((stage) => stage.steps)
      .find((step) => step.agent === "ваныч");

    expect(ваныч?.requires).toContain("вор:approved");
  });

  it("отдаёт хэш содержимого для снапшота Проверки", () => {
    // Immutable Check snapshot (M2): версия воркфлоу обязана быть частью следа.
    const { contentHash } = loadWorkflow("config/workflows/full-check.json");

    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("отвергает предусловие, записанное не как «предмет:статус»", () => {
    const broken = {
      id: "битый",
      name: "битый",
      stages: [{ id: "s", name: "s", steps: [{ agent: "a", produces: [], requires: ["вор"] }] }],
    };

    expect(() => workflowSchema.parse(broken)).toThrow();
  });

  it("отвергает воркфлоу без тактов", () => {
    expect(() => workflowSchema.parse({ id: "пустой", name: "пустой", stages: [] })).toThrow();
  });

  it("отвергает такт без шагов", () => {
    // Пустой такт молча пропускается при исполнении и выглядит как пройденный.
    expect(() =>
      workflowSchema.parse({
        id: "x",
        name: "x",
        stages: [{ id: "s", name: "s", steps: [] }],
      }),
    ).toThrow();
  });
});
