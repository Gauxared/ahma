/**
 * ОТВЕТ РОЛИ → ЗАКЛЮЧЕНИЕ: ссылка, сумма, служебные листы (spec-demo-stage-1 А7).
 *
 * Два правила, за которыми стоят прошлые дефекты конвейера:
 *
 *  · ССЫЛКА И СУММА — РАЗНОЕ (Т9.5а). Ссылка на строку появляется, когда строка
 *    нашлась в разобранном; сумма — когда у строки известны деньги. Первый
 *    агентный режим номер позиции просто выбрасывал, и панель показа была пуста;
 *  · АРИФМЕТИКА ЗА КОДОМ (ADR-V3-010). Сумма влияния берётся из разобранной
 *    строки, а названная ролью без строки — уходит в основание словом
 *    «по оценке роли». Иначе число из ответа модели стало бы числом без следа.
 */
import { describe, expect, it } from "vitest";

import type { CollectedDuringCheck } from "../execution/check-ports.js";
import type { RoleTurn } from "./codex-client.js";
import { buildCoordinateIndex, parseCrewOutput, renderHandoff, toDocumentReview } from "./crew-output.js";

const ДОКУМЕНТ = "/о/партия/сметы/ЛСР-1 Электрика.xlsx";
const ХЭШ = "a".repeat(64);

function накопитель(): CollectedDuringCheck {
  return {
    documentHashes: [{ path: ДОКУМЕНТ, contentHash: ХЭШ }],
    linearPositions: [],
    extracted: [
      { document: ДОКУМЕНТ, ordinal: "7", section: "1", sourceName: "Кабель", basis: "ФССЦ-1", unit: "м", quantity: "150", amount: "48200.00", sourceRow: 46 },
      { document: ДОКУМЕНТ, ordinal: "8", section: "1", sourceName: "Лоток", basis: "ФССЦ-2", unit: "м", quantity: "20", amount: undefined, sourceRow: 47 },
    ],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  } as unknown as CollectedDuringCheck;
}

const ход = (): RoleTurn => ({
  output: undefined,
  finalResponse: "",
  commands: [{ command: "grep -n Кабель сметы/*.tsv", output: "46\tКабель", exitCode: 0 }, { command: "cat нет.md", output: "", exitCode: 1 }],
  searches: [],
  errors: [],
  collab: [],
  inputTokens: 1000,
  outputTokens: 200,
  threadId: "тред-1",
});

function заключение(findings: unknown[], extra: Record<string, unknown> = {}) {
  return toDocumentReview({
    output: parseCrewOutput({ verdict: "🟡 брать с условиями", summary: [], findings, sections: [], openQuestions: [], handoffs: [], assumptions: [], alerts: [], nextTakt: "", ...extra }),
    turn: ход(),
    index: buildCoordinateIndex(накопитель()),
    promptSource: "эталон",
    provider: "codex-sdk@llm.govard.ru",
    model: "модель",
    checkedAt: "2026-09-07T12:00:00.000Z",
  });
}

const находка = (extra: Record<string, unknown>) => ({
  severity: "high",
  statement: "двойной счёт кабеля",
  basis: "[ИСТОЧНИК: ЛСР-1, 2026]",
  document: "",
  row: 0,
  impactRub: "",
  sourceStatus: "факт",
  ...extra,
});

describe("ссылка и сумма", () => {
  it("файл + строка → ссылка на строку листа и сумма ИЗ РАЗОБРАННОЙ строки", () => {
    const r = заключение([находка({ document: "ЛСР-1 Электрика.xlsx", row: 46, impactRub: "99.00" })]);
    const f = r.findings[0]!;

    expect(f.source?.locator).toEqual({ kind: "row", sheet: "ЛСР", row: 46 });
    expect(f.source?.sourceId).toBe(ДОКУМЕНТ);
    expect(f.impact?.value.amount, "сумма взята у модели, а не у разобранной строки").toBe("48200.00");
  });

  it("строка без суммы: ссылка есть, суммы нет — ноль не подставляется", () => {
    const f = заключение([находка({ document: "лср-1", row: 47 })]).findings[0]!;
    expect(f.source?.locator).toEqual({ kind: "row", sheet: "ЛСР", row: 47 });
    expect(f.impact).toBeUndefined();
  });

  it("сумма роли БЕЗ строки не становится влиянием — она уходит в основание словом", () => {
    const f = заключение([находка({ impactRub: "1200000" })]).findings[0]!;
    expect(f.source).toBeUndefined();
    expect(f.impact).toBeUndefined();
    expect(f.basis).toContain("сумма по оценке роли: 1200000 ₽ (⚠ без строки документа)");
  });

  it("строка, которой нет в разобранном, ссылки не даёт", () => {
    const f = заключение([находка({ document: "ЛСР-1 Электрика.xlsx", row: 999 })]).findings[0]!;
    expect(f.source).toBeUndefined();
  });
});

describe("служебные листы и след", () => {
  it("алерт становится находкой critical с деньгами в основании", () => {
    const r = заключение([], { alerts: [{ situation: "КС-2 не подписывают 20 дней", moneyEffect: "4,1 млн ₽", document: "договор п. 6.3", decision: "претензия" }] });
    const alert = r.findings.find((f) => f.statement.startsWith("🚨 АЛЕРТ"))!;
    expect(alert.severity).toBe("critical");
    expect(alert.basis).toContain("денежный эффект: 4,1 млн ₽");
    expect(alert.basis).toContain("нужно решение Артемия: претензия");
  });

  it("резюме, допущения и передачи становятся листами, если роль не завела их сама", () => {
    const r = заключение([], {
      summary: ["🔴 двойной счёт 2,3 млн"],
      assumptions: [{ assumption: "ставка 18 %", verification: "опорная база к такту 2" }],
      handoffs: [{ to: "Ваныч", subject: "потолок 44,1 млн", disputed: "", needed: "к такту 2" }],
    });
    const ids = (r.sections ?? []).map((s) => s.id);
    expect(ids).toEqual(["summary", "assumptions", "handoffs"]);
    expect(r.sections![2]!.rows[0]).toEqual(["Ваныч", "потолок 44,1 млн", "—", "к такту 2"]);
  });

  it("лист каркаса с тем же id (assumptions у Тимофея) НЕ дублируется служебным", () => {
    const r = заключение([], {
      sections: [{ id: "assumptions", title: "Допущения графика", purpose: "…", columns: ["Допущение", "Почему", "Чего не было", "Чем проверить"], rows: [["а", "б", "в", "г"]] }],
      assumptions: [{ assumption: "x", verification: "y" }],
    });
    expect((r.sections ?? []).filter((s) => s.id === "assumptions")).toHaveLength(1);
    expect(r.sections![0]!.columns).toHaveLength(4);
  });

  it("команды оболочки — в след с отпечатком; упавшая команда помечена", () => {
    const r = заключение([]);
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls![0]).toMatchObject({ tool: "shell", arguments: "grep -n Кабель сметы/*.tsv", resultChars: 9 });
    expect(r.toolCalls![1]!.failed).toBe("код выхода 1");
    expect(r.verdict).toContain("[след: 2 команд, 1200 токенов]");
    expect(r.run).toEqual({ threadId: "тред-1", provider: "codex-sdk@llm.govard.ru", model: "модель", inputTokens: 1000, outputTokens: 200 });
  });

  it("сокращённый промпт назван в вердикте словом", () => {
    const r = toDocumentReview({
      output: parseCrewOutput({}),
      turn: ход(),
      index: buildCoordinateIndex(накопитель()),
      promptSource: "доктрина",
      provider: "п",
      model: "м",
      checkedAt: "2026-09-07",
    });
    expect(r.verdict).toContain("вердикт не выдан");
    expect(r.verdict).toContain("БЕЗ ЭТАЛОННОГО ПРОМПТА");
  });

  it("рамка блока — эталонная", () => {
    const block = renderHandoff("Людмила", { to: "Халиля", subject: "Снятие 3,5 млн", disputed: "щебень", needed: "торг к такту 3" });
    expect(block.split("\n")[0]).toMatch(/^▸ БЛОК ДЛЯ ХАЛИЛЯ \(от: Людмила\) ─+$/u);
    expect(block).toContain("Спорная зона: щебень");
    expect(block.trimEnd().endsWith("─────────────────────────────────────────────")).toBe(true);
  });
});
