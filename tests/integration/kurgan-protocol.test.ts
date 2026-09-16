/**
 * Протокол тактов на настоящих курганских данных.
 *
 * Проверяется утверждение M2 «воркфлоу — это данные, а не код»: ОДИН движок,
 * два конфига, разные исходы. И честность отчёта: агент, которого нет, не
 * изображает исполнение.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bootstrap } from "@platform/bootstrap.js";
import { runProtocol } from "@modules/workflow/protocol.js";
import { checkObject } from "@modules/workflow/check-object.js";
import { classifyDocument } from "@modules/workflow/classify-document.js";
import { buildAssignments } from "@modules/intake/object-passport.js";
import type { ParseEstimateBody } from "@modules/documents/operations/parse-estimate.js";
import type { CheckConvergenceBody } from "@modules/calculations/operations/check-convergence.js";

import { kurganAvailable, KURGAN_INPUT } from "../fixtures/kurgan.js";

const describeKurgan = kurganAvailable() ? describe : describe.skip;
const TENANT = "00000000-0000-0000-0000-000000000000";

/** Настоящая Людмила: разбор смет объекта и сходимость. */
async function lyudmila(platform: ReturnType<typeof bootstrap>, produces: readonly string[]) {
  const now = new Date().toISOString();

  const body = await checkObject(KURGAN_INPUT, {
    discover: async (path) =>
      (await readdir(path)).map((name) => ({ path: join(path, name), kind: classifyDocument(name) })),
    checkDocument: async (document) => {
      const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
        "parse-estimate",
        { documentPath: document.path },
        { tenantId: TENANT, entryPoint: "subgraph", subjects: new Map(), now },
      );
      if (!parsed.ok) throw new Error("разбор заблокирован");

      const blocking = parsed.artifact.body.issues.filter((issue) => issue.severity === "blocking");
      if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join("; "));

      const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
        "check-convergence",
        {
          documentPath: document.path,
          contentHash: parsed.artifact.inputHashes[0]!,
          sections: parsed.artifact.body.sections.map((section) => ({
            number: section.number,
            name: section.name,
            declaredTotal: section.declaredTotal,
            positionTotals: section.positions.map((position) => position.amount?.value.amount),
          })),
          declaredTotal: parsed.artifact.body.declaredTotal,
          headerTotalThousands: parsed.artifact.body.headerTotalThousands,
        },
        {
          tenantId: TENANT,
          entryPoint: "subgraph",
          subjects: new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]),
          now,
        },
      );
      if (!convergence.ok) throw new Error("сходимость не посчитана");

      return {
        path: document.path,
        positions: parsed.artifact.body.sections.reduce((n, s) => n + s.positions.length, 0),
        byCode: parsed.artifact.body.summary.byCode,
        unmatched: parsed.artifact.body.summary.unmatched,
        converged: convergence.artifact.body.converged,
        delta: convergence.artifact.body.document.delta?.value.amount,
        documentTotal: convergence.artifact.body.document.computed?.value.amount,
      };
    },
  });

  return {
    agent: "людмила",
    produced: produces.map((subject) => ({
      subject,
      status: body.verdict === "принято" ? ("approved" as const) : ("returned" as const),
    })),
    handoffs: [],
  };
}

describeKurgan("протокол на курганском объекте", () => {
  it("estimate-only проходит: настоящая Людмила отрабатывает сквозняком", async () => {
    const platform = bootstrap();
    const workflow = platform.workflows.get("estimate-only")!;

    const body = await runProtocol(
      workflow.stages,
      { runStep: async (step) => (step.agent === "людмила" ? lyudmila(platform, step.produces) : undefined) },
      { subjects: new Map(), maxRework: workflow.maxRework },
    );

    expect(body.completed).toBe(true);
    expect(body.unimplementedSteps).toBe(0);
  });

  it("full-check НЕ проходит: восьми агентов нет, и это сказано", async () => {
    // Тот же движок и та же реализация Людмилы — другой конфиг, другой исход.
    const platform = bootstrap();
    const workflow = platform.workflows.get("full-check")!;

    const body = await runProtocol(
      workflow.stages,
      { runStep: async (step) => (step.agent === "людмила" ? lyudmila(platform, step.produces) : undefined) },
      { subjects: new Map(), maxRework: workflow.maxRework },
    );

    expect(body.completed).toBe(false);
    expect(body.unimplementedSteps).toBeGreaterThan(0);

    const нереализованные = body.stages
      .flatMap((stage) => stage.steps)
      .filter((step) => step.status === "не реализован")
      .map((step) => step.agent);

    expect(нереализованные).toContain("денчик");
    expect(нереализованные).toContain("настенька");
  });

  it("Людмила в full-check заблокирована отсутствием ВОР от Денчика", async () => {
    // Критическое правило легаси срабатывает на настоящих данных: Денчика нет,
    // значит вор-геометрии нет, значит сметный вход не имеет права стартовать.
    const platform = bootstrap();
    const workflow = platform.workflows.get("full-check")!;

    const body = await runProtocol(
      workflow.stages,
      { runStep: async (step) => (step.agent === "людмила" ? lyudmila(platform, step.produces) : undefined) },
      { subjects: new Map(), maxRework: workflow.maxRework },
    );

    const людмила = body.stages
      .flatMap((stage) => stage.steps)
      .find((step) => step.agent === "людмила");

    expect(людмила?.status).toBe("заблокирован");
    expect(людмила?.blocks?.[0]?.consequence).toContain("30–40%");
  });
});

describeKurgan("реестр поручений выводится из воркфлоу", () => {
  it("full-check даёт десять поручений — ровно десять агентов оркестра", async () => {
    // В легаси реестр ведётся руками и рассыхается с протоколом. Здесь он
    // выведен из того же конфига, который исполняется.
    const platform = bootstrap();
    const workflow = platform.workflows.get("full-check")!;

    const assignments = buildAssignments(workflow.stages, new Map());

    // Десятый — Тимофей: график производства работ, десятый документ пакета.
    // Он стоит в такте 4 рядом с вердиктом и читает то же самое, отвечая на
    // другой вопрос: не «брать ли объект», а «за сколько он делается».
    expect(assignments).toHaveLength(10);
    expect(assignments.map((item) => item.agent)).toEqual([
      "настенька",
      "денчик",
      "людмила",
      "палыч",
      "виктор",
      "ваныч",
      "марина",
      "халиль",
      "артемий",
      "тимофей",
    ]);
  });

  it("статус следует за фактическим прогоном, а не за отметкой человека", async () => {
    const platform = bootstrap();
    const workflow = platform.workflows.get("estimate-only")!;

    const body = await runProtocol(
      workflow.stages,
      { runStep: async (step) => (step.agent === "людмила" ? lyudmila(platform, step.produces) : undefined) },
      { subjects: new Map(), maxRework: workflow.maxRework },
    );

    const assignments = buildAssignments(
      workflow.stages,
      new Map(body.subjects.map((subject) => [subject.id, subject.status])),
    );

    expect(assignments[0]?.status).toBe("🟢");
    expect(assignments[0]?.pending).toEqual([]);
  });

  it("реестр меняется вместе с конфигом, потому что не является отдельной записью", async () => {
    const platform = bootstrap();

    const полный = buildAssignments(platform.workflows.get("full-check")!.stages, new Map());
    const сметный = buildAssignments(platform.workflows.get("estimate-only")!.stages, new Map());

    expect(полный.length).toBeGreaterThan(сметный.length);
    expect(сметный).toHaveLength(1);
  });
});
