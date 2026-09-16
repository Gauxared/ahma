/**
 * Марина как модельный агент — ТЗ §5.1, §12.2.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ
 *
 * Только частное: что кладут Марине на вход и как это изложено. Общее —
 * в `agent-shell.test.ts`.
 *
 * ГЛАВНОЕ ДЛЯ ЭТОГО АГЕНТА — ДВА ЗАПРЕТА
 *
 *  · НЕ ВЫДУМЫВАТЬ ЛИД-ТАЙМ. Срок поставки берётся из коммерческого
 *    предложения. Названный по памяти выглядит проверенным и уводит
 *    планирование на недели, а `reverseDeadline`, получив его, оформит догадку
 *    следом формулы с провенансом.
 *  · НЕ ЗАШИВАТЬ ПОРОГ. Правило трёх КП начинается со ста тысяч, и это число
 *    живёт в расчётном модуле. Повторить его в промпте значит завести второе
 *    место правды.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_PROCUREMENT, createProcurementOperation } from "./run-procurement.js";
import type { ProcurementAgentInput } from "./run-procurement.js";

const ВХОД: ProcurementAgentInput = {
  documentPath: "objects/КРГ-1",
  contentHash: "hash-объекта" as Sha256,
  quotesThreshold: "100000",
  candidates: [
    {
      ordinal: "81",
      name: "Камеры видеонаблюдения: наружная",
      basis: "ГЭСНм10-10-001-02",
      unit: "шт",
      quantity: "48",
      amount: "6912036.92",
      requiresThreeQuotes: true,
      sourceRow: 120,
    },
    {
      ordinal: "14",
      name: "Прокладка кабеля в лотках",
      basis: "ГЭСНм20-03-035-01",
      unit: "м",
      quantity: "600",
      amount: "45000.00",
      requiresThreeQuotes: false,
      sourceRow: 47,
    },
  ],
  missing: ["лид-таймы поставщиков", "коммерческие предложения"],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

const ПУСТО = { verdict: "карта не построена", findings: [], openQuestions: [], options: [] };

function агент(turn: AgentTurn = ответ(ПУСТО)) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createProcurementOperation({
    prompt: "промпт Марины",
    accuracyMarker: () => ({ range: "±20%", basis: "состав сметы", heuristic: true }),
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
  it("объявляет способность карты закупки", () => {
    expect(RUN_PROCUREMENT.provides).toContain("procurement_map");
  });
});

describe("отделить закупаемое от выполняемого", () => {
  it("передаёт работы и ресурсы ВПЕРЕМЕШКУ и говорит об этом", async () => {
    // Стандарт 3.2 требует «топ-5 ТМЦ по стоимости». Что вообще ТМЦ, правилом
    // не определить: признак не в шифре и не в единице, а в том, что названо.
    const текст = await промпт();

    expect(текст).toContain("Камеры видеонаблюдения: наружная");
    expect(текст).toContain("Прокладка кабеля в лотках");
    expect(текст).toMatch(/ВПЕРЕМЕШКУ/u);
  });

  it("прямо просит отделить материалы от работ", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/отдели товарно-материальные ценности/u);
    expect(текст).toMatch(/Работа и монтаж не твои/u);
  });
});

describe("порог трёх КП приходит из модуля", () => {
  it("несёт порог числом, а не словами", async () => {
    const текст = await промпт();

    expect(текст).toContain("100000");
  });

  it("помечает позиции, к которым правило применимо", async () => {
    // Дорогая помечена, дешёвая — нет: иначе модель разметит их сама и
    // разойдётся с расчётным модулем.
    const текст = await промпт();
    const дорогая = текст.split("\n").find((line) => line.includes("Камеры"))!;
    const дешёвая = текст.split("\n").find((line) => line.includes("Прокладка"))!;

    expect(дорогая).toContain("[нужны 3 КП]");
    expect(дешёвая).not.toContain("[нужны 3 КП]");
  });
});

describe("лид-таймы не выдумываются", () => {
  it("ЗАПРЕЩАЕТ называть срок по памяти", async () => {
    // Названный по памяти срок выглядит проверенным. Попав в reverseDeadline,
    // он оформит догадку следом формулы с провенансом — то есть выдаст себя
    // за расчёт.
    const текст = await промпт();

    expect(текст).toMatch(/выдумывать их НЕЛЬЗЯ/u);
    expect(текст).toMatch(/из\s+коммерческого предложения/u);
  });

  it("перечисляет отсутствующее, а не намекает", async () => {
    const текст = await промпт();

    expect(текст).toContain("лид-таймы поставщиков");
    expect(текст).toContain("коммерческие предложения");
  });

  it("просит назвать, для каких позиций срок нужен первым", async () => {
    // Это и есть «первые четыре часа на объекте» стандарта 3.2.
    const текст = await промпт();

    expect(текст).toMatch(/для каких позиций срок нужен первым/u);
  });
});

describe("влияние берётся из сметы", () => {
  it("подставляет сумму и строку позиции по её номеру", async () => {
    const { operation } = агент(
      ответ({
        verdict: "нужна расшифровка",
        findings: [
          {
            severity: "high",
            statement: "марка камер не указана — закупать нельзя",
            basis: "поз. 81, ГЭСНм10-10-001-02",
            deviation: "none",
            impactOrdinal: "81",
          },
        ],
        openQuestions: [],
        options: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact?.value.amount).toBe("6912036.92");
  });
});
