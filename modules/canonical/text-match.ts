/**
 * Текстовый путь канонизации — ADR-R-013, ТЗ §5.2.
 *
 * У коммерческих предложений шифров нет вовсе: только свободный текст, единица
 * и объём. Кодовый путь здесь бесполезен, а без сопоставления §5.2 не
 * выполняется — «приведение позиций разных предложений к сопоставимому виду».
 *
 * ТРИ ИСХОДА, А НЕ ДВА
 *
 * Сопоставлено · требует подтверждения · не сопоставлено. Средний исход
 * обязателен: свести неоднозначное к сопоставленному значит принять решение за
 * человека и спрятать это, а свести к несопоставленному — выбросить работу,
 * которую почти удалось сделать. «Не сопоставлено» при этом — полноправный
 * исход §5.2, а не ошибка: такие позиции выделяются отдельно и в расчёт
 * разброса не входят.
 *
 * ЕДИНИЦА — ЖЁСТКИЙ ЗАПРЕТ, А НЕ ВЕС В ФОРМУЛЕ
 *
 * «Устройство подстилающего слоя» в м³ и в м² — разные работы, как бы ни
 * совпадали наименования. Будь размерность одним из слагаемых оценки, сходство
 * имён её перевесило бы, и объём сравнился бы с площадью. Поэтому несовпадение
 * размерности снимает кандидата ДО подсчёта сходства.
 *
 * НЕОДНОЗНАЧНОСТЬ НЕ РАЗРЕШАЕТСЯ ВЫБОРОМ МАКСИМУМА
 *
 * Когда два кандидата почти равны, победитель определяется третьим знаком
 * оценки — то есть шумом. Такой выбор выглядит решением и им не является,
 * поэтому он передаётся человеку вместе с обоими вариантами.
 *
 * ОБЪЯСНЕНИЕ — СЛОВАМИ, А НЕ ЧИСЛОМ
 *
 * Человек подтверждает сопоставление, глядя на основание. «Уверенность 0.87»
 * основанием не является: по нему нельзя ни согласиться, ни возразить. Поэтому
 * объяснение перечисляет СОВПАВШИЕ и РАЗОШЕДШИЕСЯ слова.
 *
 * СРАВНИВАЮТСЯ ОСНОВЫ, А НЕ СЛОВА
 *
 * Русский флективен: «устройство слоЯ», «из щебнЯ», «железобетоннОГО забора».
 * Точное сравнение слов на таком материале не работает в принципе, и первая
 * версия этого модуля на настоящем КП провалилась именно так. Слова сводятся к
 * основе (`stemRussian`) — но только для сравнения: в объяснении человеку
 * стоят исходные слова.
 *
 * СЛОВАРЬ СИНОНИМОВ ПРИХОДИТ СНАРУЖИ
 *
 * «жб» против «железобетонный», «гидромолот» против «гидравлический молот» —
 * предметное знание клиента, а не свойство алгоритма (ADR-R-014).
 */
import { normalizeRussian } from "@contracts/index.js";

import { stemRussian } from "./stem.js";
import { parseUnit } from "./units.js";

export interface TextCandidate {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
}

export interface TextQuery {
  readonly name: string;
  readonly unit: string;
}

export type MatchOutcome = "сопоставлено" | "требует подтверждения" | "не сопоставлено";

export interface ScoredCandidate {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  /** ИСХОДНЫЕ слова запроса, нашедшиеся у кандидата. Их показывают человеку. */
  readonly shared: readonly string[];
  /** Их основы — для внутренних проверок. Наружу не показываются. */
  readonly stems: readonly string[];
}

export interface TextMatch {
  readonly outcome: MatchOutcome;
  readonly match?: TextCandidate;
  /** Заполнены при неоднозначности: человеку нужны ОБА варианта. */
  readonly alternatives: readonly ScoredCandidate[];
  readonly confidence: number;
  readonly explanation: string;
}

export interface MatchOptions {
  /** Пары синонимов: `[["жб", "железобетонный"]]`. Приходят из конфигурации. */
  readonly synonyms?: readonly (readonly [string, string])[];
}

/**
 * Порог сопоставления. Ниже — не сопоставлено.
 *
 * Значение выбрано по настоящему КП SLK: строка «устройство подстилающего слоя
 * из щебня,фракция 40- 70мм.,толщиной 300мм» против справочной «устройство
 * подстилающего слоя из щебня фракция 40-70 мм» даёт около 0.7 — совпадают все
 * значимые слова, лишние есть только у запроса.
 */
export const MATCH_FLOOR = 0.45;

/** Выше этого — сопоставлено без подтверждения, если нет близкого соперника. */
export const MATCH_CONFIDENT = 0.62;

/**
 * Насколько первый кандидат обязан оторваться от второго.
 *
 * Меньший отрыв означает, что победителя выбирает шум оценки, а не сходство.
 */
export const AMBIGUITY_MARGIN = 0.08;

/**
 * Слова, встречающиеся почти в каждой строительной позиции.
 *
 * Совпадение по ним одним — совпадение жанра, а не работы: «устройство» есть и
 * у приямка, и у кровли, и у забора. Они не выбрасываются из текста, а лишь
 * теряют вес: выбросить их значило бы сделать «устройство приямка» и «демонтаж
 * приямка» одинаковыми.
 */
const WEAK_WORDS = new Set(
  [
    "устройство",
    "монтаж",
    "работы",
    "выполнение",
    "из",
    "с",
    "по",
    "и",
    "в",
    "на",
    "для",
    "при",
    "помощи",
    "существующий",
  ].map((word) => stemRussian(word)),
);

const WEAK_WEIGHT = 0.25;

/**
 * Слова текста: основы для сравнения и обратное соответствие к исходным словам.
 *
 * Обратное соответствие обязательно. Объяснение человеку показывает ИСХОДНЫЕ
 * слова: «совпали: подстил, сло, щебн» — не объяснение, а отчёт о работе
 * алгоритма. Правило «основа для сравнения, а не для показа» легко нарушить,
 * потому что нарушение выглядит работающим.
 */
function tokenize(
  value: string,
  synonyms: ReadonlyMap<string, string>,
): { stems: string[]; original: Map<string, string> } {
  // Разделители — всё, кроме букв и цифр. Числа сохраняются: «40-70» и «20-40»
  // отличают фракции щебня, и потерять их значит сложить разные материалы.
  //
  // ЦИФРЫ ОТДЕЛЯЮТСЯ ОТ КИРИЛЛИЦЫ. В КП пишут «40- 70мм.», и без этого правила
  // получается токен «70мм», который не совпадает с «70» из справочной строки
  // «40-70 мм». Тогда «щебень 40-70» и «щебень 20-40» набирают ОДИНАКОВУЮ
  // оценку — различающее число теряется, и разные материалы по разной цене
  // становятся одной позицией. Найдено на настоящем КП SLK.
  //
  // От ЛАТИНИЦЫ цифры не отделяются: «B30F150» — марка бетона, и разрезать её
  // на «b», «30», «f», «150» значит сделать все марки похожими друг на друга.
  const words = normalizeRussian(value)
    .replace(/(\d)([а-яё])/gu, "$1 $2")
    .replace(/([а-яё])(\d)/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");

  const stems: string[] = [];
  const original = new Map<string, string>();

  for (const word of words) {
    // Синоним подставляется ДО приведения к основе: словарь пишут словами
    // («жб» → «железобетонный»), а не основами.
    const stem = stemRussian(synonyms.get(word) ?? word);
    stems.push(stem);
    if (!original.has(stem)) original.set(stem, word);
  }

  return { stems, original };
}

function weightOf(word: string): number {
  return WEAK_WORDS.has(word) ? WEAK_WEIGHT : 1;
}

function weigh(words: Iterable<string>): number {
  let total = 0;
  for (const word of words) total += weightOf(word);
  return total;
}

/**
 * Насколько лишняя подробность запроса снижает оценку.
 *
 * Мера НЕСИММЕТРИЧНА, и это не упрощение. Строка КП почти всегда подробнее
 * справочной: «устройство подстилающего слоя из щебня,фракция 40- 70мм.,
 * толщиной 300мм» против справочного «устройство подстилающего слоя из щебня
 * фракция 40-70 мм». Симметричная мера штрафует запрос за то, что он ТОЧНЕЕ, —
 * и на настоящем КП уводила верное сопоставление в «требует подтверждения».
 *
 * Полностью игнорировать лишнее тоже нельзя: тогда запрос, содержащий
 * справочную строку внутри длинного постороннего текста, получил бы единицу.
 * Четверть веса — цена подробности.
 */
const EXTRA_PENALTY = 0.25;

/**
 * Сходство наборов слов с учётом веса.
 *
 * Числитель — общий вес; знаменатель — вес КАНДИДАТА плюс четверть веса того,
 * что есть в запросе и отсутствует у кандидата.
 */
function similarity(query: readonly string[], candidate: readonly string[]): {
  score: number;
  shared: string[];
} {
  const queryWords = new Set(query);
  const candidateWords = new Set(candidate);

  const shared = [...queryWords].filter((word) => candidateWords.has(word));
  const extra = [...queryWords].filter((word) => !candidateWords.has(word));

  const denominator = weigh(candidateWords) + EXTRA_PENALTY * weigh(extra);

  return {
    score: denominator === 0 ? 0 : weigh(shared) / denominator,
    shared,
  };
}

function synonymMap(pairs: readonly (readonly [string, string])[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const [from, to] of pairs) {
    // Нормализуются обе стороны: словарь пишет человек, и «ЖБ» с «жб» должны
    // работать одинаково.
    map.set(normalizeRussian(from), normalizeRussian(to));
  }

  return map;
}

export function matchByText(
  query: TextQuery,
  candidates: readonly TextCandidate[],
  options: MatchOptions = {},
): TextMatch {
  if (candidates.length === 0) {
    return {
      outcome: "не сопоставлено",
      alternatives: [],
      confidence: 0,
      explanation: "справочник пуст: сопоставлять не с чем",
    };
  }

  const synonyms = synonymMap(options.synonyms ?? []);
  const { stems: queryWords, original: queryOriginal } = tokenize(query.name, synonyms);

  if (queryWords.length === 0) {
    return {
      outcome: "не сопоставлено",
      alternatives: [],
      confidence: 0,
      explanation: "наименование пусто: сопоставлять нечего",
    };
  }

  const queryUnit = parseUnit(query.unit);

  // Размерность снимает кандидата ДО подсчёта сходства: иначе сходство имён
  // перевесило бы несовпадение единиц и объём сравнился бы с площадью.
  const comparable = candidates.filter(
    (candidate) => parseUnit(candidate.unit).dimension === queryUnit.dimension,
  );
  const excludedByUnit = candidates.length - comparable.length;

  if (comparable.length === 0) {
    return {
      outcome: "не сопоставлено",
      alternatives: [],
      confidence: 0,
      explanation:
        `ни один кандидат не совпал по размерности: запрос в «${query.unit}» ` +
        `(${queryUnit.dimension}), в справочнике таких единиц нет`,
    };
  }

  const scored: ScoredCandidate[] = comparable
    .map((candidate) => {
      const { score, shared } = similarity(queryWords, tokenize(candidate.name, synonyms).stems);
      // Наружу идут ИСХОДНЫЕ слова запроса, а не их основы.
      return {
        id: candidate.id,
        name: candidate.name,
        score,
        shared: shared.map((stem) => queryOriginal.get(stem) ?? stem),
        stems: shared,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const runnerUp = scored[1];
  const byId = new Map(comparable.map((candidate) => [candidate.id, candidate]));

  const meaningful = best.stems
    .filter((stem) => !WEAK_WORDS.has(stem))
    .map((stem) => queryOriginal.get(stem) ?? stem);
  const weak = best.stems
    .filter((stem) => WEAK_WORDS.has(stem))
    .map((stem) => queryOriginal.get(stem) ?? stem);

  if (best.score < MATCH_FLOOR || meaningful.length === 0) {
    return {
      outcome: "не сопоставлено",
      alternatives: [],
      confidence: best.score,
      explanation:
        `ближайший кандидат «${best.name}» набрал ${best.score.toFixed(2)} ` +
        `при пороге ${MATCH_FLOOR}` +
        (excludedByUnit > 0
          ? `; по размерности снято кандидатов: ${excludedByUnit}`
          : "") +
        (meaningful.length === 0
          ? "; совпали только общие слова, значимых совпадений нет"
          : `; совпали: ${best.shared.join(", ")}`),
    };
  }

  const explanation =
    `совпали значимые слова: ${meaningful.join(", ")}` +
    (weak.length > 0 ? ` (и общие: ${weak.join(", ")})` : "") +
    `; оценка ${best.score.toFixed(2)}`;

  const ambiguous = runnerUp !== undefined && best.score - runnerUp.score < AMBIGUITY_MARGIN;

  if (ambiguous || best.score < MATCH_CONFIDENT) {
    return {
      outcome: "требует подтверждения",
      match: byId.get(best.id)!,
      alternatives: ambiguous ? [best, runnerUp!] : [best],
      confidence: best.score,
      explanation: ambiguous
        ? `${explanation}. Второй кандидат «${runnerUp!.name}» отстаёт всего на ` +
          `${(best.score - runnerUp!.score).toFixed(2)} — выбор между ними решался бы шумом оценки`
        : `${explanation}. Уверенность ниже ${MATCH_CONFIDENT}: требуется подтверждение`,
    };
  }

  return {
    outcome: "сопоставлено",
    match: byId.get(best.id)!,
    alternatives: [],
    confidence: best.score,
    explanation,
  };
}
