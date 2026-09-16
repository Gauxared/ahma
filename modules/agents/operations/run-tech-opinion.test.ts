/**
 * Тесты написаны до реализации. Денчик как модельный агент — ТЗ §5.1, §12.2,
 * ADR-R-011.
 *
 * ВТОРОЙ МОДЕЛЬНЫЙ АГЕНТ, И ПЕРВЫЙ НА ОБОЛОЧКЕ
 *
 * Всё, что общее — схема вывода, отбраковка замечания без основания,
 * подстановка суммы из расчётного модуля, обезличивание, метрики — проверено
 * в `agent-shell.test.ts` и здесь не повторяется. Здесь проверяется ТОЛЬКО
 * частное: что Денчику кладут на вход и как это изложено.
 *
 * ЧТО ДЕНЧИК ДОБАВЛЯЕТ К ДЕТЕРМИНИРОВАННОМУ МОДУЛЮ
 *
 * `tech-opinion.ts` считает реверс объёма (Д-7): кратности, стоп-флаги,
 * сумму необоснованного, статус ВОР. Это правила, и они правильно
 * детерминированы — §6.4 требует, чтобы выводимое считал модуль.
 *
 * Модель нужна для другого — Д-3 и Д-4:
 *
 *  · СОСТАВ: «5 ИТП на плане против 7 зданий в задании». Сверка количеств
 *    между документами;
 *  · ПОЛНОТА: «труба Ø219, 160 м, 10–12 млн выпала из перечня». Отсутствие
 *    не равно «не нужно».
 *
 * Расчётный модуль находит неверное в том, что ЕСТЬ. Найти то, чего НЕТ,
 * правилами нельзя: список отсутствующего бесконечен, пока кто-то не поймёт,
 * что за работа описана.
 *
 * ПОЭТОМУ ГЛАВНОЕ ЗДЕСЬ — ЧТО ПОПАДАЕТ В ПРОМПТ
 *
 * Модель, не увидевшая состава работ, не заметит пропущенного. Тесты
 * проверяют, что состав до неё доходит.
 */
import { describe, expect, it, vi } from "vitest";

import type { Sha256 } from "@contracts/index.js";

import type { AgentRunRequest, AgentTurn } from "../agent-shell.js";

import { RUN_TECH_OPINION, createTechOpinionOperation } from "./run-tech-opinion.js";
import type { TechOpinionAgentInput } from "./run-tech-opinion.js";

const ВХОД: TechOpinionAgentInput = {
  documentPath: "objects/КРГ-1/сметы/СОТ.xlsx",
  contentHash: "hash-1" as Sha256,
  hasDesignDocuments: false,
  unjustifiedAmount: "1240000.00",
  reversal: [
    {
      table: "ГЭСНм20-03-035",
      baseQuantity: "120",
      unit: "м",
      totalQuantity: "600",
      totalAmount: "1240000.00",
      flaggedAmount: "980000.00",
      assumption: "база 120 м принята по наименьшему объёму и НЕ сверена с осями",
      flagged: [
        { ordinal: "61", multiple: "3" },
        { ordinal: "67", multiple: "4" },
      ],
    },
  ],
  workGroups: [
    {
      table: "ГЭСНм10-10-001",
      name: "Камеры видеонаблюдения: наружная",
      count: 4,
      unit: "шт",
      totalQuantity: "48",
      totalAmount: "6912036.92",
    },
    {
      table: "ГЭСНм20-03-035",
      name: "Прокладка кабеля в лотках",
      count: 5,
      unit: "м",
      totalQuantity: "600",
      totalAmount: "1240000.00",
    },
  ],
};

function ответ(output: unknown): AgentTurn {
  return { output, provider: "п", model: "м", inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

const ПУСТО = { verdict: "принято", findings: [], openQuestions: [] };

function агент(turn: AgentTurn = ответ(ПУСТО)) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createTechOpinionOperation({
    prompt: "промпт Денчика",
    accuracyMarker: () => ({ range: "±10%", basis: "реверс объёма", heuristic: true }),
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
  it("объявляет способность техзаключения", () => {
    // Способность, а не имя агента: смежник просит `tech_opinion`, а не
    // «Денчика» (ADR-R-026).
    expect(RUN_TECH_OPINION.provides).toContain("tech_opinion");
    expect(RUN_TECH_OPINION.kind).toBe("agent");
  });
});

describe("реверс объёма доходит до модели (Д-7)", () => {
  it("называет таблицу норм, базу и допущение о ней", async () => {
    const текст = await промпт();

    expect(текст).toContain("ГЭСНм20-03-035");
    expect(текст).toContain("120");
    // База — ДОПУЩЕНИЕ, а не измерение. Модель, не знающая этого, примет её
    // за факт и построит на ней вывод.
    expect(текст).toContain("НЕ сверена с осями");
  });

  it("называет кратности поимённо, а не только их количество", async () => {
    // «Две позиции с кратностью выше двух» нечем защитить перед подрядчиком.
    // «Поз. 61 ×3, поз. 67 ×4» — можно.
    const текст = await промпт();

    expect(текст).toContain("61");
    expect(текст).toContain("×3");
    expect(текст).toContain("67");
    expect(текст).toContain("×4");
  });

  it("называет сумму необоснованного", async () => {
    const текст = await промпт();

    expect(текст).toContain("1240000.00");
  });
});

describe("состав работ доходит до модели (Д-3, Д-4)", () => {
  it("перечисляет группы работ с количеством позиций", async () => {
    // Это ЕДИНСТВЕННЫЙ вход, по которому можно заметить пропущенное. Модель,
    // не увидевшая состава, не скажет «камеры есть, а подводки к ним нет».
    const текст = await промпт();

    expect(текст).toContain("Камеры видеонаблюдения: наружная");
    expect(текст).toContain("Прокладка кабеля в лотках");
    expect(текст).toContain("ГЭСНм10-10-001");
  });

  it("несёт объёмы и единицы состава", async () => {
    const текст = await промпт();

    expect(текст).toContain("48");
    expect(текст).toContain("шт");
  });

  it("прямо просит назвать отсутствующее", async () => {
    // Без прямого требования модель отвечает на то, что видит, и молчит о
    // том, чего не видит. Д-4 — это ровно противоположное поведение.
    const текст = await промпт();

    expect(текст).toMatch(/отсутству|не хватает|пропущ|чего нет/iu);
  });
});

describe("отсутствие рабочей документации объявляется", () => {
  it("говорит модели, что геометрия от осей недоступна", async () => {
    // Д-1 требует длину от осей. Не сказав, что чертежей нет, мы получим
    // заключение, написанное так, будто геометрия проверена.
    const текст = await промпт();

    expect(текст).toMatch(/рабочая документация не разобрана|геометрия от осей недоступна/iu);
  });

  it("НЕ объявляет деградацию, когда документация есть", async () => {
    const { operation, runAgent } = агент();
    await operation.run({ ...ВХОД, hasDesignDocuments: true });

    expect(runAgent.mock.calls[0]![0].prompt).not.toContain("геометрия от осей недоступна");
  });
});

describe("границы Денчика", () => {
  it("НЕ просит модель считать цену", async () => {
    // «Объём мой, цена Людмилы». Заключение, назвавшее свою цену, заводит
    // второй источник правды о деньгах.
    const текст = await промпт();

    expect(текст).toMatch(/не пересчитывай|посчитан/iu);
  });

  it("подставляет сумму влияния из реверса, а не из ответа модели", async () => {
    const { operation } = агент(
      ответ({
        verdict: "возврат",
        findings: [
          {
            severity: "critical",
            statement: "объём не подтверждён",
            basis: "ГЭСНм20-03-035, поз. 61 ×3",
            deviation: "quantity_error",
            impactOrdinal: "61",
          },
        ],
        openQuestions: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    // Сумма группы — из расчётного модуля. Модель её не называла.
    expect(body.findings[0]!.impact?.value.amount).toBe("1240000.00");
  });
});
