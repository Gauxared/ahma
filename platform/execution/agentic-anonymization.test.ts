/**
 * АГЕНТНЫЙ ЦИКЛ НЕ ХОДИТ К МОДЕЛИ МИМО ОБЕЗЛИЧИВАНИЯ.
 *
 * НАЙДЕНО ЖИВЫМ ПРОГОНОМ, А НЕ ЧТЕНИЕМ КОДА
 *
 * Первый агентный прогон эталонного входа отказал целиком: все четырнадцать
 * вызовов остановил egress-шлюз — «классы [commercial_secret] не выпускаются в
 * исходном виде (ТЗ §12.1л): требуется анонимизация и маскирование».
 *
 * Причина: я построил ВТОРОЙ путь к модели и забыл, что защита стоит на первом.
 * Конвейер обезличивает в композиционном корне, внутри `runAgent`; цикл ходил
 * через порт напрямую. Ни один байт наружу при этом не ушёл — правило fail
 * closed сработало ровно так, как задумано, и остановило прогон ДО отправки.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ
 *
 * Не сам анонимизатор — у него свои наборы. Проверяется, что у цикла ОБЕ точки
 * выхода наружу несут расписку: шаг с инструментами и итоговый шаг со строгой
 * схемой. Забыть одну из двух ровно так же легко, как забыть обе, и живой
 * прогон это уже доказал.
 */
import { describe, expect, it } from "vitest";

import { buildAgenticObjectReviewers } from "./agentic-reviewers.js";
import type { CollectedDuringCheck } from "./check-ports.js";
import type { Platform } from "../bootstrap.js";
import type { AgentTurnRequest } from "../runtime/agent-runtime-port.js";

/** Накопитель обхода с одной разобранной сметой — минимум, чтобы цикл пошёл. */
function накопитель(): CollectedDuringCheck {
  return {
    documentHashes: [{ path: "/о/ЛСР-1.xlsx", contentHash: "a".repeat(64) }],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  } as unknown as CollectedDuringCheck;
}

function платформа(запросы: AgentTurnRequest[], журнал: unknown[] = []): Platform {
  let шагов = 0;

  return {
    recordModelCall: (call: unknown) => журнал.push(call),
    roster: { find: () => undefined, all: () => [], require: () => undefined },
    catalogue: { findByCode: () => undefined },
    agentRuntime: {
      id: "проверочный",
      run: async (request: AgentTurnRequest) => {
        запросы.push(request);
        шагов += 1;

        // Первый вызов — шаг цикла: агент зовёт инструмент. Второй — итоговый
        // со схемой. Так проходятся ОБЕ точки выхода наружу.
        const output =
          шагов === 1
            ? { kind: "tool_calls", content: "", toolCalls: [{ id: "1", name: "list_documents", arguments: "{}" }] }
            : { verdict: "готово", findings: [], openQuestions: [], options: [], sections: [] };

        return {
          threadId: "t",
          contour: "external" as const,
          output,
          provider: "проверочный",
          model: "м",
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    },
  } as unknown as Platform;
}

describe("обезличивание в агентном режиме", () => {
  it("расписку несут ОБА обращения: шаг цикла и итоговый шаг", async () => {
    const запросы: AgentTurnRequest[] = [];
    const рецензенты = buildAgenticObjectReviewers(платформа(запросы), "т", "сейчас")(накопитель());

    await рецензенты[0]!.review({ objectPath: "/о", documents: [] });

    expect(запросы.length, "цикл не дошёл до обеих точек выхода").toBeGreaterThanOrEqual(2);

    for (const [index, запрос] of запросы.entries()) {
      expect(
        запрос.anonymization,
        `обращение ${index + 1} уходит БЕЗ расписки обезличивания: шлюз откажет, и прогон встанет`,
      ).toBeDefined();
      expect(запрос.anonymization?.clean, "расписка выдана с остатком").toBe(true);
    }
  });

  it("расписка относится к ТОМУ, ЧТО УХОДИТ, а не к пустому промпту", async () => {
    /**
     * Цикл шлёт диалог полем `messages`, а `prompt` у него пуст. Расписка,
     * посчитанная по пустому промпту, удостоверяла бы ничто — и адаптер, сверяя
     * её с пустой строкой, пропускал бы любой диалог.
     */
    const запросы: AgentTurnRequest[] = [];
    const рецензенты = buildAgenticObjectReviewers(платформа(запросы), "т", "сейчас")(накопитель());

    await рецензенты[0]!.review({ objectPath: "/о", documents: [] });

    const первый = запросы[0]!;
    expect(первый.messages, "диалог не передан — адаптеру нечего сверять").toBeDefined();
    expect((первый.messages ?? []).length).toBeGreaterThan(0);
    expect(первый.prompt, "промпт обязан быть пустым: содержимое идёт диалогом").toBe("");
  });

  it("КАЖДОЕ обращение цикла попадает в журнал §12.1л", async () => {
    /**
     * НАЙДЕНО СРАВНЕНИЕМ РЕЖИМОВ, а не чтением кода.
     *
     * Первый успешный агентный прогон показал 220 вызовов инструментов — и
     * ДВА обращения к модели в журнале. Журнал ведёт композиционный корень
     * внутри обёртки конвейера; цикл ходит через порт напрямую, и его
     * обращения в §12.1л не попадали.
     *
     * Записанные как два, двести с лишним обращений — это неправда о том,
     * сколько раз система ходила наружу. Журнал существует ровно ради этого
     * числа: по нему считают и стоимость, и объём переданного.
     */
    const запросы: AgentTurnRequest[] = [];
    const журнал: unknown[] = [];
    const рецензенты = buildAgenticObjectReviewers(платформа(запросы, журнал), "т", "сейчас")(накопитель());

    await рецензенты[0]!.review({ objectPath: "/о", documents: [] });

    expect(журнал.length, "обращения цикла не попали в журнал §12.1л").toBe(запросы.length);
    for (const запись of журнал) {
      expect((запись as { anonymized?: boolean }).anonymized, "запись без отметки об обезличивании").toBe(true);
    }
  });

  it("инструменты передаются модели, а не только объявляются", async () => {
    // Иначе агент — тот же ролевой промпт, только с лишним кругом.
    const запросы: AgentTurnRequest[] = [];
    const рецензенты = buildAgenticObjectReviewers(платформа(запросы), "т", "сейчас")(накопитель());

    await рецензенты[0]!.review({ objectPath: "/о", documents: [] });

    const инструменты = запросы[0]?.tools ?? [];
    expect(инструменты.length, "цикл не отправил инструменты").toBeGreaterThan(0);
    expect(инструменты.map((t) => t.name)).toContain("read_positions");
    // Имя латиницей — требование провайдеров; кириллическое даёт 400.
    for (const t of инструменты) expect(t.name).toMatch(/^[a-zA-Z0-9_-]+$/u);
  });
});
