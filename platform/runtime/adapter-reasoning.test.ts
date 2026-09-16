/**
 * Глубина рассуждения модели — нестандартное поле запроса.
 *
 * ПОЧЕМУ ОНО НЕ ИМЕЕТ УМОЛЧАНИЯ
 *
 * Рассуждающие модели первого этапа `reasoning_effort` понимают. Локальный vLLM,
 * на который система переходит на втором этапе, может ответить на незнакомое
 * поле отказом. Послать его всегда значило бы сломать перевод в контур по
 * причине, которую никто не стал бы искать в адаптере: провайдер сменился,
 * агенты те же, промпты те же — а вызовы отваливаются.
 *
 * Поэтому поле уходит, ТОЛЬКО когда задано явно. Это проверяется здесь с обеих
 * сторон: задано — ушло; не задано — в теле его нет вовсе (а не `null` и не
 * пустая строка, которые провайдер обязан был бы разбирать).
 *
 * ЭТО НЕ РЕЖИМ ГЛУБИНЫ ПРОВЕРКИ (§5.4)
 *
 * Тот управляет ФОРМОЙ ответа — сколько строк, есть ли таблица — и проверяется
 * по тексту. Этот управляет тем, сколько модель думает до ответа, и стоит денег.
 * Смешать их значило бы дать пользователю ручку «подробнее», которая молча
 * умножает счёт.
 */
import { describe, expect, it, vi } from "vitest";

import { EgressGateway } from "@platform/security/egress-gateway.js";
import type { ExtensionManifest } from "@platform/extensions/manifest.js";

import { REASONING_EFFORTS, createOpenAiCompatibleRuntime } from "./openai-compatible-adapter.js";
import type { ReasoningEffort } from "./openai-compatible-adapter.js";

const МОДЕЛЬ: ExtensionManifest = {
  id: "модель-внешняя",
  version: 1,
  kind: "model-provider",
  implements: "1.0.0",
  contour: "external",
  dataClasses: ["positions"],
  egress: { destinations: ["api.модель.example"], purpose: "проверка смет" },
  requiresPermissions: [],
  provides: [],
};

function ответ(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: "готово" } }], model: "м-1" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function тело(effort?: ReasoningEffort): Promise<Record<string, unknown>> {
  const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

  await createOpenAiCompatibleRuntime({
    baseUrl: "https://api.модель.example/v1",
    model: "м-1",
    fetchImpl: doFetch,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
    egress: {
      gateway: new EgressGateway([МОДЕЛЬ]),
      extensionId: "модель-внешняя",
      dataClasses: ["positions"],
    },
  }).run({ prompt: "проверь", estimatedInputTokens: 10 });

  const [, init] = vi.mocked(doFetch).mock.calls[0]!;

  return JSON.parse(String(init!.body)) as Record<string, unknown>;
}

describe("глубина рассуждения", () => {
  it("уходит в запрос, когда задана", async () => {
    expect(await тело("medium")).toMatchObject({ reasoning_effort: "medium" });
  });

  it("ОТСУТСТВУЕТ в теле, когда не задана", async () => {
    // Именно отсутствует, а не null: провайдеру, который поля не знает, нечего
    // разбирать, и перевод в контур не ломается.
    expect(await тело()).not.toHaveProperty("reasoning_effort");
  });

  it("передаёт значение как есть, не подменяя своим", async () => {
    for (const уровень of REASONING_EFFORTS) {
      expect(await тело(уровень)).toMatchObject({ reasoning_effort: уровень });
    }
  });

  it("не трогает остальное тело запроса", async () => {
    // Температура ноль — условие воспроизводимости проверки; глубина
    // рассуждения не повод её потерять.
    expect(await тело("high")).toMatchObject({ model: "м-1", temperature: 0 });
  });
});
