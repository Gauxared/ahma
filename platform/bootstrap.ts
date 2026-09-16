/**
 * Композиционный корень (ADR-R-028: сборка руками, без DI-фреймворка).
 *
 * Здесь и только здесь части системы узнают друг о друге. Всё, что ниже, знает
 * лишь узкую талию контрактов.
 *
 * Порядок важен: сначала конфигурация, потом реестры, потом исполнитель. Любая
 * ошибка конфигурации ОСТАНАВЛИВАЕТ сборку — fail closed (ADR-R-014, R-017).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { loadBundle } from "./config/bundle-loader.js";
import { deploymentProfile } from "./config/deployment-profile.js";
import { declaredContour, visionPolicy } from "./config/vision-policy.js";
import type { DeploymentProfile } from "./config/deployment-profile.js";
import { ParameterRegistry, parameterBundleSchema } from "./config/parameters.js";
import { loadAgentRoster } from "./config/agent-roster.js";
import { loadReferenceBase } from "./config/reference-base-loader.js";
import { renderReferenceBase } from "@modules/agents/reference-base.js";
import type { AgentRoster } from "./config/agent-roster.js";
import { loadChecklists, loadRouting, loadWorkflows } from "./config/workflow-loader.js";
import type { ChecklistConfig, RoutingConfig, WorkflowDefinition } from "./config/workflow-loader.js";
import { CapabilityRegistry } from "./extensions/capabilities.js";
import { extensionBundleSchema } from "./extensions/manifest.js";
import { ExtensionRegistry } from "./extensions/registry.js";
import { OperationRunner } from "./execution/operation-runner.js";
import { fileContentHash } from "./storage/xlsx-reader.js";
import { detectFileFormat, readSheetsOf } from "./storage/sheet-reader.js";
import {
  docAdapter,
  docxAdapter,
  grandSmetaXmlAdapter,
  odfAdapter,
  pdfAdapter,
  plainTextAdapter,
  pptxAdapter,
  rtfAdapter,
  xmlAdapter,
} from "./storage/adapters.js";
import { ParserRegistry } from "@modules/documents/parser-registry.js";
import { knowledgeScope } from "@modules/workflow/knowledge-scope.js";
import type { KnowledgeScope } from "@modules/workflow/knowledge-scope.js";
import { CanonicalItemRegistry } from "@modules/canonical/item-registry.js";
import { mapPosition, summarize } from "@modules/canonical/map-position.js";
import {
  CANONICAL_ITEMS,
  createParseEstimateOperation,
} from "@modules/documents/operations/parse-estimate.js";
import { createCheckConvergenceOperation } from "@modules/calculations/operations/check-convergence.js";
import { accuracyMarker } from "@modules/calculations/estimate-checks.js";
import { createEstimateReviewOperation } from "@modules/agents/operations/run-estimate-review.js";
import { createTechOpinionOperation } from "@modules/agents/operations/run-tech-opinion.js";
import { createFinanceModelOperation } from "@modules/agents/operations/run-finance-model.js";
import { createProcurementOperation } from "@modules/agents/operations/run-procurement.js";
import { createExecutiveDocsOperation } from "@modules/agents/operations/run-executive-docs.js";
import { createContractAuditOperation } from "@modules/agents/operations/run-contract-audit.js";
import { createObjectPassportOperation } from "@modules/agents/operations/run-object-passport.js";
import { createSubcontractPlanOperation } from "@modules/agents/operations/run-subcontract-plan.js";
import { createVerdictOperation } from "@modules/agents/operations/run-verdict.js";
import { createScheduleOperation } from "@modules/agents/operations/run-schedule.js";
import type { AgentRunRequest, AgentTurn } from "@modules/agents/agent-shell.js";
import type { AgentRuntimePort } from "./runtime/agent-runtime-port.js";
import { codexSettingsFrom, type CodexSettings } from "./codex/codex-client.js";
import { withProfileCeiling } from "./runtime/agent-runtime-port.js";
import type { ModelProfile } from "./runtime/agent-runtime-port.js";
import {
  REASONING_EFFORTS,
  createOpenAiCompatibleRuntime,
} from "./runtime/openai-compatible-adapter.js";
import type { ReasoningEffort } from "./runtime/openai-compatible-adapter.js";
import { anonymize, restoreDeep } from "./security/anonymizer.js";
import type { CollectedModelCall } from "./runtime/call-journal.js";
import { EgressGateway } from "./security/egress-gateway.js";
import type { EgressRecord } from "./security/egress-gateway.js";

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

const modelProfileSchema = z.object({
  id: z.string().min(1),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  structuredOutput: z.enum(["json_schema", "json_mode", "none"]),
  toolCalling: z.enum(["native", "prompted", "none"]),
  vision: z.boolean(),
});
import { isoDate, unitCode } from "@contracts/index.js";

const canonicalItemsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      unit: z.string().min(1),
      codes: z.array(z.object({ system: z.string().min(1), code: z.string().min(1) })).default([]),
    }),
  ),
});

export interface Platform {
  readonly profile: DeploymentProfile;
  /** Область знания прогона: что разрешено и что ею выключено. */
  readonly scope: KnowledgeScope;
  /** Воркфлоу — данные, а не код (M2). Реестр строится из config/workflows. */
  readonly workflows: ReadonlyMap<string, WorkflowDefinition>;
  /** Таблица маршрута приёма. Отсутствует, если конфиг не заведён. */
  readonly routing: RoutingConfig | undefined;
  /** Приёмочные чек-листы агентов (ТЗ §12.2). */
  readonly checklists: readonly ChecklistConfig[];
  /**
   * Кто стоит за способностью: имя, роль, предмет, порядок в конвейере.
   *
   * До него имени агента не существовало как данных, и каждая поверхность
   * придумывала его заново: записка подписывала все девять «Людмилой», веб
   * выбрасывал способность вовсе.
   */
  readonly roster: AgentRoster;
  /**
   * Агентный рантайм — для АГЕНТНОГО РЕЖИМА (Т9).
   *
   * Конвейер ролевых промптов рантайм не спрашивает: он получает готовую
   * функцию `runAgent`, замкнутую на обезличивание и журнал. Агентному циклу
   * этого не хватает — ему нужен диалог с инструментами, то есть сам порт.
   *
   * Отсутствует, когда модель не настроена: агентный режим тогда не
   * предлагается, а не падает при вызове.
   */
  readonly agentRuntime?: AgentRuntimePort;
  /**
   * Настройки экипажа на Codex SDK — для режима `codex` (spec-demo-stage-1).
   *
   * Собраны из тех же переменных, что и рантайм выше; отсутствуют, когда модель
   * или ключ не заданы, — тогда режим не предлагается, а не падает при вызове.
   * Сам SDK живёт в `platform/codex/`, сборка знает только настройки.
   */
  readonly codex?: CodexSettings;
  /**
   * Записать обращение к модели в журнал §12.1л.
   *
   * ПОЧЕМУ ОТДЕЛЬНОЙ ФУНКЦИЕЙ, А НЕ ВНУТРИ РАНТАЙМА. Журнал ведёт композиционный
   * корень: только он знает объявленный контур, классы данных маршрута и то,
   * прошло ли обезличивание. Рантайм этого не знает и знать не должен.
   *
   * Понадобилась, когда появился ВТОРОЙ путь к модели — агентный цикл. Он
   * ходит через порт напрямую, и его двести двадцать обращений в журнал не
   * попадали: §12.1л требует записи каждого, а прогон выглядел бы как два
   * вызова вместо двухсот.
   */
  readonly recordModelCall?: (call: {
    readonly operationId: string;
    readonly contour: "internal" | "external" | undefined;
    readonly provider: string;
    readonly model: string;
    readonly anonymized: boolean;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }) => void;
  readonly catalogue: CanonicalItemRegistry;
  readonly parameters: ParameterRegistry;
  readonly extensions: ExtensionRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly operations: OperationRunner;
  readonly configHashes: ReadonlyMap<string, string>;
  /**
   * Реестр адаптеров разбора ТЕКСТОВЫХ документов и граница §14 по сканам.
   *
   * Появился на Platform в Д1б, и до этого не создавался в продакшене ни разу:
   * реестр был написан, покрыт тестами и не имел ни одного вызова вне них.
   * Книги (`xlsx`, `xls`) читает другой реестр — `SHEET_READERS`: «какой лист у
   * книги» и «какой текст у документа» — разные вопросы.
   */
  readonly parsers: ParserRegistry;
  /** Шлюз выхода наружу (ADR-R-017). Единственная дверь в внешний контур. */
  readonly egressGateway: EgressGateway;
  /**
   * Забирает накопленные решения шлюза и очищает накопитель.
   *
   * Именно ЗАБИРАЕТ, а не читает: запись, отданная дважды, попадёт в журнал
   * дважды, и по нему нельзя будет посчитать, сколько раз система ходила наружу.
   */
  readonly drainEgressLog: () => readonly EgressRecord[];
  /** Забирает записи журнала обращений к моделям (§12.1л). */
  readonly drainModelCalls: () => readonly CollectedModelCall[];
}

export interface BootstrapOptions {
  readonly configRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Разрешённые источники знания (ADR-R-024). `undefined` — ограничения нет.
   * Пустой список — запрещено всё, и первая операция честно откажет.
   */
  readonly knowledgeScope?: readonly string[];
}

export function bootstrap(options: BootstrapOptions = {}): Platform {
  const configRoot = options.configRoot ?? join(process.cwd(), "config");
  const codex = codexSettingsFrom(options.env ?? process.env, configRoot);
  const profile = deploymentProfile(options.env ?? process.env);

  const configHashes = new Map<string, string>();

  // Рантайм создаётся внутри блока «модель настроена»; наружу отдаётся, только
  // если он там создался. Иначе агентный режим не предлагается вовсе.
  let agentRuntime: AgentRuntimePort | undefined;
  let recordModelCall: Platform["recordModelCall"];

  const rates = loadBundle(join(configRoot, "parameters/rates.json"), parameterBundleSchema);
  configHashes.set(rates.path, rates.contentHash);
  const parameters = new ParameterRegistry(rates.value, rates.contentHash);

  const extensions = new ExtensionRegistry();
  const capabilities = new CapabilityRegistry();

  // Источник вне области объявляется ВЫКЛЮЧЕННЫМ, а не пропускается: дальше
  // разрешение способностей само даст либо отказ с названием недостающего,
  // либо записанную деградацию (ADR-R-026). Ручной проверки «а разрешён ли
  // источник» в коде операций нет и не должно быть.
  const scope = knowledgeScope(options.knowledgeScope);

  // Источники знания объявляют способности, а не разделы (ADR-R-026).
  const sources = loadBundle(join(configRoot, "knowledge-sources.json"), extensionBundleSchema);
  configHashes.set(sources.path, sources.contentHash);

  for (const manifest of sources.value.extensions) {
    extensions.register(manifest, {});

    for (const capability of manifest.provides) {
      capabilities.declare({ sourceId: manifest.id, capability, enabled: scope.allows(manifest.id) });
    }
  }

  // Маршруты выхода наружу. Отдельным файлом от источников знания: источник
  // отвечает на вопрос «откуда система берёт сведения», маршрут — «куда она их
  // выносит». Второе — предмет §12.1л и правится другими людьми.
  const routes = loadBundle(join(configRoot, "extensions/model-routes.json"), extensionBundleSchema);
  configHashes.set(routes.path, routes.contentHash);

  for (const manifest of routes.value.extensions) {
    extensions.register(manifest, {});
  }

  const egressGateway = new EgressGateway([
    ...sources.value.extensions,
    ...routes.value.extensions,
  ]);

  // Решения шлюза копятся здесь и уходят в журнал там, где есть транзакция:
  // сам шлюз о базе не знает и знать не должен (ADR-R-025).
  const egressLog: EgressRecord[] = [];

  /**
   * Журнал обращений к моделям (§12.1л, ADR-R-020).
   *
   * ТЗ дословно: «обращение к внешним моделям происходит только по процессам
   * Регламента и только после анонимизации, ЧТО ПОДТВЕРЖДАЕТСЯ ЗАПИСЯМИ
   * ЖУРНАЛА». Записи egress-шлюза отвечают на вопрос «куда ходили» и не
   * отвечают на вопрос Регламента: какой процесс, какие классы данных, было ли
   * обезличивание, сколько токенов.
   *
   * Таблица `model_call` и `ModelCallRecord` существовали с M0 и не
   * заполнялись — восьмой случай механизма без применения (О-73, №29).
   */
  const modelCallLog: CollectedModelCall[] = [];

  // Маршрут модели и то, что ему позволено выносить, берутся ИЗ манифеста, а не
  // повторяются в коде: два места правды разойдутся, и разойдутся молча — код
  // продолжит выносить класс данных, который из манифеста уже убрали.
  const modelRoutes = routes.value.extensions.filter(
    (manifest) => manifest.kind === "model-provider",
  );

  if (modelRoutes.length === 0) {
    throw new Error(
      "в config/extensions/model-routes.json нет ни одного маршрута вида model-provider",
    );
  }

  // Каталог канонических позиций строится из открытых данных ФГИС ЦС командой
  // `pnpm tsx tooling/import-fsnb.ts --fetch` и в репозитории не хранится:
  // дополнения ФСНБ выходят ежеквартально.
  //
  // Без него разбор работает с объявленной деградацией: позиции остаются
  // несопоставленными (ADR-R-026), и это видно в артефакте, а не замалчивается.
  const cataloguePath = join(configRoot, "canonical-items.json");
  const catalogue = new CanonicalItemRegistry();

  if (existsSync(cataloguePath)) {
    const bundle = loadBundle(cataloguePath, canonicalItemsSchema);
    configHashes.set(bundle.path, bundle.contentHash);

    for (const item of bundle.value.items) {
      catalogue.add({
        id: item.id,
        name: item.name,
        unit: unitCode(item.unit),
        codes: item.codes.map((code) => ({ system: code.system as never, code: code.code })),
      });
    }

    capabilities.declare({ sourceId: "canonical-catalogue", capability: CANONICAL_ITEMS, enabled: true });
  }

  // Воркфлоу читаются из конфигурации: такты, порядок и предусловия меняются
  // без пересборки. Ошибка любого файла останавливает сборку (ADR-R-014).
  const workflows = new Map<string, WorkflowDefinition>();
  const workflowsDir = join(configRoot, "workflows");

  if (existsSync(workflowsDir)) {
    for (const bundle of loadWorkflows(workflowsDir)) {
      if (workflows.has(bundle.value.id)) {
        throw new Error(`Воркфлоу ${bundle.value.id} объявлен дважды: ${bundle.path}`);
      }
      configHashes.set(bundle.path, bundle.contentHash);
      workflows.set(bundle.value.id, bundle.value);
    }
  }

  const routingPath = join(configRoot, "routing.json");
  let routing: RoutingConfig | undefined;

  if (existsSync(routingPath)) {
    const bundle = loadRouting(routingPath);
    configHashes.set(bundle.path, bundle.contentHash);
    routing = bundle.value;
  }

  const acceptanceDir = join(configRoot, "acceptance");
  const checklists: ChecklistConfig[] = [];

  if (existsSync(acceptanceDir)) {
    for (const bundle of loadChecklists(acceptanceDir)) {
      configHashes.set(bundle.path, bundle.contentHash);
      checklists.push(bundle.value);
    }
  }

  // Реестр агентов — ПОСЛЕ чек-листов: он сверяется с ними и падает, если
  // манифест ссылается на приёмку, которой нет. Рассинхрон уже был
  // (estimate-review-v1 против людмила.json) и не проявлялся никак.
  const agentsDir = join(configRoot, "agents");
  const { roster, bundles: agentBundles } = loadAgentRoster(
    agentsDir,
    checklists.map((checklist) => checklist.agent),
  );

  // Хэши ВСЕХ девяти манифестов — в отпечаток. До этого в него входил промпт
  // одного сметчика, то есть правка промпта Денчика отпечатка не меняла, и
  // «повтор даст тот же ответ» было утверждением без доказательства.
  for (const bundle of agentBundles) configHashes.set(bundle.path, bundle.contentHash);

  const operations = new OperationRunner(capabilities);

  operations.register(
    createParseEstimateOperation({
      // ЧИТАТЕЛЬ ВЫБИРАЕТСЯ ПО СОДЕРЖИМОМУ (Д1б). Здесь стояло
      // `readXlsxSheet(path)` — то есть формат определялся не файлом, а тем,
      // какую функцию однажды вписали в корень, и смета в старом двоичном
      // формате падала внутри распаковщика ZIP.
      loadDocument: async (path) => ({
        // ВСЕ листы книги: какой из них смета, знает разбор, а не читатель.
        sheets: await readSheetsOf(path),
        // У PDF ячеек нет — есть раскладка колонок, и верить ей без проверки
        // арифметикой нельзя: текст бывает распознан со скана.
        ячейки: (await detectFileFormat(path)).format === "pdf" ? ("раскладка" as const) : ("ячейки" as const),
        contentHash: await fileContentHash(path),
      }),
      // Композиционный корень — единственное место, где разбор и канонизация
      // узнают друг о друге (ADR-R-025).
      mapPosition: (position, source) => mapPosition(position, catalogue, source),
      summarize,
      today: () => isoDate(new Date().toISOString().slice(0, 10)),
    }),
  );

  operations.register(createCheckConvergenceOperation());

  // Агент подключается только при настроенном endpoint. Без него операция не
  // регистрируется вовсе — это честнее, чем зарегистрировать и падать при вызове.
  const baseUrl = (options.env ?? process.env)["STROYINTELLECT_MODEL_BASE_URL"];
  const modelId = (options.env ?? process.env)["STROYINTELLECT_MODEL_ID"];

  if (baseUrl !== undefined && baseUrl !== "" && modelId !== undefined && modelId !== "") {
    /**
     * ЛИСТЫ ЧЕРТЕЖЕЙ УХОДЯТ ТОЛЬКО НА МОДЕЛЬ ВНУТРИ КОНТУРА.
     *
     * Правило живёт отдельным модулем (`vision-policy`) и там же проверяется:
     * условие, спрятанное внутри семисотстрочной сборки, проверяется только
     * через полный запуск, то есть на практике не проверяется.
     */
    const vision = visionPolicy(baseUrl, options.env ?? process.env);
    const visionAllowed = vision.allowed;

    /**
     * Профиль потолка выбирается ПОД ЗРЕНИЕ, а не правится на месте.
     *
     * `target-local.json` описывает qwen-30b без зрения, и это верное описание
     * целевой модели контура: править в нём `vision: true` значило бы соврать
     * о том, что будет у заказчика. Профиль со зрением — отдельный файл, и
     * выбор между ними виден в конфигурации (ТЗ §6.3).
     */
    const profileName = visionAllowed ? "model-profiles/target-vision.json" : "model-profiles/target-local.json";
    const profileBundle = loadBundle(join(configRoot, profileName), modelProfileSchema);
    configHashes.set(profileBundle.path, profileBundle.contentHash);

    // Проверка адреса ДО первого вызова, а не при нём. Ошибка конфигурации,
    // обнаруженная на первой проверке объекта, — это отказ в работе посреди
    // работы; обнаруженная на старте, это отказ запуститься с объяснением.
    // ADR-R-014, R-017: любая ошибка конфигурации останавливает сборку.
    //
    // Маршрут выбирается ПО АДРЕСУ, а не берётся первым: маршрутов два —
    // внешняя модель первого этапа и модель внутри контура, — и подставить
    // внешний маршрут локальному адресу значило бы потребовать от него https и
    // обезличивания, которые к обращению внутри контура не относятся.
    const probeUrl = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const probes = modelRoutes.map((route) => ({
      route,
      // Пробник спрашивает ТОЛЬКО про адрес: допустимо ли вообще ходить в это
      // назначение. Про классы данных и обезличивание спрашивают при вызове —
      // там они известны, а здесь их пришлось бы выдумать, и выдуманный ответ
      // «да, обезличено» стал бы разрешением на будущее.
      decision: egressGateway.authorize({
        extensionId: route.id,
        url: probeUrl,
        dataClasses: [],
      }),
    }));

    const chosen = probes.find((probe) => probe.decision.allowed);

    if (chosen === undefined) {
      throw new Error(
        `STROYINTELLECT_MODEL_BASE_URL=${baseUrl} не разрешён ни одним маршрутом egress-шлюза:\n` +
          probes
            .map(
              ({ route, decision }) =>
                `  · ${route.id}: ${decision.allowed ? "" : decision.reason}`,
            )
            .join("\n") +
          "\nОбъявите назначение в config/extensions/model-routes.json — смена провайдера " +
          "должна быть видна в конфигурации, а не только в переменной среды.",
      );
    }

    const modelRoute = chosen.route;

    // Глубина рассуждения — на старте, а не при первом вызове. Опечатка в
    // переменной среды, обнаруженная на девятом агенте курганского объекта, —
    // это отказ посреди работы, за которую уже заплачено восемью обращениями.
    const effort = (options.env ?? process.env)["STROYINTELLECT_MODEL_REASONING_EFFORT"];

    if (effort !== undefined && effort !== "" && !isReasoningEffort(effort)) {
      throw new Error(
        `STROYINTELLECT_MODEL_REASONING_EFFORT=${effort} не распознан. ` +
          `Допустимо: ${REASONING_EFFORTS.join(", ")}.`,
      );
    }

    const runtime = withProfileCeiling(
      createOpenAiCompatibleRuntime({
        baseUrl,
        model: modelId,
        apiKey: (options.env ?? process.env)["STROYINTELLECT_MODEL_API_KEY"],
        ...(effort === undefined || effort === "" ? {} : { reasoningEffort: effort }),
        egress: {
          gateway: egressGateway,
          extensionId: modelRoute.id,
          dataClasses: modelRoute.dataClasses,
          record: (record) => egressLog.push(record),
        },
      }),
      profileBundle.value as ModelProfile,
    );

    agentRuntime = runtime;

    // Тот же журнал, что у конвейера, и те же поля: два журнала одного и того
    // же разошлись бы, а §12.1л держится на полноте.
    recordModelCall = (call) => {
      modelCallLog.push({
        at: new Date().toISOString(),
        process: call.operationId,
        operationId: call.operationId,
        contour: declaredContour(call.contour, options.env ?? process.env),
        provider: call.provider,
        model: call.model,
        dataClasses: modelRoute.dataClasses,
        anonymized: call.anonymized,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
      });
    };

    /**
     * Промпт агента = доктрина + эталонные примеры + накопитель дельт.
     *
     * ПОЧЕМУ ТРИ ЧАСТИ, А НЕ ОДИН ФАЙЛ
     *
     * У них разная скорость изменения. Доктрина («кто ты», рабочие стандарты)
     * меняется редко и обдуманно. Эталонные примеры «вход → выход» учат ФОРМЕ
     * ответа. Дельты — приёмы, снятые с боевых объектов; в легаси их 41, и
     * растут они после каждой ретроспективы.
     *
     * При переносе агентов обе последние части были опущены — а это больше
     * четверти промпта сметчика (2,5 КБ примеров и 8,6 КБ дельт из 39,7 КБ).
     * Опущены они были не по решению, а потому что переносилась доктрина.
     *
     * Отдельный файл `deltas.md` даёт накопителю опыта дом: ретроспектива
     * дописывает его, не трогая доктрину.
     */
    const promptOf = (agent: string): string => {
      const doctrine = readFileSync(join(configRoot, `agents/${agent}/prompt.md`), "utf8");
      const deltasPath = join(configRoot, `agents/${agent}/deltas.md`);

      if (!existsSync(deltasPath)) return doctrine;

      const deltas = readFileSync(deltasPath, "utf8");

      // Хэш дельт — в отпечаток входов: приём, дописанный после ретроспективы,
      // меняет ответы агента, и Проверка обязана это отражать.
      configHashes.set(deltasPath, createHash("sha256").update(deltas, "utf8").digest("hex"));

      return `${doctrine}\n\n${deltas}`;
    };

    const promptPath = join(configRoot, "agents/estimate-review/prompt.md");
    const prompt = promptOf("estimate-review");

    // ОПОРНАЯ БАЗА АГЕНТА — знание, на которое он опирается.
    //
    // Читается ЛЕНИВО и один раз: книга ГИПа — 183 норматива, и платить за
    // её разбор на каждом вызове незачем. Хэш книги идёт в отпечаток входов —
    // заказчик поправил свою базу, отпечаток Проверки изменился.
    //
    // Книги нет — это не отказ сборки: документы заказчика монтируются и в
    // поставку не входят (ТЗ §11). Агент уходит в режим [БЕЗ БАЗЫ], и об этом
    // сказано ему самому.
    const referenceCache = new Map<string, Promise<string | undefined>>();

    /**
     * КАРКАС РОЛИ — листы, которые агент даёт при любом объекте.
     *
     * Берётся из манифеста, а не из кода: тот же список читает сборщик книги,
     * чтобы назвать не данный лист ПРОБЕЛОМ, а не отсутствием предмета. Два
     * списка — в промпте и в книге — разошлись бы молча, и книга обвиняла бы
     * агента в пропуске листа, которого у него никто не просил.
     *
     * Предметные листы сюда НЕ ПОПАДАЮТ: их состав зависит от объекта, и
     * заданный конфигурацией список заставил бы агента выдумывать таблицу там,
     * где на объекте нет предмета.
     */
    const requiredSectionsFor = (capability: string) =>
      roster.find(capability)?.requiredSections ?? [];

    const referenceBaseFor = (capability: string): (() => Promise<string | undefined>) => {
      const identity = roster.find(capability);
      const path = identity?.referenceBase;

      if (path === undefined) return async () => undefined;

      return async () => {
        const cached = referenceCache.get(path);
        if (cached !== undefined) return cached;

        const pending = loadReferenceBase(path).then((base) => {
          if (base === undefined) return undefined;
          configHashes.set(path, base.contentHash);
          return renderReferenceBase(base);
        });

        referenceCache.set(path, pending);
        return pending;
      };
    };

    // Общий вызов модели для ЛЮБОГО из девяти агентов. Обезличивание, сверка
    // расписки и развёртка псевдонимов одинаковы у всех; второй агент не должен
    // приносить с собой вторую копию этого кода — иначе к девятому их будет
    // девять, и разойдутся они молча.
    const runAgent = async (request: AgentRunRequest): Promise<AgentTurn> => {
      const started = Date.now();


      // Обезличивание решается ЗДЕСЬ, а не в операции: только композиционный
      // корень знает, куда пойдёт запрос.
      //
      // Делается оно ВСЕГДА — и для внешней модели, и для модели внутри
      // контура. Соблазн пропустить его на внутреннем маршруте есть: шлюз
      // расписки оттуда не требует, а лишняя замена ничего не защищает.
      // Но тогда локальный прогон и внешний уходили бы РАЗНЫМ текстом, и
      // проверка, отлаженная на локальной модели, ничего не говорила бы о
      // том, что получит внешняя. Цена измерена: на корпусе заказчика
      // обезличивание меняет 3 строки из 1453.
      const anonymized = anonymize({
        text: request.prompt,
        knownEntities: request.anonymize.knownEntities,
        salt: request.anonymize.salt,
      });

      // Расписка с остатком — отказ, а не предупреждение. Анонимизатор нашёл
      // в собственном выводе то, что должен был убрать, и отправлять это
      // наружу нельзя ни при каких режимах работы (ТЗ §12.1л).
      if (!anonymized.receipt.clean) {
        throw new Error(
          "Обезличивание не завершилось: в тексте остались " +
            `[${[...new Set(anonymized.receipt.leftovers)].join(", ")}]. ` +
            "Обращение к модели отменено (ТЗ §12.1л).",
        );
      }

      /**
       * ЛИСТЫ УХОДЯТ ТОЛЬКО НА МОДЕЛЬ ВНУТРИ КОНТУРА.
       *
       * Обезличивание защищает ТЕКСТ: имена, адреса, шифры заменяются, и
       * расписка сверяет, что в выводе не осталось исходного. С изображением
       * этого сделать нельзя — фамилии проектировщиков стоят в штампе чертежа
       * растром, и «обезличенный запрос с необезличенной картинкой» это
       * обезличивание наполовину, то есть его отсутствие с видом наличия.
       *
       * Поэтому правило простое и проверяемое: адрес модели локальный — листы
       * идут; любой другой — не идут, и агент получает промпт без них. Молча:
       * отсутствие листов у агента законно, он и раньше работал без них.
       *
       * Явное согласие владельца (`STROYINTELLECT_VISION_EXTERNAL=да`)
       * правило снимает — но по умолчанию оно закрыто.
       */
      const листы = visionAllowed ? (request.images ?? []) : [];

      const result = await runtime.run({
        systemPrompt: request.systemPrompt,
        prompt: anonymized.text,
        anonymization: anonymized.receipt,
        outputSchema: request.outputSchema,
        ...(листы.length === 0 ? {} : { images: листы, needsVision: true }),
        // Оценка входа по символам: точный токенайзер целевой модели
        // неизвестен, поэтому берём консервативно 3 символа на токен.
        estimatedInputTokens: Math.ceil((request.systemPrompt.length + request.prompt.length) / 3),
      });

      // Запись журнала — ПОСЛЕ успешного обращения: «обратились» и «пытались
      // обратиться» это разные факты, и второй уже записан отказом шлюза.
      //
      // Контур берётся из результата ЭТОГО вызова, а не из хвоста общего
      // журнала. Хвост был верен, пока агенты шли по очереди; при параллельном
      // запуске (а он нужен: шестнадцать последовательных обращений — это
      // одиннадцать минут) два агента дописывают журнал вперемежку, и запись
      // получила бы чужой контур. Ошибка была бы невидимой: контур
      // правдоподобен в обоих случаях.

      modelCallLog.push({
        at: new Date().toISOString(),
        process: request.operationId,
        operationId: request.operationId,
        /**
         * Контур — ПО ОБЪЯВЛЕНИЮ ВЛАДЕЛЬЦА, а не по совпадению адреса с петлёй.
         *
         * Маршрут выбирается сопоставлением адреса с назначениями, и локальный
         * адрес попадает во «внутренний» маршрут. Но за `127.0.0.1` бывает шлюз
         * к внешним моделям — на нашем же контуре так и есть, — и журнал §12.1л
         * записывал «internal» о том, что ушло наружу. Поле `contour` и есть
         * то, ради чего этот журнал существует.
         */
        contour: declaredContour(result.contour, options.env ?? process.env),
        provider: result.provider,
        model: result.model,
        dataClasses: modelRoute.dataClasses,
        anonymized: anonymized.receipt.clean,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      return {
        // Псевдонимы разворачиваются обратно: замечание «Организация-4721
        // завысила объём» человеку заказчика бесполезно. Карта замен из
        // контура не выходила.
        output: restoreDeep(result.output, anonymized.map),
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - started,
      };
    };

    operations.register(
      createEstimateReviewOperation({
        prompt,
        accuracyMarker,
        runAgent,
        referenceBase: referenceBaseFor("estimate_review"),
        requiredSections: requiredSectionsFor("estimate_review"),
      }),
    );

    // Ваныч (эконом): первый ОБЪЕКТНЫЙ агент — его предмет стройка целиком,
    // а не отдельная смета.
    operations.register(
      createFinanceModelOperation({
        prompt: promptOf("finance-model"),
        referenceBase: referenceBaseFor("finance_model"),
        requiredSections: requiredSectionsFor("finance_model"),
        accuracyMarker,
        runAgent,
      }),
    );

    // Марина (снабжение): второй объектный агент — закупка ведётся по стройке.
    operations.register(
      createProcurementOperation({
        prompt: promptOf("procurement"),
        referenceBase: referenceBaseFor("procurement_map"),
        requiredSections: requiredSectionsFor("procurement_map"),
        accuracyMarker,
        runAgent,
      }),
    );

    // Палыч (ПТО): третий объектный агент — реестр документации ведётся по
    // стройке, а не по отдельной смете.
    operations.register(
      createExecutiveDocsOperation({
        prompt: promptOf("executive-docs"),
        referenceBase: referenceBaseFor("executive_docs"),
        requiredSections: requiredSectionsFor("executive_docs"),
        accuracyMarker,
        runAgent,
      }),
    );

    // Настенька (администратор): паспорт объекта, такт 0.
    operations.register(
      createObjectPassportOperation({
        prompt: promptOf("object-passport"),
        referenceBase: referenceBaseFor("object_passport"),
        requiredSections: requiredSectionsFor("object_passport"),
        accuracyMarker,
        runAgent,
      }),
    );

    // Виктор (договорник): пятый объектный. Договор заключается на объект, и
    // разграничение объёма — тоже объектная работа.
    operations.register(
      createContractAuditOperation({
        prompt: promptOf("contract-audit"),
        referenceBase: referenceBaseFor("contract_audit"),
        requiredSections: requiredSectionsFor("contract_audit"),
        accuracyMarker,
        runAgent,
      }),
    );

    // Халиль (подряд): шестой объектный. Ведомость распределения ведётся по
    // стройке — по одной смете что отдавать на сторону не решают.
    operations.register(
      createSubcontractPlanOperation({
        prompt: promptOf("subcontract-plan"),
        referenceBase: referenceBaseFor("subcontract_plan"),
        requiredSections: requiredSectionsFor("subcontract_plan"),
        accuracyMarker,
        runAgent,
      }),
    );

    // Артемий (руководитель): агент СИНТЕЗА — читает замечания остальных и
    // сводит их в вердикт.
    operations.register(
      createVerdictOperation({
        prompt: promptOf("verdict"),
        referenceBase: referenceBaseFor("object_verdict"),
        requiredSections: requiredSectionsFor("object_verdict"),
        accuracyMarker,
        runAgent,
      }),
    );

    /**
     * Тимофей (планировщик): второй агент синтеза, десятый документ пакета.
     *
     * Читает то же, что Артемий, и отвечает на другой вопрос: не «брать ли
     * объект», а «за сколько он делается и что этот срок сдвинет». Опорной базы
     * у него нет — длительности он берёт по типовым нормам и обязан объявить
     * это допущением.
     */
    operations.register(
      createScheduleOperation({
        prompt: promptOf("schedule"),
        requiredSections: requiredSectionsFor("work_schedule"),
        accuracyMarker,
        runAgent,
      }),
    );

    // Денчик (ГИП): второй модельный агент. Смотрит ту же смету с другой
    // стороны — объём и полнота состава против цены и сходимости.
    operations.register(
      createTechOpinionOperation({
        prompt: promptOf("tech-opinion"),
        referenceBase: referenceBaseFor("tech_opinion"),
        requiredSections: requiredSectionsFor("tech_opinion"),
        // Точность техзаключения зависит от наличия РД, а не от наличия сметы:
        // без чертежей геометрию проверить нечем.
        accuracyMarker: (context) => accuracyMarker({ hasEstimate: context.hasDesignDocuments }),
        runAgent,
      }),
    );
  }

  return {
    profile,
    scope,
    workflows,
    routing,
    checklists,
    roster,
    ...(agentRuntime === undefined ? {} : { agentRuntime }),
    ...(codex === undefined ? {} : { codex }),
    ...(recordModelCall === undefined ? {} : { recordModelCall }),
    catalogue,
    parameters,
    extensions,
    capabilities,
    operations,
    configHashes,
    // Адаптеры собираются здесь, потому что каждому нужна своя библиотека, а
    // доменный модуль о библиотеках не знает (ADR-R-025).
    parsers: new ParserRegistry([
      pdfAdapter,
      docxAdapter,
      plainTextAdapter,
      xmlAdapter,
      grandSmetaXmlAdapter,
      // Любой вход (А11): форматы, в которых заказчик присылает документы.
      rtfAdapter,
      docAdapter,
      pptxAdapter,
      odfAdapter,
    ]),
    egressGateway,
    drainEgressLog: () => egressLog.splice(0, egressLog.length),
    drainModelCalls: () => modelCallLog.splice(0, modelCallLog.length),
  };
}
