/**
 * Реверс объёма линейных позиций — правило Д-7 Денчика.
 *
 * Источник — промпт `reference-system-new/Выход/Денчик_ГИП_v9.7.txt`,
 * ЧАСТЬ 8, КЕЙС: Курган:
 *
 *   «Крупная линейная монтажная позиция (провода, кабель, сети, трубы) →
 *    обязательный реверс объёма: сметный объём ÷ геометрия РД.
 *    Кратность >2 → стоп-флаг 🔴, возврат позиции.
 *    Зачем: приём дал 64,7 млн находки»
 *
 * ЧЕМ ЭТО ЛУЧШЕ ОРИГИНАЛА
 *
 * В легаси реверс требует геометрии из рабочей документации: инженер открывает
 * чертёж, считает длину от осей и делит на неё сметный объём. Это ручная работа
 * на каждую позицию, и она делается выборочно — по подозрению.
 *
 * Здесь базовая длина берётся ИЗ САМОЙ СМЕТЫ: геометрия объекта — это тот
 * размер, который ПОВТОРЯЕТСЯ. На курганском ЭОМ 15.24 км стоит у четырёх
 * позиций, а остальные оказываются её кратными: 30.48 · 45.72 · 60.96 —
 * двойка, тройка, четвёрка.
 *
 * БАЗА — САМОЕ ЧАСТОЕ ЗНАЧЕНИЕ, А НЕ НАИМЕНЬШЕЕ. Первая версия брала минимум,
 * и на курганских данных им оказались короткие участки по 0.12 км: кратности
 * выросли до сотен (×127, ×508), а в блок попали шесть посторонних позиций.
 * Расхождение с эталонным приёмом составило 533 524.90 ₽ и 1.92 км — ровно эти
 * шесть. Повторяющийся размер — это измеренная длина объекта; одиночный
 * короткий участок — частный случай, и мерить им нельзя.
 *
 * Проверка становится сплошной и не требует чертежа. Чертёж по-прежнему нужен,
 * чтобы подтвердить саму базу, — и это записано в допущениях, а не умолчано:
 * найденная база остаётся ДОПУЩЕНИЕМ до сверки с осями (правило Д-1).
 *
 * ГРУППИРОВКА ПО ТАБЛИЦЕ НОРМ — НЕ ДЕТАЛЬ, А УСЛОВИЕ ОСМЫСЛЕННОСТИ
 *
 * Реверс считается ВНУТРИ однородной группы работ. Первая версия складывала
 * все линейные позиции сметы в одну кучу, и базой оказалась медная шина
 * 0.002 — кратности вышли в тысячах, флаги встали на всём. Ошибка нашлась на
 * настоящих данных за один прогон.
 *
 * Однородность задаёт таблица норм: `ГЭСНм20-03-035-01` и `…-03` — разные
 * расценки одной таблицы `ГЭСНм20-03-035`, то есть один вид работ. Шина и
 * кабельный короб живут в других таблицах и в реверс этой группы не входят.
 *
 * ПОЧЕМУ ФЛАГИ И ИТОГ — РАЗНЫЕ ЧИСЛА
 *
 * Кратность указывает, ГДЕ искать вставку. Но обоснования нет у ВСЕЙ группы:
 * без геометрии РД не подтверждён ни один метр. Поэтому отчёт несёт оба числа —
 * сумму по флагам и сумму по блоку, — и путать их нельзя. Эталонный выход
 * курганского приёма называет необоснованным именно блок целиком.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/**
 * Единицы, для которых реверс объёма имеет смысл, и ИХ МАСШТАБ В МЕТРАХ.
 *
 * МАСШТАБ ЗДЕСЬ НЕ УКРАШЕНИЕ. Раньше все эти единицы лежали в одном множестве
 * как равные, и объёмы сравнивались числом к числу. Но расценки ГЭСН на
 * трубопроводы и кабель нормируются НА 100 МЕТРОВ, а участки дорог — на
 * километры: в одной таблице норм рядом стоят «1,5» (сто метров) и «150» (метр),
 * и это ОДНА И ТА ЖЕ длина.
 *
 * Что получалось. Базой группы становилось меньшее число, а позиция в другой
 * единице давала кратность 100 — то есть флаг «объём завышен стократно» там,
 * где завышения нет. И наоборот: если базой оказывалась позиция в «100 м»,
 * настоящая двукратная вставка тонула в дроби 0,02 и в реверс не входила
 * вовсе. Оба исхода молчаливые: первый обвиняет подрядчика зря, второй прощает
 * ему лишние метры.
 */
const LINEAR_UNITS = new Map<string, number>([
  ["м", 1],
  ["пог.м", 1],
  ["пог. м", 1],
  ["п.м", 1],
  ["м.п.", 1],
  ["100 м", 100],
  ["1000 м", 1000],
  ["км", 1000],
]);

/** Масштаб единицы в метрах; `undefined` — единица не линейная. */
function масштаб(unit: string): number | undefined {
  return LINEAR_UNITS.get(unit.trim().toLowerCase());
}

/** Длина позиции В МЕТРАХ: объём, приведённый масштабом своей единицы. */
function вМетрах(position: LinearPosition): Decimal {
  return new Decimal(position.quantity!).times(масштаб(position.unit) ?? 1);
}

/**
 * Допуск при делении. Объёмы в сметах записаны с двумя знаками, поэтому
 * кратность 45.72 / 15.24 = 3.0000 попадает точно, но запас нужен на случай
 * округления источника.
 */
const TOLERANCE = new Decimal("0.005");

/** Порог из Д-7: кратность БОЛЬШЕ двух — стоп-флаг. */
const FLAG_ABOVE = 2;

export const VOLUME_REVERSAL_FORMULA = "calculation.volume-reversal" as const;
export const VOLUME_REVERSAL_VERSION = 1 as const;

export interface LinearPosition {
  readonly ordinal: string;
  readonly basis: string;
  readonly name: string;
  readonly unit: string;
  readonly quantity?: string | undefined;
  /**
   * Сумма позиции. НЕОБЯЗАТЕЛЬНА: обратный счёт — про ОБЪЁМЫ, а не про деньги.
   * Смета без стоимостной части проверяется этим счётом в первую очередь: у
   * неё объёмы и есть единственное содержимое.
   */
  readonly amount?: string | undefined;
}

export interface ReversedPosition {
  readonly ordinal: string;
  readonly basis: string;
  readonly name: string;
  readonly quantity: DecimalString;
  /** Пусто — сумма позиции неизвестна: обратный счёт про объёмы, не про деньги. */
  readonly amount?: DecimalString;
  /** Целая кратность к базовой длине. Отсутствует, если объём не кратен базе. */
  readonly multiple?: string;
  /** Кратность больше двух — возврат позиции по Д-7. */
  readonly flagged: boolean;
  /**
   * След вычисления кратности. Кратность — это число, которым возвращают
   * позицию подрядчику: без следа его нечем защитить, когда подрядчик
   * спросит, откуда взялась база.
   */
  readonly trace: FormulaTrace;
}

/** Однородная группа: одна таблица норм — один вид работ. */
export interface ReversalGroup {
  /** Таблица норм, например `ГЭСНм20-03-035`. */
  readonly table: string;
  /** Наименьший объём в группе. Принят за геометрию объекта — это ДОПУЩЕНИЕ. */
  readonly baseQuantity: DecimalString;
  readonly unit: string;
  readonly positions: readonly ReversedPosition[];
  /** Сумма по позициям со стоп-флагом. Пусто — денег в смете нет. */
  readonly flaggedAmount?: DecimalString;
  /** Сумма по ВСЕЙ группе: без геометрии РД не обоснован ни один метр. */
  readonly totalAmount?: DecimalString;
  readonly totalQuantity: DecimalString;
  readonly assumption: string;
}

export interface VolumeReversalReport {
  readonly groups: readonly ReversalGroup[];
  /**
   * Сумма по флагам всех групп. ПУСТО — денежного веса у находок нет, потому
   * что в сметах нет цен. Это не «ноль рублей риска»: возвраты по кратности
   * найдены, но взвесить их нечем, и показывать 0 ₽ значило бы объявить их
   * безобидными.
   */
  readonly flaggedAmount?: DecimalString;
  /** Сумма всех линейных групп, где есть хоть один флаг. */
  readonly unjustifiedAmount?: DecimalString;
}

/**
 * Таблица норм из шифра: `ГЭСНм20-03-035-01` → `ГЭСНм20-03-035`.
 *
 * Последний сегмент — номер расценки внутри таблицы; отбрасывая его, получаем
 * вид работ. Шифр без нужной структуры даёт свою группу из одной позиции:
 * сравнивать её не с чем, и это честнее, чем сложить с чужой.
 */
function tableOf(basis: string): string {
  const parts = basis.trim().split("-");
  return parts.length >= 2 ? parts.slice(0, -1).join("-") : basis.trim();
}

function isLinear(position: LinearPosition): boolean {
  return масштаб(position.unit) !== undefined;
}

export function reverseVolumes(
  positions: readonly LinearPosition[],
): VolumeReversalReport {
  const linear = positions.filter(
    (position) =>
      isLinear(position) &&
      position.quantity !== undefined &&
      position.quantity !== "",
  );

  const byTable = new Map<string, LinearPosition[]>();
  for (const position of linear) {
    const table = tableOf(position.basis);
    byTable.set(table, [...(byTable.get(table) ?? []), position]);
  }

  const groups = [...byTable.entries()]
    .map(([table, items]) => reverseGroup(table, items))
    .filter((group): group is ReversalGroup => group !== undefined)
    /**
     * Порядок — по деньгам, пока деньги есть; иначе по ОБЪЁМУ.
     *
     * Смысл сортировки — «крупное сверху». В смете без цен крупное измеряется
     * объёмом, и оставить группы в порядке словаря значило бы спрятать самую
     * большую под самой первой по алфавиту.
     */
    .sort((a, b) =>
      a.totalAmount !== undefined && b.totalAmount !== undefined
        ? new Decimal(b.totalAmount).comparedTo(new Decimal(a.totalAmount))
        : new Decimal(b.totalQuantity).comparedTo(new Decimal(a.totalQuantity)),
    );

  const withFlags = groups.filter((group) => group.positions.some((p) => p.flagged));
  const деньгиЕсть = groups.every((group) => group.totalAmount !== undefined);

  return {
    groups,
    ...(деньгиЕсть
      ? {
          flaggedAmount: decimal(
            groups
              // ноль-осознанно: складываются только ПОМЕЧЕННЫЕ группы, а
              // непомеченная не имеет суммы под флагом по определению.
              .reduce((sum, group) => sum.plus(new Decimal(group.flaggedAmount ?? "0")), new Decimal(0))
              .toFixed(2),
          ),
          unjustifiedAmount: decimal(
            withFlags
              // ноль-осознанно: та же выборка помеченных групп.
              .reduce((sum, group) => sum.plus(new Decimal(group.totalAmount ?? "0")), new Decimal(0))
              .toFixed(2),
          ),
        }
      : {}),
  };
}

/**
 * Базовая длина группы: самое частое значение объёма.
 *
 * Геометрия объекта — тот размер, который повторяется у нескольких позиций.
 * При равной частоте берётся больший: короткий участок скорее частный случай,
 * чем мера объекта.
 */
function modalBase(linear: readonly LinearPosition[]): LinearPosition {
  // Считается по ДЛИНЕ В МЕТРАХ, а не по числу в колонке: «1,5» в сотнях метров
  // и «150» в метрах — одна длина, и в подсчёте частоты они обязаны совпасть.
  const counts = new Map<string, number>();
  for (const position of linear) {
    const key = вМетрах(position).toString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let best = linear[0]!;
  let bestCount = 0;

  for (const position of linear) {
    const value = вМетрах(position);
    const count = counts.get(value.toString()) ?? 0;

    if (
      count > bestCount ||
      (count === bestCount && value.greaterThan(вМетрах(best)))
    ) {
      best = position;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Реверс внутри одной группы.
 *
 * Группа из одной позиции пропускается: кратность к самой себе всегда равна
 * единице, и такой «реверс» ничего не проверяет.
 */
function reverseGroup(
  table: string,
  linear: readonly LinearPosition[],
): ReversalGroup | undefined {
  if (linear.length < 2) return undefined;

  const base = modalBase(linear);
  /**
   * ДВА ЧИСЛА, И ПУТАТЬ ИХ НЕЛЬЗЯ.
   *
   * `baseQuantity` — то, что видит человек и ищет в смете: объём базовой
   * позиции в ЕЁ единице. `базаВМетрах` — то, чем делят: сравнивать «1,5» в
   * сотнях метров с «150» в метрах как числа значило бы объявить одну и ту же
   * длину стократным превышением.
   */
  const baseQuantity = new Decimal(base.quantity!);
  const базаВМетрах = вМетрах(base);

  // Позиции меньше базы в реверс не входят: их «кратность» была бы дробью,
  // а короткий участок не является кратным длине объекта — он её часть.
  const reversed: ReversedPosition[] = linear
    .filter((position) => !вМетрах(position).lessThan(базаВМетрах))
    .map((position) => {
      // В отчёт идёт объём КАК В СМЕТЕ — по нему читатель находит строку;
      // делится длина в метрах — по ней кратность имеет смысл.
      const quantity = new Decimal(position.quantity!);
      const длина = вМетрах(position);
      const ratio = длина.dividedBy(базаВМетрах);
      const rounded = ratio.toDecimalPlaces(0);

      // Кратность засчитывается только целая: 137/100 = 1.37 — это не
      // кратность, а другой объём, и выдавать его за «полторы базы» неверно.
      const isMultiple = ratio
        .minus(rounded)
        .abs()
        .lessThanOrEqualTo(TOLERANCE);
      const multiple = isMultiple ? rounded.toFixed(0) : undefined;

      return {
        ordinal: position.ordinal,
        basis: position.basis,
        name: position.name,
        quantity: decimal(quantity.toString()),
        ...(position.amount === undefined
          ? {}
          : { amount: decimal(new Decimal(position.amount).toFixed(2)) }),
        ...(multiple === undefined ? {} : { multiple }),
        flagged: multiple !== undefined && Number(multiple) > FLAG_ABOVE,
        trace: {
          formulaId: VOLUME_REVERSAL_FORMULA,
          formulaVersion: VOLUME_REVERSAL_VERSION,
          inputs: {
            base: decimal(базаВМетрах.toString()),
            positionVolume: decimal(quantity.toString()),
            // Масштаб единицы — часть вычисления, и он назван: без него
            // читатель следа не поймёт, почему «1,5» поделили как 150.
            unitScale: decimal(String(масштаб(position.unit) ?? 1)),
            baseUnitScale: decimal(String(масштаб(base.unit) ?? 1)),
          },
          // В след идёт ОТНОШЕНИЕ, а не округлённая кратность: 1.37 и 1 — разные
          // числа, и след, показывающий «1», скрыл бы, что кратности не было.
          output: decimal(ratio.toFixed(6)),
          rounding: "half-up",
        },
      };
    });

  const sum = (
    items: readonly ReversedPosition[],
    pick: (item: ReversedPosition) => string,
  ) =>
    items.reduce(
      (total, item) => total.plus(new Decimal(pick(item))),
      new Decimal(0),
    );

  return {
    table,
    baseQuantity: decimal(baseQuantity.toString()),
    unit: base.unit,
    positions: reversed,
    // Денежные итоги существуют, только когда сумма известна у ВСЕХ позиций:
    // сложение неизвестных как нулей дало бы правдоподобное и неверное число.
    ...(reversed.every((p) => p.amount !== undefined)
      ? {
          flaggedAmount: decimal(
            sum(
              reversed.filter((p) => p.flagged),
              (p) => p.amount!,
            ).toFixed(2),
          ),
          totalAmount: decimal(sum(reversed, (p) => p.amount!).toFixed(2)),
        }
      : {}),
    /**
     * Сумма объёмов группы — В МЕТРАХ, а не сложением чисел из колонки.
     *
     * «1,5» в сотнях метров плюс «150» в метрах даёт 151,5 чего? Ни метров, ни
     * сотен: это сложение разных величин, и результат — не длина, а мусор,
     * которым потом сортируются группы отчёта.
     */
    totalQuantity: decimal(
      linear
        .filter((position) => !вМетрах(position).lessThan(базаВМетрах))
        .reduce((total, position) => total.plus(вМетрах(position)), new Decimal(0))
        .dividedBy(масштаб(base.unit) ?? 1)
        .toString(),
    ),
    assumption:
      `базовая длина ${baseQuantity.toString()} ${base.unit} принята как самое частое значение ` +
      "в группе и НЕ сверена с осями РД — допущение, верифицировать по чертежу " +
      "до фиксации объёмов (Д-1)",
  };
}
