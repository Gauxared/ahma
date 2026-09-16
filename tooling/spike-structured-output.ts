/**
 * Спайк M0: даёт ли настроенный endpoint валидный structured output по схеме
 * реального агента (ADR-R-004, ADR-R-020).
 *
 * Это блокирующий гейт: если строгий JSON Schema не держится, вся агентная
 * архитектура опирается на разбор свободного текста, и это надо знать сейчас,
 * а не на сороковой день.
 *
 * Запуск:
 *   STROYINTELLECT_MODEL_BASE_URL=https://.../v1 \
 *   STROYINTELLECT_MODEL_API_KEY=... \
 *   STROYINTELLECT_MODEL_ID=... \
 *   pnpm tsx tooling/spike-structured-output.ts
 */
import { existsSync } from "node:fs";

import { bootstrap } from "../platform/bootstrap.js";
import { withProfileCeiling } from "../platform/runtime/agent-runtime-port.js";
import type { ModelProfile } from "../platform/runtime/agent-runtime-port.js";
import { createOpenAiCompatibleRuntime } from "../platform/runtime/openai-compatible-adapter.js";
import { assertStrictSchema } from "../platform/runtime/strict-schema.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const baseUrl = process.env.STROYINTELLECT_MODEL_BASE_URL;
const model = process.env.STROYINTELLECT_MODEL_ID;

if (baseUrl === undefined || baseUrl === "" || model === undefined || model === "") {
  console.error(
    "Не заданы STROYINTELLECT_MODEL_BASE_URL и STROYINTELLECT_MODEL_ID.\n" +
      "Спайк требует настоящего endpoint: подтверждение на моках гейт не закрывает.",
  );
  process.exit(2);
}

/** Тот же потолок, что и в config/model-profiles/target-local.json. */
const TARGET: ModelProfile = {
  id: "target-local",
  contextWindow: 32_768,
  maxOutputTokens: 8_192,
  structuredOutput: "json_schema",
  toolCalling: "prompted",
  vision: false,
};

/** Урезанная схема вывода Сметчика: структура та же, что понадобится в M1. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["convergence", "findings"],
  properties: {
    convergence: {
      type: "object",
      additionalProperties: false,
      required: ["sectionsTotal", "documentTotal", "deltaRub"],
      properties: {
        sectionsTotal: { type: "string" },
        documentTotal: { type: "string" },
        deltaRub: { type: "string" },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "statement", "basis"],
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "info"] },
          statement: { type: "string" },
          basis: { type: "string" },
        },
      },
    },
  },
} as const;

// Провайдер отвергает схемы с необязательными полями — падаем до вызова.
assertStrictSchema(SCHEMA, "схема Сметчика");

// Пробник ходит наружу через тот же шлюз, что и система (ADR-R-017). Дать ему
// обход значило бы завести вторую дверь: инструмент разработчика ходит по
// настоящим данным заказчика ровно так же, как и рабочий контур.
const platform = bootstrap();
// Маршрут выбирается по адресу: маршрутов два — внешняя модель и модель внутри
// контура, — и подставить не тот значило бы предъявить к обращению требования
// чужого контура.
const modelRoute = platform.extensions
  .all("model-provider")
  .find(
    (registered) =>
      platform.egressGateway.authorize({
        extensionId: registered.manifest.id,
        url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
        dataClasses: [],
      }).allowed,
  );

if (modelRoute === undefined) {
  throw new Error(
    `${baseUrl} не разрешён ни одним маршрутом из config/extensions/model-routes.json`,
  );
}

const runtime = withProfileCeiling(
  createOpenAiCompatibleRuntime({
    baseUrl,
    model,
    apiKey: process.env.STROYINTELLECT_MODEL_API_KEY,
    egress: {
      gateway: platform.egressGateway,
      extensionId: modelRoute.manifest.id,
      dataClasses: modelRoute.manifest.dataClasses,
    },
  }),
  TARGET,
);

const started = Date.now();

const result = await runtime.run({
  systemPrompt:
    "Ты сметчик. Отвечай строго по схеме. Числа передавай десятичными строками, " +
    "без разделителей разрядов. Ничего не выдумывай.",
  prompt:
    "В локальной смете два раздела: 14198884.54 ₽ и 89532565.11 ₽. " +
    "Итог по смете — 103731449.65 ₽. Проверь сходимость и дай замечания.",
  outputSchema: SCHEMA as unknown as Record<string, unknown>,
  estimatedInputTokens: 400,
});

const elapsed = Date.now() - started;
const output = result.output as { convergence?: { deltaRub?: string }; findings?: unknown[] };

console.log(`Провайдер     : ${result.provider}`);
console.log(`Модель        : ${result.model}`);
console.log(`Токены        : вход ${result.inputTokens}, выход ${result.outputTokens}`);
console.log(`Время         : ${elapsed} мс`);
console.log(`Расхождение   : ${output.convergence?.deltaRub ?? "не заполнено"}`);
console.log(`Замечаний     : ${output.findings?.length ?? 0}`);
console.log(`\nПолный ответ:\n${JSON.stringify(result.output, null, 2)}`);

const delta = Number(output.convergence?.deltaRub ?? Number.NaN);

if (!Number.isFinite(delta)) {
  console.error("\nГЕЙТ НЕ ПРОЙДЕН: расхождение не пришло десятичной строкой.");
  process.exit(1);
}

// 14198884.54 + 89532565.11 = 103731449.65 — расхождение ровно 0 ₽.
if (Math.abs(delta) > 0.005) {
  console.error(`\nГЕЙТ НЕ ПРОЙДЕН: модель посчитала расхождение ${delta}, ожидается 0.`);
  console.error("Это ожидаемо для арифметики в модели — в M1 сходимость считает расчётный модуль (ТЗ §6.4).");
  process.exit(1);
}

console.log("\nГЕЙТ ПРОЙДЕН: структурированный вывод по схеме держится.");
