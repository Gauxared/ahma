/**
 * Листы рабочей документации в запросе к модели.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ, И ПОЧЕМУ ИМЕННО ЭТО
 *
 * Требование задачи — «понимать схемы, таблицы, чертёжные изображения». На
 * замере курганской подшивки модель взяла с листов разбивочные расстояния,
 * трубу ПНД Ø50 на глубине 3 м и номера опор контактной сети: ровно ту
 * геометрию, отсутствие которой техническое заключение объявляло деградацией.
 *
 * Но у изображения есть свойство, которого нет у текста: **оно не проходит
 * обезличивание и пройти не может.** Фамилии проектировщиков стоят в штампе
 * чертежа растром. Поэтому здесь проверяются два разных утверждения:
 *
 *  · листы ДОХОДЯТ до модели, когда они есть, — иначе требование не выполнено;
 *  · без листов запрос остаётся ТАКИМ ЖЕ, как был, — потому что восемь агентов
 *    из девяти листов не имеют, и менять им форму запроса ради девятого
 *    значит менять поведение всех.
 *
 * Второе не мелочь: часть провайдеров различает `content` строкой и `content`
 * массивом частей. Одноэлементный массив вместо строки — тихая смена
 * поведения на всех агентах сразу.
 */
import { describe, expect, it, vi } from "vitest";

import { EgressGateway } from "@platform/security/egress-gateway.js";
import type { ExtensionManifest } from "@platform/extensions/manifest.js";

import { createOpenAiCompatibleRuntime } from "./openai-compatible-adapter.js";

const МОДЕЛЬ: ExtensionManifest = {
  id: "модель-внутренняя",
  version: 1,
  kind: "model-provider",
  implements: "1.0.0",
  contour: "internal",
  dataClasses: ["positions"],
  egress: { destinations: ["127.0.0.1"], purpose: "проверка смет" },
  requiresPermissions: [],
  provides: [],
};

const ЛИСТ = "data:image/png;base64,iVBORw0KGgo=";

async function тело(images?: readonly string[]): Promise<Record<string, unknown>> {
  const doFetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "готово" } }], model: "м-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;

  await createOpenAiCompatibleRuntime({
    baseUrl: "http://127.0.0.1:8317/v1",
    model: "м-1",
    fetchImpl: doFetch,
    egress: {
      gateway: new EgressGateway([МОДЕЛЬ]),
      extensionId: "модель-внутренняя",
      dataClasses: ["positions"],
    },
  }).run({
    prompt: "проверь состав",
    estimatedInputTokens: 10,
    ...(images === undefined ? {} : { images }),
  });

  const [, init] = vi.mocked(doFetch).mock.calls[0]!;

  return JSON.parse(String(init!.body)) as Record<string, unknown>;
}

/** Сообщение пользователя из тела запроса. */
function сообщение(body: Record<string, unknown>): { role: string; content: unknown } {
  const messages = body["messages"] as readonly { role: string; content: unknown }[];

  return messages.find((message) => message.role === "user")!;
}

describe("листы документации в запросе", () => {
  it("без листов содержание остаётся СТРОКОЙ, а не массивом из одной части", async () => {
    // Восемь агентов из девяти листов не имеют. Массив вместо строки поменял
    // бы форму запроса всем сразу, а часть провайдеров эти формы различает.
    expect(сообщение(await тело()).content).toBe("проверь состав");
  });

  it("листы доходят до модели вместе с текстом запроса", async () => {
    const content = сообщение(await тело([ЛИСТ, ЛИСТ])).content as readonly Record<string, unknown>[];

    expect(Array.isArray(content)).toBe(true);
    // Текст ПЕРВЫМ: он объясняет, что именно смотреть на листах.
    expect(content[0]).toEqual({ type: "text", text: "проверь состав" });
    expect(content.slice(1)).toEqual([
      { type: "image_url", image_url: { url: ЛИСТ } },
      { type: "image_url", image_url: { url: ЛИСТ } },
    ]);
  });

  it("пустой перечень листов не превращает содержание в массив", async () => {
    // «Листов нет» и «листов ноль» — одно и то же для модели, и форма запроса
    // обязана быть той же, что у агента без зрения вовсе.
    expect(сообщение(await тело([])).content).toBe("проверь состав");
  });

  it("остальное тело запроса не меняется от листов", async () => {
    // Температура ноль — условие воспроизводимости проверки.
    expect(await тело([ЛИСТ])).toMatchObject({ model: "м-1", temperature: 0 });
  });
});
