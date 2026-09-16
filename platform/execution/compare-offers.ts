/**
 * Сопоставление коммерческих предложений — ТЗ §5.2.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В МОДУЛЕ
 *
 * Пайплайн композирует четыре модуля: `canonical/text-match`,
 * `canonical/aggregate`, `canonical/match-ledger`, `calculations/spread` и
 * `calculations/independent-estimate`. Модулю такое запрещено — между модулями
 * ходит только узкая талия (ADR-R-025), и `verify-architecture` это валит.
 * Композиция живёт в платформе, ровно как `check-executor` композирует
 * `modules/workflow`.
 *
 * ПОЧЕМУ ВООБЩЕ ВЫНЕСЕНО
 *
 * До этого пайплайн был функцией внутри `apps/cli/src/main.ts`, сваренной с
 * `console.log`. Экран сравнения §5.5 переиспользовать её не мог — оставалось
 * либо продублировать полторы сотни строк оркестровки в вебе, либо вынести.
 * Дублирование прямо запрещено ADR-R-022: операция обязана давать один и тот же
 * артефакт независимо от точки входа, а две копии оркестровки — это две истины,
 * которые разойдутся на первой правке.
 *
 * Здесь только вычисление. Печать осталась в командной строке, отрисовка — в
 * вебе; ни того, ни другого этот файл не знает.
 *
 * ПОРЯДОК ШАГОВ НЕ ПРОИЗВОЛЕН
 *
 *  1. Сопоставление — иначе нечего сравнивать.
 *  2. Подтверждение неоднозначных — иначе разброс считается по догадкам.
 *  3. Агрегация состава — иначе свёрнутое и разбитое несравнимы.
 *  4. Разброс по сопоставимым — §5.2, несопоставленные не входят.
 *  5. Независимая оценка — она СРАВНИВАЕТСЯ с разбросом, а не строится по нему.
 *
 * Шаг 2 ОСТАНАВЛИВАЕТ расчёт: разброс по неподтверждённым сопоставлениям выдал
 * бы догадку за факт. Поэтому при `ready: false` позиции не считаются вовсе, а
 * не считаются «предварительно».
 */
import { Decimal } from "decimal.js";

import { estimateIndependently, type IndependentEstimate } from "@modules/calculations/independent-estimate.js";
import { spread, type Spread } from "@modules/calculations/spread.js";
import { classifyDeviation, type ClassifiedDeviation } from "@modules/calculations/deviation-class.js";
import { aggregateByCanonical } from "@modules/canonical/aggregate.js";
import { MatchLedger } from "@modules/canonical/match-ledger.js";
import { matchByText } from "@modules/canonical/text-match.js";

/** Набор предложений на вход: каталог, синонимы, наблюдения цен и сами КП. */
export interface CompareBundle {
  readonly objectName: string;
  readonly region: string;
  readonly period: string;
  readonly catalogue: readonly { id: string; name: string; unit: string }[];
  readonly synonyms?: readonly (readonly [string, string])[];
  readonly observations?: readonly {
    itemId: string;
    unitPrice: string;
    region: string;
    period: string;
    source: string;
  }[];
  readonly offers: readonly {
    contractor: string;
    lines: readonly { line: string; name: string; unit: string; quantity: string; amount: string }[];
  }[];
}

export interface ContractorAggregate {
  readonly contractor: string;
  readonly note: string;
  readonly total: string;
  readonly matchedAmount: string;
  /** Позиции, состав которых у этого подрядчика разбит на несколько строк. */
  readonly decomposed: readonly { readonly canonicalId: string; readonly lines: number; readonly quantityNote: string }[];
}

export interface LedgerRecordView {
  readonly offerLine: string;
  readonly explanation: string;
}

export interface PositionComparison {
  readonly canonicalId: string;
  readonly quantity: string | undefined;
  /**
   * Сумма каждого подрядчика по этой позиции.
   *
   * Отдаётся отдельно от `spread`: разброс — это статистика, и восстановить по
   * ней, кто сколько предложил, нельзя. Выгрузка и экран показывают именно
   * поимённые суммы, а не только минимум с медианой.
   */
  readonly offers: readonly { readonly source: string; readonly amount: string }[];
  /** Разброс по итогам групп. */
  readonly spread: Spread;
  /** Разброс по ценам за единицу — то, что сравнимо с оценкой Системы. */
  readonly unitSpread: Spread;
  readonly estimate: IndependentEstimate;
  readonly deviation: ClassifiedDeviation | undefined;
}

export interface ComparisonResult {
  readonly objectName: string;
  readonly offersTotal: number;
  readonly contractors: readonly ContractorAggregate[];
  /** Подтверждения не требуются: разброс посчитан. */
  readonly ready: boolean;
  readonly pending: readonly LedgerRecordView[];
  readonly unmatched: readonly LedgerRecordView[];
  /** Пусто, пока `ready` ложно: считать по неподтверждённому нельзя. */
  readonly positions: readonly PositionComparison[];
}

export function compareOffers(bundle: CompareBundle): ComparisonResult {
  // ── 1. Сопоставление и агрегация по каждому предложению ──
  const ledger = new MatchLedger();
  const aggregated = bundle.offers.map((offer) => {
    const lines = offer.lines.map((line) => {
      const match = matchByText(
        { name: line.name, unit: line.unit },
        bundle.catalogue,
        bundle.synonyms === undefined ? {} : { synonyms: bundle.synonyms },
      );

      const key = `${offer.contractor} · ${line.line}`;
      ledger.propose({
        offerLine: key,
        outcome: match.outcome,
        ...(match.match === undefined ? {} : { candidateId: match.match.id }),
        confidence: match.confidence,
        explanation: match.explanation,
      });

      const effective = ledger.effective(key);

      return {
        line: line.line,
        ...(effective === undefined ? {} : { canonicalId: effective.candidateId }),
        quantity: line.quantity,
        unit: line.unit,
        amount: line.amount,
      };
    });

    return { contractor: offer.contractor, aggregation: aggregateByCanonical(lines) };
  });

  const contractors: ContractorAggregate[] = aggregated.map(({ contractor, aggregation }) => ({
    contractor,
    note: aggregation.note,
    total: aggregation.total,
    matchedAmount: aggregation.matchedAmount,
    decomposed: aggregation.groups
      .filter((group) => group.decomposed)
      .map((group) => ({ canonicalId: group.canonicalId, lines: group.lines.length, quantityNote: group.quantityNote })),
  }));

  // ── 2. Что ждёт подтверждения человеком ──
  const readiness = ledger.readiness();
  const pending: LedgerRecordView[] = ledger
    .pending()
    .map((record) => ({ offerLine: record.offerLine, explanation: record.proposed.explanation }));

  if (!readiness.ready) {
    return {
      objectName: bundle.objectName,
      offersTotal: bundle.offers.length,
      contractors,
      ready: false,
      pending,
      unmatched: [],
      positions: [],
    };
  }

  const unmatched: LedgerRecordView[] = ledger
    .unmatched()
    .map((record) => ({ offerLine: record.offerLine, explanation: record.proposed.explanation }));

  // ── 3. Разброс по каждой канонической позиции ──
  const canonicalIds = [
    ...new Set(aggregated.flatMap(({ aggregation }) => aggregation.groups.map((group) => group.canonicalId))),
  ].sort((left, right) => left.localeCompare(right, "ru"));

  const positions: PositionComparison[] = canonicalIds.map((canonicalId) => {
    const groups = aggregated.flatMap(({ contractor, aggregation }) => {
      const group = aggregation.groups.find((item) => item.canonicalId === canonicalId);
      return group === undefined ? [] : [{ contractor, group }];
    });

    const offers = groups.map(({ contractor, group }) => ({ source: contractor, amount: group.amount }));

    // ЦЕНА ЗА ЕДИНИЦУ, А НЕ ИТОГ. Сравнивать итог группы с оценкой за единицу —
    // сравнивать 7 772 000 ₽ с 3 936 ₽/м² и объявлять это завышением в две
    // тысячи раз. Арифметически верно, по смыслу — ничто, и в переговоры такое
    // число пойдёт как факт. Первая версия команды печатала ровно это.
    const unitPrices = groups.flatMap(({ contractor, group }) => {
      if (group.quantity === undefined || new Decimal(group.quantity).isZero()) return [];
      return [{ source: contractor, amount: new Decimal(group.amount).dividedBy(group.quantity).toFixed(2) }];
    });

    // Подрядчик, у которого позиции нет вовсе, — несопоставленный по ЭТОЙ
    // позиции, а не подрядчик с ценой ноль.
    const missing = aggregated
      .filter(({ aggregation }) => !aggregation.groups.some((item) => item.canonicalId === canonicalId))
      .map(({ contractor }) => ({ source: contractor, reason: "позиция в предложении отсутствует" }));

    const result = spread({ offers, unmatched: missing });

    // Объём берётся из групп: у сопоставимых предложений он один и тот же,
    // иначе разошёлся бы и сам предмет сравнения.
    const quantity = groups[0]?.group.quantity;

    const estimate = estimateIndependently({
      itemId: canonicalId,
      quantity: quantity ?? "1",
      observations: bundle.observations ?? [],
      region: bundle.region,
      period: bundle.period,
      // Передаётся и НЕ используется: см. independent-estimate.ts.
      contractorOffers: offers.map((offer) => offer.amount),
    });

    const unitSpread = spread({ offers: unitPrices });

    const deviation =
      estimate.computable && unitSpread.median !== undefined && quantity !== undefined
        ? classifyDeviation({
            itemId: canonicalId,
            estimateUnitPrice: estimate.unitPrice as string,
            offerUnitPrice: unitSpread.median,
            estimateQuantity: quantity,
            offerQuantity: quantity,
          })
        : undefined;

    return { canonicalId, quantity, offers, spread: result, unitSpread, estimate, deviation };
  });

  return {
    objectName: bundle.objectName,
    offersTotal: bundle.offers.length,
    contractors,
    ready: true,
    pending,
    unmatched,
    positions,
  };
}
