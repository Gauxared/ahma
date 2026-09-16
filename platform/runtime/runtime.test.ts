import { describe, expect, it } from "vitest";

import { checkAgainstProfile, ProfileError, withProfileCeiling } from "./agent-runtime-port.js";
import type { AgentRuntimePort, AgentTurnRequest, ModelProfile } from "./agent-runtime-port.js";
import { checkExternalCall } from "./call-journal.js";
import type { ModelCallRecord } from "./call-journal.js";
import { assertStrictSchema, findStrictSchemaProblems } from "./strict-schema.js";

/** Потолок целевой локальной модели — тот же, что в config/model-profiles. */
const TARGET: ModelProfile = {
  id: "target-local",
  contextWindow: 32_768,
  maxOutputTokens: 8_192,
  structuredOutput: "json_schema",
  toolCalling: "prompted",
  vision: false,
};

/** Внешняя фронтирная модель: контекст и возможности заведомо шире потолка. */
const frontier: AgentRuntimePort = {
  id: "frontier",
  run: async (request) => ({
    threadId: request.threadId ?? "thread-1",
    output: { status: "ok" },
    provider: "openai-compatible",
    model: "frontier",
    inputTokens: request.estimatedInputTokens,
    outputTokens: 100,
  }),
};

function request(overrides: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return { prompt: "оцени смету", estimatedInputTokens: 10_000, ...overrides };
}

describe("потолок возможностей применяется к внешней модели (ADR-R-020)", () => {
  const capped = withProfileCeiling(frontier, TARGET);

  it("пропускает запрос в пределах потолка", async () => {
    const result = await capped.run(request());
    expect(result.output).toEqual({ status: "ok" });
  });

  it("отказывает при контексте больше целевого, хотя внешняя модель его потянула бы", async () => {
    // 2000 позиций сметы легко дают контекст шире 32k. Разрыв должен вылезти
    // сейчас, а не в момент перевода на локальную модель.
    await expect(capped.run(request({ estimatedInputTokens: 200_000 }))).rejects.toThrow(ProfileError);
  });

  it("отказывает при запросе зрения, которого у целевой модели нет", async () => {
    await expect(capped.run(request({ needsVision: true }))).rejects.toThrow(/зрение/);
  });

  it("подставляет потолок вывода, когда вызывающая сторона его не задала", async () => {
    let seen = 0;
    const probe: AgentRuntimePort = {
      id: "probe",
      run: async (r) => {
        seen = r.maxOutputTokens ?? 0;
        return { threadId: "t", output: {}, provider: "p", model: "m", inputTokens: 0, outputTokens: 0 };
      },
    };

    await withProfileCeiling(probe, TARGET).run(request());
    expect(seen).toBe(TARGET.maxOutputTokens);
  });

  it("отказывает в structured output, если целевая модель его не умеет", () => {
    const noSchema: ModelProfile = { ...TARGET, structuredOutput: "none" };
    const violation = checkAgainstProfile(request({ outputSchema: { type: "object" } }), noSchema);

    expect(violation).toEqual({ kind: "structured_output_unavailable", required: "json_schema" });
  });
});

describe("журнал обращений к моделям (ТЗ §8.3, §12.1л)", () => {
  function call(overrides: Partial<ModelCallRecord> = {}): ModelCallRecord {
    return {
      at: "2026-08-24T12:00:00Z",
      process: "contractor_search",
      operationId: "search-contractors",
      tenantId: "t-1",
      contour: "external",
      provider: "openai-compatible",
      model: "frontier",
      dataClasses: ["public"],
      anonymized: false,
      inputTokens: 100,
      outputTokens: 50,
      ...overrides,
    };
  }

  it("пропускает внешний вызов на неконфиденциальных данных", () => {
    expect(checkExternalCall(call())).toBeUndefined();
  });

  it("отклоняет коммерческую тайну во внешний контур без анонимизации", () => {
    const rejection = checkExternalCall(call({ dataClasses: ["commercial_secret"] }));
    expect(rejection?.kind).toBe("confidential_without_anonymization");
  });

  it("пропускает те же данные после анонимизации по Регламенту", () => {
    expect(checkExternalCall(call({ dataClasses: ["commercial_secret"], anonymized: true }))).toBeUndefined();
  });

  it("не ограничивает внутренний контур", () => {
    expect(checkExternalCall(call({ contour: "internal", dataClasses: ["commercial_secret"] }))).toBeUndefined();
  });

  // Журнал в памяти удалён 02.09.2026: сводка для Регламента строится по ВСЕЙ
  // истории обращений, а он знал только текущий процесс — перезапущенный воркер
  // отчитывался бы за неполный период и выглядел бы исправным. Записи и сводка
  // живут в таблице `model_call`, проверки — в
  // `platform/db/model-call-repository.test.ts`.
  //
  // `checkExternalCall` остался и проверяет саму ЗАПИСЬ перед сохранением: если
  // в журнал пришло «внешний контур, тайна, без обезличивания», то либо у шлюза
  // дефект, либо обращение прошло мимо него.
});

describe("совместимость схем со строгим structured output", () => {
  // Измерено на настоящем endpoint: провайдер отвергает схему с необязательным
  // полем ошибкой 400 «required ... including every key in properties».
  it("ловит свойство, отсутствующее в required", () => {
    const problems = findStrictSchemaProblems({
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: "string" }, b: { type: "string" } },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(/отсутствуют свойства: b/);
  });

  it("требует additionalProperties: false", () => {
    const problems = findStrictSchemaProblems({
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" } },
    });

    expect(problems.map((p) => p.message)).toContain("нужен additionalProperties: false");
  });

  it("проверяет вложенные объекты внутри массивов", () => {
    const problems = findStrictSchemaProblems({
      type: "object",
      additionalProperties: false,
      required: ["findings"],
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["severity"],
            properties: { severity: { type: "string" }, basis: { type: "string" } },
          },
        },
      },
    });

    expect(problems[0]?.path).toBe("<корень>.findings[]");
  });

  it("принимает корректную строгую схему", () => {
    expect(() =>
      assertStrictSchema({
        type: "object",
        additionalProperties: false,
        required: ["convergence"],
        properties: {
          convergence: {
            type: "object",
            additionalProperties: false,
            required: ["deltaRub"],
            properties: { deltaRub: { type: "string" } },
          },
        },
      }),
    ).not.toThrow();
  });

  it("бросает с перечнем проблем", () => {
    expect(() => assertStrictSchema({ type: "object", properties: { a: {} } }, "схема Сметчика")).toThrow(
      /схема Сметчика несовместима/,
    );
  });
});
