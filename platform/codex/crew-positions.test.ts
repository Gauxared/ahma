/**
 * ПОЗИЦИИ, НОРМАЛИЗОВАННЫЕ РОЛЬЮ — Т11.
 *
 * Решение владельца 08.09.2026: такие позиции считаются НАРАВНЕ с разобранными
 * по форме 421/пр — в сходимости, гейтах и межсметных дублях, — а уровень
 * доверия помечается отдельно.
 *
 * Набор смотрит на три вещи, каждая из которых ломается молча:
 *   · позиция доходит до накопителя обхода, а не остаётся в тексте заключения;
 *   · пустая сумма остаётся пустой (ноль сложился бы с настоящими суммами);
 *   · позиция, чей документ не разрешился, не берётся вовсе.
 */
import { describe, expect, it } from "vitest";

import { buildCoordinateIndex, parseCrewOutput, toExtractedRows } from "./crew-output.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

const ВЕДОМОСТЬ = "/партия/Ведомость объёмов.xlsx";

function накопитель(): CollectedDuringCheck {
  return {
    documentHashes: [{ path: ВЕДОМОСТЬ, contentHash: "a".repeat(64) }],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  } as unknown as CollectedDuringCheck;
}

const ответ = (positions: unknown[]): unknown => ({
  verdict: "🟡 условно",
  summary: [],
  findings: [],
  positions,
  sections: [],
  openQuestions: [],
  handoffs: [],
  assumptions: [],
  alerts: [],
  nextTakt: "",
});

describe("позиции роли из документа вне формы 421/пр", () => {
  const index = buildCoordinateIndex(накопитель());

  it("доходят до строк накопителя с пометкой уровня доверия", () => {
    const output = parseCrewOutput(
      ответ([
        {
          document: "Ведомость объёмов.xlsx",
          sheet: "Раздел 2",
          row: 41,
          ordinal: "12",
          section: "2",
          name: "Устройство основания из щебня",
          code: "ГЭСН27-04-001-01",
          unit: "м3",
          quantity: "1250.5",
          amountRub: "3187750.00",
        },
      ]),
    );

    const { rows } = toExtractedRows(output, index);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      document: ВЕДОМОСТЬ,
      sourceName: "Устройство основания из щебня",
      basis: "ГЭСН27-04-001-01",
      quantity: "1250.5",
      amount: "3187750.00",
      sourceRow: 41,
      sheet: "Раздел 2",
      // Отличие от разобранной ровно одно, и оно названо.
      acquisition: "agent_normalized",
    });
  });

  it("пустая сумма остаётся пустой, а не нулём", () => {
    const output = parseCrewOutput(
      ответ([
        {
          document: "Ведомость объёмов.xlsx",
          sheet: "",
          row: 7,
          ordinal: "1",
          section: "1",
          name: "Разработка грунта",
          code: "",
          unit: "м3",
          quantity: "400",
          amountRub: "",
        },
      ]),
    );

    const { rows } = toExtractedRows(output, index);

    // Ноль сложился бы с настоящими суммами и дал бы расхождение размером
    // в стоимость объекта (ТЗ §9).
    expect(rows[0]?.amount).toBeUndefined();
    expect(rows[0]?.quantity).toBe("400");
  });

  it("позиция с неизвестным документом ПОМЕЧАЕТСЯ, а не выбрасывается", () => {
    const output = parseCrewOutput(
      ответ([
        { document: "Которого нет.xlsx", sheet: "", row: 3, ordinal: "1", section: "", name: "Строка", code: "", unit: "шт", quantity: "1", amountRub: "10.00" },
      ]),
    );

    const { rows } = toExtractedRows(output, index);

    // Прежде здесь стоял молчаливый пропуск, и он однажды съел 136 позиций.
    // Ворота на пути данных не отбрасывают, а помечают: имя, названное ролью,
    // сохраняется, и видно, что документа с таким именем в партии нет.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.document).toContain("не найден в партии");
    expect(rows[0]?.sourceName).toBe("Строка");
  });

  it("строка без наименования не позиция", () => {
    const output = parseCrewOutput(
      ответ([{ document: "Ведомость объёмов.xlsx", sheet: "", row: 3, ordinal: "1", section: "", name: "  ", code: "", unit: "", quantity: "", amountRub: "" }]),
    );

    expect(parseCrewOutput(ответ([])).positions).toHaveLength(0);
    expect(toExtractedRows(output, index).rows).toHaveLength(0);
  });

  it("строка, уже разобранная кодом, вторым разом в счёт не идёт", () => {
    /**
     * С 08.09.2026 разобранная смета уходит роли И позициями, И текстом целиком
     * (Т10). Значит роль ВИДИТ строки формы в `документация/` и может
     * добросовестно переписать их в `positions`. Тогда одна и та же работа
     * встала бы в счёт дважды — в сходимость, в межсметный дубль, в свод по
     * деньгам. На объекте это не неточность, а работа, оплаченная дважды.
     */
    const разобрано: CollectedDuringCheck = {
      ...накопитель(),
      extracted: [
        {
          document: ВЕДОМОСТЬ,
          ordinal: "12",
          section: "2",
          sourceName: "Устройство основания из щебня",
          basis: "ГЭСН27-04-001-01",
          unit: "м3",
          quantity: "1250.5",
          amount: "3187750.00",
          sourceRow: 41,
        },
      ],
    } as unknown as CollectedDuringCheck;

    const output = parseCrewOutput(
      ответ([
        { document: "Ведомость объёмов.xlsx", sheet: "Лист1", row: 41, ordinal: "12", section: "2", name: "Устройство основания из щебня", code: "ГЭСН27-04-001-01", unit: "м3", quantity: "1250.5", amountRub: "3187750.00" },
        { document: "Ведомость объёмов.xlsx", sheet: "Лист2", row: 88, ordinal: "40", section: "3", name: "Розлив вяжущих", code: "", unit: "т", quantity: "18.4", amountRub: "" },
      ]),
    );

    const { rows, alreadyCounted } = toExtractedRows(output, buildCoordinateIndex(разобрано));

    // В счёт идёт только та строка, которой у разбора не было.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceRow).toBe(88);
    // Пересказ не исчезает молча: он уходит в заключение роли находкой.
    expect(alreadyCounted).toHaveLength(1);
    expect(alreadyCounted[0]).toContain("строка 41");
  });

  it("накопитель обхода принимает их тем же приёмником, что и разобранные", () => {
    const собранное = накопитель();
    const принято: unknown[] = [];
    const собранноеСПриёмником: CollectedDuringCheck = { ...собранное, absorb: (rows) => принято.push(...rows) };

    const output = parseCrewOutput(
      ответ([
        { document: "Ведомость объёмов.xlsx", sheet: "Лист1", row: 5, ordinal: "1", section: "1", name: "Бетон B25", code: "ФССЦ-401-0001", unit: "м3", quantity: "12", amountRub: "84000.00" },
      ]),
    );

    собранноеСПриёмником.absorb?.(toExtractedRows(output, index).rows);
    expect(принято).toHaveLength(1);
  });
});
