/**
 * Настенька как модельный агент — ТЗ §5.1, §12.2.
 *
 * ГЛАВНОЕ ДЛЯ ЭТОГО АГЕНТА
 *
 *  · «Смет 4, позиций 101» — это РАЗМЕР, а не предмет. Понять, что перед тобой
 *    система видеонаблюдения на переезде, можно только прочитав наименования.
 *  · ДОГАДКА В ПАСПОРТЕ ДОРОЖЕ ДОГАДКИ ГДЕ-ЛИБО ЕЩЁ: паспорт читают все
 *    остальные, и додуманное поле расходится по цепочке уже как факт.
 *  · «ОЖИДАЕТСЯ ПОЗЖЕ» и «ОТСУТСТВУЕТ» — разные вещи. Смешать их значит либо
 *    поднять ложную тревогу, либо скрыть настоящую пропажу.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_OBJECT_PASSPORT, createObjectPassportOperation } from "./run-object-passport.js";
import type { ObjectPassportAgentInput } from "./run-object-passport.js";

const ВХОД: ObjectPassportAgentInput = {
  documentPath: "objects/КРГ-1",
  contentHash: "hash" as Sha256,
  objectCode: "КРГ-1",
  documents: [
    { fileName: "смета-СОТ.xlsx", kind: "лср", status: "проверен" },
    {
      fileName: "КУРГАН_СОТ.pdf",
      kind: "рабочая-документация",
      status: "не поддержан",
      reason: "рабочая документация, а не сметный расчёт",
    },
  ],
  workGroups: [
    { table: "ГЭСНм10-10-001", name: "Камеры видеонаблюдения", count: 4, amount: "6912036.92" },
  ],
  positions: 101,
  declaredTotal: "104976710.00",
  expectedLater: ["финмодель — такт 2", "карта лид-таймов — такт 3"],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

function агент(turn: AgentTurn = ответ({ verdict: "паспорт", findings: [], openQuestions: [], options: [] })) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createObjectPassportOperation({
    prompt: "промпт Настеньки",
    accuracyMarker: () => ({ range: "точно", basis: "документы", heuristic: true }),
    runAgent,
  });

  return { operation, runAgent };
}

async function промпт(overrides: Partial<ObjectPassportAgentInput> = {}): Promise<string> {
  const { operation, runAgent } = агент();
  await operation.run({ ...ВХОД, ...overrides });
  return runAgent.mock.calls[0]![0].prompt;
}

describe("определение операции", () => {
  it("объявляет способность паспорта объекта", () => {
    expect(RUN_OBJECT_PASSPORT.provides).toContain("object_passport");
  });
});

describe("предмет, а не размер", () => {
  it("передаёт наименования работ, а не только счётчики", async () => {
    // По счётчикам нельзя сказать, что это за объект.
    const текст = await промпт();

    expect(текст).toContain("Камеры видеонаблюдения");
    expect(текст).toMatch(/это размер, а не предмет/u);
  });

  it("показывает документы с причиной, по которой не разобраны", async () => {
    const текст = await промпт();

    expect(текст).toContain("КУРГАН_СОТ.pdf");
    expect(текст).toContain("рабочая документация, а не сметный расчёт");
  });
});

describe("ожидаемое позже отличено от пропавшего", () => {
  it("помечает ожидаемое как НЕ пропажу", async () => {
    const текст = await промпт();

    expect(текст).toMatch(/это НЕ пропажа/u);
    expect(текст).toContain("финмодель — такт 2");
  });

  it("ЗАПРЕЩАЕТ додумывать поля", async () => {
    // Паспорт читают все остальные: догадка разойдётся по цепочке как факт.
    const текст = await промпт();

    expect(текст).toMatch(/НЕ ДОДУМЫВАЙ/u);
  });
});

describe("сметная стоимость", () => {
  it("объявляет невыведенной, когда сводного расчёта нет", async () => {
    // Ноль здесь читался бы как «объект бесплатный».
    const { operation, runAgent } = агент();
    const { declaredTotal: _без, ...безИтога } = ВХОД;
    await operation.run(безИтога);

    expect(runAgent.mock.calls[0]![0].prompt).toMatch(/не выведена/u);
  });
});
