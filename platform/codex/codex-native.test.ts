/**
 * НАТИВНЫЕ МЕХАНИЗМЫ CODEX (А12): дом с ролями и навыками, оркестрация Дирижёром.
 *
 * Замерено 08.09.2026: роль из `agents/<имя>.toml` отвечает по своим
 * `developer_instructions` при `spawn_agent`, навык из `skills/` читается без
 * нашего кода. Здесь проверяется то, что делаем МЫ: дом собирается из
 * конфигурации репозитория дословно, а нативная оркестрация читает итоги ролей
 * из файлов и отличает «роль не ответила» от «роль высказалась».
 */
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CodexSettings, RoleRunner, RoleTask, RoleTurn } from "./codex-client.js";
import { commandPrompt, materializeCodexHome } from "./codex-home.js";
import { startNativeCrew } from "./crew-native.js";
import { buildCoordinateIndex } from "./crew-output.js";
import type { CrewRole } from "./crew.js";
import type { Workspace } from "./workspace.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

async function settings(): Promise<CodexSettings> {
  return {
    baseUrl: "https://llm.example.test/v1",
    apiKey: "ключ",
    model: "cx/модель",
    home: await mkdtemp(join(tmpdir(), "дом-")),
    runsRoot: "/tmp",
    turnMinutes: 20,
    webSearch: true,
    configRoot: "/c",
    sandbox: "danger-full-access",
    orchestration: "нативная",
  };
}

describe("дом Codex", () => {
  it("роли — agents/*.toml с промптом дословно; навыки — копией; команды — prompts/", async () => {
    const s = await settings();
    const cfg = await mkdtemp(join(tmpdir(), "конфиг-"));
    await mkdir(join(cfg, "skills", "проба"), { recursive: true });
    await writeFile(join(cfg, "skills", "проба", "SKILL.md"), "---\nname: проба\ndescription: тест\n---\nтело", "utf8");
    await mkdir(join(cfg, "skills", "без-манифеста"), { recursive: true });
    await mkdir(join(cfg, "prompts"), { recursive: true });
    await writeFile(join(cfg, "prompts", "оценка.md"), "# /оценка\nтакты", "utf8");

    const prompt = 'Ты — Людмила.\nКавычки "внутри" и обратный слэш C:\\путь\nстрока "" с двумя кавычками';
    const result = materializeCodexHome({
      settings: s,
      roles: [{ name: "Людмила", description: "сметчик", instructions: prompt }],
      skillsDir: join(cfg, "skills"),
      promptsDir: join(cfg, "prompts"),
    });

    expect(result.roles).toBe(1);
    expect(result.skills, "папка без SKILL.md — не навык").toBe(1);

    const toml = await readFile(join(s.home, "agents", "Людмила.toml"), "utf8");
    expect(toml).toContain('name = "Людмила"');
    expect(toml).toContain('sandbox_mode = "danger-full-access"');
    // Промпт — дословно, включая кавычки и слэши: TOML-литерал в тройных кавычках.
    expect(toml).toContain(prompt);

    const config = await readFile(join(s.home, "config.toml"), "utf8");
    expect(config).toContain("multi_agent = true");
    expect(config).toContain('web_search = "live"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain("max_depth = 2");

    expect(existsSync(join(s.home, "skills", "проба", "SKILL.md"))).toBe(true);
    expect(existsSync(join(s.home, "skills", "без-манифеста"))).toBe(false);
    expect(commandPrompt(join(cfg, "prompts"), "оценка")).toContain("такты");
    expect(commandPrompt(join(cfg, "prompts"), "нет")).toBeUndefined();
  });

  it("повторная сборка вычищает устаревшие роли и навыки, но не сессии", async () => {
    const s = await settings();
    const cfg = await mkdtemp(join(tmpdir(), "конфиг-"));
    await mkdir(join(s.home, "sessions", "2026"), { recursive: true });
    await writeFile(join(s.home, "sessions", "2026", "rollout.jsonl"), "{}", "utf8");

    materializeCodexHome({ settings: s, roles: [{ name: "Старая", description: "", instructions: "x" }], skillsDir: cfg, promptsDir: cfg });
    materializeCodexHome({ settings: s, roles: [{ name: "Новая", description: "", instructions: "y" }], skillsDir: cfg, promptsDir: cfg });

    expect(existsSync(join(s.home, "agents", "Старая.toml"))).toBe(false);
    expect(existsSync(join(s.home, "agents", "Новая.toml"))).toBe(true);
    expect(existsSync(join(s.home, "sessions", "2026", "rollout.jsonl")), "память объекта стёрта пересборкой дома").toBe(true);
  });
});

const ROLES: CrewRole[] = [
  ["object-passport", "object_passport", "Настенька", "объект"],
  ["estimate-review", "estimate_review", "Людмила", "документ"],
  ["verdict", "object_verdict", "Артемий", "синтез"],
].map(([id, capability, person, scope]) => ({
  id: id!,
  capability: capability!,
  person: person!,
  role: `роль ${person}`,
  scope: scope as CrewRole["scope"],
  requiredSections: [],
  prompt: `ПРОМПТ ${person}`,
  promptSource: "эталон",
}));

async function workspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), "нативно-"));
  await mkdir(join(root, "выход"));
  return { root, objectPath: "/о/партия", objectCode: "ТЕСТ", summary: "# ОБЪЕКТ ТЕСТ", estimates: [], texts: [], sheets: [], withoutBase: [] };
}

const roleFile = (verdict: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ verdict, summary: [], findings: [], sections: [], openQuestions: [], handoffs: [], assumptions: [], alerts: [], nextTakt: "", ...extra });

describe("нативная оркестрация", () => {
  it("Дирижёр получает команду и свой промпт системой; итоги ролей читаются из выход/*.json", async () => {
    const space = await workspace();
    const tasks: RoleTask[] = [];
    const events: string[] = [];

    /** Подставной корень: «зовёт» роли и пишет их файлы, как сделали бы субагенты. */
    const runner: RoleRunner = async (task) => {
      tasks.push(task);
      task.onItem?.({ type: "collab_tool_call", tool: "spawn_agent", prompt: "РОЛЬ: Людмила\nпроверь сметы", receiver_thread_ids: ["t1"], agents_states: {} } as never);
      await writeFile(join(space.root, "выход", "Людмила.json"), roleFile("🔴 Людмила", { findings: [{ severity: "high", statement: "дубль", basis: "…", document: "", row: 0, impactRub: "", sourceStatus: "факт" }] }), "utf8");
      await writeFile(join(space.root, "выход", "Настенька.json"), roleFile("🟡 Настенька"), "utf8");
      await writeFile(join(space.root, "выход", "Дирижёр.json"), JSON.stringify({ passport: { domain: "дороги", side: "подрядчик", stage: "РД", data: "8 файлов", goal: "вердикт" }, route: "Классик C", why: "пакет", decision: "гейт", reload: [{ what: "договор", why: "нет", from: "заказчик", dueBy: "завтра" }], handoffs: [], whatNext: "такт 0" }), "utf8");
      task.onItem?.({ type: "collab_tool_call", tool: "wait", prompt: null, receiver_thread_ids: ["t1"], agents_states: { t1: { status: "completed", message: "готово" } } } as never);

      const turn: RoleTurn = { output: undefined, finalResponse: "Маршрут C, позвал двоих", commands: [], searches: [], errors: [], collab: [{ tool: "spawn_agent", prompt: "РОЛЬ: Людмила", receivers: ["t1"], states: [] }], inputTokens: 500, outputTokens: 50, threadId: "корень" };
      return turn;
    };

    const crew = startNativeCrew({
      runner,
      workspace: space,
      roles: ROLES,
      dispatcherPrompt: "ПРОМПТ ДИРИЖЁРА",
      command: "# /оценка — такты",
      coreRules: "ЯДРО",
      index: buildCoordinateIndex({ documentHashes: [], linearPositions: [], extracted: [], descriptors: [], designDocuments: [], designSheets: [] } as unknown as CollectedDuringCheck),
      provider: "тест",
      model: "м",
      totalMinutes: 1,
      now: "2026-09-08T10:00:00.000Z",
      progress: async (event) => {
        events.push(event.kind === "агент-начал" ? `начал:${event.capability}` : event.kind === "агент-высказался" ? `сказал:${event.outcome.capability}` : event.kind);
      },
    });

    const ludmila = await crew.result("estimate_review");
    expect(ludmila.verdict).toContain("🔴 Людмила");
    expect(ludmila.verdict).toContain("[след: субагент Дирижёра]");
    expect(ludmila.findings).toHaveLength(1);

    // Корень позван один раз: команда — в тексте хода, промпт Дирижёра — системой.
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.role).toBe("Дирижёр");
    expect(tasks[0]!.developerInstructions).toBe("ПРОМПТ ДИРИЖЁРА");
    expect(tasks[0]!.text).toContain("# /оценка — такты");
    expect(tasks[0]!.text).toContain("# ОБЪЕКТ ТЕСТ");
    expect(tasks[0]!.schema).toBeUndefined();

    // Гейт Дирижёра — разделом и вопросами у Настеньки, как в режиме тактов.
    const nastya = await crew.result("object_passport");
    expect(nastya.sections?.[0]?.id).toBe("dispatcher_route");
    expect(nastya.openQuestions?.[0]?.question).toContain("договор");

    // Роль без файла — отказ с причиной, а не пустой успех.
    await expect(crew.result("object_verdict")).rejects.toThrow("Артемий: итог не записан в выход/Артемий.json");

    // Доска: «позван» — по spawn_agent с «РОЛЬ: …», «высказался» — по файлу; Дирижёр — первым и последним.
    expect(events[0]).toBe("начал:дирижёр");
    expect(events).toContain("начал:estimate_review");
    expect(events).toContain("сказал:estimate_review");
    expect(events).toContain("сказал:object_passport");
    expect(events[events.length - 1]).toBe("сказал:дирижёр");
  });
});
