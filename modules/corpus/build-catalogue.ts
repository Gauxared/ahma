/**
 * Сборка каталога канонических позиций из корпуса (трек A, зона A1).
 *
 * Наивный цикл «прочитать и разобрать» по корпусу АПРИ падает, и это свойство
 * задачи, а не мелочь реализации: один файл на 38 МБ исчерпывает кучу 4 ГБ,
 * другой роняет читатель внутренней ошибкой. Поэтому здесь есть порог размера
 * и учёт каждого отказа.
 *
 * Молчаливых пропусков нет вовсе. «Не смогли прочитать 40 файлов» и «в корпусе
 * не было 40 файлов» — разные утверждения, и подменять первое вторым значит
 * нарушить инвариант §9 «неизвестное не превращается в ноль» на уровне
 * подготовки данных.
 *
 * Разрешение конфликтов детерминированное: один и тот же корпус обязан давать
 * один и тот же каталог, иначе воспроизводимость Проверки (ADR-R-027) рушится
 * ниже уровня, на котором мы её обеспечиваем.
 */
import type { CodeSystem, ItemCode } from "@contracts/index.js";

export interface CorpusFile {
  readonly path: string;
  readonly bytes: number;
}

/** Позиция в том виде, в каком её отдаёт разбор сметы. */
export interface CorpusPosition {
  readonly code: ItemCode | undefined;
  readonly basis: string;
  readonly name: string;
  readonly unit: string;
}

export interface CatalogueDeps {
  readonly listFiles: () => readonly CorpusFile[];
  readonly readEstimate: (path: string) => Promise<readonly CorpusPosition[]>;
  readonly maxFileBytes: number;
}

export type SkipReason = "size_limit" | "not_an_estimate" | "read_error";

export interface SkippedFile {
  readonly path: string;
  readonly reason: SkipReason;
  readonly detail: string;
}

export interface CatalogueItem {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly codes: readonly ItemCode[];
  /** Сколько раз шифр встретился в корпусе — мера доверия к записи. */
  readonly occurrences: number;
}

export interface CatalogueConflict {
  readonly code: string;
  readonly field: "name" | "unit";
  readonly chosen: string;
  readonly rejected: readonly string[];
}

export interface CatalogueReport {
  readonly totalFiles: number;
  readonly parsedFiles: number;
  readonly skipped: readonly SkippedFile[];
  readonly items: readonly CatalogueItem[];
  readonly conflicts: readonly CatalogueConflict[];
  readonly positionsTotal: number;
  readonly positionsWithoutCode: number;
  /**
   * Шифры, встреченные без единицы измерения. В каталог они не попадают:
   * канонической считается позиция, приведённая к СОПОСТАВИМОМУ виду (§5.2),
   * а без единицы сопоставление невозможно. Счётчик обязателен — «не нашли»
   * и «не было» должны различаться.
   */
  readonly itemsWithoutUnit: readonly string[];
}

/** Разбор не нашёл структуры сметы — файл просто не смета, а не сбой. */
const NOT_AN_ESTIMATE = /не найдена шапка|раскладка формы не распознана|не найдено ни одного раздела/i;

function codeKey(code: ItemCode): string {
  return `${code.system} ${code.code}`;
}

interface Accumulator {
  readonly system: CodeSystem;
  readonly code: string;
  occurrences: number;
  readonly names: Map<string, number>;
  readonly units: Map<string, number>;
}

/**
 * Выбирает самое частое значение. При равенстве частот берётся лексикографически
 * первое: произвольный, но ВОСПРОИЗВОДИМЫЙ выбор, иначе каталог зависел бы от
 * порядка обхода файловой системы.
 */
function mostFrequent(counts: ReadonlyMap<string, number>): { chosen: string; rejected: string[] } {
  const sorted = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  const chosen = sorted[0]?.[0] ?? "";

  return { chosen, rejected: sorted.slice(1).map(([value]) => value) };
}

export async function buildCatalogue(deps: CatalogueDeps): Promise<CatalogueReport> {
  const files = deps.listFiles();
  const skipped: SkippedFile[] = [];
  const accumulators = new Map<string, Accumulator>();

  let parsedFiles = 0;
  let positionsTotal = 0;
  let positionsWithoutCode = 0;

  for (const file of files) {
    if (file.bytes > deps.maxFileBytes) {
      // Порог проверяется ДО чтения: файл на 38 МБ кладёт процесс целиком,
      // и поймать это исключением уже нельзя.
      skipped.push({
        path: file.path,
        reason: "size_limit",
        detail: `${(file.bytes / 1024 / 1024).toFixed(1)} МБ при пороге ${(deps.maxFileBytes / 1024 / 1024).toFixed(0)} МБ`,
      });
      continue;
    }

    let positions: readonly CorpusPosition[];

    try {
      positions = await deps.readEstimate(file.path);
    } catch (error) {
      const message = (error as Error).message;
      skipped.push({
        path: file.path,
        reason: NOT_AN_ESTIMATE.test(message) ? "not_an_estimate" : "read_error",
        detail: message.slice(0, 200),
      });
      continue;
    }

    parsedFiles += 1;

    for (const position of positions) {
      positionsTotal += 1;

      if (position.code === undefined) {
        positionsWithoutCode += 1;
        continue;
      }

      const key = codeKey(position.code);
      const accumulator =
        accumulators.get(key) ??
        {
          system: position.code.system,
          code: position.code.code,
          occurrences: 0,
          names: new Map<string, number>(),
          units: new Map<string, number>(),
        };

      accumulator.occurrences += 1;

      const name = position.name.trim();
      if (name !== "") {
        accumulator.names.set(name, (accumulator.names.get(name) ?? 0) + 1);
      }

      const unit = position.unit.trim();
      if (unit !== "") {
        accumulator.units.set(unit, (accumulator.units.get(unit) ?? 0) + 1);
      }

      accumulators.set(key, accumulator);
    }
  }

  const items: CatalogueItem[] = [];
  const conflicts: CatalogueConflict[] = [];
  const itemsWithoutUnit: string[] = [];

  // Сортировка по шифру: порядок каталога не должен зависеть от обхода.
  for (const [key, accumulator] of [...accumulators.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = mostFrequent(accumulator.names);
    const unit = mostFrequent(accumulator.units);

    if (unit.chosen === "") {
      itemsWithoutUnit.push(key);
      continue;
    }

    if (name.rejected.length > 0) {
      conflicts.push({ code: key, field: "name", chosen: name.chosen, rejected: name.rejected });
    }
    if (unit.rejected.length > 0) {
      conflicts.push({ code: key, field: "unit", chosen: unit.chosen, rejected: unit.rejected });
    }

    items.push({
      id: key,
      name: name.chosen,
      unit: unit.chosen,
      codes: [{ system: accumulator.system, code: accumulator.code }],
      occurrences: accumulator.occurrences,
    });
  }

  return {
    totalFiles: files.length,
    parsedFiles,
    skipped,
    items,
    conflicts,
    positionsTotal,
    positionsWithoutCode,
    itemsWithoutUnit,
  };
}
