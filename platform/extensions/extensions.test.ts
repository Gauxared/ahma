import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "@contracts/index.js";
import type { OperationDefinition } from "@contracts/index.js";

import { CapabilityRegistry } from "./capabilities.js";
import { extensionManifestSchema } from "./manifest.js";
import { ExtensionError, ExtensionRegistry } from "./registry.js";

function manifest(overrides: Record<string, unknown> = {}) {
  return extensionManifestSchema.parse({
    id: "grand-smeta-xlsx",
    version: 1,
    kind: "parser",
    implements: CONTRACT_VERSION,
    ...overrides,
  });
}

function operation(overrides: Partial<OperationDefinition> = {}): OperationDefinition {
  return {
    id: "calculate-cost-per-sqm",
    version: 1,
    kind: "deterministic",
    variants: [],
    requires: ["work_rates", "area_matrix"],
    optional: ["cost_benchmark"],
    provides: ["cost_per_sqm"],
    preconditions: [],
    ...overrides,
  };
}

describe("реестр расширений (ADR-R-017)", () => {
  it("регистрирует расширение с валидным манифестом", () => {
    const registry = new ExtensionRegistry();
    registry.register(manifest(), {});

    expect(registry.ids("parser")).toEqual(["grand-smeta-xlsx"]);
  });

  it("отклоняет несовместимую мажорную версию контракта, а не пропускает молча", () => {
    const registry = new ExtensionRegistry();

    expect(() => registry.register(manifest({ implements: "2.0.0" }), {})).toThrow(ExtensionError);
    expect(registry.ids("parser")).toEqual([]);
  });

  it("отклоняет повторную регистрацию идентификатора", () => {
    const registry = new ExtensionRegistry();
    registry.register(manifest(), {});

    expect(() => registry.register(manifest(), {})).toThrow(/уже зарегистрировано/);
  });

  it("не регистрирует внешнее расширение без декларации egress (ТЗ §8.3)", () => {
    const registry = new ExtensionRegistry();

    expect(() =>
      registry.register(manifest({ id: "storhaus", kind: "integration", contour: "external" }), {}),
    ).toThrow(/не декларирует egress/);
  });
});

describe("контроль выхода наружу (ТЗ §8.3, §12.1л)", () => {
  const registry = new ExtensionRegistry();
  registry.register(
    manifest({
      id: "storhaus",
      kind: "integration",
      contour: "external",
      dataClasses: ["object_meta", "positions"],
      egress: { destinations: ["storhaus.apri.local"], purpose: "data_ingest" },
    }),
    {},
  );

  it("хранит декларацию egress, но решения о выходе НЕ принимает", () => {
    // Решение принимает `platform/security/egress-gateway.ts` (О-67), читающий
    // те же манифесты. Собственный `checkEgress` реестра удалён: он сравнивал
    // назначения сырыми строками — без разбора имени хоста, punycode, маски
    // поддоменов, требования https и проверки метки контура.
    //
    // Два механизма на одну задачу хуже одного: следующий вызывающий взял бы
    // тот, что найдёт первым, и решил бы, что выход проверен.
    const { manifest: stored } = registry.require("integration", "storhaus");

    expect(stored.egress?.destinations).toEqual(["storhaus.apri.local"]);
    expect("checkEgress" in registry).toBe(false);
  });
});

describe("разрешение способностей (ADR-R-026)", () => {
  function registryWith(...providers: readonly { capability: string; sourceId: string; enabled?: boolean }[]) {
    const registry = new CapabilityRegistry();
    for (const provider of providers) {
      registry.declare({ sourceId: provider.sourceId, capability: provider.capability, enabled: provider.enabled ?? true });
    }
    return registry;
  }

  it("связывает операцию с источниками, не зная о них ничего заранее", () => {
    const registry = registryWith(
      { capability: "work_rates", sourceId: "apri-base" },
      { capability: "area_matrix", sourceId: "object-passport" },
      { capability: "cost_benchmark", sourceId: "apri-base" },
    );

    const resolution = registry.resolveFor(operation());

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.bindings.get("work_rates")?.sourceId).toBe("apri-base");
      expect(resolution.degradations).toEqual([]);
    }
  });

  it("не стартует и называет недостающую обязательную способность (ТЗ §9)", () => {
    const registry = registryWith({ capability: "work_rates", sourceId: "apri-base" });

    const resolution = registry.resolveFor(operation());

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.blocks).toEqual([{ kind: "missing_capability", capability: "area_matrix" }]);
    }
  });

  it("идёт с объявленной деградацией, когда нет необязательной способности", () => {
    const registry = registryWith(
      { capability: "work_rates", sourceId: "apri-base" },
      { capability: "area_matrix", sourceId: "object-passport" },
    );

    const resolution = registry.resolveFor(operation());

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.degradations).toHaveLength(1);
      expect(resolution.degradations[0]?.capability).toBe("cost_benchmark");
    }
  });

  it("отключение источника не ломает код операции, а меняет разрешение", () => {
    const registry = registryWith(
      { capability: "work_rates", sourceId: "apri-base" },
      { capability: "area_matrix", sourceId: "object-passport" },
      { capability: "cost_benchmark", sourceId: "apri-base", enabled: false },
    );

    const resolution = registry.resolveFor(operation());

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.degradations.map((d) => d.capability)).toEqual(["cost_benchmark"]);
    }
  });

  it("допускает несколько источников на одну способность", () => {
    const registry = registryWith(
      { capability: "work_rates", sourceId: "apri-base" },
      { capability: "work_rates", sourceId: "fsnb-2022" },
    );

    expect(registry.providersOf("work_rates")).toHaveLength(2);
    expect(registry.resolveOne("work_rates")?.sourceId).toBe("apri-base");
  });
});
