/**
 * Тесты написаны до реализации по спецификации T1 (docs/m1-tasks.md).
 */
import { describe, expect, it } from "vitest";

import { isoDate, sha256, unitCode } from "@contracts/index.js";

import { CanonicalItemRegistry } from "./item-registry.js";
import { mapPosition } from "./map-position.js";
import type { DocumentSource } from "@contracts/index.js";

const HASH = sha256("c".repeat(64));

function source(): DocumentSource {
  return { sourceId: "kurgan-sotv", contentHash: HASH, sheet: "ЛСР", checkedAt: isoDate("2026-08-24") };
}

function registry(): CanonicalItemRegistry {
  const items = new CanonicalItemRegistry();
  items.add({
    id: "block-install",
    name: "Блок управления шкафного исполнения: установка",
    unit: unitCode("шт"),
    codes: [{ system: "ГЭСН", code: "м08-03-572-06" }],
  });
  items.add({
    id: "cable-tray",
    name: "Шина ответвительная",
    unit: unitCode("м"),
    codes: [{ system: "ГЭСН", code: "м08-01-072-01" }],
  });
  return items;
}

const POSITION = {
  ordinal: "1",
  code: { system: "ГЭСН", code: "м08-03-572-06" } as const,
  basis: "ГЭСНм08-03-572-06",
  name: "Блок управления шкафного исполнения",
  unit: unitCode("шт"),
  quantity: "2",
  unitCost: "9019.31",
  total: "18038.61",
  row: 48,
};

describe("кодовый путь канонизации (ADR-R-013)", () => {
  it("сопоставляет позицию по нормативному шифру без участия модели", () => {
    const mapped = mapPosition(POSITION, registry(), source());

    expect(mapped.mapping.kind).toBe("by_code");
    if (mapped.mapping.kind === "by_code") {
      expect(mapped.mapping.item.id).toBe("block-install");
      expect(mapped.mapping.code.code).toBe("м08-03-572-06");
    }
  });

  it("возвращает несопоставленную позицию с причиной, а не выдумывает соответствие", () => {
    const unknown = { ...POSITION, code: { system: "ГЭСН", code: "м99-99-999-99" } as const };
    const mapped = mapPosition(unknown, registry(), source());

    expect(mapped.mapping.kind).toBe("unmatched");
    if (mapped.mapping.kind === "unmatched") {
      expect(mapped.mapping.reason).toMatch(/справочник/i);
    }
  });

  it("позиция без шифра уходит в текстовый путь как несопоставленная", () => {
    // Криптошлюзы ViPNet в курганском СОТВ идут по прайс-листу: шифра нет.
    const priced = { ...POSITION, code: undefined, basis: "ТЦ_61.1.03.03_77_7708256411_22.05.2024_02_93" };
    const mapped = mapPosition(priced, registry(), source());

    expect(mapped.mapping.kind).toBe("unmatched");
    if (mapped.mapping.kind === "unmatched") {
      expect(mapped.mapping.reason).toMatch(/шифр/i);
    }
  });
});

describe("провенанс позиции (ТЗ §9, §12.1д)", () => {
  it("количество и сумма несут ссылку на лист и строку источника", () => {
    const mapped = mapPosition(POSITION, registry(), source());

    for (const valued of [mapped.quantity, mapped.amount]) {
      expect(valued?.provenance.kind).toBe("source");
      if (valued?.provenance.kind === "source") {
        expect(valued.provenance.ref.locator).toEqual({ kind: "row", sheet: "ЛСР", row: 48 });
        expect(valued.provenance.ref.contentHash).toBe(HASH);
        expect(valued.provenance.ref.status).toBe("fact");
      }
    }
  });

  it("сумма позиции приходит с двумя знаками", () => {
    const mapped = mapPosition(POSITION, registry(), source());
    expect(mapped.amount?.value.amount).toBe("18038.61");
  });

  it("не выдумывает количество, когда его нет в документе", () => {
    const mapped = mapPosition({ ...POSITION, quantity: undefined }, registry(), source());
    expect(mapped.quantity).toBeUndefined();
  });

  it("приводит количество к канонической единице с множителем расценки", () => {
    // «100 м» × 0.02 расценки = 2 метра.
    const mapped = mapPosition({ ...POSITION, unit: "100 м", quantity: "0.02" }, registry(), source());

    expect(mapped.quantity?.value.unit).toBe("м");
    expect(mapped.quantity?.value.value).toBe("2");
  });

  it("сохраняет нераспознанную единицу и сообщает о ней", () => {
    const mapped = mapPosition({ ...POSITION, unit: "антенна" }, registry(), source());

    expect(mapped.quantity?.value.unit).toBe("антенна");
    expect(mapped.unitIssue).toMatch(/реестр/i);
  });
});

describe("справочник канонических позиций", () => {
  it("находит по шифру любой системы", () => {
    const items = registry();
    expect(items.findByCode({ system: "ГЭСН", code: "м08-01-072-01" })?.id).toBe("cable-tray");
    expect(items.findByCode({ system: "ФЕР", code: "м08-01-072-01" })).toBeUndefined();
  });

  it("отвергает повторный идентификатор", () => {
    const items = registry();
    expect(() =>
      items.add({ id: "block-install", name: "дубль", unit: unitCode("шт"), codes: [] }),
    ).toThrow(/уже/i);
  });

  it("отвергает шифр, занятый другой позицией", () => {
    const items = registry();
    expect(() =>
      items.add({
        id: "other",
        name: "другая",
        unit: unitCode("шт"),
        codes: [{ system: "ГЭСН", code: "м08-03-572-06" }],
      }),
    ).toThrow(/шифр/i);
  });
});
