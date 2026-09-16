/**
 * Замер против эталона: что из выводов легаси мы воспроизводим.
 *
 * ЗАЧЕМ ЭТО НУЖНО ИМЕННО МАШИНОЙ
 *
 * Утверждение «мы не потеряли в качестве оригинала» до сих пор проверялось
 * глазами: я читал эталонный пакет, читал наш прогон и сравнивал. Так можно
 * заметить совпадение и невозможно заметить его отсутствие — глаз ищет то, что
 * ожидает найти. Пока сравнение не делает машина, паритет остаётся мнением.
 *
 * КАК УСТРОЕНО, ЧТОБЫ НЕЛЬЗЯ БЫЛО ПОДОГНАТЬ
 *
 * Ожидание — это ЧИСЛО из эталонного пакета с указанием, откуда оно взято
 * (файл, лист, строка). Совпадение ищется в НАШЕМ результате: в деталях гейтов,
 * в замечаниях агентов и в суммах их последствий. То есть замер не может пройти
 * оттого, что мы написали в нём «пройдено»: он проходит, только если система
 * действительно выдала это число.
 *
 * Обратное тоже важно: ожидание, которого мы не выдали, остаётся в отчёте
 * красным. Убрать его из файла — значит уменьшить эталон, и это видно по числу
 * ожиданий, которое печатается рядом с долей.
 *
 * ПОЧЕМУ СРАВНИВАЮТСЯ ЧИСЛА, А НЕ ФОРМУЛИРОВКИ
 *
 * Формулировка у модели своя каждый раз. Сравнение прозы с прозой давало бы
 * либо ложные совпадения по общим словам, либо ложные промахи из-за синонима.
 * Число — то немногое, что обязано совпасть, если вывод тот же.
 */
import { Decimal } from "decimal.js";

/** Насколько сумма может разойтись и всё ещё считаться той же. */
export const DEFAULT_TOLERANCE = "0.005" as const;

export interface ReferenceExpectation {
  readonly id: string;
  /** Что именно утверждает эталон. */
  readonly claim: string;
  /** Сумма из эталонного пакета как десятичная строка. */
  readonly amount: string;
  /** Откуда взято: файл и место. Без этого ожидание — выдумка. */
  readonly source: string;
  /**
   * Слова, по которым видно, что речь о том же предмете.
   *
   * Нужны для отличия «нашли число, но про другое» от настоящего совпадения:
   * 64 710 398 могло бы попасть в отчёт по другому поводу.
   */
  readonly about: readonly string[];
  /** Допуск, если у этого ожидания он свой. */
  readonly tolerance?: string;
}

export interface ReferenceCase {
  readonly id: string;
  readonly object: string;
  readonly reference: string;
  readonly expectations: readonly ReferenceExpectation[];
}

/** Что наш прогон выдал: числа и текст, в которых ищем совпадение. */
export interface OurOutput {
  /** Суммы, названные системой: последствия замечаний, детали гейтов. */
  readonly amounts: readonly string[];
  /** Весь текст выводов: вердикты, замечания, основания, детали гейтов. */
  readonly text: string;
}

export type MatchKind = "воспроизведено" | "частично" | "не воспроизведено";

export interface ExpectationResult {
  readonly expectation: ReferenceExpectation;
  readonly kind: MatchKind;
  /** Наше число, признанное совпадающим. */
  readonly matched?: string;
  /** Относительное расхождение, если совпало не точно. */
  readonly deviation?: string;
  readonly note: string;
}

export interface ReferenceMeasure {
  readonly caseId: string;
  readonly results: readonly ExpectationResult[];
  readonly reproduced: number;
  readonly partial: number;
  readonly missed: number;
  readonly total: number;
  /** Доля воспроизведённого: полное — единица, частичное — половина. */
  readonly score: string;
}

function mentionsSubject(text: string, about: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return about.some((word) => lower.includes(word.toLowerCase()));
}

/**
 * Ищет наше число, совпадающее с эталонным.
 *
 * Возвращает ближайшее, а не первое попавшееся: при нескольких кандидатах
 * ближайшее — то, о котором эталон и говорит.
 */
function closest(
  expected: Decimal,
  ours: readonly string[],
  tolerance: Decimal,
): { value: string; deviation: Decimal } | undefined {
  let best: { value: string; deviation: Decimal } | undefined;

  for (const candidate of ours) {
    let value: Decimal;
    try {
      value = new Decimal(candidate);
    } catch {
      continue;
    }

    if (expected.isZero()) continue;

    const deviation = value.minus(expected).abs().dividedBy(expected.abs());

    if (deviation.greaterThan(tolerance)) continue;
    if (best === undefined || deviation.lessThan(best.deviation)) {
      best = { value: candidate, deviation };
    }
  }

  return best;
}

export function measureAgainstReference(
  reference: ReferenceCase,
  ours: OurOutput,
): ReferenceMeasure {
  const results = reference.expectations.map((expectation): ExpectationResult => {
    const expected = new Decimal(expectation.amount);
    const tolerance = new Decimal(expectation.tolerance ?? DEFAULT_TOLERANCE);
    const hit = closest(expected, ours.amounts, tolerance);
    const subject = mentionsSubject(ours.text, expectation.about);

    // Число совпало И предмет назван — воспроизведено. Число без предмета
    // засчитывать нельзя: совпадение сумм бывает случайным.
    if (hit !== undefined && subject) {
      return {
        expectation,
        kind: "воспроизведено",
        matched: hit.value,
        deviation: hit.deviation.times(100).toFixed(4),
        note:
          hit.deviation.isZero()
            ? "совпало точно"
            : `совпало с расхождением ${hit.deviation.times(100).toFixed(4)} %`,
      };
    }

    if (hit !== undefined) {
      return {
        expectation,
        kind: "частично",
        matched: hit.value,
        note: "число найдено, но предмет в выводах не назван — совпадение может быть случайным",
      };
    }

    if (subject) {
      return {
        expectation,
        kind: "частично",
        note: "предмет назван, суммы нет — вывод сделан качественно, но не оценён в рублях",
      };
    }

    return { expectation, kind: "не воспроизведено", note: "ни числа, ни предмета в выводах нет" };
  });

  const reproduced = results.filter((result) => result.kind === "воспроизведено").length;
  const partial = results.filter((result) => result.kind === "частично").length;

  return {
    caseId: reference.id,
    results,
    reproduced,
    partial,
    missed: results.length - reproduced - partial,
    total: results.length,
    score:
      results.length === 0
        ? "0.00"
        : new Decimal(reproduced)
            .plus(new Decimal(partial).dividedBy(2))
            .dividedBy(results.length)
            .times(100)
            .toFixed(2),
  };
}
