/**
 * ИТОГОВАЯ СТРОКА ДОКУМЕНТА — НЕ ПОЗИЦИЯ.
 *
 * ЗАМЕРЕНО НА ПРОГОНЕ 16 (08.09.2026): из 144 позиций объекта ПЯТНАДЦАТЬ
 * оказались итоговыми строками — «Всего с НДС 413 072 947 ₽», «Итого без НДС
 * 338 584 383 ₽», «Итого до непредвиденных 328 722 702 ₽», «Итого затрат
 * Заказчика до резерва 13 956 658 ₽».
 *
 * Роль выписала их добросовестно: в документе это строки с суммой, как и все
 * прочие. Отличить итог от работы можно только по смыслу наименования.
 *
 * ЧЕМ ЭТО ОПАСНО. Итог — это СУММА позиций. Положенный рядом с ними, он
 * считает документ дважды: свод «из чего объект состоит» назвал бы «Всего с
 * НДС» самой дорогой работой объекта, а сходимость дала бы расхождение
 * размером в стоимость объекта.
 *
 * ПОЧЕМУ НЕ ОТБРАСЫВАЕМ. Итог, прочитанный ролью, — ценное число: им сверяется
 * сходимость, и человек видит его в таблице. Отбрасывается не строка, а её
 * участие в денежных сводах.
 */
import { describe, expect, it } from "vitest";

import { buildCoordinateIndex, parseCrewOutput, toExtractedRows } from "./crew-output.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

const СМЕТА = "/партия/Смета контракта.xlsx";

const накопитель = (): CollectedDuringCheck =>
  ({
    documentHashes: [{ path: СМЕТА, contentHash: "a".repeat(64) }],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  }) as unknown as CollectedDuringCheck;

const ответ = (positions: unknown[]): unknown => ({
  verdict: "🟡",
  summary: [],
  findings: [],
  positions,
  sections: [],
  openQuestions: [],
  handoffs: [],
  returns: [],
  assumptions: [],
  alerts: [],
  nextTakt: "",
  lesson: "",
});

const строка = (name: string, row: number, amountRub: string): unknown => ({
  document: "Смета контракта.xlsx",
  sheet: "Смета контракта",
  row,
  ordinal: String(row),
  section: "2",
  name,
  code: "",
  unit: "",
  quantity: "",
  amountRub,
});

describe("итоги в позициях роли", () => {
  const index = buildCoordinateIndex(накопитель());

  it("«Всего с НДС» и «Итого» помечены итогом, а работа — нет", () => {
    const { rows } = toExtractedRows(
      parseCrewOutput(
        ответ([
          строка("Устройство основания из щебня", 84, "223189786.00"),
          строка("Итого без НДС", 149, "338584383.00"),
          строка("Всего с НДС", 151, "413072947.00"),
          строка("В том числе НДС 22%", 150, "74488564.00"),
        ]),
      ),
      index,
    );

    expect(rows.find((r) => r.sourceRow === 84)?.total).toBeUndefined();
    expect(rows.find((r) => r.sourceRow === 149)?.total).toBe(true);
    expect(rows.find((r) => r.sourceRow === 151)?.total).toBe(true);
    expect(rows.find((r) => r.sourceRow === 150)?.total).toBe(true);
  });

  it("строка остаётся в таблице: число нужно человеку и сходимости", () => {
    const { rows } = toExtractedRows(
      parseCrewOutput(ответ([строка("Итого по смете контракта", 151, "413072947.00")])),
      index,
    );

    // Отбрасывается не строка, а её участие в денежных сводах.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe("413072947.00");
  });

  it("работа со словом «итог» в середине наименования итогом не считается", () => {
    // «Устройство итоговой обмазки» — работа, а не сумма. Признак — НАЧАЛО
    // строки: так пишут итоги в сметах, и так их отличают глазом.
    const { rows } = toExtractedRows(
      parseCrewOutput(ответ([строка("Устройство итоговой гидроизоляции", 90, "12000.00")])),
      index,
    );

    expect(rows[0]?.total).toBeUndefined();
  });
});
