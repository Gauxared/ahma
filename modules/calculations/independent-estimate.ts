/**
 * Расчётно-аналитическая оценка — ТЗ §5.2.
 *
 * Дословно ТЗ: «Система формирует собственную оценку стоимости по объекту и по
 * каждой значимой позиции НЕЗАВИСИМО от полученных предложений подрядчиков».
 *
 * ЗАЧЕМ НЕЗАВИСИМОСТЬ
 *
 * Оценка, подсмотревшая в предложения, всегда окажется рядом с ними — и тем
 * самым подтвердит любую цену, включая завышенную. Она будет выглядеть
 * работающей ровно до того дня, когда все подрядчики ошибутся или сговорятся
 * одинаково. Именно тогда независимая оценка и нужна, и именно тогда её
 * не будет.
 *
 * КАК НЕЗАВИСИМОСТЬ ОБЕСПЕЧЕНА ЗДЕСЬ
 *
 * Три рубежа, и каждый нужен.
 *
 *  1. Предложения подрядчиков ПРИНИМАЮТСЯ аргументом, но не используются в
 *     расчёте вовсе. Поле существует затем, чтобы вызывающему не пришлось
 *     заводить второй путь передачи данных — и затем, чтобы тест мог менять
 *     его и требовать неизменной оценки.
 *  2. Наблюдение с источником «предложение подрядчика» ОТВЕРГАЕТСЯ. Попытка
 *     «обогатить» опорную базу предложениями — самый естественный способ
 *     потерять независимость, и выглядит он как улучшение полноты.
 *  3. Тест меняет только цены подрядчиков и требует совпадения оценки до
 *     копейки. Утечка — правка на одну строку, выглядящая как «давайте учтём
 *     рынок»; комментарий её не остановит, тест останавливает.
 *
 * ОДНО НАБЛЮДЕНИЕ — НЕ ОЦЕНКА РЫНКА
 *
 * Это цена одной сделки. Выдать её без оговорки значит назвать частный случай
 * нормой, поэтому такая оценка помечается как тонкая.
 *
 * ДИАПАЗОН, А НЕ ОДНО ЧИСЛО
 *
 * §5.2 требует «рекомендованный диапазон цены и целевую цену». Одно число
 * выглядит точнее, чем есть, и переговоры по нему ведут как по факту.
 */
import { Decimal } from "decimal.js";

import { decimal, unitCode } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const INDEPENDENT_ESTIMATE_FORMULA = "calculation.independent-estimate" as const;
export const INDEPENDENT_ESTIMATE_VERSION = 1 as const;

/**
 * Допустимые источники наблюдений.
 *
 * Перечень закрыт намеренно: новый источник добавляется осознанно, а не
 * приходит строкой из вызывающего кода. §5.2 называет ровно эти три —
 * обучающий массив исполнителя, опорная база и исторические данные заказчика.
 */
export type ObservationSource =
  | "обучающий массив"
  | "опорная база"
  | "история АПРИ"
  | "открытый прайс";

/**
 * Источники, которые НЕЛЬЗЯ принимать: они и есть предмет проверки.
 *
 * ГРАНИЦА ПРОХОДИТ НЕ ПО ТОМУ, КТО НАЗВАЛ ЦЕНУ, А ПО ТОМУ, ДЛЯ ЧЕГО
 *
 * §5.2 запрещает строить оценку на «полученных предложениях подрядчиков» —
 * то есть на офертах, поданных ПО ЭТОМУ ОБЪЕКТУ. Опубликованный прайс завода
 * запретом не покрыт и покрыт быть не должен: это рыночное наблюдение, доступное
 * кому угодно и существующее независимо от нашего тендера.
 *
 * Различие практическое. Оценка, построенная на офертах, подтвердит их же —
 * включая согласованно завышенные. Оценка, построенная на открытых прайсах,
 * останется внешней мерой, даже если один из тех же заводов подал оферту:
 * прайс он опубликовал не для нас.
 *
 * Стереть эту границу легко в обе стороны, и обе ошибки дорогие. Пустить оферты
 * в базу — потерять независимость. Запретить открытые прайсы — остаться без
 * опорной базы вовсе и не выдать оценку ни по одной позиции.
 */
const FORBIDDEN_SOURCES = ["предложение подрядчика", "оферта", "кп по объекту", "тендерное предложение"] as const;

export interface PriceObservation {
  readonly itemId: string;
  readonly unitPrice: string;
  readonly region: string;
  readonly period: string;
  readonly source: string;
}

export interface PriceRange {
  readonly low: DecimalString;
  readonly high: DecimalString;
}

export interface IndependentEstimate {
  readonly computable: boolean;
  readonly unitPrice?: DecimalString;
  readonly total?: DecimalString;
  readonly range: PriceRange;
  /** Источники, на которых построена оценка. §5.2 требует их называть. */
  readonly sources: readonly string[];
  /** Наблюдений было слишком мало для суждения о рынке. */
  readonly thin: boolean;
  readonly note: string;
  readonly reason?: string;
  readonly trace?: FormulaTrace;
}

function money(value: Decimal): DecimalString {
  return decimal(value.toFixed(2));
}

function medianOf(values: readonly Decimal[]): Decimal {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : sorted[middle - 1]!.plus(sorted[middle]!).dividedBy(2);
}

const EMPTY_RANGE: PriceRange = { low: decimal("0.00"), high: decimal("0.00") };

export function estimateIndependently(input: {
  readonly itemId: string;
  readonly quantity: string;
  readonly observations: readonly PriceObservation[];
  readonly region: string;
  readonly period: string;
  /**
   * Предложения подрядчиков. ПРИНИМАЮТСЯ И НЕ ИСПОЛЬЗУЮТСЯ.
   *
   * Поле существует, чтобы вызывающему не пришлось заводить второй путь
   * передачи данных, и чтобы тест мог менять его, требуя неизменной оценки.
   * Если однажды это поле начнёт влиять на результат, тест независимости
   * упадёт — в этом и смысл.
   */
  readonly contractorOffers?: readonly string[];
}): IndependentEstimate {
  // Рубеж второй: наблюдение от подрядчика в опорную базу не принимается.
  for (const observation of input.observations) {
    const source = observation.source.toLowerCase();
    if (FORBIDDEN_SOURCES.some((forbidden) => source.includes(forbidden))) {
      throw new Error(
        `Наблюдение из источника «${observation.source}» не может быть опорным: ` +
          "оценка §5.2 строится НЕЗАВИСИМО от предложений подрядчиков. " +
          "Пополнение базы предложениями выглядит улучшением полноты и является потерей независимости",
      );
    }
  }

  const byItem = input.observations.filter(
    (observation) => observation.itemId === input.itemId && observation.region === input.region,
  );

  if (byItem.length === 0) {
    return {
      computable: false,
      range: EMPTY_RANGE,
      sources: [],
      thin: false,
      note: "оценка не построена",
      reason:
        `нет наблюдений по позиции «${input.itemId}» в регионе «${input.region}»: ` +
        "оценка не выдумывается, иначе выдумка пойдёт в переговоры как факт (§9)",
    };
  }

  // Свой период предпочтителен, но соседние не отбрасываются: полное
  // отбрасывание оставило бы позицию без оценки при первом же расширении
  // горизонта. Пометка о заимствовании обязательна.
  const samePeriod = byItem.filter((observation) => observation.period === input.period);
  const used = samePeriod.length > 0 ? samePeriod : byItem;
  const borrowed = samePeriod.length === 0;

  const prices = used.map((observation) => new Decimal(observation.unitPrice));
  const median = medianOf(prices);
  const low = prices.reduce((min, price) => (price.lessThan(min) ? price : min), prices[0]!);
  const high = prices.reduce((max, price) => (price.greaterThan(max) ? price : max), prices[0]!);

  const total = median.times(input.quantity);
  const sources = [...new Set(used.map((observation) => observation.source))];

  const thin = used.length < 2;

  const note =
    [
      `наблюдений ${used.length}`,
      thin ? "ВНИМАНИЕ: одно наблюдение — это цена одной сделки, а не оценка рынка" : undefined,
      borrowed
        ? `наблюдений периода «${input.period}» нет, взяты наблюдения другого периода — требует проверки`
        : undefined,
    ]
      .filter((part) => part !== undefined)
      .join("; ") || "оценка построена";

  const inputs: Record<string, DecimalString> = { quantity: decimal(input.quantity) };
  used.forEach((observation, index) => {
    inputs[`${observation.source}#${index + 1}`] = decimal(new Decimal(observation.unitPrice).toFixed(2));
  });

  return {
    computable: true,
    unitPrice: money(median),
    total: money(total),
    range: { low: money(low), high: money(high) },
    sources,
    thin,
    note,
    trace: {
      formulaId: INDEPENDENT_ESTIMATE_FORMULA,
      formulaVersion: INDEPENDENT_ESTIMATE_VERSION,
      inputs,
      output: money(total),
      unit: unitCode("RUB"),
      rounding: "half-up",
    },
  };
}
