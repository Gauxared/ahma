import { describe, expect, it } from "vitest";

import {
  CONTRACT_MAJOR,
  decimal,
  fromFormula,
  fromSource,
  isCompatibleContract,
  isOcrUnconfirmed,
  isReviewDue,
  isoDate,
  money,
  roundingGranularity,
  sha256,
} from "./index.js";
import type { SourceRef, UnitCode } from "./index.js";

const HASH = "a".repeat(64);

function ref(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    sourceId: "kurgan-lsr-sotv",
    contentHash: sha256(HASH),
    locator: { kind: "cell", sheet: "ЛСР", ref: "N334" },
    status: "fact",
    acquisition: "parsed",
    checkedAt: isoDate("2026-08-01"),
    staleAfterDays: 90,
    ...overrides,
  };
}

describe("десятичные значения", () => {
  it("принимает суммы курганских ЛСР без потери точности", () => {
    expect(decimal("14198884.54")).toBe("14198884.54");
    expect(decimal("104976702.48")).toBe("104976702.48");
  });

  it("отвергает то, что не является десятичным числом", () => {
    expect(() => decimal("1,5")).toThrow(TypeError);
    expect(() => decimal("1e5")).toThrow(TypeError);
    expect(() => decimal("")).toThrow(TypeError);
    expect(() => decimal("01.5")).toThrow(TypeError);
  });
});

describe("шкала денежных значений", () => {
  // Измерено 24.08.2026 на reference-system/input-1: внутри каждой ЛСР сходимость
  // ровно 0 ₽, а между Σ ЛСР и ССРСС — 7.52 ₽, потому что ССРСС номинирован
  // в тыс. руб с точностью до копеек.
  it("даёт гранулярность 10 ₽ для ССРСС в тыс. руб с копейками", () => {
    expect(roundingGranularity({ scale: "thousand", fractionDigits: 2 })).toBe("10");
  });

  it("даёт гранулярность 1 копейка для документа в рублях", () => {
    expect(roundingGranularity({ scale: "unit", fractionDigits: 2 })).toBe("0.01");
  });

  it("даёт гранулярность 1000 ₽ для целых тысяч", () => {
    expect(roundingGranularity({ scale: "thousand", fractionDigits: 0 })).toBe("1000");
  });

  it("объясняет курганское расхождение шкалой, а не ошибкой сходимости", () => {
    const sumOfLsr = 104_976_702.48;
    const ssrssTotal = 104_976_710;
    const granularity = Number(roundingGranularity({ scale: "thousand", fractionDigits: 2 }));

    expect(Math.abs(ssrssTotal - sumOfLsr)).toBeLessThanOrEqual(granularity);
  });

  it("хранит сумму в базовых единицах, а шкалу — как свойство источника", () => {
    const value = money("104976710", "RUB", { scale: "thousand", fractionDigits: 2 });

    expect(value.amount).toBe("104976710");
    expect(value.statedAs?.scale).toBe("thousand");
  });
});

describe("происхождение значений", () => {
  it("помечает значение старше порога свежести как требующее проверки (ТЗ §7)", () => {
    const stale = ref({ checkedAt: isoDate("2026-01-01") });
    expect(isReviewDue(stale, isoDate("2026-08-24"))).toBe(true);

    const fresh = ref({ checkedAt: isoDate("2026-08-01") });
    expect(isReviewDue(fresh, isoDate("2026-08-24"))).toBe(false);
  });

  it("выставляет reviewDue при построении значения из источника", () => {
    const valued = fromSource(money("1000"), ref({ checkedAt: isoDate("2025-01-01") }), isoDate("2026-08-24"));
    expect(valued.reviewDue).toBe(true);
  });

  it("отличает распознанное значение, чтобы исключить его из зачёта §12.1а", () => {
    const ocr = fromSource(money("1000"), ref({ acquisition: "ocr_unconfirmed" }), isoDate("2026-08-24"));
    const parsed = fromSource(money("1000"), ref(), isoDate("2026-08-24"));

    expect(isOcrUnconfirmed(ocr.provenance)).toBe(true);
    expect(isOcrUnconfirmed(parsed.provenance)).toBe(false);
  });

  it("сохраняет след формулы для вычисленного значения (ТЗ §6.4)", () => {
    const valued = fromFormula(money("10505.00"), {
      formulaId: "calculation.lineAmount",
      formulaVersion: 1,
      inputs: { quantity: decimal("12.5"), unitPrice: decimal("840.40") },
      output: decimal("10505.00"),
      unit: "RUB" as UnitCode,
      rounding: "half-up",
    });

    expect(valued.provenance.kind).toBe("formula");
    if (valued.provenance.kind === "formula") {
      expect(valued.provenance.trace.output).toBe("10505.00");
    }
  });
});

describe("совместимость контрактов", () => {
  it("принимает ту же мажорную версию и отвергает другую (ADR-R-028)", () => {
    expect(isCompatibleContract(`${CONTRACT_MAJOR}.7.3`)).toBe(true);
    expect(isCompatibleContract(`${CONTRACT_MAJOR + 1}.0.0`)).toBe(false);
    expect(isCompatibleContract("не версия")).toBe(false);
  });
});
