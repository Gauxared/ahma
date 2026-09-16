/**
 * Базовый адаптер агентного рантайма (ADR-R-004).
 *
 * Обычный цикл tool-calling поверх OpenAI-совместимого endpoint. Именно он
 * работает и с внешним провайдером первого этапа, и с локальным vLLM после
 * перевода в контур — поэтому он базовый, а Codex SDK опциональный.
 *
 * Адаптер намеренно не использует возможностей сверх объявленного профиля
 * (ADR-R-020): ограничение накладывает `withProfileCeiling`, а здесь мы просто
 * не полагаемся на нестандартные расширения конкретного провайдера.
 *
 * ВЫХОД ТОЛЬКО ЧЕРЕЗ ШЛЮЗ (ADR-R-017, ТЗ §12.1л)
 *
 * На первом этапе именно этот адаптер выносит содержимое смет заказчика на
 * внешнюю модель — то есть он и есть та граница, о которой говорит §12.1л.
 * Поэтому `egress` здесь обязательное поле, а не необязательное: необязательное
 * оставило бы умолчанием выход без проверки, и новый вызов, написанный по
 * образцу соседнего, оказался бы незащищённым, ничем себя не обнаружив.
 */
import { createHash } from "node:crypto";

import type { DataClass } from "@platform/extensions/manifest.js";
import type { EgressGateway } from "@platform/security/egress-gateway.js";

import type { AgentRuntimePort, AgentTurnRequest, AgentTurnResult } from "./agent-runtime-port.js";

/** Чем этот вызов имеет право быть — и что он выносит наружу. */
export interface AdapterEgress {
  readonly gateway: EgressGateway;
  readonly extensionId: string;
  readonly dataClasses: readonly DataClass[];
  /** Куда записать решение шлюза. Без него решение никуда не попадёт (§12.1л). */
  readonly record?: (record: ReturnType<EgressGateway["authorize"]>["record"]) => void;
}

/**
 * Отпечаток отправляемого текста.
 *
 * Считается ровно так же, как в анонимизаторе, и над той же величиной — иначе
 * сверка сравнивала бы несравнимое и всегда отвергала бы честную расписку.
 */
export function promptDigest(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 16);
}

/** Уровни, которые принимает OpenAI-совместимый провайдер рассуждающих моделей. */
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface OpenAiCompatibleOptions {
  readonly baseUrl: string;
  /** Локальный endpoint может не требовать ключа — отсюда `undefined`. */
  readonly apiKey?: string | undefined;
  readonly model: string;
  /**
   * Глубина рассуждения модели. Отправляется, ТОЛЬКО когда задана.
   *
   * Умолчания здесь нет намеренно. Поле нестандартное: рассуждающие модели его
   * понимают, а локальный vLLM в контуре может ответить на него отказом. Послать
   * его всегда значило бы сделать перевод в контур (второй этап) неработающим по
   * причине, которую никто не искал бы в адаптере.
   *
   * Это НЕ то же, что режим глубины Проверки (§5.4): тот управляет формой
   * ответа — сколько строк, есть ли таблица, — и проверяется по тексту. Этот
   * управляет тем, сколько модель думает до ответа, и стоит денег.
   */
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly egress: AdapterEgress;
}

/** Вызов инструмента, как его возвращает OpenAI-совместимый провайдер. */
interface WireToolCall {
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface ChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly WireToolCall[];
    };
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
  readonly model?: string;
}

export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

export function createOpenAiCompatibleRuntime(options: OpenAiCompatibleOptions): AgentRuntimePort {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    id: `openai-compatible:${options.model}`,

    async run(request: AgentTurnRequest): Promise<AgentTurnResult> {
      /**
       * Содержимое сообщения — строка либо части, и выбор не косметический.
       *
       * Строка остаётся строкой, пока листов нет: часть провайдеров различает
       * два вида запроса, и посылать одноэлементный массив там, где раньше шла
       * строка, значит менять поведение всех девяти агентов ради случая,
       * который у восьми из них не наступает.
       */
      type Part =
        | { readonly type: "text"; readonly text: string }
        | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

      type Wire = {
        role: string;
        content: string | readonly Part[];
        tool_call_id?: string;
        tool_calls?: readonly { id: string; type: "function"; function: { name: string; arguments: string } }[];
      };

      const messages: Wire[] = [];

      /**
       * ГОТОВЫЙ ДИАЛОГ ИМЕЕТ ПРИОРИТЕТ над одиночным промптом.
       *
       * Агентный цикл присылает всю историю: вопрос, вызов инструмента, его
       * результат, уточнение. Склеить это в одно поле `prompt` нельзя —
       * провайдер перестанет различать, что было вызовом, а что ответом на
       * него, и диалог продолжить не сможет.
       */
      if (request.messages !== undefined && request.messages.length > 0) {
        for (const m of request.messages) {
          messages.push({
            role: m.role,
            content: m.content,
            ...(m.toolCallId === undefined ? {} : { tool_call_id: m.toolCallId }),
            ...(m.toolCalls === undefined || m.toolCalls.length === 0
              ? {}
              : {
                  tool_calls: m.toolCalls.map((c) => ({
                    id: c.id,
                    type: "function" as const,
                    function: { name: c.name, arguments: c.arguments },
                  })),
                }),
          });
        }
      } else {
        if (request.systemPrompt !== undefined) {
          messages.push({ role: "system", content: request.systemPrompt });
        }

        const sheets = request.images ?? [];

        messages.push({
          role: "user",
          content:
            sheets.length === 0
              ? request.prompt
              : [
                  { type: "text", text: request.prompt } as const,
                  ...sheets.map((url) => ({ type: "image_url", image_url: { url } }) as const),
                ],
        });
      }

      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        max_tokens: request.maxOutputTokens,
        temperature: 0,
        /**
         * ОТВЕТ ЦЕЛИКОМ, А НЕ ПОТОКОМ — И ЭТО НАДО ПРОСИТЬ ЯВНО.
         *
         * Замерено на llm.govard.ru 07.09.2026: без этого поля точка отдаёт
         * `text/event-stream` — россыпь `data: {...}` — даже когда потока никто
         * не просил. С `stream: false` та же точка отвечает одним объектом.
         *
         * Читаем мы `response.json()`, и на потоке он падает разбором. То есть
         * молчаливое умолчание провайдера ломает КАЖДЫЙ вызов, а сообщение об
         * ошибке говорит про JSON, а не про поток.
         *
         * Полагаться на умолчание нельзя ни в ту, ни в другую сторону: одни
         * точки не стримят без спроса, другие стримят. Просим то, что умеем
         * читать.
         */
        stream: false,
        ...(options.reasoningEffort === undefined
          ? {}
          : { reasoning_effort: options.reasoningEffort }),
      };

      if (request.outputSchema !== undefined) {
        body["response_format"] = {
          type: "json_schema",
          json_schema: { name: "result", strict: true, schema: request.outputSchema },
        };
      }

      /**
       * ИНСТРУМЕНТЫ. Имя обязано быть латиницей (`^[a-zA-Z0-9_-]+$`) — то же
       * правило, что у имени схемы; кириллическое даёт 400 от апстрима.
       * Проверяется ЗДЕСЬ, до отправки: отказ провайдера по такой причине
       * читается как «модель не поддерживает инструменты», что неправда.
       */
      if (request.tools !== undefined && request.tools.length > 0) {
        for (const tool of request.tools) {
          if (!/^[a-zA-Z0-9_-]+$/u.test(tool.name)) {
            throw new ModelCallError(
              `Имя инструмента «${tool.name}» не по правилу провайдера ^[a-zA-Z0-9_-]+$`,
            );
          }
        }

        body["tools"] = request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
      }

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.apiKey !== undefined && options.apiKey !== "") {
        headers["authorization"] = `Bearer ${options.apiKey}`;
      }

      // Решение шлюза — ДО отправки. Проверка после неё описывала бы уже
      // случившееся: данные ушли, а мы установили, что не следовало.
      //
      // Расписка обязана относиться к ТОМУ ЖЕ тексту, который уходит. Без этой
      // сверки можно было бы обезличить один текст, приложить его расписку и
      // отправить другой — и §12.1л снова держался бы на добросовестности.
      const receipt = request.anonymization;

      /**
       * Расписка сверяется с ТЕМ, ЧТО РЕАЛЬНО УХОДИТ.
       *
       * У одиночного запроса это `prompt`. У агентного цикла — весь диалог:
       * сверять его расписку с пустым `prompt` значило бы принимать расписку,
       * не относящуюся ни к чему.
       */
      const отправляемое =
        request.messages !== undefined && request.messages.length > 0
          ? request.messages.map((m) => m.content).join("\n")
          : request.prompt;

      if (receipt !== undefined && receipt.outputDigest !== promptDigest(отправляемое)) {
        throw new ModelCallError(
          "Расписка об обезличивании относится к другому тексту: отпечаток не совпал. " +
            "Отправка отменена (ТЗ §12.1л).",
        );
      }

      const decision = options.egress.gateway.authorize({
        extensionId: options.egress.extensionId,
        url: endpoint,
        dataClasses: options.egress.dataClasses,
        ...(receipt === undefined ? {} : { anonymization: receipt }),
      });

      options.egress.record?.(decision.record);

      if (!decision.allowed) {
        throw new ModelCallError(`Выход наружу не разрешён: ${decision.reason}`);
      }

      const response = await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        // Шлюз проверил ИМЯ хоста до запроса. Пойти по перенаправлению значило
        // бы проверить один адрес, а отправить данные в другой.
        redirect: options.egress.gateway.redirectPolicy(),
        signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new ModelCallError(
          `Endpoint ответил ${response.status}: ${detail.slice(0, 500)}`,
          response.status,
        );
      }

      /**
       * ПОТОК ВМЕСТО ОБЪЕКТА — НАЗЫВАЕТСЯ ПОТОКОМ.
       *
       * `response.json()` на `text/event-stream` падает с жалобой на JSON, и
       * причина — «провайдер стримит, хотя не просили» — в этой жалобе не
       * видна. Проверка стоит до разбора, чтобы в журнале оказалось то, что
       * случилось на самом деле.
       */
      const тип = response.headers.get("content-type") ?? "";

      if (тип.includes("text/event-stream")) {
        throw new ModelCallError(
          `Endpoint ответил потоком (${тип}), хотя запрошен ответ целиком (stream: false). ` +
            "Разбор потока не поддержан: точка обязана отдавать один объект",
          response.status,
        );
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const message = payload.choices?.[0]?.message;
      const content = message?.content;
      const вызовы = message?.tool_calls ?? [];

      /**
       * ОТВЕТ С ВЫЗОВАМИ ИНСТРУМЕНТОВ — НЕ «ОТВЕТ БЕЗ СОДЕРЖИМОГО».
       *
       * Модель, решившая позвать инструмент, возвращает `tool_calls` и часто
       * пустой `content`. Прежняя проверка объявляла это отказом endpoint — то
       * есть агентный шаг падал ровно там, где агент начинал работать.
       */
      if (вызовы.length > 0) {
        return {
          threadId: request.threadId ?? crypto.randomUUID(),
          contour: decision.record.contour,
          output: {
            kind: "tool_calls" as const,
            content: content ?? "",
            toolCalls: вызовы.map((вызов, index) => ({
              id: вызов.id ?? `call_${index}`,
              name: вызов.function?.name ?? "",
              arguments: вызов.function?.arguments ?? "{}",
            })),
          },
          provider: "openai-compatible",
          model: payload.model ?? options.model,
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
        };
      }

      if (content === undefined || content === null) {
        throw new ModelCallError("Endpoint вернул ответ без содержимого");
      }

      // Схема задана — значит результат обязан быть валидным JSON. Молча
      // возвращать текст нельзя: дальше он попадёт в артефакт как факт.
      const output = request.outputSchema === undefined ? content : parseJson(content);

      return {
        threadId: request.threadId ?? crypto.randomUUID(),
        contour: decision.record.contour,
        output,
        provider: "openai-compatible",
        model: payload.model ?? options.model,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      };
    },
  };
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new ModelCallError(
      `Схема задана, но ответ не является валидным JSON: ${content.slice(0, 200)}`,
    );
  }
}
