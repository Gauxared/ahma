import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isoDate } from "@contracts/index.js";
import { ConfigError, loadBundle } from "./bundle-loader.js";
import { assertCanCreateTenant, deploymentProfile, maxTenants } from "./deployment-profile.js";
import { ParameterRegistry, parameterBundleSchema } from "./parameters.js";

const RATES = join(process.cwd(), "config/parameters/rates.json");

function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "si-config-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

describe("профиль развёртывания (ADR-R-015)", () => {
  it("по умолчанию development, читает объявленный профиль", () => {
    expect(deploymentProfile({})).toBe("development");
    expect(deploymentProfile({ STROYINTELLECT_DEPLOYMENT_PROFILE: "multi-tenant" })).toBe("multi-tenant");
  });

  it("отвергает неизвестный профиль вместо тихого умолчания", () => {
    expect(() => deploymentProfile({ STROYINTELLECT_DEPLOYMENT_PROFILE: "saas" })).toThrow(/Недопустимый/);
  });

  it("запрещает второго арендатора в контуре заказчика (ТЗ §6.1)", () => {
    expect(() => assertCanCreateTenant("single-tenant-onprem", 1)).toThrow(/не более 1 арендатора/);
    expect(() => assertCanCreateTenant("single-tenant-onprem", 0)).not.toThrow();
  });

  it("не ограничивает число арендаторов в multi-tenant", () => {
    expect(maxTenants("multi-tenant")).toBe(Number.POSITIVE_INFINITY);
    expect(() => assertCanCreateTenant("multi-tenant", 42)).not.toThrow();
  });
});

describe("загрузка бандлов (ADR-R-014)", () => {
  it("валидирует и хэширует настоящий бандл ставок", () => {
    const bundle = loadBundle(RATES, parameterBundleSchema);

    expect(bundle.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.value.parameters.map((p) => p.id)).toContain("tax.vat.rate");
  });

  it("останавливает запуск на невалидной схеме, а не подставляет умолчание", () => {
    const path = tempFile("bad.json", JSON.stringify({ parameters: [{ id: "x" }] }));
    expect(() => loadBundle(path, parameterBundleSchema)).toThrow(ConfigError);
  });

  it("останавливает запуск на битом JSON", () => {
    const path = tempFile("broken.json", "{ не json");
    expect(() => loadBundle(path, parameterBundleSchema)).toThrow(/невалидный JSON/);
  });

  it("даёт разные хэши для разного содержимого", () => {
    const a = loadBundle(tempFile("a.json", JSON.stringify({ parameters: [{ id: "a", unit: "u", values: [{ effectiveFrom: "2026-01-01", value: "1", source: "s" }] }] })), parameterBundleSchema);
    const b = loadBundle(tempFile("b.json", JSON.stringify({ parameters: [{ id: "b", unit: "u", values: [{ effectiveFrom: "2026-01-01", value: "1", source: "s" }] }] })), parameterBundleSchema);

    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe("параметры с датой действия (ТЗ §6.4)", () => {
  const bundle = loadBundle(RATES, parameterBundleSchema);
  const registry = new ParameterRegistry(bundle.value, bundle.contentHash);

  it("даёт НДС 20% для курганского объекта и 22% для текущего", () => {
    // Курганский ССРСС посчитан по №303-ФЗ со ставкой 20%.
    expect(registry.require("tax.vat.rate", isoDate("2023-09-30")).value).toBe("0.20");
    // Текущая ставка по ТЗ и КП АПРИ.
    expect(registry.require("tax.vat.rate", isoDate("2026-08-24")).value).toBe("0.22");
  });

  it("возвращает провенанс, а не голое число (ТЗ §9)", () => {
    const vat = registry.require("tax.vat.rate", isoDate("2026-08-24"));

    expect(vat.provenance.kind).toBe("source");
    if (vat.provenance.kind === "source") {
      expect(vat.provenance.ref.sourceId).toBe("parameter:tax.vat.rate");
      expect(vat.provenance.ref.contentHash).toBe(bundle.contentHash);
    }
  });

  it("не подставляет ноль, когда значения на дату нет", () => {
    expect(registry.resolve("tax.vat.rate", isoDate("2015-01-01"))).toBeUndefined();
    expect(() => registry.require("tax.vat.rate", isoDate("2015-01-01"))).toThrow(/не разрешён/);
  });

  it("сообщает о необъявленном параметре явно", () => {
    expect(() => registry.require("tax.unknown", isoDate("2026-08-24"))).toThrow(/не объявлен/);
  });
});
