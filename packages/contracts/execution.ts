/**
 * Исполнение: операции, способности, артефакты (ADR-R-022, ADR-R-026).
 *
 * Проверка — договорная единица (ТЗ §1). Операция — единица исполнения.
 * Одна и та же операция даёт идентичный артефакт из полной Проверки, из подграфа
 * и из самостоятельного вызова: иначе появляются две истины.
 */
import type { IsoDateTime, Sha256 } from "./primitives.js";

/**
 * Способность, а не источник (ADR-R-026). Операция объявляет `work_rates`,
 * а не «раздел 01 опорной базы», поэтому источник заменяется манифестом,
 * а не правкой кода.
 */
export type CapabilityId = string;

export type OperationKind = "agent" | "deterministic" | "io" | "maintenance";

/**
 * Класс полноты результата. Сводный вывод по ТЗ §5.3 имеет право нести
 * только `full`: частичный прогон не предъявляется как результат Проверки.
 */
export type Completeness = "full" | "partial" | "single";

export interface OperationRef {
  readonly id: string;
  readonly version: number;
  /** Вариант шага, например `top-by-sum` против `full-line-by-line` у Людмилы. */
  readonly variant?: string;
}

export interface OperationDefinition {
  readonly id: string;
  readonly version: number;
  readonly kind: OperationKind;
  readonly variants: readonly string[];
  /** Без этих способностей операция не стартует и называет недостающее. */
  readonly requires: readonly CapabilityId[];
  /** Без этих операция идёт, но записывает деградацию в артефакт. */
  readonly optional: readonly CapabilityId[];
  readonly provides: readonly CapabilityId[];
  /** Предусловия на общих предметах: например `vor:approved` (ADR-R-002). */
  readonly preconditions: readonly string[];
}

/** Объявленная деградация: почему результат неполон (ТЗ §9, ADR-R-026). */
export interface Degradation {
  readonly capability: CapabilityId;
  readonly reason: string;
}

/** Почему операция не может стартовать. */
export type OperationBlock =
  | { readonly kind: "missing_capability"; readonly capability: CapabilityId }
  | { readonly kind: "precondition"; readonly precondition: string; readonly actual: string };

/** Конверт результата операции. */
export interface Artifact<TBody = unknown> {
  readonly id: string;
  readonly tenantId: string;
  readonly operation: OperationRef;
  readonly completeness: Completeness;
  /**
   * Хэши фактически использованных входов и записей знания (ADR-R-027).
   * Записываем использованное, а не состав базы: база растёт и сужается
   * свободно, прошлые прогоны остаются воспроизводимыми.
   */
  readonly inputHashes: readonly Sha256[];
  readonly degradations: readonly Degradation[];
  readonly producedAt: IsoDateTime;
  readonly body: TBody;
}

/** Результат попытки исполнения: артефакт либо объяснённая блокировка. */
export type OperationOutcome<TBody = unknown> =
  | { readonly ok: true; readonly artifact: Artifact<TBody> }
  | { readonly ok: false; readonly blocks: readonly OperationBlock[] };
