/**
 * Нативная оркестрация: Дирижёр ведёт такты сам, роли — субагенты (А12).
 *
 * В ЛЕГАСИ ТАКТЫ ВЁЛ ДИРИЖЁР, А БЛОКИ НОСИЛ ЧЕЛОВЕК. Здесь человек заменён
 * инструментами Codex: корневой тред с промптом Дирижёра получает команду
 * `/оценка`, зовёт роли `spawn_agent`, передаёт блоки `send_input`, ждёт `wait`,
 * возвращает непринятое. Наш код при этом делает три вещи: собирает дом Codex с
 * ролями и навыками, запускает корневой ход и читает то, что роли записали в
 * `выход/<Имя>.json`. Порядок тактов, ворота, приёмка — в промпте команды, как
 * регламент легаси, и исполняются агентом, а не кодом.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ РЕЖИМА «ТАКТЫ». Там ворота держит код и роль не
 * стартует раньше смежника ни при каком ответе модели. Здесь ворота держит
 * Дирижёр, и он может ошибиться — зато он может и вернуть роли работу, и позвать
 * Light-инженера вместо оркестра, и спросить Штаб. Оба режима остаются рядом;
 * выбор — `STROYINTELLECT_CODEX_ORCHESTRATION`.
 *
 * РЕЗУЛЬТАТ ЧИТАЕТСЯ ИЗ ФАЙЛОВ, А НЕ ИЗ ТЕКСТА КОРНЕВОГО ХОДА. Корневой агент
 * пересказал бы за роли; файл, записанный ролью, — её собственный итог по той же
 * схеме, что и в режиме тактов, и приводится тем же `toDocumentReview`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CheckStopped, type CheckProgress, type DocumentReview } from "@modules/workflow/check-object.js";

import type { RoleRunner, RoleTurn } from "./codex-client.js";
import {
  dispatcherSection,
  parseCrewOutput,
  parseDispatcherOutput,
  reloadAsQuestions,
  toDocumentReview,
  type CoordinateIndex,
} from "./crew-output.js";
import type { Crew, CrewRole } from "./crew.js";
import type { Workspace } from "./workspace.js";

export interface NativeCrewInput {
  readonly runner: RoleRunner;
  readonly workspace: Workspace;
  readonly roles: readonly CrewRole[];
  /** Промпт Дирижёра — developer_instructions корневого треда. */
  readonly dispatcherPrompt: string;
  /** Текст команды-воркфлоу `/оценка`. */
  readonly command: string;
  readonly coreRules: string;
  readonly index: CoordinateIndex;
  readonly provider: string;
  readonly model: string;
  /** Потолок всего оркестра, минут: один ход корня длится столько, сколько такты. */
  readonly totalMinutes: number;
  readonly now: string;
  readonly progress?: (event: CheckProgress) => Promise<void>;
  readonly stopRequested?: () => string | undefined;
}

const DISPATCHER = "дирижёр";

/** Роль по имени файла `выход/<Имя>.json`. */
function roleOfFile(file: string, roles: readonly CrewRole[]): CrewRole | undefined {
  const stem = file.replace(/\.json$/u, "").toLowerCase();
  return roles.find((r) => r.person.toLowerCase() === stem);
}

/** Имя роли из первой строки блока: «РОЛЬ: Людмила». */
function roleOfPrompt(prompt: string, roles: readonly CrewRole[]): CrewRole | undefined {
  const match = /^\s*РОЛЬ:\s*([\p{L}]+)/iu.exec(prompt);
  if (match === null) return undefined;
  const wanted = match[1]!.toLowerCase();
  return roles.find((r) => r.person.toLowerCase() === wanted || wanted.startsWith(r.person.toLowerCase().slice(0, -1)));
}

export function startNativeCrew(input: NativeCrewInput): Crew {
  const { workspace, roles } = input;
  const outDir = join(workspace.root, "выход");
  let run: Promise<Map<string, DocumentReview>> | undefined;

  const report = async (event: CheckProgress): Promise<void> => {
    if (input.progress !== undefined) await input.progress(event);
  };

  const scopeOf = (role: CrewRole) => (role.scope === "синтез" ? ("синтез" as const) : ("объект" as const));

  /** Итог роли из файла, если она его записала. */
  const readRole = (role: CrewRole): unknown => {
    const path = join(outDir, `${role.person}.json`);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch (cause) {
      return { verdict: `итог записан, но не разобран: ${(cause as Error).message}` };
    }
  };

  const orchestrate = async (): Promise<Map<string, DocumentReview>> => {
    const subject = workspace.objectPath;
    const started = new Set<string>();
    const spoken = new Set<string>();
    const reviews = new Map<string, DocumentReview>();

    await report({ kind: "агент-начал", capability: DISPATCHER, subject, scope: "объект" });

    /**
     * Живые события — с предметов корневого хода: `spawn_agent` с блоком
     * «РОЛЬ: …» означает «роль позвана»; файл в `выход/` — «роль высказалась».
     * Доска агентов на экране двигается по ходу, а не по итогу.
     */
    const onItem = (item: unknown): void => {
      const raw = item as { type?: string; tool?: string; prompt?: string | null; agents_states?: Record<string, { status?: string }> };
      if (raw.type !== "collab_tool_call") return;

      if (raw.tool === "spawn_agent" && raw.prompt) {
        const role = roleOfPrompt(raw.prompt, roles);
        if (role !== undefined && !started.has(role.capability)) {
          started.add(role.capability);
          void report({ kind: "агент-начал", capability: role.capability, subject, scope: scopeOf(role) });
        }
      }

      if (raw.tool === "wait" || raw.tool === "send_input") void announceFinished();
    };

    /** Роли, чьи файлы появились, объявляются высказавшимися — по мере хода. */
    const announceFinished = async (): Promise<void> => {
      if (!existsSync(outDir)) return;
      for (const file of readdirSync(outDir)) {
        const role = roleOfFile(file, roles);
        if (role === undefined || spoken.has(role.capability)) continue;
        if (statSync(join(outDir, file)).size === 0) continue;

        const review = assemble(role, readRole(role), undefined);
        if (review === undefined) continue;
        spoken.add(role.capability);
        reviews.set(role.capability, review);
        await report({ kind: "агент-высказался", scope: scopeOf(role), outcome: outcomeOf(role, review) });
      }
    };

    const outcomeOf = (role: CrewRole, review: DocumentReview) => ({
      path: subject,
      scope: "объект" as const,
      capability: role.capability,
      verdict: review.verdict,
      findings: review.findings,
      ...(review.openQuestions === undefined ? {} : { openQuestions: review.openQuestions }),
      ...(review.sections === undefined ? {} : { sections: review.sections }),
      ...(review.toolCalls === undefined ? {} : { toolCalls: review.toolCalls }),
      ...(review.run === undefined ? {} : { run: review.run }),
    });

    const emptyTurn = (threadId?: string): RoleTurn => ({
      output: undefined,
      finalResponse: "",
      commands: [],
      searches: [],
      errors: [],
      collab: [],
      inputTokens: 0,
      outputTokens: 0,
      threadId,
    });

    const assemble = (role: CrewRole, raw: unknown, rootTurn: RoleTurn | undefined): DocumentReview | undefined => {
      if (raw === undefined) return undefined;
      const output = parseCrewOutput(raw);
      const review = toDocumentReview({
        output,
        turn: rootTurn ?? emptyTurn(),
        index: input.index,
        promptSource: role.promptSource,
        provider: input.provider,
        model: input.model,
        checkedAt: input.now,
      });
      return { ...review, verdict: review.verdict.replace(/\[след: 0 команд, 0 токенов\]/u, "[след: субагент Дирижёра]") };
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.totalMinutes * 60_000);
    let stopped: string | undefined;
    const watch = setInterval(() => {
      const reason = input.stopRequested?.();
      if (reason !== undefined) {
        stopped = reason;
        controller.abort();
      }
      void announceFinished();
    }, 10_000);

    const text = [
      input.command,
      "",
      "━━━━━━━━━━━━ ЯДРО (общие правила экипажа) ━━━━━━━━━━━━",
      input.coreRules,
      "",
      "━━━━━━━━━━━━ ОБЪЕКТ ━━━━━━━━━━━━",
      `Сегодня ${input.now.slice(0, 10)}. Объект ${workspace.objectCode}. Рабочая папка — текущий каталог.`,
      workspace.summary,
      "",
      `Роли, которых нет в опоре (режим [БЕЗ БАЗЫ] для них): ${workspace.withoutBase.length === 0 ? "нет" : workspace.withoutBase.join(", ")}.`,
      "Начинай с ШАГА 1. Каждый блок субагенту начинай строкой «РОЛЬ: <Имя>».",
    ].join("\n");

    let rootTurn: RoleTurn;
    try {
      rootTurn = await input.runner({
        role: "Дирижёр",
        text,
        schema: undefined,
        developerInstructions: input.dispatcherPrompt,
        onItem,
        workingDirectory: workspace.root,
        additionalDirectories: [workspace.objectPath],
        signal: controller.signal,
      });
    } catch (error) {
      if (stopped !== undefined) throw new CheckStopped(stopped);
      throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(watch);
    }

    await announceFinished();

    // Дирижёр — как в режиме тактов: раздел и вопросы дозагрузки в документ Настеньки.
    const dispatcherRaw = readRole({ person: "Дирижёр" } as CrewRole);
    const dispatcher = dispatcherRaw === undefined ? undefined : parseDispatcherOutput(dispatcherRaw);
    await report({
      kind: "агент-высказался",
      scope: "объект",
      outcome: {
        path: subject,
        scope: "объект",
        capability: DISPATCHER,
        verdict: dispatcher === undefined ? `Дирижёр: ${rootTurn.finalResponse.slice(0, 300)}` : `${dispatcher.decision === "гейт" ? "🔴 ГЕЙТ" : "маршрут выдан"}: ${dispatcher.route || "—"}`,
        findings: [],
        ...(dispatcher === undefined ? {} : { openQuestions: reloadAsQuestions(dispatcher), sections: [dispatcherSection(dispatcher)] }),
        toolCalls: toDocumentReview({
          output: parseCrewOutput({}),
          turn: rootTurn,
          index: input.index,
          promptSource: "эталон",
          provider: input.provider,
          model: input.model,
          checkedAt: input.now,
        }).toolCalls ?? [],
        run: {
          ...(rootTurn.threadId === undefined ? {} : { threadId: rootTurn.threadId }),
          provider: input.provider,
          model: input.model,
          inputTokens: rootTurn.inputTokens,
          outputTokens: rootTurn.outputTokens,
        },
      },
    });

    const passport = reviews.get("object_passport");
    if (passport !== undefined && dispatcher !== undefined) {
      reviews.set("object_passport", {
        ...passport,
        sections: [dispatcherSection(dispatcher), ...(passport.sections ?? [])],
        openQuestions: [...reloadAsQuestions(dispatcher), ...(passport.openQuestions ?? [])],
      });
    }

    return reviews;
  };

  return {
    result: async (capability) => {
      run ??= orchestrate();
      const reviews = await run;
      const review = reviews.get(capability);
      const role = roles.find((r) => r.capability === capability);

      if (review === undefined) {
        throw new Error(
          `${role?.person ?? capability}: итог не записан в выход/${role?.person ?? capability}.json — Дирижёр роль не позвал или роль не ответила (нативная оркестрация)`,
        );
      }

      return review;
    },
  };
}
