/**
 * ВЕРДИКТ НЕ БЫВАЕТ МЯГЧЕ СОБСТВЕННЫХ НАХОДОК.
 *
 * ЗАМЕРЕНО ПО БОЕВОЙ БАЗЕ 09.09.2026: у сметчика стоял вердикт «🟢
 * арифметически принимаем» — и под ним ЧЕТЫРЕ находки уровня critical/high.
 * Ещё один случай с одной находкой. Человек, читающий сводку, видит зелёный
 * кружок и дальше не идёт: цвет вердикта — это то, ради чего сводку открывают.
 *
 * ЭТО НЕ ОШИБКА МОДЕЛИ, А СВОЙСТВО ЯЗЫКА. «Арифметически принимаем, НО
 * содержание не подтверждено» — фраза целиком верная; зелёной её делает первое
 * слово, красной — второе. Одно слово переворачивает смысл, и читатель сводки
 * видит только первое.
 *
 * ПОЧЕМУ ЦВЕТ МЕНЯЕМ, А СЛОВА — НЕТ. Цвет считается по её же находкам: это
 * арифметика над данными роли, а не наше суждение вместо её. Формулировка
 * остаётся дословной, подмена объявляется в той же строке.
 */
import { describe, expect, it } from "vitest";

import { buildCoordinateIndex, parseCrewOutput, toDocumentReview } from "./crew-output.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";
import type { RoleTurn } from "./codex-client.js";

const пусто = (): CollectedDuringCheck =>
  ({
    documentHashes: [],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  }) as unknown as CollectedDuringCheck;

const ход = (): RoleTurn =>
  ({
    output: undefined,
    finalResponse: "",
    commands: [],
    searches: [],
    errors: [],
    collab: [],
    threadId: "t",
    inputTokens: 1,
    outputTokens: 1,
  }) as unknown as RoleTurn;

const находка = (severity: string) => ({
  severity,
  statement: "Ресурсная расшифровка отсутствует",
  basis: "06-1, строка 84",
  document: "",
  row: 0,
  impactRub: "",
  sourceStatus: "факт",
});

function заключение(verdict: string, severities: readonly string[]) {
  const output = parseCrewOutput({
    verdict,
    summary: [],
    findings: severities.map(находка),
    positions: [],
    sections: [],
    openQuestions: [],
    handoffs: [],
    returns: [],
    assumptions: [],
    alerts: [],
    nextTakt: "",
    lesson: "",
  });

  return toDocumentReview({
    output,
    turn: ход(),
    index: buildCoordinateIndex(пусто()),
    promptSource: "эталон",
    provider: "тест",
    model: "м",
    checkedAt: "2026-09-09T10:00:00.000Z",
  });
}

describe("цвет вердикта против находок", () => {
  it("зелёный при критической находке становится красным, и подмена объявлена", () => {
    const review = заключение("🟢 арифметически принимаем, содержание не подтверждено", ["critical", "high"]);

    expect(review.verdict).toContain("🔴");
    expect(review.verdict).not.toContain("🟢 арифметически");
    // Читатель обязан видеть, что цвет поднят нами, а не выставлен ролью.
    expect(review.verdict).toContain("ЦВЕТ ПОДНЯТ ПО СОБСТВЕННЫМ НАХОДКАМ");
    expect(review.verdict).toContain("1 критических");
    // Слова роли сохранены дословно: подменять её формулировку мы не вправе.
    expect(review.verdict).toContain("арифметически принимаем, содержание не подтверждено");
  });

  it("зелёный при важной находке становится жёлтым, а не красным", () => {
    const review = заключение("🟢 принимаем", ["high", "medium"]);

    expect(review.verdict).toContain("🟡");
    expect(review.verdict).toContain("1 важных");
  });

  it("зелёный без важных находок остаётся зелёным", () => {
    const review = заключение("🟢 принимаем без условий", ["medium", "low", "info"]);

    expect(review.verdict).toContain("🟢");
    expect(review.verdict).not.toContain("ЦВЕТ ПОДНЯТ");
  });

  it("красный вердикт без находок НЕ смягчается", () => {
    // Роль могла увидеть то, чего не выразила находкой; понижать её тревогу
    // арифметикой нельзя — это уже наше суждение вместо её.
    const review = заключение("🔴 не принимаем: договор не заполнен", []);

    expect(review.verdict).toContain("🔴");
    expect(review.verdict).not.toContain("ЦВЕТ ПОДНЯТ");
  });
});
