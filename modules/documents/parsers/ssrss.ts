/**
 * Разбор сводного сметного расчёта стоимости строительства (ССРСС)
 * по Приложению № 6 приказа Минстроя № 421/пр.
 *
 * Форма государственная, поэтому разбор обобщается на любой ССРСС этого
 * формата, а не только на курганский.
 *
 * ГЛАВНОЕ СВОЙСТВО ФОРМЫ: все суммы номинированы в **ТЫС. РУБ.**, тогда как
 * локальные сметные расчёты — в рублях. Шкала объявляется полем `scale` и
 * является свойством источника, а не догадкой читателя: перепутать её значит
 * ошибиться в тысячу раз.
 *
 * Две ловушки разметки, обе встречаются в настоящем документе:
 *
 *  1. Заголовок главы («Глава 5. Объекты транспортного хозяйства») лежит в
 *     объединённой ячейке и повторён в КАЖДОЙ колонке строки. Разбор «непустая
 *     A — значит позиция» завёл бы его как объект капитального строительства.
 *
 *  2. Под строкой начисления непредвиденных затрат идёт строка с формулой
 *     («2%Г1.С:Г12.С») в числовых колонках. Это пояснение к начислению, а не
 *     сумма.
 *
 *  3. Под шапкой идёт строка нумерации колонок (A=1, B=2, … H=8). Она выглядит
 *     как объект: порядковый номер в A, непустые B и C, число в «всего». Та же
 *     ловушка описана в разборе ЛСР — форма 421/пр нумерует колонки в обеих.
 *
 * Начисления (непредвиденные затраты, налоги) разведены с объектами
 * капитального строительства. У объекта обоснование — шифр локальной сметы
 * вида «05-02» (глава-номер); у начисления там ссылка на норму («Приказ от
 * 4.08.2020 № 421/пр п.179»). Смешать их значит задвоить: начисление берётся
 * ПРОЦЕНТОМ от суммы объектов и уже входит в итог после него.
 *
 * Накопительные итоги («Итого по Главам 1-7», «1-8», «1-9», «1-12») разведены
 * с итогом главы и с итогом после непредвиденных затрат намеренно. Сумма
 * локальных смет сходится с «Итого по Главам 1-9»; сравнивать её с итогом, куда
 * уже вошли 2% непредвиденных, — значит получить ложное расхождение.
 */
import { cellNumber } from "../cell-number.js";
import { normalize, rowNumbers, type Sheet } from "../sheet.js";

import type { ParseIssue } from "./grand-smeta.js";

/**
 * Шкала суммы — СВОЙСТВО ИСТОЧНИКА, прочитанное из шапки.
 *
 * Форма 421/пр допускает обе: курганский комплект составлен в тыс. руб.,
 * пакет Нижнего Тагила — в рублях («Сметная стоимость, руб.»). Умолчание здесь
 * недопустимо: перепутать шкалу значит ошибиться ровно в тысячу раз, причём
 * ошибка выйдет наружу не отказом, а посчитанным числом.
 */
export type Scale = "thousands" | "rubles";

export interface SsrssObject {
  readonly ordinal: string;
  /** Шифр локального сметного расчёта, например «05-02». */
  readonly basis: string;
  readonly name: string;
  readonly construction: string | undefined;
  readonly assembly: string | undefined;
  readonly equipment: string | undefined;
  readonly other: string | undefined;
  readonly total: string;
  readonly row: number;
}

export interface SsrssTotal {
  /** Подпись как она записана в документе. */
  readonly label: string;
  /**
   * Машинный вид: `chapter:5`, `chapters:1-9`, `with-contingency`.
   * Нужен, чтобы сверка выбирала итог однозначно, а не поиском по подстроке.
   */
  readonly scope: string;
  readonly total: string;
  readonly row: number;
}

/**
 * Начисление на итог: непредвиденные затраты, налоги. Не объект строительства.
 */
export interface SsrssAccrual {
  readonly basis: string;
  readonly name: string;
  readonly total: string;
  readonly row: number;
}

export interface SsrssDocument {
  readonly sheet: string;
  readonly scale: Scale;
  readonly objects: readonly SsrssObject[];
  readonly accruals: readonly SsrssAccrual[];
  readonly totals: readonly SsrssTotal[];
  readonly issues: readonly ParseIssue[];
}

export class SsrssParseError extends Error {
  constructor(
    message: string,
    readonly sheet: string,
  ) {
    super(`${sheet}: ${message}`);
    this.name = "SsrssParseError";
  }
}

/** Порядковый номер объекта в главе. */
const ORDINAL = /^\d+$/;
/** Шифр локальной сметы: глава-номер. Отличает объект от начисления. */
/**
 * Шифр локальной сметы в обосновании — признак ОБЪЕКТА, а не начисления.
 *
 * Здесь стояло `^\d+-\d+$` — ровно две группы цифр, как в курганском
 * комплекте. Шифры Нижнего Тагила («НТ-05-02-01») под него не подходили, и
 * объекты капитального строительства уходили в начисления: состав стройки
 * разбирался неверно и молча.
 *
 * Отличает объект от начисления не число групп, а сам вид записи: шифр — это
 * компактный код без пробелов и слов. Начисление ссылается на норму или приказ
 * («Приказ от 4.08.2020 № 421/пр п.179») и содержит и то и другое.
 */
const OBJECT_CODE = /^\p{L}{0,6}[-\s]?\d+(?:\s*-\s*\d+)+$/u;

const CHAPTER_TOTAL = /^итого по главе\s+(\d+)/i;
const CHAPTERS_TOTAL = /^итого по главам\s+(\d+)\s*[-–]\s*(\d+)/i;
const CONTINGENCY_TOTAL = /^итого с учет[оа]м/i;
/**
 * Шапка стоимостной части. «Тыс.» здесь НЕОБЯЗАТЕЛЬНО — по нему определяется
 * шкала, а не принадлежность к форме. Требуя тысяч, разбор отвергал настоящий
 * сводный расчёт в рублях как «документ другой формы».
 */
const HEADER_MARKER = /сметная стоимость,/i;
/** Тысячи против рублей — различаются по той же шапке. */
const THOUSANDS_MARKER = /сметная стоимость,\s*тыс/i;

/** Колонки формы: D-G — виды затрат, H — «всего». */
const CONSTRUCTION = "D";
const ASSEMBLY = "E";
const EQUIPMENT = "F";
const OTHER = "G";
const TOTAL = "H";

/**
 * Число из ячейки формы.
 *
 * Правило записано ОДИН РАЗ на оба разбора (`cell-number.ts`). Здесь стояла
 * своя копия строгого шаблона, и сводный расчёт в CSV терял бы все суммы
 * ровно так же, как их терял ЛСР, — а расхождение между ними вылезло бы как
 * находка системы, а не как её ошибка.
 */
function numeric(sheet: Sheet, row: number, column: string): string | undefined {
  return cellNumber(normalize(sheet.rows.get(row)?.get(column)));
}

/**
 * Строка нумерации колонок: значения по порядку равны 1, 2, 3 … Она стоит под
 * шапкой и по форме неотличима от объекта, поэтому проверяется содержанием.
 */
function isColumnNumbering(cells: ReadonlyMap<string, string>): boolean {
  const values = [...cells.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => normalize(value))
    .filter((value) => value !== "");

  return values.length >= 3 && values.every((value, index) => value === String(index + 1));
}

/**
 * Заголовок главы лежит в объединённой ячейке: один и тот же текст во всех
 * колонках строки. Это отличает его от строки объекта, где A, B и C различны.
 */
function isMergedBanner(cells: ReadonlyMap<string, string>): boolean {
  const values = [...cells.values()].map(normalize).filter((value) => value !== "");
  if (values.length < 3) return false;

  const first = values[0];
  return values.every((value) => value === first);
}

export function parseSsrss(sheet: Sheet): SsrssDocument {
  const numbers = rowNumbers(sheet);

  const headerRow = numbers.find((row) =>
    [...(sheet.rows.get(row)?.values() ?? [])].some((value) => HEADER_MARKER.test(normalize(value))),
  );

  if (headerRow === undefined) {
    throw new SsrssParseError(
      "не найдена шапка «Сметная стоимость» — документ не похож на сводный " +
        "сметный расчёт по Приложению № 6",
      sheet.name,
    );
  }

  const scale: Scale = [...(sheet.rows.get(headerRow)?.values() ?? [])].some((value) =>
    THOUSANDS_MARKER.test(normalize(value)),
  )
    ? "thousands"
    : "rubles";

  const objects: SsrssObject[] = [];
  /** Строки, похожие на объект, но без суммы, — признак расчёта без цен. */
  let безСуммы = 0;
  const accruals: SsrssAccrual[] = [];
  const totals: SsrssTotal[] = [];
  const issues: ParseIssue[] = [];

  for (const row of numbers.filter((candidate) => candidate > headerRow)) {
    const cells = sheet.rows.get(row);
    if (cells === undefined) continue;

    if (isMergedBanner(cells) || isColumnNumbering(cells)) continue;

    const label = normalize(cells.get("B"));
    const total = numeric(sheet, row, TOTAL);

    const chapter = CHAPTER_TOTAL.exec(label);
    const chapters = CHAPTERS_TOTAL.exec(label);
    const contingency = CONTINGENCY_TOTAL.test(label);

    if (chapter !== null || chapters !== null || contingency) {
      if (total === undefined) {
        issues.push({ severity: "warning", message: `итог «${label}» без суммы в колонке «всего»`, row });
        continue;
      }

      const scope =
        chapter !== null
          ? `chapter:${chapter[1]}`
          : chapters !== null
            ? `chapters:${chapters[1]}-${chapters[2]}`
            : "with-contingency";

      totals.push({ label, scope, total, row });
      continue;
    }

    const ordinal = normalize(cells.get("A"));
    const name = normalize(cells.get("C"));

    if (!ORDINAL.test(ordinal) || label === "" || name === "") continue;

    if (total === undefined) {
      // Строка выглядит объектом, но суммы у неё нет. Не молча: по числу таких
      // строк ниже различаются «расчёт без цен» и «документ не прочитан».
      if (OBJECT_CODE.test(label)) безСуммы += 1;
      continue;
    }

    // Обоснование вида «05-02» — шифр локальной сметы, значит объект.
    // Ссылка на норму вместо шифра — значит начисление на итог.
    if (!OBJECT_CODE.test(label)) {
      accruals.push({ basis: label, name, total, row });
      continue;
    }

    objects.push({
      ordinal,
      basis: label,
      name,
      construction: numeric(sheet, row, CONSTRUCTION),
      assembly: numeric(sheet, row, ASSEMBLY),
      equipment: numeric(sheet, row, EQUIPMENT),
      other: numeric(sheet, row, OTHER),
      total,
      row,
    });
  }

  /**
   * РАЗВЯЗКА, ТА ЖЕ ЧТО В ЛСР: «нет объектов» значит разное.
   *
   * Сводный расчёт пакета без стоимостной части перечисляет объекты БЕЗ сумм —
   * и без суммы строка объектом не заводится. Но итоги по главам в нём есть, и
   * в них лежит НМЦК: «Итого по Главам 1-9» 86 778 920,38 ₽. Объявив разбор
   * провалившимся, мы отказывали документу целиком и теряли эту цифру, хотя
   * прочитали её двумя строками ниже.
   *
   * Разбор провалился только тогда, когда не прочитано НИЧЕГО.
   */
  if (objects.length === 0 && безСуммы > 0 && totals.length > 0) {
    issues.push({
      severity: "warning",
      message:
        `объекты перечислены без сумм (${безСуммы}): в сводном расчёте нет стоимостной части ` +
        "по объектам, прочитаны только итоги по главам",
    });
  } else if (objects.length === 0) {
    issues.push({ severity: "blocking", message: "не найдено ни одного объекта капитального строительства" });
  }

  return { sheet: sheet.name, scale, objects, accruals, totals, issues };
}
