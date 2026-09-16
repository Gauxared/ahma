/**
 * Халиль как модельный агент — ТЗ §5.1, §12.2.
 *
 * ДВЕ ВЕЩИ, КОТОРЫЕ ДОЛЖНЫ ДЕРЖАТЬСЯ ОДНОВРЕМЕННО
 *
 *  · СКОРИНГА НЕТ. «Скоринг без финотчётности не существует», «три кандидата —
 *    один кандидат не выбор». Реестра кандидатов нет, и модель, у которой
 *    спросить «кого нанять», назовёт правдоподобные компании — то есть выдаст
 *    приглашение позвонить по выдуманному телефону.
 *  · ВЕДОМОСТЬ РАСПРЕДЕЛЕНИЯ ЕСТЬ. Легаси называет её СТАРТОМ: «до любого
 *    разговора о субподрядчике». Для неё нужен состав работ, и он есть.
 *
 * И третье, что легко потерять: сумма ГРУППЫ не равна сумме ПОЗИЦИИ. Подставить
 * итог группы в замечание об одной строке значило бы приписать ей чужие деньги.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_SUBCONTRACT_PLAN, createSubcontractPlanOperation } from "./run-subcontract-plan.js";
import type { SubcontractPlanAgentInput } from "./run-subcontract-plan.js";

const ВХОД: SubcontractPlanAgentInput = {
  documentPath: "objects/КРГ-1",
  contentHash: "hash-объекта" as Sha256,
  packages: [
    {
      table: "ГЭСНм10-06-035",
      name: "Кабель волоконно-оптический, прокладка",
      count: 14,
      groupAmount: "34210000.00",
      ordinal: "9",
      ordinalAmount: "479128.46",
      sourceRow: 21,
    },
    {
      table: "ГЭСНп02-01-011",
      name: "Пусконаладочные работы систем безопасности",
      count: 6,
      groupAmount: "4120000.00",
      ordinal: "77",
      ordinalAmount: "1980400.10",
      sourceRow: 118,
    },
  ],
  hasCandidates: false,
  missing: ["реестр субподрядчиков", "финотчётность кандидатов за последний год"],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

const ПУСТО = { verdict: "ведомость не собрана", findings: [], openQuestions: [], options: [] };

function агент(turn: AgentTurn = ответ(ПУСТО)) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createSubcontractPlanOperation({
    prompt: "промпт Халиля",
    accuracyMarker: () => ({ range: "±10%", basis: "состав работ", heuristic: true }),
    runAgent,
  });

  return { operation, runAgent };
}

async function промпт(вход: SubcontractPlanAgentInput = ВХОД): Promise<string> {
  const { operation, runAgent } = агент();
  await operation.run(вход);
  return runAgent.mock.calls[0]![0].prompt;
}

describe("определение операции", () => {
  it("объявляет способность распределения работ", () => {
    expect(RUN_SUBCONTRACT_PLAN.provides).toContain("subcontract_plan");
  });
});

describe("скоринга нет, и это сказано вслух", () => {
  it("объявляет, что скоринг не выполняется", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/РЕЕСТРА КАНДИДАТОВ НЕТ/u);
    expect(текст).toMatch(/скоринг без\s*\n?финотчётности не существует/iu);
  });

  it("прямо запрещает называть компании", async () => {
    // Правдоподобное имя в отчёте о субподряде — это приглашение позвонить по
    // выдуманному телефону.
    const текст = await промпт();

    expect(текст).toMatch(/НЕ НАЗЫВАЙ конкретных компаний, ИНН и контактов/u);
  });

  it("ставит запрет ДО состава работ", async () => {
    const текст = await промпт();

    expect(текст.indexOf("РЕЕСТРА КАНДИДАТОВ НЕТ")).toBeLessThan(текст.indexOf("ГРУППЫ РАБОТ"));
  });

  it("молчит об этом, когда реестр есть", async () => {
    const текст = await промпт({ ...ВХОД, hasCandidates: true, missing: [] });

    expect(текст).not.toMatch(/РЕЕСТРА КАНДИДАТОВ НЕТ/u);
  });

  it("запрещает выдумывать сроки мобилизации и цену перебазировки", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/НЕ ВЫДУМЫВАЙ/u);
  });
});

describe("ведомость распределения (3.1)", () => {
  it("требует свои силы или субподряд с обоснованием по каждой группе", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/свои силы или субподряд, и ОБОСНОВАНИЕ/u);
  });

  it("называет признак, по которому решают, — не сумму и не шифр", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/своя\s*\n?\s*технология, свой допуск и свои люди/u);
  });

  it("проводит границу с материалом (граница с Мариной)", async () => {
    // Пакет «на 10 млн», из которых 8 млн материал, отдаётся не тот, что думали.
    const текст = await промпт();

    expect(текст).toMatch(/ГРАНИЦА С МАТЕРИАЛОМ/u);
  });

  it("требует сценарий Г там, где отказ останавливает объект", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/СЦЕНАРИЙ Г/u);
  });

  it("передаёт группы работ с итогами", async () => {
    const текст = await промпт();

    expect(текст).toContain("Пусконаладочные работы систем безопасности");
    expect(текст).toContain("34210000.00");
  });
});

describe("сумма группы не подменяет сумму позиции", () => {
  it("в основание идут деньги той строки, на которую сослались", async () => {
    // Группа «прокладка ВОК» стоит 34,2 млн, а позиция 9 — 479 тыс. Замечание
    // об одной строке с суммой всей группы приписало бы ей чужие деньги.
    const { operation } = агент(
      ответ({
        verdict: "ведомость собрана",
        findings: [
          {
            severity: "major",
            statement: "прокладка ВОК — субподряд: своя техника и допуск, своих людей нет",
            basis: "поз. 9, ГЭСНм10-06-035-01",
            deviation: "none",
            impactOrdinal: "9",
          },
        ],
        openQuestions: [],
        options: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact?.value.amount).toBe("479128.46");
    expect(body.findings[0]!.impact?.value.amount).not.toBe("34210000.00");
  });
});
