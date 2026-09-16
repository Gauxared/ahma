/**
 * Техзаключение — продукт Денчика на такте 1.
 *
 * Источник — промпт `reference-system-new/Выход/Денчик_ГИП_v9.7.txt`:
 *
 *   ЧАСТЬ 2: «ТВОЯ ЗОНА (Такт 0–1 — ВХОД всей цепочки): техзаключение =
 *   нормпрофиль объекта + геометрия от осей + нагрузки/балансы + БЛОК
 *   ДОПУЩЕНИЙ». И: «ГРАНИЦА С ЛЮДМИЛОЙ: объём и геометрия — ты, цена и
 *   индекс — она. ВОР без твоего техзаключения = объёмы без инженерного
 *   обоснования».
 *
 *   ЧАСТЬ 1: «не выпускаешь ВОР — даёшь техзаключение ДЛЯ ВОР».
 *
 * ЧТО ЭТОТ МОДУЛЬ ДЕЛАЕТ, А ЧТО НЕТ
 *
 * Делает: реверс объёма линейных позиций (Д-7) и вывод о том, обоснованы ли
 * объёмы геометрией. Продукт — предмет `вор-геометрия` со статусом, который
 * протокол использует как гейт: пока он не `approved`, Людмила не считает.
 *
 * НЕ делает: нормпрофиль со статусами (Д-5, Д-6 — нужна нормбаза), геометрию
 * от осей (Д-1 — нужен разбор РД), нагрузки и балансы (нужны исходные данные
 * проекта). Всё это объявляется деградацией, а не умалчивается: режим
 * [БЕЗ БАЗЫ] промпта разрешает работать, но обязывает сказать.
 *
 * ПОЧЕМУ СТАТУС ВЫЧИСЛЯЕТСЯ, А НЕ СТАВИТСЯ
 *
 * В легаси «Статус ВОР = 🔴 возвращён» ставит человек по итогам чтения. Здесь
 * статус следует из найденного: есть блок с кратностью выше двух и нет
 * геометрии, чтобы его подтвердить, — значит возврат. Это то же решение, но
 * его нельзя забыть принять.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString } from "@contracts/index.js";

/**
 * Результат реверса объёма в форме, нужной техзаключению.
 *
 * Объявлен здесь целиком и НЕ импортируется из расчётного модуля: модули
 * разговаривают только узкой талией контрактов (ADR-R-025). Реверс считает
 * расчёт, отображение в эту форму делает композиционный корень.
 *
 * Следствие важнее формальности: техзаключение НИЧЕГО НЕ СЧИТАЕТ. Оно решает,
 * возвращать ли ВОР, по уже посчитанным числам. Заключение, заводящее
 * собственную арифметику, стало бы вторым источником правды о объёмах.
 */
export interface ReversalForOpinion {
  readonly table: string;
  readonly baseQuantity: string;
  readonly unit: string;
  readonly totalQuantity: string;
  /** Пусто — денежного веса нет: смета без стоимостной части. Объёмы при этом есть. */
  readonly totalAmount?: string | undefined;
  readonly flaggedAmount?: string | undefined;
  readonly assumption: string;
  readonly flagged: readonly { readonly ordinal: string; readonly multiple?: string | undefined }[];
}

export interface TechOpinionInput {
  readonly documentPath: string;
  /** Группы реверса, посчитанные расчётным модулем. */
  readonly groups: readonly ReversalForOpinion[];
  /** Сумма групп, где есть хоть один флаг. Считает расчёт, не заключение. */
  /** Пусто — денежного веса нет: в сметах отсутствует стоимостная часть. */
  readonly unjustifiedAmount?: string | undefined;
  /** Разобрана ли рабочая документация. Пока всегда `false`. */
  readonly hasDesignDocuments: boolean;
}

export interface TechFinding {
  readonly severity: "critical" | "high" | "medium" | "info";
  readonly statement: string;
  /** Основание: шифр, кратность, деньги. Без основания нет вывода (ТЗ §9). */
  readonly basis: string;
  readonly amount?: DecimalString;
}

export interface TechHandoff {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly payload: string;
  readonly priority: "critical" | "high" | "medium";
}

export interface TechOpinion {
  readonly documentPath: string;
  /** Предмет протокола, который производит Денчик. */
  readonly subject: "вор-геометрия";
  readonly status: "approved" | "returned";
  readonly findings: readonly TechFinding[];
  /** Сумма объёмов, не подтверждённых геометрией. */
  readonly unjustifiedAmount?: DecimalString | undefined;
  readonly assumptions: readonly string[];
  readonly degradations: readonly string[];
  readonly handoff: TechHandoff;
}

const NO_DESIGN_DOCS = "рабочая документация не разобрана: геометрия от осей недоступна";

export function buildTechOpinion(input: TechOpinionInput): TechOpinion {
  /**
   * Подозрительна группа, где ЕСТЬ отмеченные позиции, а не та, где деньги
   * больше нуля. Отбор по деньгам молча пропускал бы всю смету без цен: там
   * возвраты по кратности найдены, а взвесить их нечем.
   */
  const suspect = input.groups.filter((group) => group.flagged.length > 0);

  const findings: TechFinding[] = [];
  const assumptions: string[] = [];

  for (const group of suspect) {
    const flagged = group.flagged;

    findings.push({
      severity: "critical",
      statement:
        `Объёмы группы ${group.table} не подтверждены геометрией: у ${flagged.length} позиций ` +
        `кратность к базовой длине больше двух. Реверс объёма обязателен до фиксации ВОР (Д-7).`,
      basis:
        `${group.table}: база ${group.baseQuantity} ${group.unit}, блок ${group.totalQuantity} ${group.unit}; ` +
        flagged.map((position) => `поз. ${position.ordinal} ×${position.multiple}`).join(", "),
      // Денежный вес находки — только если он есть. `decimal("0")` объявил бы
      // возврат объёма безобидным.
      ...(group.totalAmount === undefined ? {} : { amount: decimal(group.totalAmount) }),
    });

    assumptions.push(group.assumption);
  }

  const degradations = input.hasDesignDocuments ? [] : [NO_DESIGN_DOCS];

  // Возврат — следствие найденного, а не отдельное решение: объёмы без
  // геометрического обоснования не имеют права идти в смету.
  const status = suspect.length > 0 ? "returned" : "approved";

  return {
    documentPath: input.documentPath,
    subject: "вор-геометрия",
    status,
    findings,
    ...(input.unjustifiedAmount === undefined
      ? {}
      : { unjustifiedAmount: decimal(input.unjustifiedAmount) }),
    assumptions,
    degradations,
    handoff: {
      from: "денчик",
      to: "людмила",
      subject: "вор-геометрия",
      payload:
        status === "approved"
          ? "Геометрических возражений по объёмам нет. Принимать к ВОР как есть."
          : `НЕ принимать к ВОР без геометрического обоснования: ${input.unjustifiedAmount} ₽ ` +
            `по ${suspect.length} группам. Требуется сверка объёмов с осями РД. ` +
            `Сметный эффект посчитать по обеим версиям — с блоком и без.`,
      priority: "critical",
    },
  };
}

/** Ноль как честный итог: реверс выполнен, флагов нет. */
export const NO_UNJUSTIFIED = decimal("0.00");
