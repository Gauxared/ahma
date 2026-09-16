/**
 * Экипаж как рецензенты обхода (spec-demo-stage-1 §7).
 *
 * ОБХОД НЕ ЗНАЕТ, ЧТО ЗА НИМ СТОИТ КОДЕКС. Он спрашивает у восьми объектных и
 * двух синтезных рецензентов их заключения — как у конвейера. Первый вопрос
 * запускает Дирижёра и весь DAG тактов; остальные рецензенты ждут своей роли.
 * Экран, пакет, `agent_run`, выгрузки заполняются без изменений: им приходит
 * тот же `DocumentReview`.
 *
 * ДОКУМЕНТНЫХ РЕЦЕНЗЕНТОВ В ЭТОМ РЕЖИМЕ НЕТ. Людмила и Денчик в реестре —
 * роли «документ», но здесь они смотрят все сметы объекта из одного треда:
 * так закрывается Т9.5, и так устроен образец (один чат Людмилы на объект).
 *
 * ПРОМПТ РОЛИ — ЭТАЛОННЫЙ ТЕКСТ, если он есть в конфигурации
 * (`config/agents/<роль>/source-prompt.txt`), иначе доктрина `prompt.md` с
 * дельтами. Разница объявляется в вердикте словом (crew-output).
 *
 * РАБОЧАЯ ПАПКА СТРОИТСЯ ПРИ ПЕРВОМ ВОПРОСЕ, а не при сборке рецензентов: ей
 * нужен полный накопитель обхода и итоги по документам, а они появляются только
 * когда обход закончил разбор — то есть ровно тогда, когда объектных
 * рецензентов и спрашивают.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";

import type { CodeSystem } from "@contracts/index.js";
import { renderReferenceBase } from "@modules/agents/reference-base.js";
import type {
  CheckProgress,
  ObjectReviewContext,
  ObjectReviewer,
  SynthesisReviewer,
} from "@modules/workflow/check-object.js";

import type { Platform } from "../bootstrap.js";
import { loadReferenceBase, loadReferenceBaseSheets } from "../config/reference-base-loader.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

import type { PreviousEdition, PreviousEditions } from "../execution/previous-edition.js";

import { createCodexRunner, providerLabel, type CodexSettings, type RoleRunner } from "./codex-client.js";
import { commandPrompt, materializeCodexHome, threadResumable, type HomeRole } from "./codex-home.js";
import { startNativeCrew } from "./crew-native.js";
import { buildCoordinateIndex } from "./crew-output.js";
import { startCrew, type Crew, type CrewRole } from "./crew.js";
import { materializeWorkspace } from "./workspace.js";

export interface CrewReviewersInput {
  readonly platform: Platform;
  readonly settings: CodexSettings;
  readonly objectPath: string;
  readonly objectCode: string;
  readonly now: string;
  readonly progress?: (event: CheckProgress) => Promise<void>;
  readonly stopRequested?: () => string | undefined;
  /**
   * Что роли говорили об этом объекте в прошлый раз (Т9.5). Читается из базы
   * воркером — исполнитель прогона в базу не ходит.
   */
  readonly previous?: PreviousEditions;
  /** Подмена исполнителя — тестам; в работе исполнитель строится из настроек. */
  readonly runner?: RoleRunner;
}

/** Шифры смет ищутся по семи системам — как в собственном цикле конвейера. */
const CODE_SYSTEMS: readonly CodeSystem[] = ["ГЭСН", "ГЭСНм", "ГЭСНмр", "ГЭСНп", "ГЭСНр", "ФСБЦ", "ФССЦ", "ФЕР"];

/** Роли экипажа из реестра агентов, с текстами промптов. */
export function crewRolesOf(platform: Platform, configRoot: string): CrewRole[] {
  return platform.roster.all().map((identity) => {
    const folder = join(configRoot, "agents", identity.id);
    const reference = join(folder, "source-prompt.txt");

    if (existsSync(reference)) {
      return {
        id: identity.id,
        capability: identity.capability,
        person: identity.person,
        role: identity.role,
        scope: identity.scope,
        requiredSections: identity.requiredSections,
        prompt: readFileSync(reference, "utf8"),
        promptSource: "эталон",
      };
    }

    const doctrine = readFileSync(join(folder, "prompt.md"), "utf8");
    const deltas = join(folder, "deltas.md");

    return {
      id: identity.id,
      capability: identity.capability,
      person: identity.person,
      role: identity.role,
      scope: identity.scope,
      requiredSections: identity.requiredSections,
      prompt: existsSync(deltas) ? `${doctrine}\n\n${readFileSync(deltas, "utf8")}` : doctrine,
      promptSource: "доктрина",
    };
  });
}

/**
 * Роли вне пакета — как нативные субагенты (А12): Дмитрий (ГАП), Рудик
 * (прораб), пять Light-инженеров. Их промпты лежат в `config/crew/roles/*.txt`
 * дословно из легаси; в такты они не входят, но Дирижёр может их позвать —
 * маршрут A (единый инженер) и контуры v9.
 */
export function extraRolesOf(configRoot: string): HomeRole[] {
  const dir = join(configRoot, "crew", "roles");
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => file.endsWith(".txt"))
    .sort()
    .map((file) => {
      const stem = file.replace(/\.txt$/u, "");
      const [person, ...rest] = stem.split("-");
      const name = person!.charAt(0).toUpperCase() + person!.slice(1);
      return {
        name,
        description: `${name} — ${rest.join(" ") || "роль легаси"}; промпт легаси дословно`,
        instructions: readFileSync(join(dir, file), "utf8"),
      };
    });
}

/** Спецификация базы вида `единая:00·,02·` — листы Единой базы по префиксам имён. */
const UNIFIED_PREFIX = "единая:";

export interface ExtraBases {
  /** Книга Единой базы (120 листов с префиксами ролей и листами памяти Дирижёра). */
  readonly unified: string;
  readonly roles: readonly { readonly person: string; readonly spec: string }[];
}

/**
 * Привязка баз к ролям, которых нет в `config/agents/<роль>/manifest.json`:
 * `config/crew/bases/привязка.json`. Нет файла — ролей без манифеста с базой
 * нет, и это честный режим [БЕЗ БАЗЫ], а не тихая ошибка.
 */
export function extraBasesOf(configRoot: string): ExtraBases {
  const path = join(configRoot, "crew", "bases", "привязка.json");
  if (!existsSync(path)) return { unified: join(configRoot, "crew", "bases", "СтройИнтеллект_ЕдинаяБаза_v1.0.xlsx"), roles: [] };

  const parsed = JSON.parse(readFileSync(path, "utf8")) as { единая?: string; роли?: Record<string, string> };
  const root = join(configRoot, "..");
  const resolve = (spec: string): string => (spec.startsWith(UNIFIED_PREFIX) ? spec : join(root, spec));

  return {
    unified: join(root, parsed.единая ?? "config/crew/bases/СтройИнтеллект_ЕдинаяБаза_v1.0.xlsx"),
    roles: Object.entries(parsed.роли ?? {}).map(([person, spec]) => ({ person, spec: resolve(spec) })),
  };
}

/**
 * ВСЕ ИСТОЧНИКИ БАЗЫ — Т12: «нормативка и опорная база вся должна быть в
 * системе». Перечень строится ОБХОДОМ ПАПОК, а не списком в коде: источник,
 * добавленный файлом, участвует в анализе со следующего прогона и правки кода
 * не требует (Т13).
 */
export function allBases(configRoot: string): readonly { readonly title: string; readonly path: string }[] {
  const roots = [join(configRoot, "crew", "bases"), join(configRoot, "..", "reference-system")];
  const found = new Map<string, string>();

  for (const dir of roots) {
    if (!existsSync(dir)) continue;

    for (const name of readdirSync(dir)) {
      if (!/\.xlsx?$/iu.test(name) || name.startsWith("~$")) continue;
      // Книга под одним именем в двух папках — один источник: `config/` главнее,
      // потому что именно она едет на сервер.
      if (!found.has(name)) found.set(name, join(dir, name));
    }
  }

  return [...found].map(([name, path]) => ({ title: name.replace(/\.xlsx?$/iu, ""), path })).sort((a, b) => a.title.localeCompare(b.title));
}

/** Отбор листов по спецификации `единая:<префикс>,<префикс>`. */
export function sheetKeeper(spec: string): (sheetName: string) => boolean {
  const prefixes = spec
    .slice(UNIFIED_PREFIX.length)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return (sheetName) => prefixes.some((prefix) => sheetName.startsWith(prefix));
}

const DISPATCHER_FALLBACK = [
  "Ты — Дирижёр СтройИнтеллект: диспетчер приёма объекта. Собери паспорт входа (домен · сторона стола · стадия · состав данных · срок и цель; что не дано — ❌),",
  "оцени по пяти критериям (тип задачи, домен, качество данных, объём, сторона стола), назови маршрут, объяви гейт неполных данных, если считать честно нельзя,",
  "и подготовь блоки для первых агентов. «В работе» и «нужно уточнить» как итог — не результат.",
].join(" ");

/**
 * ЦЕНА ПАМЯТИ НАЗВАНА И ПРИНЯТА — ПОТОЛКА ЗДЕСЬ НЕТ.
 *
 * ЗАМЕРЕНО НА ПРОГОНЕ 16 (08.09.2026, редакция 9 Дагестана): продолжение
 * тредов подняло прогон с 2,80 до 14,51 млн входных токенов и с 36 до 64
 * минут. Возобновлённый тред несёт ВСЕ прежние редакции: девятая тащит за
 * собой восемь, и один ход сметчика стоил 2,82 млн токенов — больше, чем весь
 * прежний прогон целиком.
 *
 * РЕШЕНИЕ ВЛАДЕЛЬЦА 09.09.2026: порога не ставим. Тот же прогон показал, ради
 * чего платится эта цена — роли отчитались о судьбе прежних находок, завели
 * листы «Судьба находок» и «Редакция-контроль», а Людмила после возврата
 * выдала 66 позиций вместо 15. В строительной документации потерянная деталь
 * стоит дороже потраченного токена, поэтому тред продолжается всегда, когда
 * его след жив.
 *
 * Единственная причина НЕ продолжать — мёртвый след: `resumeThread` на нём
 * уронил бы ход роли, то есть обменял бы заключение на отказ.
 */
function продолжаемый(role: PreviousEdition, home: string): boolean {
  return role.threadId !== undefined && threadResumable(home, role.threadId);
}

export function buildCrewReviewers(input: CrewReviewersInput): {
  readonly objectReviewers: (collected: CollectedDuringCheck) => readonly ObjectReviewer[];
  readonly synthesisReviewers: (collected: CollectedDuringCheck) => readonly SynthesisReviewer[];
} {
  const { platform, settings } = input;
  const roles = crewRolesOf(platform, settings.configRoot);
  const extraBases = extraBasesOf(settings.configRoot);

  const coreRulesPath = join(settings.configRoot, "crew", "core-rules.md");
  const dispatcherPath = join(settings.configRoot, "crew", "dispatcher-prompt.txt");
  const coreRules = existsSync(coreRulesPath) ? readFileSync(coreRulesPath, "utf8") : "";
  const dispatcherPrompt = existsSync(dispatcherPath) ? readFileSync(dispatcherPath, "utf8") : DISPATCHER_FALLBACK;

  const normOf = (code: string): string | undefined => {
    for (const system of CODE_SYSTEMS) {
      const item = platform.catalogue.findByCode({ system, code });
      if (item !== undefined) return `${item.name} · единица ${item.unit} · ${system}`;
    }
    return undefined;
  };

  let crew: Promise<Crew> | undefined;

  const ensure = (collected: CollectedDuringCheck, context: ObjectReviewContext): Promise<Crew> => {
    crew ??= (async () => {
      /**
       * ДОМ CODEX СОБИРАЕТСЯ ПЕРЕД ПРОГОНОМ (А12): роли пакета и роли вне
       * пакета — `agents/*.toml` с промптами легаси, навыки легаси — `skills/`,
       * команда `/оценка` — `prompts/`. Обоим режимам оркестрации нужен один
       * и тот же дом: в режиме тактов роли получают навыки и могут звать
       * помощников, в нативном — Дирижёр зовёт роли сам.
       */
      materializeCodexHome({
        settings,
        roles: [
          { name: "Дирижёр", description: "Дирижёр СтройИнтеллект.Plus v9.8 — диспетчер и штаб", instructions: dispatcherPrompt },
          ...roles.map((r) => ({ name: r.person, description: `${r.person} — ${r.role}`, instructions: r.prompt })),
          ...extraRolesOf(settings.configRoot),
        ],
        skillsDir: join(settings.configRoot, "skills"),
        promptsDir: join(settings.configRoot, "codex", "prompts"),
      });

      const workspace = await materializeWorkspace({
        root: settings.runsRoot,
        label: `${input.objectCode}-${input.now.replace(/[:.]/g, "-")}`,
        objectCode: input.objectCode,
        objectPath: input.objectPath,
        collected,
        documents: context.documents,
        declaredTotal: context.declaredTotal,
        roles: [
          ...roles.map((r) => ({
            capability: r.capability,
            person: r.person,
            referenceBase: platform.roster.find(r.capability)?.referenceBase,
          })),
          // Дирижёр и роли вне пакета — базы по привязке (Единая база и книги
          // Light-контуров): раньше они работали [БЕЗ БАЗЫ] при лежащих рядом книгах.
          ...extraBases.roles.map((r) => ({ capability: `легаси:${r.person}`, person: r.person, referenceBase: r.spec })),
        ],
        /**
         * ВСЕ КНИГИ БАЗЫ, А НЕ КНИГА СВОЕЙ РОЛИ (Т12). Читаются командами из
         * `база/`, поэтому полнота не оплачивается окном промпта.
         */
        bases: allBases(settings.configRoot),
        // Своды правил и ГОСТы текстом: извлекаются один раз
        // (`tooling/extract-normative.ts`) и живут вне выпусков, в `var/`.
        normativeDir: env["STROYINTELLECT_NORMATIVE_DIR"] ?? join(cwd(), "var", "нормативка"),
        // Кейсы прежней системы: планка по составу входа и выхода.
        casesDir: env["STROYINTELLECT_CASES_DIR"] ?? join(cwd(), "var", "кейсы"),
        /**
         * ВЕСЬ каталог нормативов (Т12): роль поднимает любой шифр, а не только
         * встреченный в сметах этого объекта.
         */
        catalogue: platform.catalogue.all().flatMap((item) =>
          item.codes.map((code) => ({ code: code.code, name: item.name, unit: item.unit, system: code.system })),
        ),
        referenceBaseText: async (spec) => {
          const base = spec.startsWith(UNIFIED_PREFIX)
            ? await loadReferenceBaseSheets(extraBases.unified, sheetKeeper(spec))
            : await loadReferenceBase(spec);
          return base === undefined ? undefined : renderReferenceBase(base, 100_000);
        },
        normOf,
        coreRules,
      });

      const runner = input.runner ?? createCodexRunner(settings);
      const command = commandPrompt(join(settings.configRoot, "codex", "prompts"), "оценка");

      if (settings.orchestration === "нативная" && command !== undefined) {
        return startNativeCrew({
          runner,
          workspace,
          roles,
          dispatcherPrompt,
          command,
          coreRules,
          index: buildCoordinateIndex(collected),
          provider: providerLabel(settings),
          model: settings.model,
          // Весь оркестр — один ход корня: потолок роли, умноженный на такты.
          totalMinutes: settings.turnMinutes * 5,
          now: input.now,
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          ...(input.stopRequested === undefined ? {} : { stopRequested: input.stopRequested }),
        });
      }

      return startCrew({
        runner,
        workspace,
        roles,
        dispatcherPrompt,
        coreRules,
        index: buildCoordinateIndex(collected),
        // Позиции, нормализованные ролью, копятся вместе с разобранными (Т11).
        ...(collected.absorb === undefined ? {} : { absorb: collected.absorb }),
        provider: providerLabel(settings),
        model: settings.model,
        turnMinutes: settings.turnMinutes,
        now: input.now,
        webSearch: settings.webSearch,
        /**
         * ПРЕЖНЯЯ РЕДАКЦИЯ — С ОТСЕЧЁННЫМИ МЁРТВЫМИ ТРЕДАМИ.
         *
         * Тред, чей rollout не пережил переезд выпуска, продолжить нельзя:
         * `resumeThread` уронил бы ход роли, то есть обменял бы заключение на
         * отказ. Выписка из прежней редакции при этом остаётся — память не
         * теряется, теряется только продолжение разговора.
         */
        ...(input.previous === undefined
          ? {}
          : {
              previous: {
                edition: input.previous.edition,
                roles: input.previous.roles.map((role) =>
                  продолжаемый(role, settings.home)
                    ? role
                    : {
                        capability: role.capability,
                        verdict: role.verdict,
                        saidAt: role.saidAt,
                        findings: role.findings,
                        questions: role.questions,
                      },
                ),
              },
            }),
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(input.stopRequested === undefined ? {} : { stopRequested: input.stopRequested }),
      });
    })();

    return crew;
  };

  return {
    objectReviewers: (collected) =>
      roles
        .filter((role) => role.scope !== "синтез")
        .map((role) => ({
          capability: role.capability,
          review: async (context) => (await ensure(collected, context)).result(role.capability),
        })),
    synthesisReviewers: (collected) =>
      roles
        .filter((role) => role.scope === "синтез")
        .map((role) => ({
          capability: role.capability,
          review: async (context) => (await ensure(collected, context)).result(role.capability),
        })),
  };
}
