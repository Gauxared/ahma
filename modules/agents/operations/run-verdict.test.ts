/**
 * Артемий как агент синтеза — ТЗ §5.1, §5.3, §12.2.
 *
 * ГЛАВНОЕ ДЛЯ ЭТОГО АГЕНТА
 *
 *  · Он ЧИТАЕТ замечания остальных. Пустой список означал бы вердикт по
 *    объекту, о котором никто ничего не сказал.
 *  · ОТКАЗ смежника — не отсутствие мнения, а отсутствие проверки. Промолчав о
 *    нём, вердикт оказался бы полнее, чем есть основания.
 *  · МАРЖА И ВЛИЯНИЕ ЗАМЕЧАНИЙ НЕ СКЛАДЫВАЮТСЯ: разные величины, и их сумма не
 *    значит ничего, а выглядит итогом.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_VERDICT, createVerdictOperation } from "./run-verdict.js";
import type { VerdictAgentInput } from "./run-verdict.js";

const ВХОД: VerdictAgentInput = {
  documentPath: "objects/КРГ-1",
  contentHash: "hash" as Sha256,
  walkVerdict: "принято",
  gates: [
    { id: "§12.1б", passed: true, detail: "сошлось смет: 4" },
    { id: "агент", passed: false, detail: "не обозрено: смета Б (endpoint недоступен)" },
  ],
  peers: [
    {
      capability: "estimate_review",
      verdict: "смета обоснована",
      findings: [{ severity: "high", statement: "нерасшифрованный комплект поз. 89" }],
    },
    {
      capability: "procurement_map",
      verdict: "закупать нельзя",
      findings: [{ severity: "critical", statement: "марка камер не указана" }],
      error: undefined,
    },
    {
      capability: "finance_model",
      verdict: "",
      findings: [],
      error: "модель недоступна",
    },
  ],
  missing: ["выручка по договору"],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

function агент(turn: AgentTurn = ответ({ verdict: "🟡", findings: [], openQuestions: [], options: [] })) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createVerdictOperation({
    prompt: "промпт Артемия",
    accuracyMarker: () => ({ range: "±20%", basis: "синтез", heuristic: true }),
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
  it("объявляет способность вердикта", () => {
    expect(RUN_VERDICT.provides).toContain("object_verdict");
  });
});

describe("он видит сказанное смежниками", () => {
  it("несёт замечания каждого агента с его именем", async () => {
    // Без имени агента в сорока замечаниях нельзя понять, кто автор, и
    // противоречие между смежниками не обнаружить.
    const текст = await промпт();

    expect(текст).toContain("estimate_review");
    expect(текст).toContain("нерасшифрованный комплект поз. 89");
    expect(текст).toContain("procurement_map");
    expect(текст).toContain("марка камер не указана");
  });

  it("ОТКАЗ смежника назван отказом, а не пустым мнением", async () => {
    // Промолчав об отказе, вердикт оказался бы полнее, чем есть основания.
    const текст = await промпт();

    expect(текст).toMatch(/finance_model: ОТКАЗ — модель недоступна/u);
  });

  it("несёт итог обхода и исход гейтов", async () => {
    const текст = await промпт();

    expect(текст).toContain("ИТОГ ОБХОДА");
    expect(текст).toMatch(/НЕ ПРОЙДЕН · агент/u);
  });
});

describe("запреты вердикта", () => {
  it("ЗАПРЕЩАЕТ складывать маржу с влиянием замечаний", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/НЕ СКЛАДЫВАЙ маржу с влиянием/u);
  });

  it("требует цену вопроса у каждого условия входа", async () => {
    // Условие без цены — пожелание: его не с чем сравнить и нечем взвесить.
    const текст = await промпт();

    expect(текст).toMatch(/Условие без цены это пожелание/u);
  });

  it("требует примортем ДО вердикта", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/Примортем после вердикта — оправдание/u);
  });
});

describe("предмет — объект целиком", () => {
  it("оставляет влияние незаполненным", async () => {
    const { operation } = агент(
      ответ({
        verdict: "🟡 идём при условиях",
        findings: [
          {
            severity: "high",
            statement: "закупка заблокирована спецификацией",
            basis: "procurement_map: марка камер не указана",
            deviation: "none",
            impactOrdinal: "",
          },
        ],
        openQuestions: [],
        options: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact).toBeUndefined();
  });
});
