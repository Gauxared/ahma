/**
 * Агентный цикл — против того, чтобы «агентность» опять оказалась словом.
 *
 * ПОЧЕМУ ЭТИ НАБОРЫ ВАЖНЕЕ ОБЫЧНЫХ
 *
 * Требование агентности было записано архитектурой (`ADR-V3-002`, `ADR-V3-007`)
 * и обойдено: сделали десять ролевых промптов по одному вызову каждый, а профиль
 * модели объявлял `toolCalling` — возможность, которой не пользовался никакой
 * код. Ни один набор этого не поймал, потому что ни один набор про это не
 * спрашивал.
 *
 * Здесь спрашивается прямо: зовёт ли агент инструменты, доходят ли их
 * результаты обратно, ограничен ли цикл, и попадает ли КАЖДЫЙ вызов в цепочку
 * доказательности.
 */
import { describe, expect, it } from "vitest";

import { runAgentLoop, type LoopMessage, type LoopRuntime, type LoopTurn } from "./agent-loop.js";
import type { AgentTool } from "./agent-tools.js";

const СХЕМА = { type: "object", required: ["verdict"], properties: { verdict: { type: "string" } } };

function инструмент(name: string, ответ: string | (() => Promise<string>)): AgentTool {
  return {
    name,
    description: "проверочный",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    call: typeof ответ === "string" ? async () => ответ : ответ,
  };
}

/** Рантайм, отдающий заранее заданную последовательность шагов. */
function рантайм(
  шаги: readonly LoopTurn[],
  журнал: { messages: LoopMessage[][]; схемы: unknown[] } = { messages: [], схемы: [] },
): LoopRuntime & { журнал: typeof журнал } {
  let i = 0;
  return {
    журнал,
    step: async (messages) => {
      журнал.messages.push([...messages]);
      const шаг = шаги[i] ?? { content: "", toolCalls: [], inputTokens: 0, outputTokens: 0 };
      i += 1;
      return шаг;
    },
    finish: async (messages, schema) => {
      журнал.messages.push([...messages]);
      журнал.схемы.push(schema);
      return { output: { verdict: "готово" }, inputTokens: 5, outputTokens: 3 };
    },
  };
}

describe("агентный цикл", () => {
  it("агент ЗОВЁТ инструмент, и результат возвращается ему в диалог", async () => {
    // Это и есть разница с ролевым промптом: материал агент добывает.
    const рт = рантайм([
      { content: "смотрю позиции", toolCalls: [{ id: "1", name: "read_positions", arguments: "{}" }], inputTokens: 10, outputTokens: 4 },
      { content: "всё ясно", toolCalls: [], inputTokens: 8, outputTokens: 2 },
    ]);

    const итог = await runAgentLoop({
      systemPrompt: "ты сметчик",
      task: "проверь смету",
      tools: [инструмент("read_positions", "1\tГЭСН\tработа\tм2\t10\t1000,00")],
      schema: СХЕМА,
      maxSteps: 5,
      runtime: рт,
    });

    expect(итог.toolCalls).toHaveLength(1);
    expect(итог.toolCalls[0]?.tool).toBe("read_positions");

    // Ответ инструмента ДОЕХАЛ до модели — иначе вызов был бы бессмысленным.
    const последние = рт.журнал.messages.at(-1) ?? [];
    const отИнструмента = последние.filter((m) => m.role === "tool");
    expect(отИнструмента).toHaveLength(1);
    expect(отИнструмента[0]?.content).toContain("ГЭСН");
  });

  it("КАЖДЫЙ вызов инструмента попадает в цепочку доказательности", async () => {
    // Без этого агентный режим теряет то, на чём стоит система: «откуда взято».
    const рт = рантайм([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "read_positions", arguments: '{"document":"ЛСР.xlsx"}' },
          { id: "2", name: "lookup_norm", arguments: '{"code":"ГЭСН01"}' },
        ],
        inputTokens: 10,
        outputTokens: 4,
      },
      { content: "готов", toolCalls: [], inputTokens: 6, outputTokens: 2 },
    ]);

    const итог = await runAgentLoop({
      systemPrompt: "s",
      task: "t",
      tools: [инструмент("read_positions", "позиции"), инструмент("lookup_norm", "норматив")],
      schema: СХЕМА,
      maxSteps: 5,
      runtime: рт,
    });

    expect(итог.toolCalls.map((c) => c.tool)).toEqual(["read_positions", "lookup_norm"]);
    // Доводы записаны: без них видно «звал инструмент», но не видно, о чём спрашивал.
    expect(итог.toolCalls[0]?.arguments).toContain("ЛСР.xlsx");
    expect(итог.toolCalls[1]?.arguments).toContain("ГЭСН01");
    // Отпечаток вместо содержимого: ответ бывает в десятки килобайт.
    expect(итог.toolCalls[0]?.resultDigest).toMatch(/^[0-9a-f]{8}$/u);
    expect(итог.toolCalls[0]?.resultChars).toBeGreaterThan(0);
  });

  it("цикл ОГРАНИЧЕН потолком, и исчерпание названо, а не скрыто", async () => {
    /**
     * Цикл без потолка — счёт за токены без границы. Но и молча оборвать его
     * нельзя: неполный разбор, выданный за полный, — тот же изъян, что зелёный
     * вердикт на неполном обходе.
     */
    const бесконечный: LoopTurn = {
      content: "ещё смотрю",
      toolCalls: [{ id: "x", name: "read_positions", arguments: "{}" }],
      inputTokens: 1,
      outputTokens: 1,
    };

    const рт = рантайм(Array.from({ length: 50 }, () => бесконечный));

    const итог = await runAgentLoop({
      systemPrompt: "s",
      task: "t",
      tools: [инструмент("read_positions", "позиции")],
      schema: СХЕМА,
      maxSteps: 3,
      runtime: рт,
    });

    expect(итог.steps).toBe(3);
    expect(итог.exhausted, "исчерпание потолка не объявлено").toBe(true);

    // И агенту СКАЗАНО, что потолок исчерпан: иначе его вывод будет выглядеть
    // законченным, хотя он таким не является.
    const последние = рт.журнал.messages.at(-1) ?? [];
    expect(JSON.stringify(последние)).toContain("Потолок шагов исчерпан");
  });

  it("отказ инструмента возвращается агенту, а не рвёт прогон", async () => {
    // Одна неудачная попытка не отменяет разбор: агент способен попробовать
    // иначе. Но отказ записывается — иначе он выглядел бы пустым ответом.
    const рт = рантайм([
      { content: "", toolCalls: [{ id: "1", name: "read_sheet", arguments: "{}" }], inputTokens: 2, outputTokens: 1 },
      { content: "понял", toolCalls: [], inputTokens: 2, outputTokens: 1 },
    ]);

    const итог = await runAgentLoop({
      systemPrompt: "s",
      task: "t",
      tools: [
        инструмент("read_sheet", async () => {
          throw new Error("книга не открывается");
        }),
      ],
      schema: СХЕМА,
      maxSteps: 5,
      runtime: рт,
    });

    expect(итог.output).toEqual({ verdict: "готово" });
    expect(итог.toolCalls[0]?.failed).toContain("книга не открывается");
    expect(JSON.stringify(рт.журнал.messages.at(-1))).toContain("инструмент отказал");
  });

  it("выдуманный инструмент получает ОТВЕТ со списком настоящих", async () => {
    // Молчание в ответ на выдуманное имя заставляет агента звать его снова до
    // исчерпания потолка — то есть тратить прогон на тупик.
    const рт = рантайм([
      { content: "", toolCalls: [{ id: "1", name: "delete_estimate", arguments: "{}" }], inputTokens: 2, outputTokens: 1 },
      { content: "понял", toolCalls: [], inputTokens: 2, outputTokens: 1 },
    ]);

    const итог = await runAgentLoop({
      systemPrompt: "s",
      task: "t",
      tools: [инструмент("read_positions", "позиции")],
      schema: СХЕМА,
      maxSteps: 5,
      runtime: рт,
    });

    expect(итог.toolCalls[0]?.failed).toBe("инструмент не существует");
    expect(JSON.stringify(рт.журнал.messages.at(-1))).toContain("read_positions");
  });

  it("итог берётся СТРОГОЙ СХЕМОЙ, а не разбором свободного текста", async () => {
    // Книга пакета и экран собираются из схемы. Разбор прозы здесь недопустим
    // ровно так же, как в конвейере.
    const рт = рантайм([{ content: "готово", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);

    await runAgentLoop({
      systemPrompt: "s",
      task: "t",
      tools: [инструмент("read_positions", "позиции")],
      schema: СХЕМА,
      maxSteps: 5,
      runtime: рт,
    });

    expect(рт.журнал.схемы).toHaveLength(1);
    expect(рт.журнал.схемы[0]).toBe(СХЕМА);
  });

  it("потолок шагов обязателен: нулевой отвергается", async () => {
    await expect(
      runAgentLoop({
        systemPrompt: "s",
        task: "t",
        tools: [],
        schema: СХЕМА,
        maxSteps: 0,
        runtime: рантайм([]),
      }),
    ).rejects.toThrow(/потолок шагов/u);
  });

  it("токены считаются по ВСЕМ шагам, включая итоговый", async () => {
    // Агентный режим дороже конвейера, и на сколько — должно быть видно числом,
    // а не выясняться из счёта провайдера.
    const рт = рантайм([
      { content: "", toolCalls: [{ id: "1", name: "read_positions", arguments: "{}" }], inputTokens: 100, outputTokens: 20 },
      { content: "готов", toolCalls: [], inputTokens: 200, outputTokens: 30 },
    ]);

    const итог = await runAgentLoop({
      systemPrompt: "s",
      task: "t",
      tools: [инструмент("read_positions", "позиции")],
      schema: СХЕМА,
      maxSteps: 5,
      runtime: рт,
    });

    expect(итог.inputTokens).toBe(305);
    expect(итог.outputTokens).toBe(53);
  });
});
