/**
 * Сравнение предложений — ТЗ §10, четвёртая из четырёх договорных выгрузок:
 *
 *   «Сравнение предложений (Excel) | Сопоставимые позиции, цены по каждому
 *    предложению подрядчика, разброс, оценка Системы, отклонения и аномалии»
 *
 * ГЛАВНОЕ ТРЕБОВАНИЕ — СЛОВО «СОПОСТАВИМЫЕ»
 *
 * §5.2 говорит прямо: несопоставленные позиции в расчёт разброса не входят.
 * В выгрузке это означает, что подрядчик, не давший цену, оставляет ПУСТУЮ
 * ячейку, а не ноль. Ноль в таблице сравнения читается как «предложил
 * бесплатно» и занижает и минимум, и разброс — то есть искажает ровно то число,
 * ради которого таблицу и строят.
 *
 * ОЦЕНКА СИСТЕМЫ — ОТДЕЛЬНЫЙ СТОЛБЕЦ
 *
 * Смешать её с ценами подрядчиков значит позволить ей влиять на разброс. §5.2
 * требует обратного: оценка сравнивается С разбросом, а не участвует в нём.
 *
 * ВЫГРУЗКА НИЧЕГО НЕ СЧИТАЕТ
 *
 * Разброс, отклонение и аномалии приходят ПОСЧИТАННЫМИ. Дай выгрузке считать
 * самой — и Excel разойдётся с результатом Проверки, а защищать перед
 * заказчиком придётся два разных числа. Поэтому входные типы описаны здесь
 * СВОИМИ словами и не импортируются из расчётного модуля: выгрузка зависит от
 * формы данных, а не от того, кто их посчитал (ADR-R-025).
 *
 * ПОРЯДОК КОЛОНОК ОБЩИЙ ДЛЯ ВСЕХ СТРОК
 *
 * Подрядчики собираются в единый упорядоченный список, и каждая строка
 * заполняется по нему. Иначе цена одного подрядчика окажется в колонке
 * другого — ошибка, которую в таблице на двадцать позиций никто не заметит.
 */
import { escapeFormulaInjection } from "@contracts/index.js";
import type { DecimalString } from "@contracts/index.js";

import type { Cell, CellStyle, WorkbookSpec } from "./calculation-workbook.js";

export const OFFERS_TEMPLATE_VERSION = "offers-comparison-1" as const;

export interface OfferCell {
  readonly contractor: string;
  /** Отсутствует, когда подрядчик цену не дал. Пустая ячейка, а не ноль. */
  readonly amount?: string;
}

/** Разброс, посчитанный расчётным модулем. Здесь только форма. */
export interface SpreadForExport {
  readonly min?: string;
  readonly max?: string;
  readonly median?: string;
  readonly ratio?: string;
  readonly comparable: number;
  readonly unmatched: readonly { readonly source: string; readonly reason: string }[];
  readonly anomalies: readonly {
    readonly source: string;
    readonly amount: string;
    readonly impact: string;
    readonly ratio: string;
  }[];
  readonly computable: boolean;
  readonly reason?: string;
  readonly note: string;
}

export interface DeviationForExport {
  readonly absolute: string;
  readonly relative?: string;
}

export interface ComparisonPosition {
  readonly name: string;
  readonly unit: string;
  readonly quantity: string;
  readonly offers: readonly OfferCell[];
  readonly systemEstimate?: string;
  readonly spread: SpreadForExport;
  readonly deviation?: DeviationForExport;
}

export interface OffersComparison extends WorkbookSpec {
  /** Единый порядок подрядчиков, по которому построены все строки. */
  readonly contractors: readonly string[];
  readonly positions: readonly ComparisonPosition[];
}

const EMPTY: Cell = { kind: "empty" };

function text(value: string, style?: CellStyle): Cell {
  const base = { kind: "text" as const, value: escapeFormulaInjection(value) };
  return style === undefined ? base : { ...base, style };
}

function number(value: string, marker: string, style?: CellStyle): Cell {
  const base = { kind: "number" as const, value: value as DecimalString, marker };
  return style === undefined ? base : { ...base, style };
}

export function buildOffersComparison(input: {
  readonly objectName: string;
  readonly positions: readonly ComparisonPosition[];
  readonly generatorVersion?: string;
  readonly producedAt?: string;
  readonly artifactId?: string;
}): OffersComparison {
  // Единый порядок: подрядчик, встретившийся хоть в одной позиции, получает
  // колонку во всех. Сортировка убирает зависимость от порядка загрузки КП.
  const contractors = [
    ...new Set(input.positions.flatMap((position) => position.offers.map((offer) => offer.contractor))),
  ].sort((a, b) => a.localeCompare(b, "ru"));

  const header: Cell[] = [
    text("Позиция", "header"),
    text("Ед. изм.", "header"),
    text("Количество", "header"),
    ...contractors.map((contractor) => text(contractor, "header")),
    text("Минимум", "header"),
    text("Медиана", "header"),
    text("Максимум", "header"),
    text("Разброс, макс/мин", "header"),
    text("Оценка Системы", "header"),
    text("Отклонение медианы от оценки", "header"),
    text("Примечание", "header"),
  ];

  const rows: Cell[][] = [header];

  for (const position of input.positions) {
    const byContractor = new Map(position.offers.map((offer) => [offer.contractor, offer.amount]));

    const priceCells = contractors.map((contractor) => {
      const amount = byContractor.get(contractor);
      // Пустая ячейка, а не ноль: ноль читается как «предложил бесплатно».
      return amount === undefined ? EMPTY : number(amount, `предложение: ${contractor}`);
    });

    const spread = position.spread;

    rows.push([
      text(position.name),
      text(position.unit),
      text(position.quantity),
      ...priceCells,
      spread.min === undefined ? EMPTY : number(spread.min, "разброс: минимум по сопоставимым"),
      spread.median === undefined ? EMPTY : number(spread.median, "разброс: медиана по сопоставимым"),
      spread.max === undefined ? EMPTY : number(spread.max, "разброс: максимум по сопоставимым"),
      spread.ratio === undefined ? EMPTY : number(spread.ratio, "разброс: максимум / минимум"),
      position.systemEstimate === undefined
        ? EMPTY
        : number(position.systemEstimate, "оценка Системы (в разброс не входит)"),
      position.deviation?.relative === undefined
        ? EMPTY
        : number(position.deviation.relative, "отклонение медианы от оценки Системы"),
      text(spread.computable ? spread.note : `${spread.reason ?? "разброс не вычислен"}; ${spread.note}`, "note"),
    ]);
  }

  // Аномалии — отдельный блок: §5.2 требует называть их с суммой влияния, а не
  // растворять в показателе.
  const anomalies = input.positions.flatMap((position) =>
    position.spread.anomalies.map((anomaly) => ({ position: position.name, anomaly })),
  );

  if (anomalies.length > 0) {
    rows.push([EMPTY]);
    rows.push([text("АНОМАЛИИ (§5.2): предложения, отличающиеся от медианы в разы", "header")]);
    rows.push([
      text("Позиция", "header"),
      text("Подрядчик", "header"),
      text("Цена", "header"),
      text("Влияние, ₽", "header"),
      text("Кратность медиане", "header"),
    ]);

    for (const { position, anomaly } of anomalies) {
      rows.push([
        text(position),
        text(anomaly.source),
        number(anomaly.amount, `предложение: ${anomaly.source}`),
        number(anomaly.impact, "отличие от медианы в рублях"),
        number(anomaly.ratio, "цена / медиана"),
      ]);
    }
  }

  // Несопоставленные называются поимённо: исход, о котором не сказано, — то же
  // самое, что исход, которого не было.
  const unmatched = input.positions.flatMap((position) =>
    position.spread.unmatched.map((item) => ({ position: position.name, item })),
  );

  if (unmatched.length > 0) {
    rows.push([EMPTY]);
    rows.push([text("НЕСОПОСТАВЛЕННЫЕ (§5.2): в расчёт разброса НЕ входят", "header")]);

    for (const { position, item } of unmatched) {
      rows.push([text(position), text(item.source), text(item.reason, "note")]);
    }
  }

  return {
    sheets: [
      {
        name: "Сравнение предложений",
        columnWidths: [42, 10, 14, ...contractors.map(() => 18), 16, 16, 16, 18, 18, 22, 52],
        rows,
      },
    ],
    metadata: {
      templateVersion: OFFERS_TEMPLATE_VERSION,
      generatorVersion: input.generatorVersion ?? "не указана",
      artifactId: input.artifactId ?? "не указан",
      inputHashes: [],
      producedAt: input.producedAt ?? "не указано",
    },
    contractors,
    positions: input.positions,
  };
}
