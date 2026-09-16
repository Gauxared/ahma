/**
 * Узкая талия СтройИнтеллекта (ADR-R-025).
 *
 * Это ЕДИНСТВЕННЫЙ словарь, которым модули разговаривают друг с другом.
 * Модуль не импортирует типы другого модуля — только отсюда. Так N×M связей
 * между агентами, операциями, источниками и адаптерами превращается в N.
 *
 * Расширять этот словарь следует неохотно: каждый тип здесь выведен из буквы ТЗ
 * или из измеренного факта в легаси, а не придуман про запас.
 */
export { CONTRACT_VERSION, CONTRACT_MAJOR, isCompatibleContract } from "./version.js";
export type { ContractVersion } from "./version.js";

export {
  decimal,
  isDecimalString,
  isIsoDate,
  isSha256,
  isoDate,
  money,
  roundingGranularity,
  sha256,
  unitCode,
} from "./primitives.js";
export type {
  CurrencyCode,
  DecimalString,
  IsoDate,
  IsoDateTime,
  Money,
  MoneyScale,
  Quantity,
  RoundingMode,
  Sha256,
  StatedAs,
  UnitCode,
} from "./primitives.js";

export { escapeFormulaInjection } from "./formula-injection.js";
export { normalizeRussian, russianIncludes } from "./russian-text.js";
export type { EscapeOptions } from "./formula-injection.js";

export { fromFormula, fromSource, isOcrUnconfirmed, isReviewDue } from "./provenance.js";
export type {
  Acquisition,
  FormulaTrace,
  Locator,
  Provenance,
  SourceRef,
  SourceStatus,
  Valued,
} from "./provenance.js";

export type {
  AccuracyMarker,
  CanonicalItem,
  CodeSystem,
  DocumentSource,
  MappingSummary,
  DeviationKind,
  Finding,
  GateSubject,
  Handoff,
  HandoffPriority,
  ItemCode,
  MappedPosition,
  OpenQuestion,
  PositionMapping,
  Severity,
  SubjectStatus,
} from "./domain.js";

export type {
  Artifact,
  CapabilityId,
  Completeness,
  Degradation,
  OperationBlock,
  OperationDefinition,
  OperationKind,
  OperationOutcome,
  OperationRef,
} from "./execution.js";
