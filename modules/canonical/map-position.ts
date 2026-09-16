/**
 * Отображение позиции сметы в сопоставимый вид (ТЗ §5.2, ADR-R-013).
 *
 * Числа выходят отсюда только как `Valued<T>` со ссылкой на лист и строку
 * источника: §12.1д принимает «ноль чисел без маркера статуса источника
 * в выгрузках», и обеспечить это позже, на выгрузке, уже невозможно —
 * происхождение теряется на первом же преобразовании.
 *
 * Несопоставленная позиция — полноправный исход, а не ошибка. По §5.2
 * несопоставимые позиции выделяются отдельно и в расчёт разброса не входят.
 */
import { Decimal } from "decimal.js";

import { decimal, money, unitCode } from "@contracts/index.js";
import type {
  DocumentSource,
  ItemCode,
  MappedPosition,
  MappingSummary,
  Money,
  PositionMapping,
  Quantity,
  SourceRef,
  Valued,
} from "@contracts/index.js";

import type { CanonicalItemRegistry } from "./item-registry.js";
import { parseUnit } from "./units.js";

/** Позиция в том виде, в каком её отдаёт парсер. */
export interface RawPosition {
  readonly ordinal: string;
  readonly code: ItemCode | undefined;
  readonly basis: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity: string | undefined;
  readonly unitCost: string | undefined;
  /** Пусто — сумма НЕИЗВЕСТНА (смета без стоимостной части), а не равна нулю. */
  readonly total: string | undefined;
  readonly row: number;
}

const STALE_AFTER_DAYS = 90;

function refFor(source: DocumentSource, row: number): SourceRef {
  return {
    sourceId: source.sourceId,
    contentHash: source.contentHash,
    locator: { kind: "row", sheet: source.sheet, row },
    // Значение взято из документа заказчика: это факт, а не ориентир (ТЗ §7).
    status: "fact",
    acquisition: "parsed",
    checkedAt: source.checkedAt,
    staleAfterDays: STALE_AFTER_DAYS,
  };
}

function valued<T>(value: T, ref: SourceRef): Valued<T> {
  return { value, provenance: { kind: "source", ref } };
}

function decimalString(value: Decimal): string {
  return value.toFixed(6).replace(/\.?0+$/, "") || "0";
}

export function mapPosition(
  position: RawPosition,
  registry: CanonicalItemRegistry,
  source: DocumentSource,
): MappedPosition {
  const ref = refFor(source, position.row);
  const unit = parseUnit(position.unit);

  const mapping = resolveMapping(position, registry);

  // Количество приводится к канонической единице: «100 м» × 0.02 = 2 м.
  //
  // Если единицы в документе нет вовсе, количество НЕ выпускается: число без
  // единицы не является величиной, и подставить сюда «шт» значило бы выдумать
  // данные. Сумма позиции при этом остаётся валидной.
  let quantity: Valued<Quantity> | undefined;
  if (position.quantity !== undefined && unit.unit !== "") {
    const raw = new Decimal(position.quantity);
    const canonical = unit.resolved ? raw.times(new Decimal(unit.multiplier)) : raw;

    quantity = valued<Quantity>(
      { value: decimal(decimalString(canonical)), unit: unitCode(unit.unit) },
      ref,
    );
  }

  const amount =
    position.total === undefined
      ? undefined
      : valued<Money>(money(new Decimal(position.total).toFixed(2)), ref);

  const unitPrice =
    position.unitCost === undefined
      ? undefined
      : valued<Money>(money(new Decimal(position.unitCost).toFixed(2)), ref);

  const result: MappedPosition = {
    ordinal: position.ordinal,
    sourceName: position.name,
    mapping,
    ...(amount === undefined ? {} : { amount }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(unitPrice === undefined ? {} : { unitPrice }),
    ...(unit.reason === undefined ? {} : { unitIssue: unit.reason }),
  } as MappedPosition;

  return result;
}

function resolveMapping(position: RawPosition, registry: CanonicalItemRegistry): PositionMapping {
  if (position.code === undefined) {
    return {
      kind: "unmatched",
      reason:
        `у позиции нет нормативного шифра (обоснование «${position.basis}»): ` +
        "кодовый путь неприменим, требуется сопоставление по наименованию",
    };
  }

  const item = registry.findByCode(position.code);

  if (item === undefined) {
    return {
      kind: "unmatched",
      reason:
        `шифр ${position.code.system} ${position.code.code} отсутствует в справочнике ` +
        "канонических позиций",
    };
  }

  return { kind: "by_code", item, code: position.code };
}

export function summarize(positions: readonly MappedPosition[]): MappingSummary {
  return {
    total: positions.length,
    byCode: positions.filter((position) => position.mapping.kind === "by_code").length,
    unmatched: positions.filter((position) => position.mapping.kind === "unmatched").length,
    unitIssues: positions.filter((position) => position.unitIssue !== undefined).length,
  };
}
