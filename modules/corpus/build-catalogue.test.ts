/**
 * Тесты написаны до реализации по спецификации A1 (docs/track-a-tasks.md).
 *
 * Обход файловой системы и чтение xlsx внедряются зависимостями: предмет
 * проверки — правила отбора, учёт отказов и разрешение конфликтов, а не
 * библиотека чтения.
 */
import { describe, expect, it } from "vitest";

import { buildCatalogue } from "./build-catalogue.js";
import type { CorpusFile, CatalogueDeps } from "./build-catalogue.js";

const MAX_BYTES = 5 * 1024 * 1024;

function deps(
  files: readonly CorpusFile[],
  read: CatalogueDeps["readEstimate"],
): CatalogueDeps {
  return { listFiles: () => files, readEstimate: read, maxFileBytes: MAX_BYTES };
}

/** Позиция в том виде, в каком её отдаёт разбор сметы. */
function position(code: string, name: string, unit: string) {
  return {
    ordinal: "1",
    code: { system: "ГЭСН" as const, code },
    basis: `ГЭСН${code}`,
    name,
    unit,
    quantity: "1",
    unitCost: "100.00",
    total: "100.00",
    row: 10,
  };
}

describe("отбор файлов корпуса (A1)", () => {
  it("отклоняет файл больше порога и называет причину", async () => {
    const report = await buildCatalogue(
      deps([{ path: "/огромный.xlsx", bytes: 40 * 1024 * 1024 }], async () => {
        throw new Error("читать не должны были");
      }),
    );

    expect(report.items).toHaveLength(0);
    expect(report.skipped).toEqual([
      { path: "/огромный.xlsx", reason: "size_limit", detail: expect.stringContaining("40") },
    ]);
  });

  it("учитывает файл, который не является сметой", async () => {
    const report = await buildCatalogue(
      deps([{ path: "/график.xlsx", bytes: 1000 }], async () => {
        throw new Error("не найдена шапка таблицы (ячейка A со значением «№ п/п»)");
      }),
    );

    expect(report.skipped[0]?.reason).toBe("not_an_estimate");
  });

  it("учитывает ошибку чтения, а не роняет прогон (§9)", async () => {
    const report = await buildCatalogue(
      deps(
        [
          { path: "/битый.xlsx", bytes: 1000 },
          { path: "/хороший.xlsx", bytes: 1000 },
        ],
        async (path) => {
          if (path === "/битый.xlsx") {
            throw new Error("Cannot read properties of undefined (reading 'comments')");
          }
          return [position("м08-03-572-06", "Блок управления", "шт")];
        },
      ),
    );

    expect(report.skipped[0]).toMatchObject({ path: "/битый.xlsx", reason: "read_error" });
    expect(report.items).toHaveLength(1);
    expect(report.parsedFiles).toBe(1);
  });

  it("ни один файл не теряется: разобрано плюс пропущено равно всего", async () => {
    const report = await buildCatalogue(
      deps(
        [
          { path: "/a.xlsx", bytes: 1000 },
          { path: "/b.xlsx", bytes: 99 * 1024 * 1024 },
          { path: "/c.xlsx", bytes: 1000 },
        ],
        async (path) => {
          if (path === "/c.xlsx") throw new Error("не найдена шапка таблицы");
          return [position("м08-03-572-06", "Блок", "шт")];
        },
      ),
    );

    expect(report.totalFiles).toBe(3);
    expect(report.parsedFiles + report.skipped.length).toBe(report.totalFiles);
  });
});

describe("разрешение конфликтов по шифру (A1)", () => {
  it("сводит одинаковый шифр в одну позицию", async () => {
    const report = await buildCatalogue(
      deps([{ path: "/a.xlsx", bytes: 1000 }, { path: "/b.xlsx", bytes: 1000 }], async () => [
        position("м08-03-572-06", "Блок управления", "шт"),
      ]),
    );

    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.occurrences).toBe(2);
  });

  it("выбирает самое частое наименование, а не первое встреченное", async () => {
    const names = ["Редкое имя", "Частое имя", "Частое имя", "Частое имя"];
    let index = 0;

    const report = await buildCatalogue(
      deps(
        names.map((_, n) => ({ path: `/${n}.xlsx`, bytes: 1000 })),
        async () => [position("м08-03-572-06", names[index++]!, "шт")],
      ),
    );

    expect(report.items[0]?.name).toBe("Частое имя");
  });

  it("предъявляет конфликт единиц, а не прячет его", async () => {
    const units = ["шт", "шт", "компл"];
    let index = 0;

    const report = await buildCatalogue(
      deps(
        units.map((_, n) => ({ path: `/${n}.xlsx`, bytes: 1000 })),
        async () => [position("м08-03-572-06", "Блок", units[index++]!)],
      ),
    );

    expect(report.items[0]?.unit).toBe("шт");
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toMatchObject({ code: "ГЭСН м08-03-572-06", field: "unit" });
  });

  it("детерминирован: тот же корпус даёт тот же каталог", async () => {
    const make = () =>
      buildCatalogue(
        deps([{ path: "/a.xlsx", bytes: 1000 }, { path: "/b.xlsx", bytes: 1000 }], async () => [
          position("м08-01-072-01", "Шина", "100 м"),
          position("м08-03-572-06", "Блок", "шт"),
        ]),
      );

    const first = await make();
    const second = await make();

    expect(JSON.stringify(first.items)).toBe(JSON.stringify(second.items));
  });

  it("сортирует каталог по шифру: порядок не зависит от обхода", async () => {
    const report = await buildCatalogue(
      deps([{ path: "/a.xlsx", bytes: 1000 }], async () => [
        position("м99-99-999-99", "Последний", "шт"),
        position("м01-01-001-01", "Первый", "шт"),
      ]),
    );

    expect(report.items.map((item) => item.codes[0]?.code)).toEqual([
      "м01-01-001-01",
      "м99-99-999-99",
    ]);
  });

  it("не берёт в каталог шифр без единицы, но считает его", async () => {
    // Позиция без единицы несопоставима (§5.2), значит она не каноническая.
    const report = await buildCatalogue(
      deps([{ path: "/a.xlsx", bytes: 1000 }], async () => [
        position("м08-03-572-06", "Блок", ""),
        position("м08-01-072-01", "Шина", "100 м"),
      ]),
    );

    expect(report.items.map((item) => item.codes[0]?.code)).toEqual(["м08-01-072-01"]);
    expect(report.itemsWithoutUnit).toEqual(["ГЭСН м08-03-572-06"]);
  });

  it("пропускает позиции без шифра: кодовый путь к ним неприменим", async () => {
    const report = await buildCatalogue(
      deps([{ path: "/a.xlsx", bytes: 1000 }], async () => [
        { ...position("м08-03-572-06", "Блок", "шт"), code: undefined, basis: "ТЦ_прайс" },
      ]),
    );

    expect(report.items).toHaveLength(0);
    expect(report.positionsWithoutCode).toBe(1);
  });
});
