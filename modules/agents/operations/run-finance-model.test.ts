/**
 * Ваныч как модельный агент — ТЗ §5.1, §6.4, §12.2.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ
 *
 * Только частное: что кладут Ванычу на вход и как это изложено. Общее — схема
 * вывода, отбраковка замечания без основания, режим глубины — проверено в
 * `agent-shell.test.ts`.
 *
 * ГЛАВНОЕ ДЛЯ ЭТОГО АГЕНТА — ГРАНИЦА «ЦЕНА ≠ ЗАТРАТЫ»
 *
 * Его собственный чек-лист приёмки требует: «себестоимость не выводится из
 * смет — смета это цена заказчику, не затраты». Отчёт нарушал это правило до
 * 02.09.2026 (О-76): итог сметы передавался в сценарии как затраты, и маржа
 * выходила втрое меньше.
 *
 * Поэтому промпт обязан НАЗЫВАТЬ сметную стоимость ценой заказчику, а не
 * молча класть её рядом с затратами.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_FINANCE_MODEL, createFinanceModelOperation } from "./run-finance-model.js";
import type { FinanceModelAgentInput } from "./run-finance-model.js";

const ВХОД: FinanceModelAgentInput = {
  documentPath: "objects/КРГ-1",
  contentHash: "hash-объекта" as Sha256,
  declaredTotal: "104976710.00",
  scenarios: [
    {
      id: "базовый",
      revenue: "110000000.00",
      costs: "94000000.00",
      margin: "16000000.00",
      marginShare: "0.1455",
      profitable: true,
    },
    {
      id: "реалистичный",
      revenue: "93500000.00",
      costs: "103400000.00",
      margin: "-9900000.00",
      marginShare: "-0.1059",
      profitable: false,
    },
  ],
  breaksAt: "реалистичный",
  assumption: "числа стресса — допущение: протокол их не задаёт",
  packages: [
    {
      table: "ГЭСНм10-10-001",
      name: "Камеры видеонаблюдения",
      amount: "6912036.92",
      share: "0.0658",
    },
  ],
  moneyCost: {
    days: 30,
    annualRate: "0.21",
    rateSince: "2026-06-01",
    amount: "1811500.00",
  },
  missing: [],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

const ПУСТО = { verdict: "тянем", findings: [], openQuestions: [], options: [] };

function агент(turn: AgentTurn = ответ(ПУСТО)) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createFinanceModelOperation({
    prompt: "промпт Ваныча",
    accuracyMarker: () => ({ range: "±15%", basis: "сценарии", heuristic: true }),
    runAgent,
  });

  return { operation, runAgent };
}

async function промпт(overrides: Partial<FinanceModelAgentInput> = {}): Promise<string> {
  const { operation, runAgent } = агент();
  await operation.run({ ...ВХОД, ...overrides });
  return runAgent.mock.calls[0]![0].prompt;
}

describe("определение операции", () => {
  it("объявляет способность финансовой модели", () => {
    expect(RUN_FINANCE_MODEL.provides).toContain("finance_model");
  });
});

describe("граница «цена заказчику ≠ затраты»", () => {
  it("НАЗЫВАЕТ сметную стоимость ценой заказчику", async () => {
    // Положить смету рядом с затратами и промолчать — ровно тот дефект, что
    // жил в отчёте: маржа считалась как выручка минус смета.
    const текст = await промпт();

    expect(текст).toContain("104976710.00");
    expect(текст).toMatch(/ЦЕНА ЗАКАЗЧИКУ/u);
    expect(текст).toMatch(/не наши\s+затраты/u);
  });

  it("затраты в сценариях НЕ равны сметной стоимости", async () => {
    // Проверка самого образца: если бы вход путал их, тест ниже проходил бы
    // случайно.
    expect(ВХОД.scenarios[0]!.costs).not.toBe(ВХОД.declaredTotal);
  });
});

describe("сценарии доходят до модели", () => {
  it("несёт маржу, долю и точку перелома", async () => {
    const текст = await промпт();

    expect(текст).toContain("16000000.00");
    expect(текст).toContain("0.1455");
    expect(текст).toMatch(/перелом на сценарии «реалистичный»/u);
  });

  it("помечает убыточный сценарий словом, а не только знаком", async () => {
    // «−9 900 000» в столбце легко прочесть как «9 900 000»: минус теряется.
    const текст = await промпт();

    expect(текст).toContain("УБЫТОК");
  });

  it("печатает допущение по стрессу ВСЕГДА", async () => {
    // Протокол числами стресса не задаёт. Молчание сделало бы допущение
    // похожим на цитату из протокола (§9).
    const текст = await промпт();

    expect(текст).toContain("допущение");
  });

  it("ОТСУТСТВИЕ сценариев объявляется, а не замалчивается", async () => {
    // Пустой раздел читался бы как «сценарии сошлись».
    const { operation, runAgent } = агент();
    const { breaksAt: _без, ...безСценариев } = ВХОД;
    await operation.run({ ...безСценариев, scenarios: [] });
    const текст = runAgent.mock.calls[0]![0].prompt;

    expect(текст).toMatch(/СЦЕНАРИИ НЕ ПОСТРОЕНЫ/u);
  });
});

describe("стоимость денег (3.6)", () => {
  it("несёт ставку С ДАТОЙ, а не одно число", async () => {
    // Ставка без даты — не ставка: §6.4 требует значение с датой начала
    // действия, и старая ставка даёт правдоподобно неверную цену денег.
    const текст = await промпт();

    expect(текст).toContain("0.21");
    expect(текст).toContain("2026-06-01");
    expect(текст).toContain("1811500.00");
  });
});

describe("потолки и недостающее", () => {
  it("показывает состав объекта как кандидатов в пакеты", async () => {
    // Как разбивать на пакеты, решает Ваныч; модуль показывает, из чего объект
    // состоит. Без состава потолки назначать не из чего.
    const текст = await промпт();

    expect(текст).toContain("Камеры видеонаблюдения");
    expect(текст).toContain("0.0658");
    expect(текст).toMatch(/ПОТОЛКИ/u);
  });

  it("ПЕРЕЧИСЛЯЕТ, чего не хватает, а не намекает", async () => {
    const текст = await промпт({ missing: ["график платежей", "рыночные цены"] });

    expect(текст).toContain("график платежей");
    expect(текст).toContain("рыночные цены");
  });

  it("запрещает выдумывать дату разрыва", async () => {
    // Дата, выдуманная моделью, выглядит посчитанной и попадает в решение.
    const текст = await промпт();

    expect(текст).toMatch(/НЕ ВЫДУМЫВАЙ дату/u);
  });
});

describe("предмет — объект, а не позиция", () => {
  it("оставляет влияние НЕЗАПОЛНЕННЫМ, а не нулевым", async () => {
    // Замечание «маржа за коридором» не относится к строке сметы. Ноль здесь
    // означал бы «влияния нет» (§9).
    const { operation } = агент(
      ответ({
        verdict: "риск",
        findings: [
          {
            severity: "high",
            statement: "маржа ниже коридора",
            basis: "сценарий реалистичный: −10,59%",
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
