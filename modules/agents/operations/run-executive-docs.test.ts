/**
 * Палыч как модельный агент — ТЗ §5.1, §12.2.
 *
 * ГЛАВНОЕ ДЛЯ ЭТОГО АГЕНТА — ДВА ТРЕБОВАНИЯ ЕГО СТАНДАРТОВ
 *
 *  · СКРЫТЫЕ РАБОТЫ (3.3). Признак не в шифре и не в единице, а в
 *    последовательности работ: подстилающий слой закрывается покрытием, кабель
 *    в лотке — крышкой, камера не закрывается ничем. Пропущенный акт не создаёт
 *    замечания в смете и обнаруживается на объекте, когда работа уже закрыта.
 *  · ДЕНЬГИ У КАЖДОГО ЗАМЕЧАНИЯ (3.2): «алерт без денежного последствия не
 *    засчитывается». Риск без суммы остаётся без веса.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_EXECUTIVE_DOCS, createExecutiveDocsOperation } from "./run-executive-docs.js";
import type { ExecutiveDocsAgentInput } from "./run-executive-docs.js";

const ВХОД: ExecutiveDocsAgentInput = {
  documentPath: "objects/КРГ-1",
  contentHash: "hash-объекта" as Sha256,
  works: [
    {
      ordinal: "14",
      name: "Устройство подстилающего слоя из щебня",
      basis: "ГЭСН27-04-001-01",
      unit: "м3",
      quantity: "1110",
      amount: "2664000.00",
      sourceRow: 47,
    },
    {
      ordinal: "81",
      name: "Камеры видеонаблюдения: наружная",
      basis: "ГЭСНм10-10-001-02",
      unit: "шт",
      quantity: "48",
      amount: "6912036.92",
      sourceRow: 120,
    },
  ],
  startChecklistOpen: ["приказы о назначении ответственных не подписаны"],
  missing: ["график работ", "план закрытия"],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

const ПУСТО = { verdict: "реестр не собран", findings: [], openQuestions: [], options: [] };

function агент(turn: AgentTurn = ответ(ПУСТО)) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createExecutiveDocsOperation({
    prompt: "промпт Палыча",
    accuracyMarker: () => ({ range: "±10%", basis: "состав работ", heuristic: true }),
    runAgent,
  });

  return { operation, runAgent };
}

async function промпт(): Promise<string> {
  const { operation, runAgent } = агент();
  await operation.run(ВХОД);
  return runAgent.mock.calls[0]![0].prompt;
}

describe("определение операции", () => {
  it("объявляет способность исполнительной документации", () => {
    expect(RUN_EXECUTIVE_DOCS.provides).toContain("executive_docs");
  });
});

describe("скрытые работы (3.3)", () => {
  it("передаёт состав и просит назвать закрываемые последующими", async () => {
    const текст = await промпт();

    expect(текст).toContain("Устройство подстилающего слоя из щебня");
    expect(текст).toContain("Камеры видеонаблюдения: наружная");
    expect(текст).toMatch(/СКРЫТЫЕ РАБОТЫ/u);
  });

  it("называет цену ошибки, а не только правило", async () => {
    // «Требуется акт» — это регламент. «Закрыли без акта — вскрытие за свой
    // счёт» — это причина, по которой его не забудут.
    const текст = await промпт();

    expect(текст).toMatch(/вскрытие\s+за свой счёт/u);
  });
});

describe("деньги обязательны (3.2)", () => {
  it("требует денежного последствия у КАЖДОГО замечания", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/Алерт без денег не засчитывается/u);
  });

  it("подставляет сумму под угрозой из сметы", async () => {
    // Сумма из ответа модели была бы числом без следа (§12.1д).
    const { operation } = агент(
      ответ({
        verdict: "риск",
        findings: [
          {
            severity: "critical",
            statement: "подстилающий слой закрывается покрытием — нужен акт до закрытия",
            basis: "поз. 14, ГЭСН27-04-001-01",
            deviation: "none",
            impactOrdinal: "14",
          },
        ],
        openQuestions: [],
        options: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact?.value.amount).toBe("2664000.00");
  });
});

describe("чек-лист старта и границы", () => {
  it("сообщает незакрытые пункты чек-листа", async () => {
    // Незакрытый чек-лист — это «выход на объект преждевременный» (3.1), и
    // знать об этом надо до разговора о скрытых работах.
    const текст = await промпт();

    expect(текст).toContain("приказы о назначении ответственных не подписаны");
  });

  it("ЗАПРЕЩАЕТ выдумывать даты", async () => {
    // «За десять дней до закрытия» без даты закрытия — не срок, а формулировка.
    const текст = await промпт();

    expect(текст).toMatch(/ДАТЫ НЕ ВЫДУМЫВАЙ/u);
  });

  it("перечисляет недостающее", async () => {
    const текст = await промпт();

    expect(текст).toContain("график работ");
    expect(текст).toContain("план закрытия");
  });
});
