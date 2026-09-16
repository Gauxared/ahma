/**
 * Тесты написаны до реализации по спецификации T4 (docs/m1-tasks.md).
 *
 * Прогон против настоящего endpoint вынесен в отдельный интеграционный тест:
 * здесь проверяется контракт операции и разделение труда по §6.4 — числа
 * влияния приходят из расчётного модуля, а не от модели.
 */
import { describe, expect, it } from "vitest";

import { sha256 } from "@contracts/index.js";
import type { GateSubject, Sha256 } from "@contracts/index.js";
import { CapabilityRegistry } from "@platform/extensions/capabilities.js";
import { OperationRunner } from "@platform/execution/operation-runner.js";
import { findStrictSchemaProblems } from "@platform/runtime/strict-schema.js";

import {
  ESTIMATE_REVIEW_SCHEMA,
  RUN_ESTIMATE_REVIEW,
  createEstimateReviewOperation,
} from "./run-estimate-review.js";
import type { EstimateReviewBody, EstimateReviewInput } from "./run-estimate-review.js";

const HASH = sha256("2".repeat(64));

const INPUT: EstimateReviewInput = {
  documentPath: "/лср.xlsx",
  contentHash: HASH,
  hasEstimate: true,
  convergence: {
    converged: true,
    documentTotal: "18038.61",
    documentDelta: "0.00",
    sections: [{ scope: "section:1", name: "Оборудование", computed: "18038.61", delta: "0.00", status: "converged" }],
  },
  checks: {
    positions: 2,
    total: "18038.61",
    duplicates: [],
    negatives: [],
    unexplainedLumpSums: [
      { ordinal: "7", name: "Комплект СКУД", amount: "1200.00", share: "0.07", row: 42 },
    ],
  },
  topPositions: {
    coverage: "0.85",
    positions: [
      { ordinal: "1", section: "1", name: "Блок управления", basis: "ГЭСНм08-03-572-06", amount: "9019.31", share: "0.50", row: 48 },
    ],
  },
};

/** Ответ модели, соответствующий схеме. */
const MODEL_OUTPUT = {
  verdict: "Смета сходится, но есть нерасшифрованный комплект.",
  findings: [
    {
      severity: "critical",
      statement: "Комплект СКУД не расшифрован",
      basis: "позиция 7, доля 7% итога — превышает порог расшифровки 5%",
      deviation: "quantity_error",
      impactOrdinal: "7",
    },
  ],
  openQuestions: [
    { question: "Запросить расшифровку комплекта СКУД", owner: "Заказчик", dueBy: "2026-09-01" },
  ],
};

function makeRunner(output: unknown = MODEL_OUTPUT, latencyMs = 1200) {
  const runner = new OperationRunner(new CapabilityRegistry());

  runner.register(
    createEstimateReviewOperation({
      prompt: "системный промпт Сметчика",
      accuracyMarker: ({ hasEstimate }) =>
        hasEstimate
          ? { range: "±3–5%", basis: "по локальному сметному расчёту", heuristic: true }
          : { range: "±10–15%", basis: "без локального сметного расчёта", heuristic: true },
      runAgent: async () => ({
        output,
        provider: "openai-compatible",
        model: "тестовая",
        inputTokens: 500,
        outputTokens: 200,
        latencyMs,
      }),
    }),
  );

  return runner;
}

function context(status: GateSubject["status"] = "draft") {
  return {
    tenantId: "t-1",
    entryPoint: "single" as const,
    subjects: new Map([["estimate", { id: "estimate", status, returnedCount: 0 }]]),
    now: "2026-08-25T10:00:00Z",
  };
}

describe("схема вывода Сметчика", () => {
  it("совместима со строгим structured output (M0, находка спайка)", () => {
    expect(findStrictSchemaProblems(ESTIMATE_REVIEW_SCHEMA)).toEqual([]);
  });
});

describe("операция агента Сметчика (T4)", () => {
  it("объявлена с предусловием на разобранную смету", () => {
    expect(RUN_ESTIMATE_REVIEW.id).toBe("run-estimate-review");
    expect(RUN_ESTIMATE_REVIEW.kind).toBe("agent");
    expect(RUN_ESTIMATE_REVIEW.preconditions).toEqual(["estimate:draft|approved"]);
  });

  it("не стартует, пока смета возвращена на пересчёт", async () => {
    const outcome = await makeRunner().run<EstimateReviewInput, EstimateReviewBody>(
      "run-estimate-review",
      INPUT,
      context("returned"),
    );

    expect(outcome.ok).toBe(false);
  });

  it("возвращает замечания с основанием", async () => {
    const outcome = await makeRunner().run<EstimateReviewInput, EstimateReviewBody>(
      "run-estimate-review",
      INPUT,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.body.findings).toHaveLength(1);
    expect(outcome.artifact.body.findings[0]?.basis.length).toBeGreaterThan(10);
  });

  it("числа влияния берёт из расчётного модуля, а не от модели (ТЗ §6.4)", async () => {
    const outcome = await makeRunner().run<EstimateReviewInput, EstimateReviewBody>(
      "run-estimate-review",
      INPUT,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const impact = outcome.artifact.body.findings[0]?.impact;

    // Модель назвала ЛИШЬ порядковый номер позиции; сумму подставил модуль.
    expect(impact?.value.amount).toBe("1200.00");
    expect(impact?.provenance.kind).toBe("source");
  });

  it("отвергает ответ модели, не соответствующий схеме", async () => {
    const runner = makeRunner({ verdict: "без замечаний" });

    await expect(
      runner.run<EstimateReviewInput, EstimateReviewBody>("run-estimate-review", INPUT, context()),
    ).rejects.toThrow(/схем/i);
  });

  it("отбрасывает замечание без основания, а не выпускает его дальше", async () => {
    const runner = makeRunner({
      verdict: "есть замечание",
      findings: [{ severity: "high", statement: "что-то не так", basis: "", deviation: "double_count", impactOrdinal: "" }],
      openQuestions: [],
    });

    const outcome = await runner.run<EstimateReviewInput, EstimateReviewBody>(
      "run-estimate-review",
      INPUT,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.body.findings).toEqual([]);
    expect(outcome.artifact.body.rejected).toHaveLength(1);
  });

  it("прикладывает маркер точности и замер прогона", async () => {
    const outcome = await makeRunner(MODEL_OUTPUT, 4200).run<EstimateReviewInput, EstimateReviewBody>(
      "run-estimate-review",
      INPUT,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.body.accuracy.range).toBe("±3–5%");
    expect(outcome.artifact.body.accuracy.heuristic).toBe(true);
    expect(outcome.artifact.body.run.latencyMs).toBe(4200);
    expect(outcome.artifact.body.run.inputTokens).toBe(500);
  });
});
