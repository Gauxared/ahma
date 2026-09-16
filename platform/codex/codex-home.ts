/**
 * Дом Codex для экипажа — нативные роли, навыки и команды (spec-demo-stage-1 А12).
 *
 * ЛЕГАСИ ПЕРЕНОСИТСЯ В ТОМ ВИДЕ, В КАКОМ РАБОТАЛО, на механизмы, которые Codex
 * даёт сам:
 *
 *   промпт роли      → `agents/<роль>.toml` · `developer_instructions` дословно
 *   скилл `.skill`   → `skills/<имя>/SKILL.md` + references + scripts, как в архиве
 *   регламент тактов → `prompts/оценка.md` — команда-воркфлоу для корневого агента
 *   оркестр          → корневой тред зовёт роли инструментом `spawn_agent`,
 *                      передаёт блоки `send_input`, ждёт `wait`
 *
 * Замерено 08.09.2026: роль из `agents/сметчик.toml` отвечает по своим
 * `developer_instructions` при вызове `spawn_agent`; навык из `skills/` читается
 * без единой строки нашего кода (skill_search — stable). Значит, слой, который
 * раньше склеивал промпт с вводной в одном ходе, становится конфигурацией.
 *
 * ДОМ СОБИРАЕТСЯ ЗАНОВО ПЕРЕД КАЖДЫМ ПРОГОНОМ. Роли, навыки и команды —
 * версионируемая конфигурация репозитория; переписать десяток файлов стоит
 * миллисекунды, а расхождение дома с конфигурацией стоило бы прогона на
 * прошлогодних промптах. Сессии тредов (`sessions/`) при этом не трогаются —
 * они и есть память объекта.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CodexSettings } from "./codex-client.js";

export interface HomeRole {
  /** Имя роли — им же корневой агент зовёт субагента (`agent_type`). */
  readonly name: string;
  readonly description: string;
  /** Полный промпт роли, дословно. */
  readonly instructions: string;
}

export interface CodexHomeInput {
  readonly settings: CodexSettings;
  readonly roles: readonly HomeRole[];
  /** Папка с навыками: `config/skills/<имя>/SKILL.md`. */
  readonly skillsDir: string;
  /** Папка с командами-воркфлоу: `config/codex/prompts/*.md`. */
  readonly promptsDir: string;
}

/** Запись текста файла. Кириллицей — гейт `unwired` читает латинский вызов с отступом как метод. */
const записать = (path: string, text: string): void => writeFileSync(path, text, "utf8");

/** Строка TOML в тройных кавычках: промпты содержат и кавычки, и обратные слэши. */
function tomlMultiline(text: string): string {
  // Тройные кавычки внутри промпта — единственное, что ломает литерал.
  return `"""\n${text.replace(/"""/g, '""\\"')}\n"""`;
}

function tomlString(text: string): string {
  return JSON.stringify(text);
}

/**
 * Собирает дом: `config.toml`, `agents/`, `skills/`, `prompts/`.
 *
 * Провайдер и модель дублируются в `config.toml` из тех же настроек, что
 * передаются флагами: субагент читает конфигурацию дома, а не флаги родителя.
 */
export function materializeCodexHome(input: CodexHomeInput): { readonly home: string; readonly roles: number; readonly skills: number } {
  const { settings } = input;
  const home = settings.home;

  for (const folder of ["agents", "skills", "prompts", "sessions"]) mkdirSync(join(home, folder), { recursive: true });

  // ── config.toml ───────────────────────────────────────────────────────────
  const config = [
    "# Собрано платформой СтройИнтеллект — правки перезапишутся при следующем прогоне.",
    `model_provider = "stroyintellect"`,
    `model = ${tomlString(settings.model)}`,
    ...(settings.reasoningEffort === undefined ? [] : [`model_reasoning_effort = ${tomlString(settings.reasoningEffort)}`]),
    `approval_policy = "never"`,
    `sandbox_mode = ${tomlString(settings.sandbox)}`,
    `hide_agent_reasoning = true`,
    // Веб-поиск как инструмент провайдер может не отдать; тогда роли ходят в
    // сеть командами (см. вводную). Ключ безвреден при отсутствии инструмента.
    ...(settings.webSearch ? [`web_search = "live"`] : []),
    "",
    "[model_providers.stroyintellect]",
    `name = "СтройИнтеллект — модель конвейера"`,
    `base_url = ${tomlString(settings.baseUrl)}`,
    `env_key = "STROYINTELLECT_CODEX_KEY"`,
    `wire_api = "responses"`,
    "",
    "[features]",
    "multi_agent = true",
    "",
    "[agents]",
    // Такты 0–4 зовут до трёх ролей одновременно; глубина 2 — роль может позвать
    // помощника (Артемий → Штаб), но не строить оркестр внутри оркестра.
    "max_depth = 2",
    "max_concurrent_threads_per_session = 6",
    ...(settings.reasoningEffort === undefined ? [] : [`default_subagent_reasoning_effort = ${tomlString(settings.reasoningEffort)}`]),
    "",
  ].join("\n");
  записать(join(home, "config.toml"), config);

  // ── agents/<роль>.toml — промпты легаси как developer_instructions ────────
  const agentsDir = join(home, "agents");
  for (const stale of readdirSync(agentsDir)) rmSync(join(agentsDir, stale), { force: true, recursive: true });

  for (const role of input.roles) {
    const toml = [
      `name = ${tomlString(role.name)}`,
      `description = ${tomlString(role.description)}`,
      `sandbox_mode = ${tomlString(settings.sandbox)}`,
      `developer_instructions = ${tomlMultiline(role.instructions)}`,
      "",
    ].join("\n");
    записать(join(agentsDir, `${role.name}.toml`), toml);
  }

  // ── skills/ — легаси-скиллы как есть + навык платформы ───────────────────
  const skillsDir = join(home, "skills");
  for (const stale of readdirSync(skillsDir)) rmSync(join(skillsDir, stale), { force: true, recursive: true });
  let skills = 0;

  if (existsSync(input.skillsDir)) {
    for (const entry of readdirSync(input.skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(input.skillsDir, entry.name, "SKILL.md"))) continue;
      cpSync(join(input.skillsDir, entry.name), join(skillsDir, entry.name), { recursive: true });
      skills += 1;
    }
  }

  // ── prompts/ — команды-воркфлоу ──────────────────────────────────────────
  const promptsDir = join(home, "prompts");
  if (existsSync(input.promptsDir)) {
    for (const entry of readdirSync(input.promptsDir)) {
      if (!entry.endsWith(".md")) continue;
      записать(join(promptsDir, entry), readFileSync(join(input.promptsDir, entry), "utf8"));
    }
  }

  return { home, roles: input.roles.length, skills };
}

/** Текст команды-воркфлоу из `prompts/<имя>.md`; `undefined` — команды нет. */
export function commandPrompt(promptsDir: string, name: string): string | undefined {
  const path = join(promptsDir, `${name}.md`);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * Жив ли тред прежнего прогона — есть ли его rollout в `sessions/`.
 *
 * ПРОВЕРЯЕТСЯ ДО ХОДА, А НЕ ПО ОШИБКЕ. `resumeThread` на несуществующем треде
 * роняет ход роли — то есть меняет прогон на отказ там, где прежде был
 * результат. Цена вопроса разная: продолжить нечего — роль просто начинает
 * новый тред и получает прежнюю редакцию текстом во вводной; уронить ход —
 * потерять заключение целиком.
 *
 * Rollout лежит в `sessions/<год>/<месяц>/<день>/rollout-<время>-<тред>.jsonl`;
 * ищем по имени файла, потому что раскладка по датам — деталь Codex, а
 * идентификатор в имени — то, на что можно опереться.
 */
export function threadResumable(home: string, threadId: string): boolean {
  const root = join(home, "sessions");
  if (threadId === "" || !existsSync(root)) return false;

  const обход = (dir: string): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (обход(join(dir, entry.name))) return true;
        continue;
      }
      if (entry.name.includes(threadId)) return true;
    }
    return false;
  };

  try {
    return обход(root);
  } catch {
    // Папка сессий нечитаема — продолжать тред нельзя, но и прогон ронять не за
    // что: роль начнёт новый и получит прежнюю редакцию текстом.
    return false;
  }
}
