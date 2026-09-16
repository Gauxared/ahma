/**
 * Три режима глубины ответа — ТЗ §5.4.
 *
 * Роадмап M3: «экспресс ≤15 строк без таблиц, стандарт с источником на каждую
 * цифру, эксперт ≥3 варианта и матрица».
 *
 * РЕЖИМ — КОНТРАКТ НА ФОРМУ, А НЕ ПОЖЕЛАНИЕ К СТИЛЮ
 *
 * Экспресс, выдавший таблицу на две страницы, нарушил договор ровно так же,
 * как эксперт, не давший вариантов. Поэтому режим проверяется, а не только
 * объявляется в промпте: инструкцию «будь краток» модель нарушает тем чаще,
 * чем больше ей есть что сказать.
 *
 * ГЛУБОКИЙ РЕЖИМ НЕ МОЖЕТ БЫТЬ МЯГЧЕ
 *
 * Эксперт наследует требование источников от стандарта. Иначе выбор более
 * глубокого режима ОСЛАБЛЯЛ бы требования: «эксперт» разрешал бы цифры без
 * основания, которых «стандарт» не разрешает. Требования только накапливаются.
 */

export type DepthMode = "экспресс" | "стандарт" | "эксперт";

export interface DepthContract {
  /** Предел длины в строках. `undefined` — не ограничена. */
  readonly maxLines?: number;
  readonly tablesAllowed: boolean;
  /** Каждая цифра обязана нести источник. */
  readonly sourcePerNumber: boolean;
  /** Минимум вариантов решения. */
  readonly minOptions: number;
  readonly purpose: string;
}

export const DEPTH_MODES: Readonly<Record<DepthMode, DepthContract>> = {
  экспресс: {
    maxLines: 15,
    tablesAllowed: false,
    sourcePerNumber: false,
    minOptions: 0,
    purpose: "быстрый ответ на один вопрос: не более 15 строк, без таблиц",
  },
  стандарт: {
    tablesAllowed: true,
    sourcePerNumber: true,
    minOptions: 0,
    purpose: "рабочий ответ: у каждой цифры источник",
  },
  эксперт: {
    tablesAllowed: true,
    // Наследуется от стандарта: глубокий режим строже, а не мягче.
    sourcePerNumber: true,
    minOptions: 3,
    purpose: "разбор развилки: не менее трёх вариантов и матрица сравнения",
  },
};

export interface AnswerShape {
  readonly text: string;
  /** Сколько чисел в ответе. */
  readonly numbers: number;
  /** Сколько из них несут источник. */
  readonly numbersWithSource: number;
  /** Сколько вариантов решения предложено. */
  readonly options: number;
}

export interface DepthCheck {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

/** Таблица в markdown: строка, начинающаяся и заканчивающаяся вертикальной чертой. */
const TABLE_ROW = /^\s*\|.*\|\s*$/m;

export function checkDepth(mode: DepthMode, answer: AnswerShape): DepthCheck {
  const contract = DEPTH_MODES[mode];
  const violations: string[] = [];

  const lines = answer.text.split("\n").filter((line) => line.trim() !== "").length;

  if (contract.maxLines !== undefined && lines > contract.maxLines) {
    violations.push(`режим «${mode}» допускает не более ${contract.maxLines} строк, в ответе ${lines}`);
  }

  if (!contract.tablesAllowed && TABLE_ROW.test(answer.text)) {
    violations.push(`режим «${mode}» запрещает таблицы`);
  }

  // Ноль цифр — не «все цифры без источника»: требовать нечего.
  if (contract.sourcePerNumber && answer.numbers > answer.numbersWithSource) {
    violations.push(
      `цифр без источника: ${answer.numbers - answer.numbersWithSource} из ${answer.numbers} ` +
        `(режим «${mode}» требует источник на каждую)`,
    );
  }

  if (answer.options < contract.minOptions) {
    violations.push(`режим «${mode}» требует не менее ${contract.minOptions} вариантов, дано ${answer.options}`);
  }

  return { ok: violations.length === 0, violations };
}

/** Формулировка требований для промпта агента. */
export function describeDepth(mode: DepthMode): string {
  const contract = DEPTH_MODES[mode];

  const parts = [contract.purpose];

  if (contract.maxLines !== undefined) parts.push(`жёсткий предел: ${contract.maxLines} строк`);
  if (!contract.tablesAllowed) parts.push("таблицы запрещены");
  if (contract.sourcePerNumber) parts.push("каждое число — с источником");
  if (contract.minOptions > 0) parts.push(`минимум вариантов: ${contract.minOptions}`);

  return parts.join("; ");
}
