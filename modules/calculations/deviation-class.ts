/**
 * Классификация отклонений — ТЗ §5.2.
 *
 * Дословно: «Классификация выявленных отклонений: рыночное движение цен,
 * особенность технического решения, ошибка в объёмах, завышение расценки,
 * двойной учёт».
 *
 * ЗАЧЕМ КЛАССИФИКАЦИЯ, А НЕ ПРОСТО ЧИСЛО
 *
 * «Дороже оценки на 3 млн» не говорит, что делать. Пять категорий ТЗ — это
 * пять РАЗНЫХ следующих шагов:
 *
 *   рыночное движение   → обновить опорную базу, спорить не о чем;
 *   техническое решение → проверить, нужно ли оно; спор с проектировщиком;
 *   ошибка в объёмах    → вернуть подрядчику пересчёт, спор арифметический;
 *   завышение расценки  → переговоры о цене;
 *   двойной учёт        → снять позицию целиком, спор о факте.
 *
 * Отклонение без категории — работа, переложенная обратно на человека.
 *
 * КАТЕГОРИЯ ВЫВОДИТСЯ ИЗ ПРИЗНАКОВ, А НЕ УГАДЫВАЕТСЯ
 *
 * Классификатор смотрит на измеренное: совпал ли объём, есть ли повтор
 * позиции, двигалась ли база, объявлен ли иной состав работ. Где признаков не
 * хватает, категория НЕ назначается: угаданная категория хуже отсутствующей,
 * потому что по ней пойдут в переговоры. «Не классифицировано» — полноправный
 * исход, как и «не сопоставлено» в §5.2.
 *
 * СУММА ВЛИЯНИЯ СЧИТАЕТСЯ ВСЕГДА
 *
 * §5.2 требует её отдельно от классификации: «выделение аномалий с указанием
 * суммы влияния в рублях». Сумма известна и тогда, когда причина — нет.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/** Пять категорий §5.2 плюс три служебных исхода. */
export type DeviationCategory =
  | "рыночное движение цен"
  | "особенность технического решения"
  | "ошибка в объёмах"
  | "завышение расценки"
  | "двойной учёт"
  | "отклонения нет"
  | "предложение ниже оценки"
  | "не классифицировано";

export interface DeviationInput {
  readonly itemId: string;
  readonly estimateUnitPrice: string;
  readonly offerUnitPrice: string;
  readonly estimateQuantity: string;
  readonly offerQuantity: string;
  /** Индекс движения цен за период, если он измерен. `1.10` — плюс 10%. */
  readonly marketIndex?: string;
  /** Чем состав работ отличается, если это объявлено предложением. */
  readonly compositionDiffers?: string;
  /** Ссылка на позицию, которую эта дублирует. */
  readonly duplicateOf?: string;
}

export interface ClassifiedDeviation {
  readonly itemId: string;
  readonly category: DeviationCategory;
  /** Сумма влияния в рублях со знаком: экономия отрицательна. */
  readonly impact: DecimalString;
  readonly basis: string;
  readonly remedy: string;
}

/**
 * Насколько цена может превысить объяснённую индексом, оставаясь «рынком».
 *
 * Индекс измерен приблизительно, и требовать совпадения до копейки значило бы
 * записывать в завышение любое округление. Пять процентов — запас на точность
 * самого индекса, а не на аппетит подрядчика.
 */
const MARKET_TOLERANCE = new Decimal("0.05");

function money(value: Decimal): DecimalString {
  return decimal(value.toFixed(2));
}

export function classifyDeviation(input: DeviationInput): ClassifiedDeviation {
  const estimatePrice = new Decimal(input.estimateUnitPrice);
  const offerPrice = new Decimal(input.offerUnitPrice);
  const estimateQuantity = new Decimal(input.estimateQuantity);
  const offerQuantity = new Decimal(input.offerQuantity);

  const estimateTotal = estimatePrice.times(estimateQuantity);
  const offerTotal = offerPrice.times(offerQuantity);
  const impact = money(offerTotal.minus(estimateTotal));

  const priceDiffers = !offerPrice.equals(estimatePrice);
  const quantityDiffers = !offerQuantity.equals(estimateQuantity);

  const of = (
    category: DeviationCategory,
    basis: string,
    remedy: string,
  ): ClassifiedDeviation => ({ itemId: input.itemId, category, impact, basis, remedy });

  // Двойной учёт перевешивает остальное: позиция, учтённая дважды, не
  // становится «завышением расценки» оттого, что и цена в ней завышена.
  // Сначала снимают дубль, потом обсуждают цену оставшейся.
  if (input.duplicateOf !== undefined) {
    return of(
      "двойной учёт",
      `позиция дублирует ${input.duplicateOf}: одна и та же работа учтена в предложении дважды`,
      "снять позицию целиком из предложения; спор о факте, а не о цене",
    );
  }

  if (!priceDiffers && !quantityDiffers) {
    return of(
      "отклонения нет",
      "цена и объём совпали с расчётно-аналитической оценкой",
      "действий не требуется",
    );
  }

  if (offerTotal.lessThan(estimateTotal)) {
    // Экономия — не нарушение, но и не молчание: цена ниже оценки бывает и
    // признаком недооценённого объёма работ подрядчиком.
    return of(
      "предложение ниже оценки",
      `предложение дешевле оценки на ${money(estimateTotal.minus(offerTotal))} ₽`,
      "проверить полноту состава работ: цена ниже оценки бывает признаком недоучтённого объёма",
    );
  }

  // Иной состав работ объявлен предложением — это объяснение, а не догадка,
  // и оно перевешивает ценовые признаки.
  if (input.compositionDiffers !== undefined) {
    return of(
      "особенность технического решения",
      `состав работ отличается: ${input.compositionDiffers}`,
      "проверить с проектировщиком, требуется ли это решение; при отсутствии требования — вернуть к проектному",
    );
  }

  if (quantityDiffers && !priceDiffers) {
    return of(
      "ошибка в объёмах",
      `цена за единицу совпала (${input.estimateUnitPrice} ₽), объём разошёлся: ` +
        `${input.estimateQuantity} против ${input.offerQuantity}`,
      "вернуть подрядчику пересчёт объёма; спор арифметический, а не переговорный",
    );
  }

  if (priceDiffers && !quantityDiffers) {
    if (input.marketIndex !== undefined) {
      const explained = estimatePrice.times(input.marketIndex);
      const ceiling = explained.times(new Decimal(1).plus(MARKET_TOLERANCE));

      if (!offerPrice.greaterThan(ceiling)) {
        return of(
          "рыночное движение цен",
          `рост цены объясняется индексом ${input.marketIndex}: ` +
            `оценка ${input.estimateUnitPrice} ₽ × ${input.marketIndex} = ${money(explained)} ₽, ` +
            `предложено ${input.offerUnitPrice} ₽`,
          "обновить опорную базу по индексу; предмета для спора нет",
        );
      }

      return of(
        "завышение расценки",
        `индекс ${input.marketIndex} объясняет цену до ${money(explained)} ₽, ` +
          `предложено ${input.offerUnitPrice} ₽ — сверх объяснённого`,
        "переговоры о цене: рыночным движением превышение не объясняется",
      );
    }

    return of(
      "завышение расценки",
      `объём совпал (${input.estimateQuantity}), цена выше оценки: ` +
        `${input.offerUnitPrice} ₽ против ${input.estimateUnitPrice} ₽`,
      "переговоры о цене со ссылкой на расчётно-аналитическую оценку и её источники",
    );
  }

  // Разошлось и то и другое, объяснений нет. Категорию можно только угадать,
  // а угаданная хуже отсутствующей: по ней пойдут в переговоры.
  return of(
    "не классифицировано",
    `разошлись и цена, и объём (${input.estimateUnitPrice} → ${input.offerUnitPrice} ₽, ` +
      `${input.estimateQuantity} → ${input.offerQuantity}); признаков для категории недостаточно`,
    "запросить у подрядчика расшифровку позиции: без неё причина отклонения не определяется",
  );
}
