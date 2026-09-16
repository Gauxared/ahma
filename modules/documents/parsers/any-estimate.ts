/**
 * РАЗБОР СМЕТЫ ЛЮБОЙ ВЁРСТКИ — ПО ШАПКЕ КОЛОНОК.
 *
 * ЗАЧЕМ. Владелец 09.09.2026: «нам нужно обрабатывать любые сметы в любых
 * форматах, а не только там где написано 421/пр». Разбор `grand-smeta.ts`
 * держится на форме приказа: ячейка A со словами «№ п/п» и подзаголовок
 * «всего». Замерено на клиентском корпусе: из ста настоящих книг по этой форме
 * составлены тридцать четыре. Остальные шестьдесят шесть — сметы контракта по
 * 44-ФЗ, ведомости объёмов, калькуляции своей вёрстки, расчёты НМЦК — до сих
 * пор не давали НИ ОДНОЙ позиции. Они доезжали до ролей текстом, и это лучше
 * молчания, но координаты, арифметики и сходимости у них не было.
 *
 * ЧЕМ ЭТОТ РАЗБОР ОТЛИЧАЕТСЯ ОТ ФОРМЕННОГО. Он не знает формы. Он ищет СТРОКУ
 * ШАПКИ — ту, где стоят слова колонок, — и по ним понимает, что где: где
 * наименование, где единица, где количество, цена и сумма. Так читает человек:
 * он не помнит номер приложения, он смотрит на заголовки.
 *
 * ПОЧЕМУ ВЫБОР КОЛОНОК ПРОВЕРЯЕТСЯ АРИФМЕТИКОЙ. Слово «стоимость» стоит и над
 * ценой единицы, и над суммой; «всего» — и над количеством с коэффициентами, и
 * над деньгами. Ошибиться колонкой значит выдать цену за сумму и занизить смету
 * в сотни раз — молча и правдоподобно. Поэтому среди колонок-кандидатов
 * выбирается та тройка, на которой СХОДИТСЯ САМ ДОКУМЕНТ: количество × цена =
 * сумма. Это не порог отбора, а способ прочесть шапку глазами документа: если
 * не сошлось ни на одной строке, разбор всё равно состоится — по шапке, — но
 * скажет об этом замечанием.
 *
 * ЧЕГО ЗДЕСЬ НЕ ДЕЛАЕТСЯ. Не выдумываются числа. Пустая денежная колонка
 * остаётся пустой (`undefined`), а не нулём: ТЗ §9. Итоговые строки не
 * отбрасываются — они помечаются итогами (`total-row.ts`), потому что число
 * итога нужно сходимости и человеку, а в своды идти не должно.
 */
import { Decimal } from "decimal.js";

import { cellNumber } from "../cell-number.js";
import { normalize, rowNumbers, type Sheet } from "../sheet.js";
import { isTotalRow } from "../total-row.js";
import { LsrParseError, parseItemCode } from "./grand-smeta.js";
import type { LsrDocument, LsrPosition, LsrSection, ParseIssue } from "./grand-smeta.js";

/** Роль колонки: что в ней стоит по мнению её заголовка. */
type Role = "ordinal" | "code" | "name" | "unit" | "quantity" | "unitCost" | "total";

/**
 * Заголовок → РОЛИ, а не одна роль. Порядок проверок значим.
 *
 * «Стоимость единицы» проверяется раньше «стоимости»: иначе цена станет суммой.
 * «Всего с учётом коэффициентов» — количество, а не деньги, и проверяется
 * раньше «всего». Так же читает человек: уточнение важнее общего слова.
 *
 * ПОЧЕМУ РОЛЕЙ МОЖЕТ БЫТЬ ДВЕ. Замерено 09.09.2026 на смете контракта объекта
 * «Джанга» (Дагестан): графа E — «Цена за единицу измерения, тыс.руб», графа F
 * — «Цена, тыс.руб с учетом Индекса фактической и прогнозной инфляции». Обе
 * начинаются словом «цена», и по слову их не различить: F — это СУММА позиции
 * (10 × 29,772 = 297,72), а по заголовку она «цена». Отдав такой графе одну
 * роль, разбор объявил бы смету «без стоимостной части» — 63 позиции с
 * объёмами и без единого рубля.
 *
 * Поэтому неоднозначный заголовок остаётся неоднозначным, а выбирает между
 * ролями АРИФМЕТИКА документа (`выбратьТройку`): количество × цена = сумма.
 *
 * `\b` не применяется нигде: в JavaScript граница слова считается по ASCII, и
 * после кириллицы её нет — правило молча не срабатывало бы (дефект встречался
 * в этом коде трижды). Границу задаёт «дальше не буква».
 */
function роли(header: string): readonly Role[] {
  const t = normalize(header).toLowerCase();
  if (t === "" || t.length > 120) return [];

  if (/^(№|n|номер)\s*(п\/п|пп|п\.п)?$|^поз(иция|\.)?$|^№$/u.test(t)) return ["ordinal"];
  if (/шифр|обоснование|код(?!\p{L})|норматив|расцен|источник цены/u.test(t)) return ["code"];

  /**
   * НАИМЕНОВАНИЕ ПРОВЕРЯЕТСЯ РАНЬШЕ ОБОСНОВАНИЯ — нет: обоснование выше, но в
   * узкой вёрстке (и в тексте PDF) обе графы стоят одной ячейкой
   * («Обоснование Наименование работ и затрат»). Разделить их нечем, а выбрать
   * надо: без наименования строка не позиция вовсе. Поэтому проверка ниже.
   */
  if (/наименование|описание|вид(ы)? работ|состав работ|работы и затраты|перечень/u.test(t)) return ["name"];
  if (/ед\.?\s*изм|единиц[аы] измерения|ед-ца|^ед\.?$/u.test(t)) return ["unit"];

  // «Всего с учётом коэффициентов» — КОЛИЧЕСТВО, а не деньги. В тексте PDF
  // подзаголовок обрывается на «всего с учетом», и полного слова ждать нельзя.
  if (/всего с уч[её]том/u.test(t)) return ["quantity"];
  if (/кол-?во|количество|объ[её]м/u.test(t)) return ["quantity"];

  if (/стоимость единицы|цена за ед|цена ед|сметная цена|на единицу(?! измерения в текущем)/u.test(t)) {
    return ["unitCost"];
  }

  if (/сумма|всего|итого/u.test(t)) return ["total"];

  // Голое «цена» или «стоимость» — неоднозначность, и признать её честнее,
  // чем угадать. Решает арифметика документа.
  if (/цена|стоимость/u.test(t)) return ["unitCost", "total"];

  return [];
}

/** Что нашлось в строке шапки: роль → колонки-кандидаты, слева направо. */
type Candidates = Map<Role, string[]>;

function индексКолонки(column: string): number {
  let index = 0;
  for (const character of column) index = index * 26 + (character.charCodeAt(0) - 64);
  return index;
}

/**
 * Разбор шапки строки — и той же строки, склеенной со следующей.
 *
 * Шапки сплошь двухэтажные: «Стоимость, руб.» сверху, «на единицу | всего»
 * снизу. Прочитанная порознь, верхняя строка объявила бы одной колонкой то, что
 * в документе две. Поэтому каждая строка пробуется и сама по себе, и склеенной
 * с нижней, а побеждает та проба, где ролей больше.
 */
function кандидаты(sheet: Sheet, rows: readonly number[]): Candidates {
  const этажи = rows.map((row) => sheet.rows.get(row)).filter((cells) => cells !== undefined);
  if (этажи.length === 0) return new Map();

  const колонки = new Set<string>(этажи.flatMap((cells) => [...cells.keys()]));
  const найдено: Candidates = new Map();

  for (const column of [...колонки].sort((a, b) => индексКолонки(a) - индексКолонки(b))) {
    // Этажи склеиваются СНИЗУ ВВЕРХ: уточнение («всего», «на единицу») стоит
    // под общим словом («Стоимость, руб.»), и решает именно оно.
    const текст = normalize([...этажи].reverse().map((cells) => cells.get(column) ?? "").join(" "));

    for (const r of роли(текст)) {
      const список = найдено.get(r) ?? [];
      список.push(column);
      найдено.set(r, список);
    }
  }

  return найдено;
}

/**
 * Сколько КОЛОНОК получили роль. Этим сравниваются пробы шапки.
 *
 * Считаются колонки, а не роли: голая «Цена» даёт сразу две роли, и по ролям
 * прайс-лист из двух граф («Наименование | Цена») набрал бы три и объявился
 * сметой. Колонок у него две, и сметой он не станет.
 */
function вес(c: Candidates): number {
  return new Set([...c.values()].flat()).size;
}

/**
 * ШАПКА ЛИ ЭТО. Требуется наименование и хотя бы одна числовая колонка, а всего
 * ролей — не меньше трёх.
 *
 * Двух ролей мало: «Наименование | Срок» есть у графика производства работ, и
 * график не смета. Трёх достаточно: «№ | Наименование | Стоимость» — это уже
 * смета контракта по 44-ФЗ, и её позиции нам нужны.
 */
function похожеНаШапку(c: Candidates): boolean {
  const числовая = c.has("quantity") || c.has("total") || c.has("unitCost");
  return c.has("name") && числовая && вес(c) >= 3;
}

interface Раскладка {
  readonly headerRow: number;
  readonly firstDataRow: number;
  readonly candidates: Candidates;
}

/**
 * Все подходящие шапки листа, СИЛЬНЕЙШАЯ ПЕРВОЙ.
 *
 * Возвращается список, а не одна: самая «богатая» шапка не всегда та, под
 * которой лежат строки. В сводном сметном расчёте Кургана широкая шапка стоит
 * в строке 30, а таблица начинается выше — выбрав только её, разбор нашёл бы
 * ноль позиций при живой таблице. Поэтому решает не вес, а результат: разбор
 * пробует шапки по очереди и берёт первую, под которой есть позиции.
 */
function найтиШапки(sheet: Sheet): readonly Раскладка[] {
  const numbers = rowNumbers(sheet);
  const найденные: { readonly раскладка: Раскладка; readonly вес: number }[] = [];

  /**
   * Шапка бывает МНОГОЭТАЖНОЙ. В книге это два этажа («Стоимость, руб.» над
   * «на единицу | всего»), в тексте PDF — до пяти: замерено на локальном
   * сметном расчёте кейса «Благоустройство», где «Количество», «Единица»,
   * «№ п/п | Обоснование Наименование работ и затрат» и «измерения | на
   * единицу | всего с учетом» стоят пятью отдельными строками.
   */
  const ЭТАЖЕЙ = 5;

  for (const [i, row] of numbers.entries()) {
    let лучшаяЗдесь: { readonly раскладка: Раскладка; readonly вес: number } | undefined;

    for (let этажей = 1; этажей <= ЭТАЖЕЙ; этажей += 1) {
      const окно = numbers.slice(i, i + этажей);
      if (окно.length < этажей) break;

      const c = кандидаты(sheet, окно);
      if (!похожеНаШапку(c)) continue;
      if (лучшаяЗдесь !== undefined && вес(c) <= лучшаяЗдесь.вес) continue;

      лучшаяЗдесь = {
        вес: вес(c),
        раскладка: {
          headerRow: row,
          firstDataRow: пропуститьНумерацию(sheet, окно[окно.length - 1] ?? row),
          candidates: c,
        },
      };
    }

    if (лучшаяЗдесь !== undefined) найденные.push(лучшаяЗдесь);
  }

  if (найденные.length === 0) {
    throw new LsrParseError(
      "в листе не найдена строка заголовков колонок (наименование и числовая колонка) — " +
        "таблица позиций не распознана ни по форме 421/пр, ни по шапке",
      sheet.name,
    );
  }

  // При равном весе выигрывает ВЕРХНЯЯ: ниже по листу встречаются повторы шапки
  // на новой странице, и данные надо брать с первой, иначе половина сметы
  // останется выше начала разбора.
  return [...найденные]
    .sort((left, right) => right.вес - left.вес || left.раскладка.headerRow - right.раскладка.headerRow)
    .map((найденная) => найденная.раскладка);
}

/**
 * Строка нумерации колонок (1, 2, 3 …) под шапкой — не позиция.
 *
 * Она выглядит как строка данных: числа в ячейках, непустое наименование.
 * Пропущенная, она стала бы позицией «2» стоимостью 5 ₽.
 */
function пропуститьНумерацию(sheet: Sheet, headerRow: number): number {
  for (const row of rowNumbers(sheet).filter((n) => n > headerRow && n <= headerRow + 3)) {
    const cells = sheet.rows.get(row);
    if (cells === undefined) continue;

    const values = [...cells.values()].map((value) => normalize(value)).filter((v) => v !== "");
    if (values.length >= 3 && values.every((value) => /^\d{1,2}$/u.test(value))) return row;

    return headerRow;
  }

  return headerRow;
}

/** Тройка денежных колонок, выбранная арифметикой документа. */
interface Тройка {
  readonly quantity: string | undefined;
  readonly unitCost: string | undefined;
  readonly total: string | undefined;
  /** На скольких строках количество × цена сошлось с суммой. */
  readonly сошлось: number;
  readonly проверено: number;
}

/** Сошлись ли количество × цена и сумма. Допуск — рубль либо полпроцента. */
function сходится(q: string, u: string, t: string): boolean {
  const произведение = new Decimal(q).times(u);
  const сумма = new Decimal(t);
  const расхождение = произведение.minus(сумма).abs();
  const допуск = Decimal.max(new Decimal(1), сумма.abs().times("0.005"));
  return расхождение.lessThanOrEqualTo(допуск);
}

/**
 * ВЫБОР ДЕНЕЖНЫХ КОЛОНОК АРИФМЕТИКОЙ САМОГО ДОКУМЕНТА.
 *
 * Кандидатов на «сумму» в широкой смете бывает четыре: базисная, текущая, с
 * НДС, «всего по позиции». Угадывать нельзя. Перебираются все тройки, и
 * побеждает та, на которой документ сходится чаще: смета — арифметический
 * документ, и её собственная арифметика знает про её колонки больше, чем мы.
 */
function выбратьТройку(sheet: Sheet, layout: Раскладка): Тройка {
  const q = layout.candidates.get("quantity") ?? [undefined];
  const u = layout.candidates.get("unitCost") ?? [undefined];
  const t = layout.candidates.get("total") ?? [undefined];
  const строки = rowNumbers(sheet).filter((row) => row > layout.firstDataRow);

  let лучшая: Тройка = {
    // Запасной выбор без арифметики: сумма — самая правая из денежных колонок,
    // количество и цена — самые левые. Так они стоят в бумажной смете.
    quantity: q[0],
    unitCost: u[0],
    total: t[t.length - 1],
    сошлось: 0,
    проверено: 0,
  };

  for (const quantity of q) {
    for (const unitCost of u) {
      for (const total of t) {
        if (quantity === undefined || unitCost === undefined || total === undefined) continue;
        if (unitCost === total || quantity === total || quantity === unitCost) continue;

        let сошлось = 0;
        let проверено = 0;

        for (const row of строки) {
          const cells = sheet.rows.get(row);
          if (cells === undefined) continue;

          const кол = cellNumber(cells.get(quantity));
          const цена = cellNumber(cells.get(unitCost));
          const сумма = cellNumber(cells.get(total));
          if (кол === undefined || цена === undefined || сумма === undefined) continue;

          проверено += 1;
          if (сходится(кол, цена, сумма)) сошлось += 1;
        }

        if (сошлось > лучшая.сошлось) лучшая = { quantity, unitCost, total, сошлось, проверено };
      }
    }
  }

  /**
   * ОДНА КОЛОНКА НЕ БЫВАЕТ И ЦЕНОЙ, И СУММОЙ. Так выходит у таблицы с
   * единственной денежной графой «Стоимость»: она неоднозначна, и запасной
   * выбор поставил бы её на оба места. Тогда цена позиции равнялась бы её
   * сумме — утверждение, которого в документе нет. Остаётся сумма: она
   * нужнее, и она же идёт в сходимость.
   */
  if (лучшая.unitCost !== undefined && лучшая.unitCost === лучшая.total) {
    return { ...лучшая, unitCost: undefined };
  }

  return лучшая;
}

/** Номер раздела из заголовка: «Раздел 2. Земляные работы» → «2». */
function номерРаздела(name: string, порядковый: number): string {
  const m = /^\s*(?:раздел|глава|подраздел)\s*№?\s*([\d.]+)/iu.exec(name);
  return m?.[1] ?? String(порядковый);
}

/**
 * Разбор листа ЛЮБОЙ вёрстки в тот же документ, что даёт форменный разбор.
 *
 * Результат намеренно того же типа: ниже по течению — сопоставление с
 * каталогом, сходимость, дубли, экраны. Второй тип документа заставил бы
 * продублировать их все, и они разошлись бы.
 */
export interface AnyEstimateOptions {
  /**
   * ТРЕБОВАТЬ, ЧТОБЫ АРИФМЕТИКА ДОКУМЕНТА ПОДТВЕРДИЛА ЧТЕНИЕ КОЛОНОК.
   *
   * У книги ячейка — это ячейка: что в ней написано, то и прочитано. У текста
   * PDF ячеек нет, границы колонок восстановлены по просветам, а сам текст
   * бывает распознан со сканом — и тогда «488 310,74» приходит как «488 3^0,74»,
   * а «2 612 950,83» как «2S0;32^877 020». Замерено на кейсе «Благоустройство»
   * 09.09.2026: разбор такого текста дал 334 «позиции» с объёмом 625905 там,
   * где в документе 6,25905, и без единого итога.
   *
   * ВЫДУМАННАЯ ЦИФРА ХУЖЕ ОТСУТСТВУЮЩЕЙ: она выглядит фактом. Поэтому там, где
   * ячеек нет, позиции признаются только если СМЕТА СОШЛАСЬ САМА С СОБОЙ —
   * количество × цена = сумма на её собственных строках. Не сошлась — разбора
   * нет, и документ идёт к ролям текстом и картинками, как шёл.
   */
  readonly требоватьАрифметику?: boolean;
}

/** Сколько строк должны сойтись, чтобы чтение колонок считалось подтверждённым. */
const ПОДТВЕРЖДЕНИЕ = { строк: 3, доля: 0.5 } as const;

export function parseAnyEstimate(sheet: Sheet, options: AnyEstimateOptions = {}): LsrDocument {
  let первая: unknown;

  // Шапок-кандидатов бывает несколько; берётся первая, под которой ЕСТЬ
  // позиции. Наружу уходит причина от САМОЙ СИЛЬНОЙ: она про ту таблицу,
  // которую человек и считает главной на листе.
  for (const layout of найтиШапки(sheet)) {
    try {
      return разобратьПо(sheet, layout, options);
    } catch (cause) {
      первая ??= cause;
    }
  }

  throw первая instanceof Error ? первая : new LsrParseError("таблица позиций не разобрана", sheet.name);
}

function разобратьПо(sheet: Sheet, layout: Раскладка, options: AnyEstimateOptions): LsrDocument {
  const тройка = выбратьТройку(sheet, layout);

  if (options.требоватьАрифметику === true) {
    const подтверждено =
      тройка.сошлось >= ПОДТВЕРЖДЕНИЕ.строк && тройка.сошлось >= тройка.проверено * ПОДТВЕРЖДЕНИЕ.доля;

    if (!подтверждено) {
      throw new LsrParseError(
        `таблица найдена, но арифметика её не подтвердила: количество × цена = сумма сошлось ` +
          `на ${тройка.сошлось} строках из ${тройка.проверено}. У документа без ячеек ` +
          "(текст PDF, распознанный скан) это значит, что колонки прочитаны неверно либо цифры " +
          "искажены распознаванием — позиции из такого чтения были бы выдуманными",
        sheet.name,
      );
    }
  }

  const nameColumn = layout.candidates.get("name")?.[0];
  if (nameColumn === undefined) throw new LsrParseError("колонка наименования не определена", sheet.name);

  const ordinalColumn = layout.candidates.get("ordinal")?.[0];
  const codeColumn = layout.candidates.get("code")?.[0];
  const unitColumn = layout.candidates.get("unit")?.[0];

  const issues: ParseIssue[] = [];
  const sections: LsrSection[] = [];
  let текущий: { number: string; name: string; row: number | undefined; positions: LsrPosition[]; declaredTotal: string | undefined } = {
    number: "1",
    name: "",
    row: undefined,
    positions: [],
    declaredTotal: undefined,
  };
  const закрыть = (): void => {
    if (текущий.positions.length > 0 || текущий.name !== "") {
      sections.push({
        number: текущий.number,
        name: текущий.name,
        positions: текущий.positions,
        declaredTotal: текущий.declaredTotal,
        row: текущий.row,
      });
    }
  };

  let ожидание: { readonly name: string; readonly row: number } | undefined;
  let declaredTotal: string | undefined;
  let declaredTotalRow: number | undefined;
  let порядковыйРаздела = 1;
  let порядковыйПозиции = 0;

  for (const row of rowNumbers(sheet).filter((n) => n > layout.firstDataRow)) {
    const cells = sheet.rows.get(row);
    if (cells === undefined) continue;

    const name = normalize(cells.get(nameColumn));
    const quantity = тройка.quantity === undefined ? undefined : cellNumber(cells.get(тройка.quantity));
    const unitCost = тройка.unitCost === undefined ? undefined : cellNumber(cells.get(тройка.unitCost));
    const total = тройка.total === undefined ? undefined : cellNumber(cells.get(тройка.total));
    const числаЕсть = quantity !== undefined || unitCost !== undefined || total !== undefined;

    if (name === "" && !числаЕсть) continue;

    /**
     * ИТОГ — не позиция, но и не мусор: его число забирает сходимость.
     * Итог раздела остаётся в разделе, последний итог листа становится итогом
     * документа. Порядок именно такой: «Всего по смете» стоит ниже всех
     * разделов, и последним оказывается он.
     */
    if (isTotalRow(name)) {
      if (total !== undefined) {
        текущий.declaredTotal = текущий.declaredTotal ?? total;
        declaredTotal = total;
        declaredTotalRow = row;
      }
      continue;
    }

    /**
     * Текст без единого числа — ВОЗМОЖНО заголовок раздела, а возможно проза:
     * примечание сметчика, подпись, перенос длинного наименования. Различает их
     * то, что идёт ДАЛЬШЕ: заголовок стоит перед позициями, проза — сама по
     * себе. Поэтому раздел не открывается сразу, а ждёт первой позиции под
     * собой. Без этого ожидания смета в тексте PDF дала 1432 «раздела» на 334
     * позиции — то есть разделами стали переносы строк.
     */
    if (name !== "" && !числаЕсть) {
      ожидание = { name, row };
      continue;
    }

    if (name === "") {
      // Числа без наименования — продолжение разорванной строки либо обрывок
      // раскладки PDF. Выдумывать им работу нельзя, потерять молча тоже.
      issues.push({ severity: "warning", message: "строка с числами без наименования — не разобрана", row });
      continue;
    }

    if (ожидание !== undefined) {
      закрыть();
      порядковыйРаздела += 1;
      текущий = {
        number: номерРаздела(ожидание.name, порядковыйРаздела),
        name: ожидание.name,
        row: ожидание.row,
        positions: [],
        declaredTotal: undefined,
      };
      ожидание = undefined;
    }

    порядковыйПозиции += 1;
    const basis = codeColumn === undefined ? "" : normalize(cells.get(codeColumn));

    текущий.positions.push({
      ordinal: (ordinalColumn === undefined ? "" : normalize(cells.get(ordinalColumn))) || String(порядковыйПозиции),
      code: parseItemCode(basis),
      basis,
      name,
      unit: unitColumn === undefined ? "" : normalize(cells.get(unitColumn)),
      quantity,
      unitCost,
      total,
      row,
    });
  }

  закрыть();

  const позиции = sections.flatMap((section) => section.positions);

  if (позиции.length === 0) {
    throw new LsrParseError(
      `шапка колонок найдена в строке ${layout.headerRow}, но ни одной строки со значениями под ней нет`,
      sheet.name,
    );
  }

  issues.push({
    severity: "warning",
    message:
      `форма 421/пр не распознана — таблица разобрана по шапке колонок (строка ${layout.headerRow}): ` +
      `наименование ${nameColumn}` +
      (тройка.quantity === undefined ? "" : `, количество ${тройка.quantity}`) +
      (тройка.unitCost === undefined ? "" : `, цена ${тройка.unitCost}`) +
      (тройка.total === undefined ? "" : `, сумма ${тройка.total}`),
    row: layout.headerRow,
  });

  if (тройка.проверено > 0) {
    issues.push({
      severity: "warning",
      message:
        `арифметика колонок: количество × цена = сумма сошлось на ${тройка.сошлось} строках из ${тройка.проверено} проверяемых`,
    });
  } else if (тройка.unitCost !== undefined && тройка.total !== undefined) {
    issues.push({
      severity: "warning",
      message: "арифметику колонок проверить не на чем: нет ни одной строки, где заполнены и количество, и цена, и сумма",
    });
  }

  return {
    form: "any-layout",
    sheet: sheet.name,
    totalColumn: тройка.total ?? "",
    quantityColumn: тройка.quantity,
    unitCostColumn: тройка.unitCost,
    sections,
    withoutPrices: позиции.every((position) => position.total === undefined),
    declaredTotal,
    declaredTotalRow,
    headerTotalThousands: undefined,
    issues,
  };
}
