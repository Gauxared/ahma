import { describe, expect, it } from "vitest";

import type { GateSubject, OperationDefinition, Sha256 } from "@contracts/index.js";
import { sha256 } from "@contracts/index.js";

import { CapabilityRegistry } from "../extensions/capabilities.js";
import { OperationRunner } from "./operation-runner.js";
import type { EntryPoint } from "./operation-runner.js";

const HASH = sha256("b".repeat(64));

/** Ваныч: финмодель не считается без подтверждённого ВОР (реальный кейс Кургана). */
const FINANCE: OperationDefinition = {
  id: "build-financial-model",
  version: 1,
  kind: "deterministic",
  variants: [],
  requires: ["bill_of_quantities"],
  optional: ["financing_terms"],
  provides: ["financial_model"],
  preconditions: ["vor:approved"],
};

function subjects(status: GateSubject["status"]): ReadonlyMap<string, GateSubject> {
  return new Map([["vor", { id: "vor", status, returnedCount: status === "returned" ? 1 : 0 }]]);
}

function makeRunner() {
  const capabilities = new CapabilityRegistry();
  capabilities.declare({ sourceId: "lyudmila-vor", capability: "bill_of_quantities", enabled: true });
  capabilities.declare({ sourceId: "contract-terms", capability: "financing_terms", enabled: true });

  const runner = new OperationRunner(capabilities);
  runner.register({
    definition: FINANCE,
    run: async (input: { positions: number }) => ({
      body: { margin: "0.12", positions: input.positions },
      inputHashes: [HASH] as readonly Sha256[],
    }),
  });

  return runner;
}

function context(entryPoint: EntryPoint, status: GateSubject["status"] = "approved") {
  return { tenantId: "t-1", entryPoint, subjects: subjects(status), now: "2026-08-24T12:00:00Z" };
}

describe("предусловия проверяются из любой точки входа (ADR-R-022)", () => {
  it("не считает финмодель, пока ВОР возвращён на пересчёт", async () => {
    const outcome = await makeRunner().run("build-financial-model", { positions: 10 }, context("check", "returned"));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.blocks).toEqual([{ kind: "precondition", precondition: "vor:approved", actual: "returned" }]);
    }
  });

  it("одиночный вызов НЕ обходит гейт полной Проверки", async () => {
    const outcome = await makeRunner().run("build-financial-model", { positions: 10 }, context("single", "draft"));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.blocks[0]).toMatchObject({ kind: "precondition", actual: "draft" });
    }
  });

  it("сообщает об отсутствующем предмете, а не считает его подтверждённым", async () => {
    const runner = makeRunner();
    const outcome = await runner.run("build-financial-model", { positions: 10 }, {
      tenantId: "t-1",
      entryPoint: "single",
      subjects: new Map(),
      now: "2026-08-24T12:00:00Z",
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.blocks[0]).toMatchObject({ actual: "предмет отсутствует" });
    }
  });
});

describe("одна операция — одна истина (ADR-R-022)", () => {
  it("даёт идентичное содержание из Проверки и из отдельного вызова", async () => {
    const runner = makeRunner();

    const fromCheck = await runner.run("build-financial-model", { positions: 42 }, context("check"));
    const standalone = await runner.run("build-financial-model", { positions: 42 }, context("single"));

    expect(fromCheck.ok && standalone.ok).toBe(true);
    if (fromCheck.ok && standalone.ok) {
      expect(fromCheck.artifact.body).toEqual(standalone.artifact.body);
      expect(fromCheck.artifact.inputHashes).toEqual(standalone.artifact.inputHashes);
    }
  });

  it("различает точки входа только классом полноты", async () => {
    const runner = makeRunner();

    const check = await runner.run("build-financial-model", { positions: 1 }, context("check"));
    const subgraph = await runner.run("build-financial-model", { positions: 1 }, context("subgraph"));
    const single = await runner.run("build-financial-model", { positions: 1 }, context("single"));

    expect(check.ok && check.artifact.completeness).toBe("full");
    expect(subgraph.ok && subgraph.artifact.completeness).toBe("partial");
    expect(single.ok && single.artifact.completeness).toBe("single");
  });
});

describe("деградация записывается в артефакт (ADR-R-026)", () => {
  it("идёт без необязательной способности и сообщает об этом в результате", async () => {
    const capabilities = new CapabilityRegistry();
    capabilities.declare({ sourceId: "lyudmila-vor", capability: "bill_of_quantities", enabled: true });

    const runner = new OperationRunner(capabilities);
    runner.register({
      definition: FINANCE,
      run: async () => ({ body: { margin: "0.12" }, inputHashes: [] as readonly Sha256[] }),
    });

    const outcome = await runner.run("build-financial-model", {}, context("check"));

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.artifact.degradations).toEqual([
        {
          capability: "financing_terms",
          reason: "Необязательная способность financing_terms не предоставлена ни одним включённым источником",
        },
      ]);
    }
  });

  it("не стартует без обязательной способности и называет её", async () => {
    const runner = new OperationRunner(new CapabilityRegistry());
    runner.register({
      definition: FINANCE,
      run: async () => ({ body: {}, inputHashes: [] as readonly Sha256[] }),
    });

    const outcome = await runner.run("build-financial-model", {}, context("check"));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.blocks).toContainEqual({ kind: "missing_capability", capability: "bill_of_quantities" });
    }
  });
});

describe("конфигурация операций", () => {
  it("отвергает некорректное предусловие при регистрации, а не при исполнении", () => {
    const runner = new OperationRunner(new CapabilityRegistry());

    expect(() =>
      runner.register({
        definition: { ...FINANCE, preconditions: ["vor-approved"] },
        run: async () => ({ body: {}, inputHashes: [] as readonly Sha256[] }),
      }),
    ).toThrow(/Некорректное предусловие/);
  });
});

describe("грамматика предусловий: допустимые статусы (ADR-R-003)", () => {
  /** Сходимость идёт и по черновику, и по подтверждённой смете, но не по возвращённой. */
  const CONVERGENCE: OperationDefinition = {
    id: "check-convergence",
    version: 1,
    kind: "deterministic",
    variants: [],
    requires: [],
    optional: [],
    provides: ["convergence"],
    preconditions: ["estimate:draft|approved"],
  };

  function runnerWith(): OperationRunner {
    const runner = new OperationRunner(new CapabilityRegistry());
    runner.register({
      definition: CONVERGENCE,
      run: async () => ({ body: { ok: true }, inputHashes: [] as readonly Sha256[] }),
    });
    return runner;
  }

  function subjectsWith(status: GateSubject["status"]): ReadonlyMap<string, GateSubject> {
    return new Map([["estimate", { id: "estimate", status, returnedCount: 0 }]]);
  }

  it("пропускает при любом из перечисленных статусов", () => {
    for (const status of ["draft", "approved"] as const) {
      expect(runnerWith().checkStartable("check-convergence", subjectsWith(status)).blocks).toEqual([]);
    }
  });

  it("блокирует при статусе вне перечня и называет фактический", () => {
    const { blocks } = runnerWith().checkStartable("check-convergence", subjectsWith("returned"));

    expect(blocks).toEqual([
      { kind: "precondition", precondition: "estimate:draft|approved", actual: "returned" },
    ]);
  });

  it("отвергает пустую альтернативу при регистрации", () => {
    const runner = new OperationRunner(new CapabilityRegistry());

    expect(() =>
      runner.register({
        definition: { ...CONVERGENCE, preconditions: ["estimate:draft|"] },
        run: async () => ({ body: {}, inputHashes: [] as readonly Sha256[] }),
      }),
    ).toThrow(/Некорректное предусловие/);
  });
});
