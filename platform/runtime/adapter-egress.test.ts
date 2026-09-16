/**
 * Адаптер модели ходит наружу только через egress-шлюз — ADR-R-017, ТЗ §12.1л.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЕ ТЕСТЫ, А НЕ ЧАСТЬ ТЕСТОВ ШЛЮЗА
 *
 * Тесты шлюза отвечают на вопрос «правильно ли он решает». Эти — на вопрос
 * «спрашивают ли его вообще». Второе не следует из первого: безупречный шлюз,
 * который никто не вызывает, защищает ровно ничего. Именно так в этом проекте
 * уже вышло с KnowledgeScope, реестром форматов, журналом и очередью — механизм
 * был готов и не подключён.
 *
 * ПОЧЕМУ ОБЪЯВЛЕНИЕ EGRESS ОБЯЗАТЕЛЬНО В ТИПЕ
 *
 * Сделать его необязательным значит оставить умолчанием выход без проверки:
 * новый вызов адаптера, написанный по образцу соседнего, окажется незащищённым
 * и ничем себя не обнаружит. Обязательное поле заставляет ответить на вопрос
 * «что этот вызов выносит наружу» в момент, когда вызов пишут.
 */
import { describe, expect, it, vi } from "vitest";

import { anonymize } from "@platform/security/anonymizer.js";
import { EgressGateway } from "@platform/security/egress-gateway.js";
import type { ExtensionManifest } from "@platform/extensions/manifest.js";

import { ModelCallError, createOpenAiCompatibleRuntime } from "./openai-compatible-adapter.js";

const МОДЕЛЬ: ExtensionManifest = {
  id: "модель-внешняя",
  version: 1,
  kind: "model-provider",
  implements: "1.0.0",
  contour: "external",
  dataClasses: ["object_meta", "positions"],
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

function рантайм(
  baseUrl: string,
  fetchImpl: typeof fetch,
  dataClasses: readonly ("object_meta" | "positions" | "commercial_secret")[] = ["positions"],
): ReturnType<typeof createOpenAiCompatibleRuntime> {
  return createOpenAiCompatibleRuntime({
    baseUrl,
    model: "м-1",
    fetchImpl,
    egress: {
      gateway: new EgressGateway([МОДЕЛЬ]),
      extensionId: "модель-внешняя",
      dataClasses,
    },
  });
}

const ЗАПРОС = { prompt: "проверь", estimatedInputTokens: 10 };

describe("адаптер и шлюз", () => {
  it("выпускает запрос в задекларированное назначение", async () => {
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    const результат = await рантайм("https://api.модель.example/v1", doFetch).run(ЗАПРОС);

    expect(результат.output).toBe("готово");
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it("НЕ ВЫЗЫВАЕТ fetch при незадекларированном назначении", async () => {
    // Главное здесь — не текст ошибки, а то, что запрос не ушёл. Проверка
    // «выбросил исключение» пропустила бы вариант, где данные уже отправлены,
    // а исключение выброшено на разборе ответа.
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    await expect(рантайм("https://чужой.example/v1", doFetch).run(ЗАПРОС)).rejects.toThrow(
      ModelCallError,
    );

    expect(doFetch).not.toHaveBeenCalled();
  });

  it("НЕ ВЫЗЫВАЕТ fetch при выносе необъявленного класса данных", async () => {
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    await expect(
      рантайм("https://api.модель.example/v1", doFetch, ["commercial_secret"]).run(ЗАПРОС),
    ).rejects.toThrow(ModelCallError);

    expect(doFetch).not.toHaveBeenCalled();
  });

  it("запрещает перенаправления на уровне транспорта", async () => {
    // Шлюз проверил имя хоста ДО запроса. Если бы адаптер пошёл по 302,
    // проверка относилась бы к одному адресу, а данные ушли бы на другой.
    let принято: RequestInit | undefined;
    const doFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      принято = init;
      return ответ();
    }) as unknown as typeof fetch;

    await рантайм("https://api.модель.example/v1", doFetch).run(ЗАПРОС);

    expect(принято?.redirect).toBe("error");
  });

  it("отказ шлюза объясняет причину, а не просто отказывает", async () => {
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    await expect(рантайм("https://чужой.example/v1", doFetch).run(ЗАПРОС)).rejects.toThrow(
      /не задекларировано/,
    );
  });
});

describe("расписка об обезличивании", () => {
  const С_ТАЙНОЙ: ExtensionManifest = {
    ...МОДЕЛЬ,
    dataClasses: ["object_meta", "positions", "commercial_secret"],
  };

  function сТайной(fetchImpl: typeof fetch) {
    return createOpenAiCompatibleRuntime({
      baseUrl: "https://api.модель.example/v1",
      model: "м-1",
      fetchImpl,
      egress: {
        gateway: new EgressGateway([С_ТАЙНОЙ]),
        extensionId: "модель-внешняя",
        dataClasses: ["commercial_secret"],
      },
    });
  }

  it("НЕ ВЫЗЫВАЕТ fetch, когда тайна уходит без расписки", async () => {
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    await expect(сТайной(doFetch).run(ЗАПРОС)).rejects.toThrow(/§12.1л/u);

    expect(doFetch).not.toHaveBeenCalled();
  });

  it("НЕ ВЫЗЫВАЕТ fetch с распиской от ДРУГОГО текста", async () => {
    // Обезличить один текст, приложить его расписку и отправить другой — самый
    // естественный способ обойти проверку, не написав ни строчки лжи.
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    const чужая = anonymize({ text: "совсем другой текст", knownEntities: [], salt: "п" }).receipt;

    await expect(
      сТайной(doFetch).run({ ...ЗАПРОС, anonymization: чужая }),
    ).rejects.toThrow(/отпечаток не совпал/u);

    expect(doFetch).not.toHaveBeenCalled();
  });

  it("НЕ ВЫЗЫВАЕТ fetch с распиской, в которой есть остаток", async () => {
    // Расписка с остатком означает, что анонимизатор нашёл в собственном выводе
    // то, что должен был убрать. «Почти обезличено» — это не обезличено.
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    const грязная = anonymize({
      text: ЗАПРОС.prompt,
      knownEntities: ["проверь"],
      salt: "п",
      dryRun: true,
    }).receipt;

    expect(грязная.clean).toBe(false);

    await expect(
      сТайной(doFetch).run({ ...ЗАПРОС, anonymization: грязная }),
    ).rejects.toThrow(ModelCallError);

    expect(doFetch).not.toHaveBeenCalled();
  });

  it("выпускает тайну с чистой распиской на ТОТ ЖЕ текст", async () => {
    const doFetch = vi.fn(async () => ответ()) as unknown as typeof fetch;

    const своя = anonymize({ text: ЗАПРОС.prompt, knownEntities: [], salt: "п" }).receipt;

    const результат = await сТайной(doFetch).run({ ...ЗАПРОС, anonymization: своя });

    expect(результат.output).toBe("готово");
    expect(doFetch).toHaveBeenCalledOnce();
  });
});
