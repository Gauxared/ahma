/**
 * Codex SDK — исполнитель роли экипажа (spec-demo-stage-1 §4.3, А3).
 *
 * ЕДИНСТВЕННОЕ МЕСТО, ГДЕ СИСТЕМА ЗНАЕТ О `@openai/codex-sdk`. Остальной
 * экипаж (`crew.ts`) работает с `RoleRunner` — «дай роли задание, получи ответ по
 * схеме и след хода» — и проверяется подставным исполнителем без сети и без
 * двоичного файла Codex.
 *
 * ЧТО ДАЁТ SDK И ЧЕГО НЕ ДАЁТ АДАПТЕР ОТ СЕБЯ. SDK запускает `codex` как
 * отдельный процесс, даёт ему песочницу ТОЛЬКО ДЛЯ ЧТЕНИЯ над рабочей папкой,
 * ведёт тред с памятью и возвращает предметы хода: команды оболочки, поиски,
 * ответ. Адаптер лишь собирает провайдера из тех же переменных среды, что у
 * конвейера (ТЗ §6.3 — смена модели конфигурацией), и переводит предметы хода в
 * форму, понятную экипажу.
 *
 * ПРОВАЙДЕР — `wire_api = "responses"`, И ЭТО НЕ ВЫБОР. Замерено 07.09.2026:
 * `codex-cli 0.147.0` отвергает `wire_api = "chat"`; `llm.govard.ru/v1/responses`
 * отвечает 200, тред доходит до `turn.completed`.
 *
 * ДОМ CODEX — СВОЙ, НЕ `~/.codex`. В домашнем каталоге пользователя лежат его
 * личные навыки и конфиг; прогон системы не должен их ни читать, ни менять.
 * И не `/tmp`: двоичный файл отказывается заводить там служебные ссылки
 * (замерено: «Refusing to create helper binaries under temporary dir»).
 *
 * БЕЗОПАСНОСТЬ В ПРОТОТИПЕ — РЕШЕНИЕ ВЛАДЕЛЬЦА (spec-demo-stage-1 §8). Этот путь
 * не проходит через egress-шлюз и обезличивание: Codex ходит к модели сам.
 * Что остаётся по конструкции — песочница без записи и без сети, ключ в среде
 * процесса, а не в тексте.
 */
import { join } from "node:path";

import { Codex, type ModelReasoningEffort, type SandboxMode, type ThreadItem, type Usage } from "@openai/codex-sdk";

/** Настройки экипажа, собранные из среды. Отсутствуют — режим не предлагается. */
export interface CodexSettings {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly reasoningEffort?: ModelReasoningEffort;
  /** `CODEX_HOME`: сессии тредов и служебные файлы Codex. */
  readonly home: string;
  /** Куда класть рабочие папки прогонов (А5). */
  readonly runsRoot: string;
  /** Потолок одного хода роли в минутах (А9). */
  readonly turnMinutes: number;
  /** Веб-поиск модели. По умолчанию выключен: сеть треда закрыта. */
  readonly webSearch: boolean;
  /** Корень конфигурации: промпты ролей, Ядро, промпт Дирижёра. */
  readonly configRoot: string;
  /**
   * Песочница команд роли. По умолчанию `read-only`.
   *
   * ЗАМЕРЕНО 07.09.2026 НА СЕРВЕРЕ: песочница Codex 0.147 на Linux — это
   * bubblewrap с пользовательскими пространствами имён, а Ubuntu 24.04 по
   * умолчанию их запрещает (`kernel.apparmor_restrict_unprivileged_userns=1`).
   * Каждая команда роли отвечала «bwrap: loopback: Failed RTM_NEWADDR», и
   * десять ролей работали по одной вводной, не прочитав ни файла. Знак того,
   * что песочницы нет, — `danger-full-access`: команды идут от пользователя
   * службы без ограничений. Это решение владельца площадки, поэтому оно в
   * переменной среды, а не в коде.
   */
  readonly sandbox: SandboxMode;
  /**
   * Кто ведёт такты (А12). `такты` — наш DAG: тред на роль, ворота в коде.
   * `нативная` — корневой Дирижёр зовёт роли инструментом `spawn_agent` сам,
   * как в легаси, где Дирижёр вёл такты, а блоки носил человек.
   */
  readonly orchestration: "такты" | "нативная";
}

const SANDBOX_MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

/**
 * Глубина рассуждения конвейера → глубина Codex.
 *
 * У конвейера пять слов, у Codex — пять других: `max` у Codex нет, `minimal`
 * у конвейера нет. Сопоставление здесь, а не в переменной среды: одна
 * переменная на обоих исполнителей, иначе они разойдутся по глубине молча.
 */
const EFFORT_OF: Readonly<Record<string, ModelReasoningEffort>> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

const TURN_MINUTES_DEFAULT = 20;

/**
 * Собирает настройки из тех же переменных, что и конвейер.
 *
 * `undefined`, когда не задан адрес, модель или ключ: Codex без ключа падает
 * посреди хода, а отсутствие настроек должно быть видно ДО постановки прогона —
 * тогда режим на экране не предлагается вовсе.
 */
export function codexSettingsFrom(env: NodeJS.ProcessEnv, configRoot: string): CodexSettings | undefined {
  const baseUrl = env["STROYINTELLECT_MODEL_BASE_URL"];
  const model = env["STROYINTELLECT_MODEL_ID"];
  const apiKey = env["STROYINTELLECT_MODEL_API_KEY"];

  if (!baseUrl || !model || !apiKey) return undefined;

  const effort = env["STROYINTELLECT_MODEL_REASONING_EFFORT"];
  const minutes = Number.parseInt(env["STROYINTELLECT_CODEX_TURN_MINUTES"] ?? "", 10);
  const sandbox = env["STROYINTELLECT_CODEX_SANDBOX"];
  const orchestration = env["STROYINTELLECT_CODEX_ORCHESTRATION"];

  if (orchestration !== undefined && orchestration !== "" && orchestration !== "такты" && orchestration !== "нативная") {
    throw new Error(`STROYINTELLECT_CODEX_ORCHESTRATION=${orchestration} не распознан. Допустимо: такты, нативная.`);
  }

  // Опечатка в режиме песочницы — отказ на старте, а не тихий `read-only`:
  // площадка, где песочница не работает, получила бы прогон без команд.
  if (sandbox !== undefined && sandbox !== "" && !SANDBOX_MODES.includes(sandbox as SandboxMode)) {
    throw new Error(
      `STROYINTELLECT_CODEX_SANDBOX=${sandbox} не распознан. Допустимо: ${SANDBOX_MODES.join(", ")}.`,
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    ...(effort !== undefined && EFFORT_OF[effort] !== undefined ? { reasoningEffort: EFFORT_OF[effort] } : {}),
    home: env["STROYINTELLECT_CODEX_HOME"] ?? join(process.cwd(), "var", "codex-home"),
    runsRoot: env["STROYINTELLECT_CODEX_RUNS"] ?? join(process.cwd(), "var", "codex-runs"),
    turnMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : TURN_MINUTES_DEFAULT,
    webSearch: env["STROYINTELLECT_CODEX_WEB_SEARCH"] === "1",
    configRoot,
    sandbox: sandbox === undefined || sandbox === "" ? "read-only" : (sandbox as SandboxMode),
    orchestration: orchestration === "нативная" ? "нативная" : "такты",
  };
}

/** Команда оболочки, которую роль выполнила в песочнице, — звено следа (Т9.4). */
export interface RoleCommand {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | undefined;
}

/** Что вернул один ход роли. */
export interface RoleTurn {
  /** Разобранный JSON ответа. `undefined` — ответ не разобрался; текст ниже. */
  readonly output: unknown;
  readonly finalResponse: string;
  readonly commands: readonly RoleCommand[];
  readonly searches: readonly string[];
  /** Ошибки, о которых Codex сообщил предметами хода, не прерывая его. */
  readonly errors: readonly string[];
  /** Вызовы субагентов корневым тредом: `spawn_agent`, `send_input`, `wait`. */
  readonly collab: readonly CollabCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly threadId: string | undefined;
}

/** Предмет хода `collab_tool_call` — SDK 0.147 его ещё не типизирует. */
export interface CollabCall {
  readonly tool: string;
  readonly prompt: string;
  readonly receivers: readonly string[];
  /** Состояния субагентов: тред → статус и последнее сообщение. */
  readonly states: readonly { readonly thread: string; readonly status: string; readonly message: string }[];
}

export interface RoleTask {
  /** Имя роли — для журнала и для имени треда. */
  readonly role: string;
  /**
   * Промпт роли — как `developer_instructions` треда, а не текст хода (А12).
   * Так промпт легаси остаётся нативным промптом: модель видит его системой,
   * а ход несёт только задание. Без него тред идёт с инструкциями дома Codex.
   */
  readonly developerInstructions?: string;
  /** Живые предметы хода — для доски агентов: субагент позван, роль ответила. */
  readonly onItem?: (item: ThreadItem) => void;
  /** Полная вводная хода: промпт роли, Ядро, задание оркестратора. */
  readonly text: string;
  /** JSON-схема ответа. Ответ приходит строго по ней. */
  readonly schema: unknown;
  /** Рабочая папка прогона: роль читает её командами. */
  readonly workingDirectory: string;
  /** Папка партии объекта — исходники, только чтение. */
  readonly additionalDirectories: readonly string[];
  readonly signal: AbortSignal;
  /** Продолжить прежний тред роли, если он был (Т9.5, память между прогонами). */
  readonly threadId?: string;
}

/**
 * Исполнитель роли. Экипаж знает только его.
 *
 * Функция, а не класс: единственная операция, и класс с одним методом лишь
 * дал бы правилу `unwired` ещё одну публичную точку для проверки.
 */
export type RoleRunner = (task: RoleTask) => Promise<RoleTurn>;

/** Что Codex сообщает о себе в след прогона: имя провайдера по адресу. */
export function providerLabel(settings: CodexSettings): string {
  try {
    return `codex-sdk@${new URL(settings.baseUrl).host}`;
  } catch {
    return "codex-sdk";
  }
}

/**
 * Исполнитель на Codex SDK.
 *
 * Один объект `Codex` на все роли: провайдер и дом у них общие. Тред — на роль:
 * `startThread` в каждом задании, `resumeThread` — когда задание принесло
 * прежний идентификатор.
 */
export function createCodexRunner(settings: CodexSettings): RoleRunner {
  const KEY_VARIABLE = "STROYINTELLECT_CODEX_KEY";

  /**
   * Среда процесса Codex собирается ЯВНО: SDK не наследует `process.env`, когда
   * среда передана, и это нам на руку — личный `~/.codex` и чужие ключи в
   * процесс не попадают. Прокси-переменные передаются, если заданы: на сервере
   * выход к модели может идти через туннель (deploy/README.md).
   */
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: settings.home,
    CODEX_HOME: settings.home,
    LANG: process.env["LANG"] ?? "C.UTF-8",
    [KEY_VARIABLE]: settings.apiKey,
  };

  for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"]) {
    const value = process.env[name];
    if (value !== undefined && value !== "") env[name] = value;
  }

  /**
   * Объект `Codex` — на роль, а не один на всех: `developer_instructions` живут в
   * конфигурации объекта, и это единственный способ отдать промпт роли системой
   * через SDK 0.147. Объекты кэшируются: роль зовётся раз-два за прогон.
   */
  const instances = new Map<string, Codex>();

  const codexFor = (developerInstructions: string | undefined): Codex => {
    const key = developerInstructions ?? "";
    const cached = instances.get(key);
    if (cached !== undefined) return cached;

    const instance = new Codex({
      env,
      config: {
        model_provider: "stroyintellect",
        model_providers: {
          stroyintellect: {
            name: "СтройИнтеллект — модель конвейера",
            base_url: settings.baseUrl,
            env_key: KEY_VARIABLE,
            wire_api: "responses",
          },
        },
        // Рассуждения модели в предметах хода не нужны: след прогона — команды
        // и ответ, а не внутренняя речь.
        hide_agent_reasoning: true,
        ...(developerInstructions === undefined ? {} : { developer_instructions: developerInstructions }),
      },
    });

    instances.set(key, instance);
    return instance;
  };

  return async (task) => {
    const codex = codexFor(task.developerInstructions);
    const options = {
      model: settings.model,
      sandboxMode: settings.sandbox,
      workingDirectory: task.workingDirectory,
      additionalDirectories: [...task.additionalDirectories],
      skipGitRepoCheck: true,
      approvalPolicy: "never" as const,
      networkAccessEnabled: false,
      webSearchMode: (settings.webSearch ? "live" : "disabled") as "live" | "disabled",
      ...(settings.reasoningEffort === undefined ? {} : { modelReasoningEffort: settings.reasoningEffort }),
    };

    const thread = task.threadId === undefined ? codex.startThread(options) : codex.resumeThread(task.threadId, options);

    // Ход читается потоком: предметы нужны по мере появления — доска агентов
    // показывает «Ваныч позван» в момент вызова, а не через двадцать минут.
    const streamed = await thread.runStreamed(task.text, {
      ...(task.schema === undefined ? {} : { outputSchema: task.schema }),
      signal: task.signal,
    });
    const items: ThreadItem[] = [];
    let usage: Usage | null = null;
    let finalResponse = "";
    let failure: string | undefined;

    for await (const event of streamed.events) {
      if (event.type === "item.completed") {
        items.push(event.item);
        if (event.item.type === "agent_message") finalResponse = event.item.text;
        task.onItem?.(event.item);
      } else if (event.type === "item.started" || event.type === "item.updated") {
        task.onItem?.(event.item);
      } else if (event.type === "turn.completed") {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        failure = event.error.message;
      } else if (event.type === "error") {
        failure = event.message;
      }
    }

    if (failure !== undefined) throw new Error(`ход роли ${task.role} не удался: ${failure}`);

    return {
      ...itemsToTrace(items),
      output: parseJson(finalResponse),
      finalResponse,
      ...tokensOf(usage),
      threadId: thread.id ?? undefined,
    };
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function tokensOf(usage: Usage | null): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: (usage?.output_tokens ?? 0) + (usage?.reasoning_output_tokens ?? 0),
  };
}

/**
 * Предметы хода → след роли.
 *
 * Изменения файлов сюда не попадают намеренно: песочница только для чтения, и
 * если Codex всё же сообщил о правке, это ошибка режима, а не действие роли — она
 * попадает в `errors` и видна словом.
 */
export function itemsToTrace(items: readonly ThreadItem[]): {
  commands: RoleCommand[];
  searches: string[];
  errors: string[];
  collab: CollabCall[];
} {
  const commands: RoleCommand[] = [];
  const searches: string[] = [];
  const errors: string[] = [];
  const collab: CollabCall[] = [];

  for (const item of items) {
    // Вызовы субагентов SDK 0.147 отдаёт без типа — читаются по форме.
    if ((item as { type: string }).type === "collab_tool_call") {
      const raw = item as unknown as {
        tool?: string;
        prompt?: string | null;
        receiver_thread_ids?: string[];
        agents_states?: Record<string, { status?: string; message?: string | null }>;
      };
      collab.push({
        tool: raw.tool ?? "collab",
        prompt: raw.prompt ?? "",
        receivers: raw.receiver_thread_ids ?? [],
        states: Object.entries(raw.agents_states ?? {}).map(([thread, state]) => ({
          thread,
          status: state.status ?? "",
          message: state.message ?? "",
        })),
      });
      continue;
    }

    if (item.type === "command_execution") {
      commands.push({
        command: item.command,
        output: item.aggregated_output,
        exitCode: item.exit_code,
      });
    } else if (item.type === "web_search") {
      searches.push(item.query);
    } else if (item.type === "error") {
      errors.push(item.message);
    } else if (item.type === "file_change") {
      errors.push(`роль попыталась изменить файлы (${item.changes.map((c) => c.path).join(", ")}) — песочница только для чтения`);
    }
  }

  return { commands, searches, errors, collab };
}
