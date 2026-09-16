/**
 * УКАЗАТЕЛЬ ДОКУМЕНТОВ ЗНАЕТ ВСЮ ПАРТИЮ — разбор дефекта прогона 15.
 *
 * ЧТО СЛУЧИЛОСЬ. Роли вернули 136 позиций из сметы контракта по 44-ФЗ,
 * ведомости объёмов и обоснования НМЦК. До системы не дошла ни одна: указатель
 * строился из `documentHashes`, а он пополняется ТОЛЬКО при удачном разборе
 * формы 421/пр. У этого комплекта таких смет нет — список был пуст, `resolve`
 * возвращал `undefined` на любое имя, и отбор «позицию, которую не к чему
 * привязать, не берём» выбрасывал всё.
 *
 * То есть проверка, написанная ради честности, давала ГАРАНТИРОВАННЫЙ НОЛЬ
 * ровно в том случае, ради которого требование и заведено. И давала молча:
 * роль отработала, файл ответа записан, счёт позиций пуст.
 *
 * Набор держит оба свойства: документ партии разрешается, ложная координата
 * при этом не появляется.
 */
import { describe, expect, it } from "vitest";

import { buildCoordinateIndex, parseCrewOutput, toExtractedRows } from "./crew-output.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

const ВЕДОМОСТЬ = "/партия/06-3 Ведомость объемов Джанга.xls";

/** Комплект БЕЗ единой сметы по форме 421/пр — как «Дагестан дороги». */
function безСмет(): CollectedDuringCheck {
  return {
    // Пусто: ни одна смета не разобрана, и это законное состояние комплекта.
    documentHashes: [],
    linearPositions: [],
    extracted: [],
    descriptors: [{ path: ВЕДОМОСТЬ, contentHash: "b".repeat(64) }],
    designDocuments: [],
    designSheets: [],
  } as unknown as CollectedDuringCheck;
}

const ответ = (positions: unknown[]): unknown => ({
  verdict: "🟡",
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

describe("комплект без разобранных смет", () => {
  const index = buildCoordinateIndex(безСмет());

  it("документ партии разрешается, хотя смет в комплекте нет", () => {
    expect(index.resolve("06-3 Ведомость объемов Джанга.xls")?.path).toBe(ВЕДОМОСТЬ);
  });

  it("позиции роли доходят до строк, а не выбрасываются отбором", () => {
    const output = parseCrewOutput(
      ответ([
        {
          document: "06-3 Ведомость объемов Джанга.xls",
          sheet: "Ведомость",
          row: 19,
          ordinal: "1",
          section: "Дорожная одежда",
          name: "Устройство основания из щебня",
          code: "",
          unit: "м2",
          quantity: "72359.55",
          amountRub: "",
        },
      ]),
    );

    const { rows } = toExtractedRows(output, index);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.document).toBe(ВЕДОМОСТЬ);
    expect(rows[0]?.acquisition).toBe("agent_normalized");
    // Суммы в ведомости объёмов нет — и ноль сюда не подставляется.
    expect(rows[0]?.amount).toBeUndefined();
  });

  it("ложной координаты при этом не появляется", () => {
    // Разбора не было, значит и суммы по строке система не знает. Ответ
    // «строка неизвестна» — единственный честный: подставить сумму из
    // документа, который никто не разбирал, значило бы выдать чтение за разбор.
    expect(index.amountAt(ВЕДОМОСТЬ, 19)).toEqual({ known: false, amount: undefined });
  });
});
