/**
 * Структура затрат сметы — блок «в том числе» из шапки ЛСР.
 *
 * ЧТО ЭТО ОТКРЫВАЕТ
 *
 * Форма 421/пр несёт в шапке разложение сметной стоимости по элементам:
 *
 *   Сметная стоимость          14 198,88 тыс. руб.
 *   в том числе:
 *     строительных работ            0,00
 *     монтажных работ          11 086,18
 *     оборудования              2 222,04
 *     прочих затрат               890,67
 *
 * Разбор читал позиции и терял это разложение. Цена потери обнаружилась
 * замером против эталона: три вывода эталонного пакета из десяти опираются
 * ровно на эти четыре числа — «оборудование СОТ в смете 2,22 млн, а железа
 * проекта в нём нет», «монтаж СОТ 11,09 млн — реальный фронт слаботочки»,
 * «прочие затраты 890,67 тыс. — это задвоенная ПНР».
 *
 * ПОЧЕМУ ЭТО ЧИТАЕТСЯ ИЗ ШАПКИ, А НЕ СЧИТАЕТСЯ ПО ПОЗИЦИЯМ
 *
 * Потому что это утверждение ДОКУМЕНТА, а не наш вывод. Сложить позиции по
 * признаку «это оборудование» мы не можем: признака в строке нет, он в разделе
 * и в структуре расценки. А шапка говорит прямо, и её же читает человек.
 *
 * НУЛЬ И ОТСУТСТВИЕ РАЗЛИЧАЮТСЯ
 *
 * «строительных работ 0» — это утверждение: строительных работ в смете нет.
 * Отсутствие строки — это незнание. Первое приходит нулём, второе —
 * отсутствием поля (ТЗ §9).
 */
import { Decimal } from "decimal.js";

import type { Sheet } from "../sheet.js";

/** Элементы затрат, объявленные шапкой сметы. Все — в рублях. */
export interface CostElements {
  /** «Сметная стоимость» из шапки, приведённая к рублям. */
  readonly total?: string;
  readonly construction?: string;
  readonly assembly?: string;
  readonly equipment?: string;
  readonly other?: string;
  /** Средства на оплату труда рабочих. */
  readonly labour?: string;
  /** Материалы — только из блока итогов по разделам; в шапке их нет. */
  readonly materials?: string;
  readonly overhead?: string;
  readonly profit?: string;
  /**
   * «Оборудование, отсутствующее в ФРСН» — то, что обосновано конъюнктурой, а
   * не нормативом. На курганском объекте это криптошлюзы ViPNet, и эталонный
   * разбор называет их единственным «железом» в смете.
   */
  readonly outsideRegistry?: string;
  /** Откуда взято: шапка даёт тысячи, итоги по разделам — точные рубли. */
  readonly from: "шапка" | "итоги-разделов";
  /** Множитель шкалы: шапка номинирована в тыс. руб. */
  readonly scale: "thousands" | "rubles";
}

/**
 * Строки шапки, которые нас интересуют.
 *
 * Совпадение по вхождению, а не по равенству: у разных выгрузок это
 * «монтажных работ» и «монтажных работ, руб.», а требовать точного совпадения
 * значило бы читать одну смету и не читать другую.
 */
const LABELS: readonly { readonly key: keyof CostElements; readonly marker: RegExp }[] = [
  { key: "total", marker: /^сметная стоимость/iu },
  { key: "construction", marker: /^строительных работ/iu },
  { key: "assembly", marker: /^монтажных работ/iu },
  { key: "equipment", marker: /^оборудовани/iu },
  { key: "other", marker: /^прочих затрат/iu },
  { key: "labour", marker: /средства на оплату труда рабочих/iu },
];

/**
 * Где заканчивается шапка.
 *
 * Слова «оборудования» и «прочих затрат» встречаются и ниже — в наименованиях
 * разделов и позиций. Читать их оттуда значило бы принять стоимость одной
 * позиции за итог по элементу. Шапка кончается строкой заголовка таблицы.
 */
const HEADER_LIMIT = /№\s*п\/п/u;

function firstNumber(cells: readonly string[], from: number): string | undefined {
  for (let index = from; index < cells.length; index += 1) {
    const raw = (cells[index] ?? "").replace(/\s/gu, "").replace(",", ".");
    if (raw === "") continue;
    if (!/^-?\d+(?:\.\d+)?$/u.test(raw)) continue;
    return raw;
  }

  return undefined;
}

/**
 * Итоги по разделам — второй, ТОЧНЫЙ источник структуры затрат.
 *
 * Шапка номинирована в тысячах с двумя знаками: гранулярность 10 ₽, и
 * «2 222 040» вместо «2 222 036,29». Блок «Итоги по разделу» даёт рубли до
 * копейки, а сверх того — материалы, накладные, сметную прибыль и строку
 * «Оборудование, отсутствующее в ФРСН», которых в шапке нет вовсе.
 *
 * ДВЕ ЛОВУШКИ, ОБЕ УДВАИВАЮТ НЕЗАМЕТНО
 *
 * Первая: блоков итогов в смете НЕСКОЛЬКО — по одному на раздел («Итоги по
 * разделу 1») и один общий («Итоги по смете:»). Сложить все значит удвоить
 * смету. Берётся только общий: он и есть утверждение документа о себе.
 *
 * Вторая: внутри блока структура повторяется дважды — сначала «Всего прямые
 * затраты (справочно)» со своей разбивкой, потом настоящие строки работ со
 * своей. Материалы стоят и там, и там с одним и тем же числом.
 *
 * Обе ошибки невидимы: сумма остаётся правдоподобной. Первую я и допустил —
 * оборудование вышло 4 444 072,58 вместо 2 222 036,29, ровно вдвое.
 */
const SECTION_LABELS: readonly { readonly key: keyof CostElements; readonly marker: RegExp }[] = [
  { key: "construction", marker: /^строительные работы$/iu },
  { key: "assembly", marker: /^монтажные работы$/iu },
  { key: "equipment", marker: /^оборудование$/iu },
  { key: "other", marker: /^прочие затраты$/iu },
  { key: "materials", marker: /^материалы$/iu },
  { key: "overhead", marker: /^накладные расходы$/iu },
  { key: "profit", marker: /^сметная прибыль$/iu },
  { key: "outsideRegistry", marker: /^оборудование, отсутствующее в фрсн$/iu },
];

/** Начало справочного блока, чью разбивку складывать нельзя. */
const REFERENCE_ONLY = /\(справочно\)/iu;

function parseSectionTotals(sheet: Sheet): Map<keyof CostElements, Decimal> {
  const sums = new Map<keyof CostElements, Decimal>();
  let inSection = false;
  let skippingReference = false;

  for (const rowNumber of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const cells = sheet.rows.get(rowNumber)!;
    const ordered = [...cells.keys()].sort((a, b) => a.localeCompare(b)).map((key) => cells.get(key) ?? "");
    const label = (ordered[0] ?? "").trim();

    // Только общий блок сметы. Блоки разделов несут те же строки, и сложение
    // всех дало бы смету, удвоенную по числу разделов.
    if (/^итоги по смете/iu.test(label)) {
      inSection = true;
      skippingReference = false;
      continue;
    }

    if (!inSection) continue;

    if (/^всего по смете/iu.test(label)) {
      // «ВСЕГО по смете» закрывает перечень, но «справочно» под ней
      // продолжается — там и лежит «отсутствующее в ФРСН».
      skippingReference = false;
      continue;
    }

    if (REFERENCE_ONLY.test(label)) {
      // «Всего ФОТ (справочно)» и «Всего накладные (справочно)» — сами по себе
      // итоги, а не заголовки; пропускать надо только разбивку ПРЯМЫХ затрат.
      skippingReference = /прямые затраты/iu.test(label);
      continue;
    }

    const matched = SECTION_LABELS.find((entry) => entry.marker.test(label));
    if (matched === undefined) continue;

    // Настоящая строка работ закрывает справочную разбивку: дальше идут её
    // собственные материалы, и они-то и нужны. Без сброса флага пропускались
    // ОБА вхождения, и материалы выходили нулём — то есть «материалов нет»
    // вместо «материалы 265 427,50».
    if (matched.key === "assembly" || matched.key === "construction" || matched.key === "other") {
      skippingReference = false;
    }

    if (skippingReference && matched.key === "materials") continue;

    const value = firstNumber(ordered, 1);
    if (value === undefined) continue;

    sums.set(matched.key, (sums.get(matched.key) ?? new Decimal(0)).plus(value));
  }

  return sums;
}

export function parseCostElements(sheet: Sheet): CostElements {
  const numbers = [...sheet.rows.keys()].sort((a, b) => a - b);
  const found = new Map<keyof CostElements, string>();

  for (const rowNumber of numbers) {
    const cells = sheet.rows.get(rowNumber)!;
    const ordered = [...cells.keys()].sort((a, b) => a.localeCompare(b)).map((key) => cells.get(key) ?? "");
    const line = ordered.join(" ");

    if (HEADER_LIMIT.test(line)) break;

    for (const { key, marker } of LABELS) {
      if (found.has(key)) continue;

      const at = ordered.findIndex((cell) => marker.test(cell.trim()));
      if (at === -1) continue;

      const value = firstNumber(ordered, at + 1);
      if (value !== undefined) found.set(key, value);
    }
  }

  // Шкала: шапка формы 421/пр номинирована в тысячах, и «тыс.руб.» стоит
  // рядом со значением. Если единицы не нашлось — не домысливаем.
  const thousands = numbers.some((rowNumber) => {
    const cells = sheet.rows.get(rowNumber)!;
    return [...cells.values()].some((cell) => /тыс\.?\s*руб/iu.test(cell));
  });

  const multiplier = thousands ? new Decimal(1000) : new Decimal(1);

  const scaled = (key: keyof CostElements): string | undefined => {
    const raw = found.get(key);
    return raw === undefined ? undefined : new Decimal(raw).times(multiplier).toFixed(2);
  };

  const sections = parseSectionTotals(sheet);

  // Итоги по разделам ТОЧНЕЕ шапки и богаче её. Шапка остаётся источником
  // «Сметной стоимости» и запасным вариантом там, где блока итогов нет.
  const fromSections = (key: keyof CostElements): string | undefined => {
    const value = sections.get(key);
    return value === undefined ? undefined : value.toFixed(2);
  };

  const pick = (key: keyof CostElements): string | undefined =>
    fromSections(key) ?? scaled(key);

  return {
    ...(scaled("total") === undefined ? {} : { total: scaled("total")! }),
    ...(fromSections("materials") === undefined ? {} : { materials: fromSections("materials")! }),
    ...(fromSections("overhead") === undefined ? {} : { overhead: fromSections("overhead")! }),
    ...(fromSections("profit") === undefined ? {} : { profit: fromSections("profit")! }),
    ...(fromSections("outsideRegistry") === undefined
      ? {}
      : { outsideRegistry: fromSections("outsideRegistry")! }),
    from: sections.size > 0 ? ("итоги-разделов" as const) : ("шапка" as const),
    ...(pick("construction") === undefined ? {} : { construction: pick("construction")! }),
    ...(pick("assembly") === undefined ? {} : { assembly: pick("assembly")! }),
    ...(pick("equipment") === undefined ? {} : { equipment: pick("equipment")! }),
    ...(pick("other") === undefined ? {} : { other: pick("other")! }),
    ...(scaled("labour") === undefined ? {} : { labour: scaled("labour")! }),
    scale: thousands ? "thousands" : "rubles",
  };
}
