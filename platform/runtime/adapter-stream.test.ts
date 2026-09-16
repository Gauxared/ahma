/**
 * ОТВЕТ ЦЕЛИКОМ, А НЕ ПОТОКОМ — против провайдера, который стримит без спроса.
 *
 * НАЙДЕНО ЗАМЕРОМ ПРИ СМЕНЕ ПРОВАЙДЕРА, а не набором.
 *
 * 07.09.2026, `llm.govard.ru/v1`, модель `cx/gpt-5.6-luna-medium`. Один и тот
 * же запрос:
 *
 *   без поля `stream`  → `data: {"id":"chatcmpl-…","object":"chat.completion.chunk"…`
 *   со `stream: false` → `{"id":"chatcmpl-…","object":"chat.completion"…}`
 *
 * То есть точка отдаёт `text/event-stream` ПО УМОЛЧАНИЮ. Читаем мы
 * `response.json()`, и на потоке он падает разбором — значит молчаливое
 * умолчание провайдера ломает КАЖДЫЙ вызов.
 *
 * Хуже ломки то, как это выглядит: жалоба про JSON. Настоящая причина —
 * «провайдер стримит» — в ней не видна, и искать её пришлось бы в сетевом
 * дампе. Поэтому проверяются две вещи: что мы просим ответ целиком и что поток
 * называется потоком, если он всё-таки пришёл.
 *
 * Полагаться на умолчание нельзя ни в ту, ни в другую сторону: OpenRouter
 * отвечает объектом без просьбы, эта точка — потоком. Просим то, что умеем
 * читать.
 */
import { describe, expect, it, vi } from "vitest";

import { EgressGateway } from "@platform/security/egress-gateway.js";
import type { ExtensionManifest } from "@platform/extensions/manifest.js";

import { createOpenAiCompatibleRuntime } from "./openai-compatible-adapter.js";

const МОДЕЛЬ: ExtensionManifest = {
  id: "модель-внешняя",
  version: 1,
  kind: "model-provider",
  implements: "1.0.0",
  contour: "external",
  dataClasses: ["positions"],
  egress: { destinations: ["llm.example.test"], purpose: "проверка смет" },
  requiresPermissions: [],
  provides: [],
};

function рантайм(doFetch: typeof fetch) {
  return createOpenAiCompatibleRuntime({
    baseUrl: "https://llm.example.test/v1",
    model: "cx/gpt-5.6-luna-medium",
    fetchImpl: doFetch,
    egress: {
      gateway: new EgressGateway([МОДЕЛЬ]),
      extensionId: "модель-внешняя",
      dataClasses: ["positions"],
    },
  });
}

const ЗАПРОС = { prompt: "скажи: да", estimatedInputTokens: 10 };

describe("ответ модели целиком, а не потоком", () => {
  it("в запросе ЯВНО стоит stream: false", async () => {
    const doFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "да" } }], model: "м" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await рантайм(doFetch).run(ЗАПРОС);

    const [, init] = vi.mocked(doFetch).mock.calls[0]!;
    const тело = JSON.parse(String(init!.body)) as Record<string, unknown>;

    expect(
      тело["stream"],
      "поле stream не отправлено: точка, стримящая по умолчанию, сломает каждый вызов",
    ).toBe(false);
  });

  it("поток НАЗЫВАЕТСЯ потоком, а не ошибкой разбора JSON", async () => {
    /**
     * Если провайдер всё равно ответил потоком, в журнале должно оказаться то,
     * что случилось. Жалоба «Unexpected token d in JSON» отправила бы читателя
     * искать поломку в нашем разборе вместо настройки провайдера.
     */
    const поток = 'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"да"}}]}\n\n';

    const doFetch = vi.fn(
      async () =>
        new Response(поток, {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }),
    ) as unknown as typeof fetch;

    await expect(рантайм(doFetch).run(ЗАПРОС)).rejects.toThrow(/поток/iu);
  });

  it("обычный объект читается по-прежнему", async () => {
    // Правка не должна стоить работающего случая.
    const doFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "да" } }],
            model: "м",
            usage: { prompt_tokens: 3, completion_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const итог = await рантайм(doFetch).run(ЗАПРОС);

    expect(итог.output).toBeDefined();
  });
});
