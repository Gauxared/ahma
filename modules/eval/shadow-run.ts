/**
 * Теневой прогон и метрика разрыва — ADR-R-020.
 *
 * Роадмап M3: «Теневой прогон против небольшой локальной модели — регулярно,
 * ДАЖЕ ПОКА НЕ ПРОХОДИТ. Метрика „разрыв внешняя ↔ целевая модель" ведётся с
 * этого момента; перевод в контур разрешён по ЗАКРЫТИЮ РАЗРЫВА, а не по
 * наступлению срока».
 *
 * ЗАЧЕМ МЕРИТЬ РАЗРЫВ ЗАРАНЕЕ
 *
 * Разрыв, который начинают мерить в день переезда, измеряют один раз и под
 * давлением срока: плохой результат оспаривают, а не принимают. Разрыв, который
 * ведут с самого начала, показывает ТРЕНД — и отвечает на вопрос, сближаются
 * модели или расходятся, задолго до того, как решение станет срочным.
 *
 * РАЗРЫВ — ЭТО ПОТЕРЯ, А НЕ РАЗЛИЧИЕ
 *
 * Целевая модель может закрыть пункт, который внешняя пропустила. Это не
 * разрыв: разрыв — то, что мы ПОТЕРЯЕМ при переезде. Считать различия в обе
 * стороны значило бы смешать риск с удачей и получить число, по которому
 * нельзя принять решение.
 *
 * ПУСТОЙ ЭТАЛОН НЕ ЗАКРЫВАЕТ РАЗРЫВ
 *
 * Ноль потерянных из нуля — это «не измеряли», а не «разрыв закрыт». Признать
 * такой прогон успешным значит разрешить переезд по отсутствию данных.
 */

export interface RunResult {
  readonly agent: string;
  /** Идентификаторы пунктов чек-листа, которые модель закрыла. */
  readonly passedItems: readonly string[];
}

export interface ShadowComparison {
  readonly agent: string;
  /** Доля пунктов эталона, потерянных целевой моделью. 0 — потерь нет. */
  readonly gap: number;
  /** Пункты, которые целевая модель НЕ закрыла. Это и есть цена переезда. */
  readonly lost: readonly string[];
  /** Пункты, закрытые целевой моделью сверх эталона. В разрыв не входят. */
  readonly gained: readonly string[];
  readonly closed: boolean;
  readonly note: string;
}

export function compareRuns(input: {
  readonly reference: RunResult;
  readonly shadow: RunResult;
}): ShadowComparison {
  const reference = new Set(input.reference.passedItems);
  const shadow = new Set(input.shadow.passedItems);

  const lost = [...reference].filter((item) => !shadow.has(item));
  const gained = [...shadow].filter((item) => !reference.has(item));

  const measurable = reference.size > 0;
  const gap = measurable ? lost.length / reference.size : 0;

  return {
    agent: input.reference.agent,
    gap,
    lost,
    gained,
    // Разрыв закрыт, только если было что мерить и ничего не потеряно.
    closed: measurable && lost.length === 0,
    note: measurable
      ? `эталон закрыл ${reference.size} пунктов, целевая модель потеряла ${lost.length}`
      : "разрыв не измерялся: эталонный прогон не закрыл ни одного пункта",
  };
}

export interface GapTrend {
  readonly direction: "сближаются" | "расходятся" | "без изменений" | "недостаточно замеров";
  /** Сколько замеров до нулевого разрыва при текущем темпе. */
  readonly runsToClose?: number;
  readonly note: string;
}

/**
 * Тренд по ряду замеров.
 *
 * Прогноз `runsToClose` — не обещание, а ответ на вопрос «успеваем ли к сроку»
 * при сохранении темпа. При расхождении прогноза нет вовсе: продлевать линию,
 * которая идёт вверх, до пересечения с нулём — арифметика без смысла.
 */
export function gapTrend(gaps: readonly number[]): GapTrend {
  if (gaps.length < 2) {
    return {
      direction: "недостаточно замеров",
      note: "по ряду из одного замера тренда нет; нужен хотя бы второй прогон",
    };
  }

  const first = gaps[0]!;
  const last = gaps[gaps.length - 1]!;
  const step = (first - last) / (gaps.length - 1);

  if (Math.abs(first - last) < 1e-9) {
    return {
      direction: "без изменений",
      note: `разрыв держится на ${(last * 100).toFixed(0)}% — темпа сближения нет`,
    };
  }

  if (last > first) {
    return {
      direction: "расходятся",
      note:
        `разрыв вырос с ${(first * 100).toFixed(0)}% до ${(last * 100).toFixed(0)}%: ` +
        "целевая модель отстаёт всё сильнее, срок переезда под вопросом",
    };
  }

  return {
    direction: "сближаются",
    runsToClose: Math.ceil(last / step),
    note:
      `разрыв снизился с ${(first * 100).toFixed(0)}% до ${(last * 100).toFixed(0)}%; ` +
      `при этом темпе закроется примерно за ${Math.ceil(last / step)} замеров`,
  };
}
