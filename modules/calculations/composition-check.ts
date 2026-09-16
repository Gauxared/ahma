/**
 * Сверка состава и полноты спецификации — правила Д-3 и Д-4 Денчика.
 *
 * Источник — промпт `reference-system-new/Выход/Денчик_ГИП_v9.7.txt`, ЧАСТЬ 3.
 *
 *   Д-3. СОСТАВ, А НЕ ТОЛЬКО ЦИФРЫ. Сверять количество объектов/систем/точек:
 *        план vs ТЗ. (ЧТЗ: 5 ИТП на плане против 7 зданий в ТЗ — флаг «5≠7».
 *        Пропавший ИТП = пропавшая мощность и деньги.)
 *
 *   Д-4. ПОЛНОТА СПЕЦИФИКАЦИИ. После расчёта — проверить, все ли позиции
 *        в спецификации. Отсутствие ≠ «не нужно».
 *
 * ПОЧЕМУ ЭТО НЕ ЛОВИТСЯ СХОДИМОСТЬЮ
 *
 * Сходимость проверяет, что сумма слагаемых равна объявленному итогу. Пропавшей
 * позиции нет НИ В ОДНОМ слагаемом и нет в итоге — смета сходится идеально и
 * без неё. Поэтому §12.1б, которую мы держим в нуле, про этот класс ошибок
 * ничего не говорит, и нужен отдельный счёт по составу.
 *
 * ДВА ИСХОДА, КОТОРЫЕ НЕЛЬЗЯ СЛИВАТЬ
 *
 * `недобор` — единиц меньше, чем в другой разметке: пропавшая работа и
 * мощность. `избыток` — больше: переплата. Свести их к «расхождению» значит
 * потерять направление ошибки, а оно определяет, к кому идти с вопросом.
 *
 * ТРЕТИЙ ИСХОД — «СРАВНИВАТЬ НЕ С ЧЕМ»
 *
 * Группа, встреченная в одной разметке, не сошлась и не разошлась. Объявить её
 * сошедшейся значит выдать незнание за проверку (ТЗ §9), поэтому она попадает
 * в отдельный список непроверяемых.
 */

export interface CountedItem {
  /** Что считаем: «опоры», «труба Ø219», «ИТП». */
  readonly group: string;
  /** Где посчитано: «смета», «спецификация», «рд», «тз». */
  readonly source: string;
  readonly count: number;
}

export type MismatchKind = "недобор" | "избыток";

export interface CompositionMismatch {
  readonly group: string;
  readonly kind: MismatchKind;
  /** Разметка, где единиц МЕНЬШЕ. Именно туда идёт вопрос. */
  readonly missingFrom: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly delta: number;
}

export interface CompositionReport {
  readonly mismatches: readonly CompositionMismatch[];
  /** Группы, встреченные в одной разметке: сравнивать не с чем. */
  readonly unverifiable: readonly string[];
}

export function checkComposition(items: readonly CountedItem[]): CompositionReport {
  const byGroup = new Map<string, CountedItem[]>();

  for (const item of items) {
    byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
  }

  const mismatches: CompositionMismatch[] = [];
  const unverifiable: string[] = [];

  for (const [group, entries] of byGroup) {
    const sources = new Map(entries.map((entry) => [entry.source, entry.count]));

    if (sources.size < 2) {
      unverifiable.push(group);
      continue;
    }

    const counts = [...sources.values()];
    const min = Math.min(...counts);
    const max = Math.max(...counts);

    if (min === max) continue;

    // Разметка с наименьшим числом — та, где единицы потеряны.
    const missingFrom = [...sources.entries()].find(([, count]) => count === min)![0];

    mismatches.push({
      group,
      // Направление считается от полноты: меньше — недобор, и вопрос туда.
      kind: "недобор",
      missingFrom,
      counts: Object.fromEntries(sources),
      delta: max - min,
    });
  }

  return { mismatches, unverifiable };
}
