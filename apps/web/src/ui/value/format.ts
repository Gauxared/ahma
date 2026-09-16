import type { Money, MoneyScale, Quantity } from "@contracts/primitives.js";

/**
 * Форматирование значений. ТОЛЬКО показ, никакой арифметики предметной области.
 *
 * ГРАНИЦА, КОТОРУЮ ЗДЕСЬ НЕЛЬЗЯ ПЕРЕЙТИ
 *
 * §6.4 требует, чтобы все числа результата считал расчётный модуль. Деление на
 * миллион ради подписи «млн» — это масштабирование для чтения, а не расчёт: его
 * результат нигде не сохраняется и ни во что не подставляется. Чтобы разница не
 * стёрлась, компактная форма никогда не показывается одна — рядом или в
 * раскрытии всегда стоит точное значение из источника.
 */

const RU = "ru-RU";

const SCALE_WORD: Readonly<Record<MoneyScale, string>> = {
  unit: "₽",
  thousand: "тыс. ₽",
  million: "млн ₽",
};

/** Точная сумма без обозначения валюты — когда единица показывается отдельно. */
export function formatAmount(value: Money): string {
  const amount = Number(value.amount);
  return Number.isFinite(amount)
    ? amount.toLocaleString(RU, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.amount;
}

/**
 * Десятичная строка как её читает человек: «824 009,97».
 *
 * Нужна там, где значение приходит строкой из разбора, а не типизированной
 * суммой. Экран позиций показывал `824009.97` — то самое число, которое рядом,
 * в карточке замечания, стоит как «824 009,97 ₽». Один и тот же рубль в двух
 * написаниях на соседних экранах читается как разные числа, а экран позиций —
 * это ровно то место, куда клиент приходит СВЕРЯТЬ.
 *
 * Нечисловое возвращается как есть: разбор мог положить туда прочерк или
 * пометку, и подменять её нулём значило бы придумать значение.
 */
export function formatDecimal(value: string): string {
  const число = Number(value);

  return Number.isFinite(число) && value.trim() !== ""
    ? число.toLocaleString(RU, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value;
}

/** Точная сумма в рублях, как она пришла: без потери копеек. */
export function formatMoneyExact(value: Money): string {
  return `${formatAmount(value)} ₽`;
}

/**
 * Компактная сумма для KPI: «104,98 млн ₽».
 *
 * Порог выбран так, чтобы не сокращать то, что и так коротко: суммы меньше
 * миллиона показываются полностью — «сокращённые» 0,11 млн читаются хуже, чем
 * 110 000 ₽, и именно на этом макет заказчика терял точность в самой важной
 * карточке.
 */
export function formatMoneyCompact(value: Money): { readonly text: string; readonly unit: string } {
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) {
    return { text: value.amount, unit: "₽" };
  }

  const absolute = Math.abs(amount);
  if (absolute >= 1_000_000_000) {
    return { text: (amount / 1_000_000_000).toLocaleString(RU, { maximumFractionDigits: 2 }), unit: "млрд ₽" };
  }
  if (absolute >= 1_000_000) {
    return { text: (amount / 1_000_000).toLocaleString(RU, { maximumFractionDigits: 2 }), unit: "млн ₽" };
  }
  return { text: amount.toLocaleString(RU, { maximumFractionDigits: 0 }), unit: "₽" };
}

/** Число величины без единицы — когда единица показывается отдельным кеглем. */
export function formatQuantityValue(value: Quantity): string {
  const amount = Number(value.value);
  return Number.isFinite(amount) ? amount.toLocaleString(RU, { maximumFractionDigits: 3 }) : value.value;
}

export function formatQuantity(value: Quantity): string {
  return `${formatQuantityValue(value)} ${value.unit}`;
}

/**
 * Как значение было заявлено в источнике.
 *
 * Показывается рядом с суммой, когда шкала источника не рублёвая: расхождение
 * ЛСР и ССРСС на 7.52 ₽ объясняется именно этим, и прятать шкалу значит
 * оставить расхождение необъяснимым (§12.1б).
 */
export function describeStatedAs(value: Money): string | undefined {
  const stated = value.statedAs;
  if (stated === undefined || stated.scale === "unit") {
    return undefined;
  }
  return `в источнике: ${SCALE_WORD[stated.scale]}, ${stated.fractionDigits} зн. после запятой`;
}

/**
 * Суммы ВНУТРИ прозы агента — разрядкой, как все остальные числа продукта.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ ПОНАДОБИЛОСЬ
 *
 * Агент возвращает вердикт и основание текстом, и суммы в нём приходят так, как
 * их напечатала модель: `14198884.54 ₽`. Рядом, в плитках и таблицах, те же
 * рубли стоят как `14 198 884,54 ₽` — потому что через `formatAmount` проходит
 * всё, что система посчитала сама. Проза мимо этого правила проходила, и на
 * одном экране оказывались два разных вида одной величины: девятизначное число
 * без разрядки читатель не прочитывает, а пересчитывает пальцем.
 *
 * ЧТО ЭТО НЕ ДЕЛАЕТ
 *
 * Не округляет, не пересчитывает и не переставляет: копейки остаются те же,
 * порядок цифр тот же. Это разрядка и запятая вместо точки — то же самое, что
 * делает `toLocaleString` с числом, посчитанным расчётным модулем.
 *
 * ЯКОРЬ — ЗНАК РУБЛЯ, А НЕ «ПОХОЖЕ НА ЧИСЛО»
 *
 * Без якоря под правило попали бы шифры (`ГЭСНм08-03-572-06`), номера позиций и
 * количества (`198120 м`), а испорченный шифр хуже неразмеченной суммы: по нему
 * не найти расценку. Поэтому меняется только то, за чем непосредственно стоит
 * `₽` — с возможной шкалой «тыс.» или «млн» между ними.
 *
 * Порог в четыре знака оставляет короткие числа как есть: `Δ 7.52 ₽`
 * разрядки не требует, а `7,52` вместо `7.52` в одном месте и `7.52` в
 * соседнем — это разнобой ради разнобоя.
 */
const AMOUNT_IN_PROSE = /(?<![\d.,])(\d{4,})(?:[.,](\d{1,2}))?(?=\s*(?:тыс\.?|млн\.?|млрд\.?)?\s*₽)/g;

export function formatAmountsInProse(text: string): string {
  return text.replace(AMOUNT_IN_PROSE, (_match, whole: string, fraction: string | undefined) => {
    const grouped = Number(whole).toLocaleString(RU, { maximumFractionDigits: 0 });
    return fraction === undefined ? grouped : `${grouped},${fraction}`;
  });
}

export function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  return new Date(parsed).toLocaleDateString(RU, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Число со СКЛОНЯЕМЫМ существительным: «1 партия», «2 партии», «5 партий».
 *
 * ЗАЧЕМ ЭТО НУЖНО ВООБЩЕ
 *
 * Подписи собирались как `${rows.length} партий`, и на демонстрационном экране
 * стояло «1 партий». Это не мелочь стиля: продукт продаётся сметчикам как
 * инструмент, который читает документы внимательнее человека, а сам не умеет
 * согласовать числительное. Первое впечатление стоит дороже, чем эта функция.
 *
 * Правило русского языка, а не таблица частных случаев: смотрим на две
 * последние цифры. 11–14 — всегда родительный множественного («11 партий»),
 * иначе решает последняя: 1 — именительный единственного, 2–4 — родительный
 * единственного, остальное — родительный множественного.
 *
 * Три формы передаются явно, а не выводятся из одной: русское словоизменение
 * по одной форме не восстанавливается («партия/партии/партий»,
 * «файл/файла/файлов», «замечание/замечания/замечаний» — три разных образца).
 */
export interface Plural {
  /** 1 партия, 21 партия */
  readonly one: string;
  /** 2 партии, 33 партии */
  readonly few: string;
  /** 5 партий, 11 партий, 100 партий */
  readonly many: string;
}

export function pluralWord(count: number, forms: Plural): string {
  const целое = Math.abs(Math.trunc(count));
  const десятки = целое % 100;
  const единицы = целое % 10;

  // 11–14 — исключение, и оно первое: без него «11 партия» и «12 партии».
  if (десятки >= 11 && десятки <= 14) return forms.many;
  if (единицы === 1) return forms.one;
  if (единицы >= 2 && единицы <= 4) return forms.few;

  return forms.many;
}

/** «5 партий» — число и согласованное с ним слово одной подписью. */
export function plural(count: number, forms: Plural): string {
  return `${count.toLocaleString(RU)} ${pluralWord(count, forms)}`;
}

/** Словоформы, встречающиеся на экранах. Один список, чтобы не расходились. */
export const СЛОВО = {
  партия: { one: "партия", few: "партии", many: "партий" },
  файл: { one: "файл", few: "файла", many: "файлов" },
  замечание: { one: "замечание", few: "замечания", many: "замечаний" },
  позиция: { one: "позиция", few: "позиции", many: "позиций" },
  документ: { one: "документ", few: "документа", many: "документов" },
  смета: { one: "смета", few: "сметы", many: "смет" },
  объект: { one: "объект", few: "объекта", many: "объектов" },
  прогон: { one: "прогон", few: "прогона", many: "прогонов" },
  агент: { one: "агент", few: "агента", many: "агентов" },
  гейт: { one: "гейт", few: "гейта", many: "гейтов" },
  запись: { one: "запись", few: "записи", many: "записей" },
  предмет: { one: "предмет", few: "предмета", many: "предметов" },
  страница: { one: "страница", few: "страницы", many: "страниц" },
  лист: { one: "лист", few: "листа", many: "листов" },
  проверка: { one: "проверка", few: "проверки", many: "проверок" },
} as const satisfies Readonly<Record<string, Plural>>;
