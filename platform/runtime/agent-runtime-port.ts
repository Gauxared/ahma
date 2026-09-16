/**
 * Порт агентного рантайма (ADR-R-004).
 *
 * Codex SDK понижен с основы рантайма до одного из адаптеров. Базовым является
 * OpenAI-совместимый: на нём идёт первый этап, и его же отдаёт локальный vLLM
 * при переводе в контур. ТЗ §6.3 требует смены модели конфигурацией без
 * изменения прикладного кода — значит агентный цикл не может быть привязан
 * к особенностям одного провайдера.
 */

import type { AnonymizeReceipt } from "../security/anonymizer.js";

/**
 * Возможности целевой ЛОКАЛЬНОЙ модели (ADR-R-020).
 *
 * Это потолок, а не описание текущего провайдера. Смысл в том, чтобы на внешней
 * фронтирной модели работать внутри ограничений той, что будет в проде: иначе
 * бюджеты §11 и контекстная стратегия окажутся измерены на модели, которой
 * в контуре заказчика не будет, и «перевод» превратится в переписывание.
 */
export interface ModelProfile {
  readonly id: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly structuredOutput: "json_schema" | "json_mode" | "none";
  readonly toolCalling: "native" | "prompted" | "none";
  readonly vision: boolean;
}

export interface AgentTurnRequest {
  readonly prompt: string;
  readonly systemPrompt?: string;
  /** JSON Schema ожидаемого результата. */
  readonly outputSchema?: Record<string, unknown>;
  /** Рабочий каталог Проверки: /input, /context, /knowledge, /work, /output. */
  readonly workspace?: string;
  readonly threadId?: string;
  /** Оценка размера запроса в токенах, посчитанная вызывающей стороной. */
  readonly estimatedInputTokens: number;
  readonly needsVision?: boolean;
  /**
   * Листы рабочей документации как изображения — `data:image/png;base64,…`.
   *
   * ПОЧЕМУ ОТДЕЛЬНЫМ ПОЛЕМ, А НЕ ЧАСТЬЮ ПРОМПТА
   *
   * Промпт проходит обезличивание и расписку (§8.3, §12.1л); изображение —
   * НЕ проходит и пройти не может: имена проектировщиков стоят в штампе
   * чертежа растром. Держать их в одном поле значило бы объявить обезличенным
   * то, что обезличено наполовину.
   *
   * Отсюда правило, которое держит композиционный корень: листы уходят только
   * туда, откуда они и так не выходят, — на модель внутри контура.
   */
  readonly images?: readonly string[];
  readonly maxOutputTokens?: number;
  /**
   * Расписка анонимизатора для `prompt` (§8.3, §12.1л).
   *
   * Живёт в ЗАПРОСЕ, а не в настройках адаптера: она относится к конкретному
   * тексту, и один адаптер за свою жизнь отправляет их множество. Расписка,
   * заданная при сборке, удостоверяла бы первый текст и молча покрывала все
   * последующие.
   */
  readonly anonymization?: AnonymizeReceipt;
  /**
   * ИНСТРУМЕНТЫ АГЕНТА (Т9.2) — то, чего в этом порту не было и из-за чего
   * агентность оказалась объявленной, но не сделанной.
   *
   * Профиль модели объявлял `toolCalling`, а передать инструменты было нечем:
   * поле отсутствовало в запросе, значит ни один адаптер их не отправлял.
   * Возможность, объявленная и недостижимая, хуже необъявленной — она выглядит
   * работающей.
   *
   * Схема довода передаётся как есть: провайдеры принимают JSON Schema, и
   * переводить её в свой формат значило бы завести второе описание того же.
   */
  readonly tools?: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  }[];
  /**
   * Готовый диалог вместо одного промпта.
   *
   * Агентный цикл ведёт РАЗГОВОР: вопрос, вызов инструмента, его результат,
   * уточнение. Уложить это в поле `prompt` можно только склеив всё в один
   * текст — и тогда провайдер не увидит, что было вызовом инструмента, а что
   * его результатом, то есть не сможет продолжить диалог.
   */
  readonly messages?: readonly {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly content: string;
    readonly toolCallId?: string;
    readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly arguments: string }[];
  }[];
}

export interface AgentTurnResult {
  readonly threadId: string;
  /**
   * Покинул ли запрос контур — решение egress-шлюза ПО ЭТОМУ вызову.
   *
   * Возвращается результатом, а не читается из общего журнала: при
   * параллельном запуске агентов хвост журнала принадлежит соседу, и запись
   * §12.1л получила бы чужой контур. Ошибка была бы невидимой — контур
   * правдоподобен в обоих случаях.
   */
  readonly contour?: "internal" | "external";
  readonly output: unknown;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AgentRuntimePort {
  readonly id: string;
  run(request: AgentTurnRequest): Promise<AgentTurnResult>;
}

/** Почему запрос не соответствует объявленному потолку. */
export type ProfileViolation =
  | { readonly kind: "context_overflow"; readonly requested: number; readonly limit: number }
  | { readonly kind: "output_overflow"; readonly requested: number; readonly limit: number }
  | { readonly kind: "vision_unavailable" }
  | { readonly kind: "structured_output_unavailable"; readonly required: "json_schema" };

export class ProfileError extends Error {
  constructor(readonly violation: ProfileViolation, profileId: string) {
    super(`Запрос выходит за объявленный потолок модели ${profileId}: ${describe(violation)}`);
    this.name = "ProfileError";
  }
}

function describe(violation: ProfileViolation): string {
  switch (violation.kind) {
    case "context_overflow":
      return `контекст ${violation.requested} токенов при потолке ${violation.limit}`;
    case "output_overflow":
      return `вывод ${violation.requested} токенов при потолке ${violation.limit}`;
    case "vision_unavailable":
      return "требуется зрение, которого нет у целевой модели";
    case "structured_output_unavailable":
      return "требуется structured output по схеме, которого нет у целевой модели";
  }
}

export function checkAgainstProfile(
  request: AgentTurnRequest,
  profile: ModelProfile,
): ProfileViolation | undefined {
  if (request.estimatedInputTokens > profile.contextWindow) {
    return { kind: "context_overflow", requested: request.estimatedInputTokens, limit: profile.contextWindow };
  }

  const requestedOutput = request.maxOutputTokens ?? profile.maxOutputTokens;
  if (requestedOutput > profile.maxOutputTokens) {
    return { kind: "output_overflow", requested: requestedOutput, limit: profile.maxOutputTokens };
  }

  if (request.needsVision === true && !profile.vision) {
    return { kind: "vision_unavailable" };
  }

  if (request.outputSchema !== undefined && profile.structuredOutput === "none") {
    return { kind: "structured_output_unavailable", required: "json_schema" };
  }

  return undefined;
}

/**
 * Оборачивает любой рантайм и применяет ОБЪЯВЛЕННЫЙ потолок, а не фактический
 * потолок провайдера.
 *
 * Без этой обёртки девять агентов созреют на большом контексте и надёжном
 * structured output, а разрыв обнаружится в момент перевода на локальную модель.
 */
export function withProfileCeiling(inner: AgentRuntimePort, profile: ModelProfile): AgentRuntimePort {
  return {
    id: `${inner.id}@${profile.id}`,
    async run(request: AgentTurnRequest): Promise<AgentTurnResult> {
      const violation = checkAgainstProfile(request, profile);

      if (violation !== undefined) {
        throw new ProfileError(violation, profile.id);
      }

      return inner.run({ ...request, maxOutputTokens: request.maxOutputTokens ?? profile.maxOutputTokens });
    },
  };
}
