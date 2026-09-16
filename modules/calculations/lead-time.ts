/**
 * Карта лид-таймов и стандарт трёх КП — правила 3.1 и 3.2 Марины.
 *
 * Источник — промпт `reference-system-new/Выход/Марина_Снаб_v9.6.txt`:
 *
 *   3.1. СТАНДАРТ 3+ КП — АБСОЛЮТНОЕ ПРАВИЛО. Минимум 3 КП на каждую
 *        позицию > 100 тыс. руб.
 *
 *   3.2. КАРТА ЛИД-ТАЙМОВ — ПЕРВЫЕ 4 ЧАСА НА ОБЪЕКТЕ (Такт 3): топ ТМЦ по
 *        стоимости → крайний срок заказа. Статусы: 🔴 ГОРИТ (≤14 дн) ·
 *        🟡 СРОЧНО (2–6 нед) · 🟢 ПЛАНОВЫЙ (>6 нед).
 *        Урок Школы №19: витражи на 250 млн с лид-таймом 12–16 недель видны
 *        за 4 часа — или теряются месяцы.
 *
 * ЧТО СЧИТАЕТСЯ, А ЧТО НАЗЫВАЕТСЯ
 *
 * Крайний срок заказа — арифметика: дата потребности минус лид-тайм. Дальше
 * важен не сам срок, а сколько до него осталось ОТ СЕГОДНЯ: позиция с
 * шестнадцатью неделями поставки может быть спокойной, если её заказывать
 * через полгода, и горящей, если через неделю.
 *
 * ЧЕТВЁРТЫЙ СТАТУС, КОТОРОГО НЕТ В ПРОТОКОЛЕ
 *
 * Протокол знает три цвета. Но срок заказа может быть УЖЕ ПРОШЕДШИМ, и это не
 * «горит» — это «поздно». Разговор при этом другой: не ускорять закупку, а
 * переносить срок или искать замену. Свести просрочку к красному значит
 * предложить невозможное и потерять неделю на попытках.
 */

/** Порог правила 3.1: три КП обязательны для позиций ДОРОЖЕ ста тысяч. */
/**
 * Порог стандарта трёх КП (3.1): позиция дороже — три предложения обязательны.
 *
 * Экспортируется, потому что о нём говорит не только карта лид-таймов: агент
 * снабжения перечисляет позиции, к которым правило применимо, и повторить число
 * у него значило бы завести второе место правды о пороге.
 */
export const QUOTE_THRESHOLD = 100_000;
const REQUIRED_QUOTES = 3;

/** Пороги статусов из протокола, в днях. */
const BURNING_DAYS = 14;
const URGENT_DAYS = 42;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProcurementItem {
  readonly name: string;
  readonly amount: string;
  /** Когда позиция нужна на объекте, ISO-дата. */
  readonly neededBy: string;
  readonly leadTimeWeeks: number;
  /** Сколько живых КП собрано. */
  readonly quotes: number;
}

export type LeadTimeStatus = "⚫ ПРОСРОЧЕН" | "🔴 ГОРИТ" | "🟡 СРОЧНО" | "🟢 ПЛАНОВЫЙ";

export interface LeadTimeRow {
  readonly name: string;
  readonly amount: string;
  readonly neededBy: string;
  readonly leadTimeWeeks: number;
  /** Крайний срок размещения заказа. */
  readonly orderBy: string;
  /** Дней до крайнего срока от сегодня. Отрицательное — срок прошёл. */
  readonly daysToOrder: number;
  readonly status: LeadTimeStatus;
  readonly quotes: number;
  /** Выполнен ли стандарт трёх КП для этой позиции. */
  readonly quotesOk: boolean;
}

export interface LeadTimeMap {
  /** Позиции по убыванию стоимости: дорогое видно первым. */
  readonly items: readonly LeadTimeRow[];
  /** Просроченные и горящие: с них начинается разговор. */
  readonly urgent: readonly LeadTimeRow[];
  /** Позиции, где не хватает КП по правилу 3.1. */
  readonly quotesMissing: readonly LeadTimeRow[];
}

function statusOf(days: number): LeadTimeStatus {
  if (days < 0) return "⚫ ПРОСРОЧЕН";
  if (days <= BURNING_DAYS) return "🔴 ГОРИТ";
  if (days <= URGENT_DAYS) return "🟡 СРОЧНО";
  return "🟢 ПЛАНОВЫЙ";
}

export function buildLeadTimeMap(
  items: readonly ProcurementItem[],
  today: string,
): LeadTimeMap {
  const now = Date.parse(`${today}T00:00:00Z`);

  const rows: LeadTimeRow[] = items.map((item) => {
    const needed = Date.parse(`${item.neededBy}T00:00:00Z`);
    const orderBy = needed - item.leadTimeWeeks * 7 * DAY_MS;
    const daysToOrder = Math.round((orderBy - now) / DAY_MS);

    return {
      name: item.name,
      amount: item.amount,
      neededBy: item.neededBy,
      leadTimeWeeks: item.leadTimeWeeks,
      orderBy: new Date(orderBy).toISOString().slice(0, 10),
      daysToOrder,
      status: statusOf(daysToOrder),
      quotes: item.quotes,
      // Порог строгий: «> 100 тыс.», ровно сто тысяч правилом не покрыто.
      quotesOk: Number(item.amount) <= QUOTE_THRESHOLD || item.quotes >= REQUIRED_QUOTES,
    };
  });

  const sorted = [...rows].sort((a, b) => Number(b.amount) - Number(a.amount));

  return {
    items: sorted,
    urgent: sorted.filter((row) => row.status === "⚫ ПРОСРОЧЕН" || row.status === "🔴 ГОРИТ"),
    quotesMissing: sorted.filter((row) => !row.quotesOk),
  };
}
