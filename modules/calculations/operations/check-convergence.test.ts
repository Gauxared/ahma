/**
 * Тесты написаны до реализации по спецификации T3 (docs/m1-tasks.md).
 *
 * Проверяются операционные свойства и провенанс. Сама арифметика сходимости
 * покрыта тестами модуля расчёта и курганской фикстурой.
 */
import { describe, expect, it } from "vitest";

import type { GateSubject, Sha256 } from "@contracts/index.js";
import { sha256 } from "@contracts/index.js";
import { CapabilityRegistry } from "@platform/extensions/capabilities.js";
import { OperationRunner } from "@platform/execution/operation-runner.js";

import { CHECK_CONVERGENCE, createCheckConvergenceOperation } from "./check-convergence.js";
import type { CheckConvergenceBody, EstimateForConvergence } from "./check-convergence.js";

const HASH = sha256("f".repeat(64));

/** Две позиции в разделе, итог сходится ровно. */
const ESTIMATE: EstimateForConvergence = {
  documentPath: "/лср.xlsx",
  contentHash: HASH,
  sections: [
    {
      number: "1",
      name: "Оборудование",
      declaredTotal: "18038.61",
      positionTotals: ["9019.31", "9019.30"],
    },
  ],
  declaredTotal: "18038.61",
  headerTotalThousands: "18.04",
};

function makeRunner() {
  const runner = new OperationRunner(new CapabilityRegistry());
  runner.register(createCheckConvergenceOperation());
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

describe("операция сходимости (T3)", () => {
  it("объявлена с предусловием на разобранную смету", () => {
    expect(CHECK_CONVERGENCE.id).toBe("check-convergence");
    expect(CHECK_CONVERGENCE.kind).toBe("deterministic");
    expect(CHECK_CONVERGENCE.preconditions).toEqual(["estimate:draft|approved"]);
  });

  it("не стартует, пока смета возвращена на пересчёт", async () => {
    const outcome = await makeRunner().run<EstimateForConvergence, CheckConvergenceBody>(
      "check-convergence",
      ESTIMATE,
      context("returned"),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.blocks[0]).toMatchObject({ kind: "precondition", actual: "returned" });
    }
  });

  it("даёт нулевое расхождение и переносит хэш входа в артефакт", async () => {
    const outcome = await makeRunner().run<EstimateForConvergence, CheckConvergenceBody>(
      "check-convergence",
      ESTIMATE,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.inputHashes).toEqual([HASH]);
    expect(outcome.artifact.body.converged).toBe(true);
    expect(outcome.artifact.body.document.delta?.value.amount).toBe("0.00");
  });

  it("каждое число артефакта несёт след формулы (ТЗ §9, §12.1д)", async () => {
    const outcome = await makeRunner().run<EstimateForConvergence, CheckConvergenceBody>(
      "check-convergence",
      ESTIMATE,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { body } = outcome.artifact;
    const numbers = [
      body.document.computed,
      body.document.delta,
      ...body.sections.map((section) => section.computed),
      ...body.sections.map((section) => section.delta),
    ].filter((value) => value !== undefined);

    expect(numbers.length).toBeGreaterThan(0);

    for (const value of numbers) {
      expect(value.provenance.kind).toBe("formula");
      if (value.provenance.kind === "formula") {
        expect(value.provenance.trace.formulaId).toMatch(/^calculation\.convergence\./);
      }
    }
  });

  it("предъявляет расхождение шкалы отдельно, с гранулярностью", async () => {
    const outcome = await makeRunner().run<EstimateForConvergence, CheckConvergenceBody>(
      "check-convergence",
      ESTIMATE,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const scale = outcome.artifact.body.headerScale;
    expect(scale).toBeDefined();
    expect(scale?.granularity).toBe("10");
    expect(scale?.explainedByScale).toBe(true);
  });

  it("расхождение больше нуля даёт статус «не сошлось»", async () => {
    const broken: EstimateForConvergence = {
      ...ESTIMATE,
      sections: [{ ...ESTIMATE.sections[0]!, positionTotals: ["9019.31", "9019.00"] }],
    };

    const outcome = await makeRunner().run<EstimateForConvergence, CheckConvergenceBody>(
      "check-convergence",
      broken,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.body.converged).toBe(false);
    expect(outcome.artifact.body.sections[0]?.status).toBe("diverged");
    expect(outcome.artifact.body.sections[0]?.delta?.value.amount).toBe("-0.30");
  });

  it("пустой раздел даёт «нечего сверять», а не ложную сходимость", async () => {
    const withEmpty: EstimateForConvergence = {
      ...ESTIMATE,
      sections: [
        ...ESTIMATE.sections,
        { number: "2", name: "Мебель", declaredTotal: undefined, positionTotals: [] },
      ],
    };

    const outcome = await makeRunner().run<EstimateForConvergence, CheckConvergenceBody>(
      "check-convergence",
      withEmpty,
      context(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const empty = outcome.artifact.body.sections[1];
    expect(empty?.status).toBe("not_comparable");
    expect(empty?.reason).toBeDefined();
    expect(outcome.artifact.body.notComparable).toContain("section:2");
  });
});
