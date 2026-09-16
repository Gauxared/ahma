/**
 * Виктор как модельный агент — ТЗ §5.1, §12.2.
 *
 * ГЛАВНОЕ В НЁМ — ГРАНИЦА МЕЖДУ «ПРОЧИТАЛ» И «ПРЕДПОЛОЖИЛ»
 *
 * Первый протокол легаси: «документ целиком, фрагмент договора не аудируется».
 * Текста договора нет вообще — значит red-flag аудита нет. Модель, которую об
 * этом не предупредили, напишет правдоподобное «вероятно, штраф 0,1%/день», и
 * читатель примет сочинение за прочитанный документ.
 *
 * Что при этом ОСТАЁТСЯ выполнимым: матрица разграничения объёма (дельта В-4,
 * снятая на этом же курганском объекте) и перечень условий, которые договор
 * обязан содержать при ТАКОМ составе работ.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_CONTRACT_AUDIT, createContractAuditOperation } from "./run-contract-audit.js";
import type { ContractAuditAgentInput } from "./run-contract-audit.js";

const ВХОД: ContractAuditAgentInput = {
  documentPath: "objects/КРГ-1",
  contentHash: "hash-объекта" as Sha256,
  works: [
    {
      ordinal: "29",
      name: "Установка анкеров железобетонных в направляющих котлованах",
      basis: "ГЭСН28-01-004-02",
      unit: "шт",
      quantity: "112",
      amount: "10141552.64",
      sourceRow: 63,
    },
    {
      ordinal: "9",
      name: "Кабель волоконно-оптический, прокладка в грунте",
      basis: "ГЭСНм10-06-035-01",
      unit: "км",
      quantity: "7.4",
      amount: "479128.46",
      sourceRow: 21,
    },
  ],
  hasContractText: false,
  missing: ["текст договора", "сторона сделки: генподряд или субподряд"],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

const ПУСТО = { verdict: "аудит невозможен", findings: [], openQuestions: [], options: [] };

function агент(turn: AgentTurn = ответ(ПУСТО), вход: ContractAuditAgentInput = ВХОД) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createContractAuditOperation({
    prompt: "промпт Виктора",
    accuracyMarker: () => ({ range: "±10%", basis: "состав работ", heuristic: true }),
    runAgent,
  });

  return { operation, runAgent, вход };
}

async function промпт(вход: ContractAuditAgentInput = ВХОД): Promise<string> {
  const { operation, runAgent } = агент(ответ(ПУСТО), вход);
  await operation.run(вход);
  return runAgent.mock.calls[0]![0].prompt;
}

describe("определение операции", () => {
  it("объявляет способность договорного аудита", () => {
    expect(RUN_CONTRACT_AUDIT.provides).toContain("contract_audit");
  });
});

describe("отсутствие договора объявляется, а не обходится", () => {
  it("говорит, что red-flag аудит не выполняется", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/ТЕКСТА ДОГОВОРА НЕТ/u);
    expect(текст).toMatch(/НЕ ВЫПОЛНЯЕТСЯ/u);
  });

  it("ставит это ДО состава работ", async () => {
    // Увидев сначала состав, модель начнёт аудировать договор, которого ей не
    // показывали, и предупреждение внизу уже ничего не изменит.
    const текст = await промпт();

    expect(текст.indexOf("ТЕКСТА ДОГОВОРА НЕТ")).toBeLessThan(текст.indexOf("СОСТАВ РАБОТ"));
  });

  it("запрещает выдумывать условия договора", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/НЕ ВЫДУМЫВАЙ УСЛОВИЙ ДОГОВОРА/u);
    expect(текст).toMatch(/сочинение на тему договора/u);
  });

  it("молчит об этом, когда договор есть", async () => {
    const текст = await промпт({ ...ВХОД, hasContractText: true, missing: [] });

    expect(текст).not.toMatch(/ТЕКСТА ДОГОВОРА НЕТ/u);
  });
});

describe("что он делает вместо аудита", () => {
  it("требует матрицу разграничения объёма (В-4)", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/РАЗГРАНИЧЕНИЕ ОБЪЁМА/u);
    expect(текст).toMatch(/давальческий материал/u);
    expect(текст).toMatch(/подписанный убыток/u);
  });

  it("просит условия, привязанные к ЭТОМУ составу работ", async () => {
    // «В договоре должен быть порядок ДС» — общее место, оно верно для любого
    // договора и потому бесполезно.
    const текст = await промпт();

    expect(текст).toMatch(/Условие без привязки к составу работ — общее место/u);
  });

  it("передаёт состав работ с суммами", async () => {
    const текст = await промпт();

    expect(текст).toContain("Установка анкеров железобетонных в направляющих котлованах");
    expect(текст).toContain("10141552.64");
  });

  it("требует аргументы второй стороны у каждой правки", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/ТРЕТЬЯ КОЛОНКА/u);
  });
});

describe("риск в рублях (протокол 2)", () => {
  it("требует цифру, а не слово «опасно»", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/«опасно» без цифры не существует/u);
  });

  it("подставляет сумму из сметы, а не из ответа модели", async () => {
    // Число из ответа модели было бы числом без следа (§12.1д).
    const { operation } = агент(
      ответ({
        verdict: "🟡 подписывать после правок",
        findings: [
          {
            severity: "critical",
            statement: "принадлежность анкеров не разграничена: материал заказчика или наш",
            basis: "поз. 29, ГЭСН28-01-004-02",
            deviation: "none",
            impactOrdinal: "29",
          },
        ],
        openQuestions: [],
        options: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact?.value.amount).toBe("10141552.64");
  });
});
