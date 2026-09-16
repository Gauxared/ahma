/**
 * Сходимость сметы как операция (ADR-R-022, ТЗ §12.1б).
 *
 * Отличие от функции расчёта в модуле `calculations`: здесь числа выходят
 * наружу, а значит обязаны нести происхождение. §12.1д принимает «числа без
 * маркера статуса источника в выгрузках — 0», и выгрузка строится из артефакта,
 * поэтому провенанс должен появиться ЗДЕСЬ, а не на этапе формирования Excel.
 *
 * Предусловие `estimate:draft|approved`: сходимость идёт и по разобранному
 * черновику, и по подтверждённой смете, но не по возвращённой на пересчёт —
 * там данные устарели.
 */
import { money } from "@contracts/index.js";
import type { Money, OperationDefinition, Sha256, Valued } from "@contracts/index.js";

import { calculateConvergence, compareWithHeader } from "../convergence.js";
import type { ConvergenceStatus, ScaleComparison } from "../convergence.js";

export const CHECK_CONVERGENCE: OperationDefinition = {
  id: "check-convergence",
  version: 1,
  kind: "deterministic",
  variants: [],
  requires: [],
  optional: [],
  provides: ["convergence"],
  preconditions: ["estimate:draft|approved"],
};

export interface SectionForConvergence {
  readonly number: string;
  readonly name: string;
  readonly declaredTotal: string | undefined;
  /** `undefined` — сумма позиции неизвестна, а не равна нулю. */
  readonly positionTotals: readonly (string | undefined)[];
}

export interface EstimateForConvergence {
  readonly documentPath: string;
  readonly contentHash: Sha256;
  readonly sections: readonly SectionForConvergence[];
  readonly declaredTotal: string | undefined;
  readonly headerTotalThousands: string | undefined;
}

export interface ConvergenceLevelBody {
  readonly scope: string;
  readonly name?: string;
  /** Пусто, когда сложить нельзя: среди слагаемых есть неизвестные суммы. */
  readonly computed: Valued<Money> | undefined;
  readonly declared: Valued<Money> | undefined;
  readonly delta: Valued<Money> | undefined;
  readonly status: ConvergenceStatus;
  readonly reason?: string;
}

export interface ScaleComparisonBody {
  readonly documentTotal: string;
  readonly headerInRubles: string;
  readonly delta: string;
  readonly granularity: string;
  readonly explainedByScale: boolean;
}

export interface CheckConvergenceBody {
  readonly documentPath: string;
  readonly sections: readonly ConvergenceLevelBody[];
  readonly document: ConvergenceLevelBody;
  readonly headerScale: ScaleComparisonBody | undefined;
  readonly converged: boolean;
  readonly notComparable: readonly string[];
}

/** Вычисленное значение выходит только со следом формулы. */
function computed(value: string, trace: ConvergenceLevelTrace): Valued<Money> {
  return { value: money(value), provenance: { kind: "formula", trace } };
}

type ConvergenceLevelTrace = ReturnType<typeof calculateConvergence>["document"]["trace"];

function scaleBody(comparison: ScaleComparison | undefined): ScaleComparisonBody | undefined {
  return comparison === undefined
    ? undefined
    : {
        documentTotal: comparison.documentTotal,
        headerInRubles: comparison.headerInRubles,
        delta: comparison.delta,
        granularity: comparison.granularity,
        explainedByScale: comparison.explainedByScale,
      };
}

export function createCheckConvergenceOperation() {
  return {
    definition: CHECK_CONVERGENCE,
    run: async (input: EstimateForConvergence) => {
      const report = calculateConvergence({
        sections: input.sections.map((section) => ({
          number: section.number,
          positionTotals: section.positionTotals,
          declaredTotal: section.declaredTotal,
        })),
        declaredTotal: input.declaredTotal,
        headerTotalThousands: input.headerTotalThousands,
      });

      const byNumber = new Map(input.sections.map((section) => [section.number, section.name]));

      const level = (
        source: (typeof report.sections)[number] | typeof report.document,
        name?: string,
      ): ConvergenceLevelBody => ({
        scope: source.scope,
        ...(name === undefined ? {} : { name }),
        computed: source.computed === undefined ? undefined : computed(source.computed, source.trace),
        declared: source.declared === undefined ? undefined : computed(source.declared, source.trace),
        delta: source.delta === undefined ? undefined : computed(source.delta, source.trace),
        status: source.status,
        ...(source.reason === undefined ? {} : { reason: source.reason }),
      });

      const body: CheckConvergenceBody = {
        documentPath: input.documentPath,
        sections: report.sections.map((section) =>
          level(section, byNumber.get(section.scope.replace("section:", ""))),
        ),
        document: level(report.document),
        headerScale: scaleBody(report.headerScale),
        converged: report.converged,
        notComparable: report.notComparable,
      };

      // Вход операции — тот же документ, что разбирали: его хэш и записываем
      // (ADR-R-027), чтобы прогон был воспроизводим по содержимому.
      return { body, inputHashes: [input.contentHash] as readonly Sha256[] };
    },
  };
}

export { compareWithHeader };
