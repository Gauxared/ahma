/**
 * Тесты написаны до реализации по спецификации T3 (docs/m1-tasks.md).
 *
 * Работают против настоящего PostgreSQL с включённым RLS: изоляцию арендатора
 * моками не подтвердить.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decimal, sha256 } from "@contracts/index.js";
import type { Artifact, FormulaTrace } from "@contracts/index.js";

import { ArtifactRepository } from "./artifact-repository.js";
import { createPrismaClient, withTenant } from "./prisma.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

const HASH = sha256("1".repeat(64));

function artifactFor(tenantId: string): Artifact<{ note: string }> {
  return {
    id: randomUUID(),
    tenantId,
    operation: { id: "check-convergence", version: 1 },
    completeness: "single",
    inputHashes: [HASH],
    degradations: [],
    producedAt: "2026-08-25T10:00:00Z" as Artifact["producedAt"],
    body: { note: "сходимость" },
  };
}

const TRACE: FormulaTrace = {
  formulaId: "calculation.convergence.document",
  formulaVersion: 1,
  inputs: { addend_1: decimal("9019.31"), addend_2: decimal("9019.30") },
  output: decimal("0.00"),
  rounding: "half-up",
};

describeDb("хранилище артефактов", () => {
  // Свой клиент на файл: общий синглтон рвётся чужим disconnect().
  const db = createPrismaClient(DATABASE_URL);
  const repository = new ArtifactRepository();
  const alpha = randomUUID();
  const beta = randomUUID();

  beforeAll(async () => {
    await db.tenant.createMany({
      data: [
        { id: alpha, slug: `art-a-${alpha.slice(0, 8)}`, displayName: "Альфа" },
        { id: beta, slug: `art-b-${beta.slice(0, 8)}`, displayName: "Бета" },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [alpha, beta] } } });
    await db.$disconnect();
  });

  it("сохраняет артефакт и читает его в контексте своего арендатора", async () => {
    const artifact = artifactFor(alpha);

    await withTenant(db, alpha, (tx) => repository.save(tx, artifact, [TRACE]));

    const loaded = await withTenant(db, alpha, (tx) => repository.findById(tx, artifact.id));

    expect(loaded?.operation.id).toBe("check-convergence");
    expect(loaded?.completeness).toBe("single");
    expect(loaded?.inputHashes).toEqual([HASH]);
    expect(loaded?.body).toEqual({ note: "сходимость" });
  });

  it("НЕ отдаёт артефакт чужого арендатора (ADR-R-015)", async () => {
    const artifact = artifactFor(alpha);
    await withTenant(db, alpha, (tx) => repository.save(tx, artifact, []));

    const stolen = await withTenant(db, beta, (tx) => repository.findById(tx, artifact.id));

    expect(stolen).toBeUndefined();
  });

  it("сохраняет следы формул и связывает их с артефактом", async () => {
    const artifact = artifactFor(alpha);
    await withTenant(db, alpha, (tx) => repository.save(tx, artifact, [TRACE, { ...TRACE, output: decimal("1.50") }]));

    const traces = await withTenant(db, alpha, (tx) => repository.tracesOf(tx, artifact.id));

    expect(traces).toHaveLength(2);
    expect(traces[0]?.formulaId).toBe("calculation.convergence.document");
    expect(traces.map((trace) => trace.output)).toEqual(["0.00", "1.50"]);
  });

  it("не отдаёт следы формул чужого арендатора", async () => {
    const artifact = artifactFor(alpha);
    await withTenant(db, alpha, (tx) => repository.save(tx, artifact, [TRACE]));

    expect(await withTenant(db, beta, (tx) => repository.tracesOf(tx, artifact.id))).toEqual([]);
  });

  it("отказывается сохранять артефакт под чужим арендатором", async () => {
    const foreign = artifactFor(beta);

    await expect(withTenant(db, alpha, (tx) => repository.save(tx, foreign, []))).rejects.toThrow();
  });
});
