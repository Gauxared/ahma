/**
 * КООРДИНАТА ЗАМЕЧАНИЯ В АГЕНТНОМ РЕЖИМЕ — против пустой панели показа.
 *
 * НАЙДЕНО НА ЖИВОМ ПРОГОНЕ, а не чтением кода.
 *
 * Панель «Что показать клиенту» была пуста при двухстах сорока семи
 * замечаниях: «Ни одно замечание прогона не несёт координаты в исходном
 * файле». Это не свойство пакета — это свойство РЕЖИМА.
 *
 * Схема ответа агента (`AGENT_OUTPUT_SCHEMA`) требует `impactOrdinal` —
 * порядковый номер позиции, к которой относится вывод, — и модель его
 * возвращает. Конвейер по этому номеру находит строку в книге и вешает на
 * замечание ссылку. Агентный режим номер ПРОСТО ВЫБРАСЫВАЛ при переводе
 * ответа во внутренний вид: брались только `severity`, `statement`, `basis`.
 *
 * Следствие: на ЛЮБОМ агентном прогоне панель для встречи пуста. Режим,
 * который заказчик считает главным, отдавал результат, который нечем
 * показать в документе.
 *
 * ЗДЕСЬ ПРОВЕРЯЕТСЯ, что номер позиции доезжает до ссылки — и что ссылка
 * появляется ДАЖЕ БЕЗ СУММЫ: в смете без стоимостной части денег нет, а
 * строка в книге известна, и именно она нужна на встрече.
 */
import { describe, expect, it } from "vitest";

import { buildAgenticReviewers } from "./agentic-reviewers.js";
import type { CollectedDuringCheck } from "./check-ports.js";
import type { Platform } from "../bootstrap.js";

const ДОКУМЕНТ = "/о/ЛСР-1.xlsx";
const ХЭШ = "a".repeat(64);

/** Накопитель с одной позицией БЕЗ суммы — как в пакете Нижнего Тагила. */
function накопитель(): CollectedDuringCheck {
  return {
    documentHashes: [{ path: ДОКУМЕНТ, contentHash: ХЭШ }],
    linearPositions: [],
    extracted: [
      {
        document: ДОКУМЕНТ,
        ordinal: "7",
        section: "1",
        sourceName: "Устройство основания под фундаменты",
        basis: "ГЭСН08-01-002-02",
        unit: "м3",
        quantity: "25.2",
        amount: undefined,
        sourceRow: 46,
      },
    ],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  } as unknown as CollectedDuringCheck;
}

/** Платформа, чья модель сразу отвечает итогом со ссылкой на позицию 7. */
function платформа(): Platform {
  return {
    recordModelCall: () => undefined,
    roster: { find: () => undefined, all: () => [], require: () => undefined },
    catalogue: { findByCode: () => undefined },
    agentRuntime: {
      id: "проверочный",
      run: async () => ({
        threadId: "t",
        contour: "external" as const,
        output: {
          verdict: "не принимать",
          findings: [
            {
              severity: "critical",
              statement: "Объём не подтверждён рабочей документацией",
              basis: "ГЭСН08-01-002-02, 25.2 м3",
              deviation: "quantity_error",
              impactOrdinal: "7",
            },
          ],
          openQuestions: [],
          options: [],
          sections: [],
        },
        provider: "проверочный",
        model: "м",
        inputTokens: 1,
        outputTokens: 1,
      }),
    },
  } as unknown as Platform;
}

describe("координата замечания в агентном режиме", () => {
  it("номер позиции превращается в ссылку на строку книги", async () => {
    const рецензенты = buildAgenticReviewers(платформа(), "т", "сейчас")(накопитель());
    const обзор = await рецензенты[0]!.review({ path: ДОКУМЕНТ, kind: "лср" }, {} as never);

    const находка = обзор.findings[0];
    expect(находка, "замечание не дошло").toBeDefined();
    expect(
      находка?.source,
      "номер позиции выброшен: панель «Что показать клиенту» останется пустой",
    ).toBeDefined();
    expect(находка?.source?.locator).toEqual({ kind: "row", sheet: "ЛСР", row: 46 });
    expect(находка?.source?.sourceId).toBe(ДОКУМЕНТ);
  });

  it("ссылка есть ДАЖЕ БЕЗ СУММЫ, а сумма влияния — нет", () => {
    /**
     * Разные вещи, и связывать их нельзя. Смета без стоимостной части даёт
     * строку и не даёт денег: показать замечание в документе можно, взвесить
     * его — нельзя. Подставленный ноль объявил бы находку безобидной.
     */
    return buildAgenticReviewers(платформа(), "т", "сейчас")(накопитель())[0]!
      .review({ path: ДОКУМЕНТ, kind: "лср" }, {} as never)
      .then((обзор) => {
        expect(обзор.findings[0]?.source, "ссылки нет").toBeDefined();
        expect(обзор.findings[0]?.impact, "выдумана сумма влияния").toBeUndefined();
      });
  });

  it("номер, которого нет среди позиций, ссылки НЕ даёт", async () => {
    // Модель может назвать позицию, которой в смете нет. Выдать на неё
    // координату значило бы привести читателя в никуда и назвать это следом.
    const platform = платформа();
    const прогон = platform.agentRuntime!.run;
    (platform as { agentRuntime: { run: unknown } }).agentRuntime.run = async (...args: never[]) => {
      const ответ = (await (прогон as (...a: never[]) => Promise<{ output: { findings: { impactOrdinal: string }[] } }>)(
        ...args,
      ));
      ответ.output.findings[0]!.impactOrdinal = "999";
      return ответ;
    };

    const обзор = await buildAgenticReviewers(platform, "т", "сейчас")(накопитель())[0]!.review({ path: ДОКУМЕНТ, kind: "лср" }, {} as never);

    expect(обзор.findings[0]?.source, "выдумана ссылка на несуществующую позицию").toBeUndefined();
  });

  it("агенту СКАЗАНО, когда номер позиции ставить, а когда оставлять пустым", async () => {
    /**
     * НАЙДЕНО СРАЗУ ПОСЛЕ ПРЕДЫДУЩЕЙ ПРАВКИ, живым прогоном.
     *
     * Панель показа заполнилась — и три разные находки об ОБЪЕКТЕ («в
     * комплекте нет рабочих чертежей») получили координату «лист „ЛСР“,
     * строка 46». Строка 46 — первая позиция в каждой из этих книг: модель
     * ставила `impactOrdinal: "1"` просто потому, что схема требует поле, а
     * инструкции, когда его оставлять пустым, в агентном промпте не было.
     *
     * Ложная координата ХУЖЕ отсутствующей: она обещает след и приводит в
     * никуда. Конвейер объясняет это правило каждой роли отдельно — агентный
     * режим не объяснял никому.
     */
    const запросы: { prompt?: string; messages?: readonly { content?: string }[] }[] = [];
    const platform = платформа();
    (platform as { agentRuntime: { run: unknown } }).agentRuntime.run = async (request: never) => {
      запросы.push(request as never);
      return {
        threadId: "t",
        contour: "external" as const,
        output: { verdict: "готово", findings: [], openQuestions: [], options: [], sections: [] },
        provider: "п",
        model: "м",
        inputTokens: 1,
        outputTokens: 1,
      };
    };

    await buildAgenticReviewers(platform, "т", "сейчас")(накопитель())[0]!.review(
      { path: ДОКУМЕНТ, kind: "лср" },
      {} as never,
    );

    const текст = запросы
      .flatMap((з) => [з.prompt ?? "", ...(з.messages ?? []).map((m) => m.content ?? "")])
      .join("\n");

    expect(текст, "агенту не сказано про impactOrdinal — координата будет выдуманной").toContain(
      "impactOrdinal",
    );
    expect(текст, "не сказано, когда поле оставлять пустым").toMatch(/пуст/iu);
  });
});
