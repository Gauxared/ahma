/**
 * Доменные типы узкой талии (ADR-R-025).
 *
 * Все три выведены из легаси и ТЗ, а не изобретены:
 *  · `CanonicalItem` — из структуры Людмилы «Позиция ЛСР | Шифр ФЕР | Ресурс сметы
 *    | Номенклатура закупки» (ADR-R-013);
 *  · `Finding` — из ТЗ §5.2 «аномалии с указанием суммы влияния в рублях и
 *    основания расчёта»;
 *  · `Handoff` — из листа `Передачи_смежникам`, который есть у каждого из девяти
 *    агентских выходов реального кейса.
 */
import type { IsoDate, Money, Quantity, Sha256, UnitCode } from "./primitives.js";
import type { Valued } from "./provenance.js";

/**
 * Сметно-нормативные системы, дающие кодовый якорь канонизации (ADR-R-013).
 *
 * Список сверен с составом ФСНБ-2022: у ГЭСН и ФЕР есть отраслевые ветви —
 * монтаж (м), ремонт (р), пусконаладка (п), монтаж при ремонте (мр). Это не
 * варианты записи, а РАЗНЫЕ справочники: «ГЭСНм08-03-572-06» и
 * «ГЭСН08-03-572-06» указывают на разные нормы.
 */
export type CodeSystem =
  | "ГЭСН"
  | "ГЭСНм"
  | "ГЭСНмр"
  | "ГЭСНп"
  | "ГЭСНр"
  | "ФЕР"
  | "ФЕРм"
  | "ФЕРмр"
  | "ФЕРп"
  | "ФЕРр"
  | "ТЕР"
  | "ТЕРм"
  | "ТЕРмр"
  | "ТЕРп"
  | "ТЕРр"
  | "ФССЦ"
  | "ФССЦпг"
  /** Сметные цены ресурсов ФСНБ-2022: материалы, оборудование, машины. */
  | "ФСБЦ";

export interface ItemCode {
  readonly system: CodeSystem;
  readonly code: string;
}

/**
 * Вид работ или ресурс, приведённый к сопоставимому виду.
 *
 * Кодовый путь (`codes` не пуст) — детерминированный, без модели.
 * Текстовый путь (`codes` пуст) — сопоставление с уверенностью и обязательным
 * подтверждением человеком при неоднозначности.
 */
export interface CanonicalItem {
  readonly id: string;
  readonly name: string;
  readonly unit: UnitCode;
  readonly codes: readonly ItemCode[];
}

/**
 * Откуда взят документ. Нужен обоим модулям — разбору и канонизации, — поэтому
 * живёт в талии, а не в одном из них (ADR-R-025).
 */
export interface DocumentSource {
  readonly sourceId: string;
  readonly contentHash: Sha256;
  readonly sheet: string;
  readonly checkedAt: IsoDate;
}

/**
 * Позиция документа, приведённая (или не приведённая) к каноническому виду.
 *
 * Форма уточнена по реальным данным курганского комплекта:
 *  · `amount` обязателен — без итога позиция не была бы распознана;
 *  · `quantity` необязателен — в комплекте есть позиция без единицы измерения,
 *    а число без единицы не является величиной, и подставлять «шт» нельзя.
 */
export interface MappedPosition {
  readonly ordinal: string;
  readonly sourceName: string;
  /**
   * Сумма позиции. НЕОБЯЗАТЕЛЬНА — и это не послабление, а честность.
   *
   * Встречаются сметы без стоимостной части: шифры, наименования, единицы и
   * объёмы есть, денежных колонок нет (пакет «Устройство фундаментов линии
   * 720» — все десять ЛСР такие). Позиция там остаётся фактом, а её сумма
   * неизвестна. Ноль вместо неё сложился бы в сходимости и дал бы «расхождение
   * 0 ₽» на смете, о стоимости которой не известно ничего (ТЗ §9).
   */
  readonly amount?: Valued<Money>;
  readonly quantity?: Valued<Quantity>;
  readonly unitPrice?: Valued<Money>;
  readonly mapping: PositionMapping;
  /** Заполняется, если единицу не удалось привести к канонической. */
  readonly unitIssue?: string;
}

/** Сводка по сопоставлению — для отчётов и гейтов. */
export interface MappingSummary {
  readonly total: number;
  readonly byCode: number;
  readonly unmatched: number;
  readonly unitIssues: number;
}

/**
 * Исход сопоставления. `unmatched` — полноправный исход, а не ошибка:
 * ТЗ §5.2 требует выделять несопоставимые позиции отдельно и НЕ включать их
 * в расчёт разброса.
 */
export type PositionMapping =
  | { readonly kind: "by_code"; readonly item: CanonicalItem; readonly code: ItemCode }
  | {
      readonly kind: "by_text";
      readonly item: CanonicalItem;
      readonly confidence: number;
      readonly explanation: string;
      readonly confirmedByHuman: boolean;
    }
  | { readonly kind: "unmatched"; readonly reason: string };

/**
 * Маркер точности оценки (ТЗ §9, REQ-TZ-RESULT-02).
 *
 * Сквозное понятие: ТЗ требует его у КАЖДОЙ оценки, поэтому он живёт в талии,
 * а не в модуле расчёта. Поле `heuristic` обязательно и всегда истинно —
 * договор прямо запрещает представлять маркер как достигнутую точность.
 */
export interface AccuracyMarker {
  readonly range: string;
  readonly basis: string;
  readonly heuristic: true;
}

export type Severity = "critical" | "high" | "medium" | "info";

/** Классификация отклонений по ТЗ §5.2. */
export type DeviationKind =
  | "market_movement"
  | "technical_solution"
  | "quantity_error"
  | "rate_overstatement"
  | "double_count";

/** Наблюдение агента. Влияние — всегда в рублях с провенансом (ТЗ §5.2). */
export interface Finding {
  readonly id: string;
  readonly agentId: string;
  readonly severity: Severity;
  readonly statement: string;
  /** Основание: пункт нормы, расценка, расчёт. ТЗ §9 — без основания нет вывода. */
  readonly basis: string;
  readonly subject?: string;
  readonly deviation?: DeviationKind;
  readonly impact?: Valued<Money>;
  readonly openQuestion?: OpenQuestion;
}

/** ТЗ §9: у открытого вопроса всегда есть владелец и срок. */
export interface OpenQuestion {
  readonly question: string;
  readonly owner: string;
  readonly dueBy: string;
}

export type HandoffPriority = "critical" | "high" | "medium";

/** Передача смежнику — структура листа `Передачи_смежникам`. */
export interface Handoff {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly payload: string;
  readonly priority: HandoffPriority;
  /** Предмет, который передача блокирует или разблокирует: например «ВОР». */
  readonly gates?: readonly string[];
}

/**
 * Статус общего предмета, на котором стоят гейты (ADR-R-002, ADR-R-003).
 * В реальном кейсе Кургана ВОР был возвращён Людмиле на пересчёт со статусом 🔴,
 * а Ванычу адресовано «БЕЗ моего "ОК по ВОР" финмодель НЕ считать».
 */
export type SubjectStatus = "draft" | "returned" | "approved";

export interface GateSubject {
  readonly id: string;
  readonly status: SubjectStatus;
  readonly reason?: string;
  readonly returnedCount: number;
}
