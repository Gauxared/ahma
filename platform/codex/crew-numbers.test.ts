/**
 * ЧИСЛО ОТ РОЛИ ПРИВОДИТСЯ К КАНОНИЧЕСКОМУ ВИДУ — ИЛИ ОСТАЁТСЯ ПУСТЫМ.
 *
 * ЧЕМ ЭТО ВЫЗВАНО. Позиции Т11 приходят из модели строкой, и модель пишет
 * число так, как оно стояло в документе: «1 234 567,89», «3187750,00 ₽».
 * Дальше строка идёт наравне с разобранной — в своды, сортировки и пороги, где
 * её читает `Number(...)`.
 *
 * ЦЕНА МОЛЧАНИЯ. `Number("1 234,56")` — это NaN, а «NaN > порога» — ЛОЖЬ.
 * Позиция на полтора миллиона молча читается как «порог не превышен», и
 * требование трёх коммерческих предложений снимается само собой. Ни отказа, ни
 * замечания: система рапортует успех. Второй путь той же беды — `decimal()` на
 * границе записи, который на такой строке бросает TypeError.
 *
 * ЧЕГО НЕЛЬЗЯ ДЕЛАТЬ В ОТВЕТ: подставлять ноль. Ноль сложится с настоящими
 * суммами и даст расхождение размером в стоимость объекта (ТЗ §9). Непонятное
 * число остаётся ПУСТЫМ и уходит находкой.
 */
import { describe, expect, it } from "vitest";

import { buildCoordinateIndex, parseCrewOutput, toExtractedRows, числоРоли } from "./crew-output.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

const ВЕДОМОСТЬ = "/партия/Ведомость объёмов.xlsx";

const накопитель = (): CollectedDuringCheck =>
  ({
    documentHashes: [{ path: ВЕДОМОСТЬ, contentHash: "a".repeat(64) }],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  }) as unknown as CollectedDuringCheck;

const ответ = (positions: unknown[]): unknown => ({
  verdict: "🟡 условно",
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

const позиция = (amountRub: string, quantity = "1"): unknown => ({
  document: "Ведомость объёмов.xlsx",
  sheet: "Лист1",
  row: 5,
  ordinal: "1",
  section: "1",
  name: "Устройство основания из щебня",
  code: "",
  unit: "м3",
  quantity,
  amountRub,
});

describe("число, записанное человеком", () => {
  it("разряды пробелами и запятая как десятичная — это число", () => {
    // Так пишут в русских сметах и так модель их и перепишет.
    expect(числоРоли("1 234 567,89")).toBe("1234567.89");
    expect(числоРоли("3187750,00")).toBe("3187750.00");
    expect(числоРоли("72 359.55")).toBe("72359.55");
    // Неразрывный пробел из книги Excel — тот же разделитель разрядов.
    expect(числоРоли("1 250 000,50")).toBe("1250000.50");
  });

  it("знак валюты и минус сохраняют смысл, а не ломают разбор", () => {
    expect(числоРоли("403000 ₽")).toBe("403000");
    expect(числоРоли("15000,00 руб.")).toBe("15000.00");
    // Снятия и возвраты в сметах отрицательны законно.
    expect(числоРоли("-84 000,00")).toBe("-84000.00");
  });

  it("разряды запятыми — английская запись — тоже читается", () => {
    expect(числоРоли("1,234,567.89")).toBe("1234567.89");
    expect(числоРоли("1,234,567")).toBe("1234567");
  });

  it("что понять нельзя — не угадывается", () => {
    // «Примерно три с небольшим миллиона» — это не число, и подставлять сюда
    // 3.2 значило бы выдумать сумму объекта.
    expect(числоРоли("≈3,2 млн")).toBeUndefined();
    expect(числоРоли("от 100 до 200")).toBeUndefined();
    expect(числоРоли("н/д")).toBeUndefined();
    expect(числоРоли("")).toBeUndefined();
  });
});

describe("позиции роли с человеческими числами", () => {
  const index = buildCoordinateIndex(накопитель());

  it("сумма с пробелами и запятой доходит канонической, а не строкой из документа", () => {
    const { rows } = toExtractedRows(parseCrewOutput(ответ([позиция("1 234 567,89", "1 250,5")])), index);

    // Прежде сюда попадала строка как есть, и `Number` на ней давал NaN.
    expect(rows[0]?.amount).toBe("1234567.89");
    expect(rows[0]?.quantity).toBe("1250.5");
    expect(Number(rows[0]?.amount)).toBeGreaterThan(1_000_000);
  });

  it("непонятное число оставляет позицию, но не подставляет ноль", () => {
    const { rows, unreadableNumbers } = toExtractedRows(
      parseCrewOutput(ответ([позиция("≈3,2 млн")])),
      index,
    );

    // Позиция на месте: наименование, единица и строка документа известны.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceName).toBe("Устройство основания из щебня");
    // Сумма не определена — и это не ноль.
    expect(rows[0]?.amount).toBeUndefined();
    // И об этом сказано: человек не должен прочесть пустоту как «цены нет».
    expect(unreadableNumbers).toHaveLength(1);
    expect(unreadableNumbers[0]).toContain("≈3,2 млн");
  });

  it("пустая сумма — законный ответ и в список непрочитанных не идёт", () => {
    const { rows, unreadableNumbers } = toExtractedRows(parseCrewOutput(ответ([позиция("", "")])), index);

    expect(rows[0]?.amount).toBeUndefined();
    expect(unreadableNumbers).toHaveLength(0);
  });
});
