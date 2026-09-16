/**
 * АГЕНТНЫЙ ЦИКЛ — «подумал → позвал инструмент → увидел → уточнил» (Т9.3).
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ОБОЛОЧКИ РОЛЕВОГО ПРОМПТА
 *
 * `agent-shell.ts` делает ОДИН вызов модели: складывает всё, что посчитал код,
 * в один промпт и получает ответ по строгой схеме. Он остаётся — это режим
 * `конвейер`, он быстрее, дешевле и предсказуемее.
 *
 * Здесь другое. Агент получает ЗАДАЧУ и ИНСТРУМЕНТЫ, а что смотреть — решает
 * сам. Он может прочитать позиции, увидеть странный шифр, поднять норматив,
 * обнаружить расхождение, пересчитать сходимость и только после этого дать
 * вывод. Материал он добывает, а не получает.
 *
 * ПОТОЛОК ШАГОВ ОБЯЗАТЕЛЕН
 *
 * Цикл без потолка — это счёт за токены без границы и прогон без конца. Потолок
 * объявлен числом, и его достижение — не ошибка, а ИСХОД: агент говорит то, что
 * успел, и это помечается. Молча оборвать цикл и выдать неполный разбор за
 * полный — тот же изъян, что зелёный вердикт на неполном обходе.
 *
 * ОТВЕТ ПО СХЕМЕ ЗАПРАШИВАЕТСЯ ОТДЕЛЬНЫМ, ПОСЛЕДНИМ ШАГОМ
 *
 * Провайдеры не дают одновременно `tools` и строгий `response_format`: модель
 * либо зовёт инструменты, либо укладывается в схему. Поэтому цикл идёт с
 * инструментами и без схемы, а когда агент перестаёт звать инструменты —
 * задаётся последний вопрос со схемой и всей историей диалога.
 *
 * Так строгая схема остаётся обязательной: книга пакета и экран собираются из
 * неё, и «разбор свободного текста» здесь недопустим ровно как и в конвейере.
 */
import type { AgentTool, ToolCallRecord } from "./agent-tools.js";

/** Сообщение диалога — минимум, нужный OpenAI-совместимому провайдеру. */
export interface LoopMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly LoopToolCall[];
}

export interface LoopToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/** Что вернул провайдер на один шаг цикла. */
export interface LoopTurn {
  readonly content: string;
  readonly toolCalls: readonly LoopToolCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LoopRuntime {
  /** Шаг с инструментами и без строгой схемы: модель может позвать инструмент. */
  readonly step: (
    messages: readonly LoopMessage[],
    tools: readonly AgentTool[],
  ) => Promise<LoopTurn>;
  /** Последний шаг: строгая схема, инструментов уже нет. */
  readonly finish: (
    messages: readonly LoopMessage[],
    schema: Record<string, unknown>,
  ) => Promise<{ readonly output: unknown; readonly inputTokens: number; readonly outputTokens: number }>;
}

export interface LoopRequest {
  readonly systemPrompt: string;
  readonly task: string;
  readonly tools: readonly AgentTool[];
  readonly schema: Record<string, unknown>;
  /** Потолок шагов. Обязателен: см. заголовок файла. */
  readonly maxSteps: number;
  readonly runtime: LoopRuntime;
}

export interface LoopResult {
  readonly output: unknown;
  /** Каждый вызов инструмента — звено цепочки доказательности (Т9.4). */
  readonly toolCalls: readonly ToolCallRecord[];
  readonly steps: number;
  /** Потолок исчерпан — агент сказал то, что успел, и это надо назвать. */
  readonly exhausted: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Отпечаток результата инструмента: в артефакт кладётся он, а не сам ответ. */
function отпечаток(текст: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < текст.length; i += 1) {
    h ^= текст.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export async function runAgentLoop(request: LoopRequest): Promise<LoopResult> {
  if (request.maxSteps <= 0) {
    throw new Error("потолок шагов агентного цикла обязателен и должен быть положительным");
  }

  const поИмени = new Map(request.tools.map((tool) => [tool.name, tool]));
  const messages: LoopMessage[] = [
    { role: "system", content: request.systemPrompt },
    { role: "user", content: request.task },
  ];

  const записи: ToolCallRecord[] = [];
  let вход = 0;
  let выход = 0;
  let шагов = 0;
  let исчерпан = false;

  for (;;) {
    if (шагов >= request.maxSteps) {
      исчерпан = true;
      break;
    }

    const turn = await request.runtime.step(messages, request.tools);
    шагов += 1;
    вход += turn.inputTokens;
    выход += turn.outputTokens;

    // Инструментов не позвал — значит собрал всё, что хотел. Дальше строгая схема.
    if (turn.toolCalls.length === 0) {
      if (turn.content.trim() !== "") messages.push({ role: "assistant", content: turn.content });
      break;
    }

    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });

    for (const вызов of turn.toolCalls) {
      const tool = поИмени.get(вызов.name);

      if (tool === undefined) {
        // Выдуманный инструмент — ОТВЕТ агенту, а не молчание: иначе он будет
        // звать его снова до исчерпания потолка.
        const ответ = `инструмента «${вызов.name}» нет. Доступны: ${[...поИмени.keys()].join(", ")}`;
        записи.push({
          tool: вызов.name,
          arguments: вызов.arguments,
          resultChars: ответ.length,
          resultDigest: отпечаток(ответ),
          failed: "инструмент не существует",
        });
        messages.push({ role: "tool", content: ответ, toolCallId: вызов.id });
        continue;
      }

      let ответ: string;
      let сбой: string | undefined;

      try {
        const доводы = вызов.arguments.trim() === "" ? {} : (JSON.parse(вызов.arguments) as Record<string, unknown>);
        ответ = await tool.call(доводы);
      } catch (cause) {
        // Отказ инструмента ВОЗВРАЩАЕТСЯ агенту текстом, а не рвёт цикл: одна
        // неудачная попытка не отменяет разбор, а агент способен попробовать
        // иначе. Но отказ и записывается — иначе он выглядел бы как пустой ответ.
        сбой = (cause as Error).message;
        ответ = `инструмент отказал: ${сбой}`;
      }

      записи.push({
        tool: вызов.name,
        arguments: вызов.arguments,
        resultChars: ответ.length,
        resultDigest: отпечаток(ответ),
        ...(сбой === undefined ? {} : { failed: сбой }),
      });

      messages.push({ role: "tool", content: ответ, toolCallId: вызов.id });
    }
  }

  if (исчерпан) {
    messages.push({
      role: "user",
      content:
        `Потолок шагов исчерпан (${request.maxSteps}). Дай вывод по тому, что успел собрать, ` +
        "и обязательно назови в замечаниях, чего не успел проверить.",
    });
  }

  const итог = await request.runtime.finish(messages, request.schema);

  return {
    output: итог.output,
    toolCalls: записи,
    steps: шагов,
    exhausted: исчерпан,
    inputTokens: вход + итог.inputTokens,
    outputTokens: выход + итог.outputTokens,
  };
}
