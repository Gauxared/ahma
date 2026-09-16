/**
 * Лист как чистые данные: номер строки → буква колонки → текст ячейки.
 *
 * Парсер работает НАД этой абстракцией, а не над библиотекой чтения xlsx.
 * Причина не в чистоте: ТЗ §8.1 требует принимать ещё и ГРАНД-Смета XML, а это
 * та же смета в другом контейнере. Одна абстракция — одна логика разбора на оба
 * формата, и разбор тестируется без файлов.
 */
export interface Sheet {
  readonly name: string;
  /** Ключ внешней карты — номер строки (с единицы), внутренней — буква колонки. */
  readonly rows: ReadonlyMap<number, ReadonlyMap<string, string>>;
}

export function cell(sheet: Sheet, row: number, column: string): string | undefined {
  return sheet.rows.get(row)?.get(column);
}

/** Номера строк по возрастанию. */
export function rowNumbers(sheet: Sheet): readonly number[] {
  return [...sheet.rows.keys()].sort((a, b) => a - b);
}

/** Сжимает пробелы и убирает края — в выгрузках ГРАНД-Сметы их много. */
export function normalize(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Удобно для тестов: строит лист из массива `[номер, { колонка: текст }]`. */
export function sheetFrom(name: string, rows: readonly [number, Record<string, string>][]): Sheet {
  return {
    name,
    rows: new Map(rows.map(([number, cells]) => [number, new Map(Object.entries(cells))])),
  };
}
