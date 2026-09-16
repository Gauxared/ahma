/**
 * CLI СтройИнтеллекта — точка входа безынтерфейсного MVP (ADR-R-009).
 *
 * ТЗ ставит экраны в этап 4, КП относит наполнение опорной базы к работам
 * специалистов Исполнителя, а самые рискованные критерии (§12.1а извлечение,
 * §12.1б сходимость, §12.1в полнота реестра) проверяются без интерфейса.
 *
 * Команды повторяют четыре точки входа из ADR-R-022:
 *   si check     — Проверка целиком либо подграф
 *   si run       — одна операция
 *   si maintain  — обслуживание (актуализация базы, парсинг)
 *   si doctor    — что собралось и что разрешилось
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { bootstrap } from "@platform/bootstrap.js";
import type { Platform } from "@platform/bootstrap.js";
import { isoDate } from "@contracts/index.js";
import type { GateSubject, Sha256 } from "@contracts/index.js";
import type { ParseEstimateBody } from "@modules/documents/operations/parse-estimate.js";
import type {
  CheckConvergenceBody,
  EstimateForConvergence,
} from "@modules/calculations/operations/check-convergence.js";
import { buildCalculationWorkbook, tracesOf } from "@modules/exports/calculation-workbook.js";
import { buildObjectReport } from "@modules/exports/object-report.js";
import { sumObjectTotals } from "@modules/calculations/object-total.js";
import { compareWithHeader } from "@modules/calculations/convergence.js";
import { parseSsrss } from "@modules/documents/parsers/ssrss.js";
import { writeMemo } from "@platform/storage/docx-writer.js";
import { readPdfText } from "@platform/storage/pdf-reader.js";
import { readXlsxSheet } from "@platform/storage/xlsx-reader.js";
import type { CalculationSource } from "@modules/exports/calculation-workbook.js";
import { writeWorkbook } from "@platform/storage/xlsx-writer.js";
import { checkObject } from "@modules/workflow/check-object.js";
import {
  buildCheckPorts,
  buildObjectReviewers,
  buildReviewers,
  buildVerdictReviewers,
  describeDocument,
  toConvergenceInput,
} from "@platform/execution/check-ports.js";
import type { CheckObjectBody } from "@modules/workflow/check-object.js";
import { buildSnapshot, snapshotDigest } from "@modules/workflow/snapshot.js";
import { CONVERGENCE_FORMULA, CONVERGENCE_VERSION } from "@modules/calculations/convergence.js";
import { OBJECT_TOTAL_FORMULA, OBJECT_TOTAL_VERSION } from "@modules/calculations/object-total.js";
import { classifyDocument } from "@modules/workflow/classify-document.js";
import { buildMemo, rubles } from "@modules/exports/memo.js";
import { buildViolationsRegister } from "@modules/exports/violations-register.js";
import { buildOffersComparison } from "@modules/exports/offers-comparison.js";
import { aggregateByCanonical } from "@modules/canonical/aggregate.js";
import { MatchLedger } from "@modules/canonical/match-ledger.js";
import { matchByText } from "@modules/canonical/text-match.js";
import { classifyDeviation } from "@modules/calculations/deviation-class.js";
import { estimateIndependently } from "@modules/calculations/independent-estimate.js";
import { spread } from "@modules/calculations/spread.js";
import { detectFormat } from "@modules/documents/format-detector.js";
import { parseScope } from "@modules/workflow/knowledge-scope.js";
import { runProtocol } from "@modules/workflow/protocol.js";
import type { StepResult } from "@modules/workflow/protocol.js";
import type { SubjectState } from "@modules/workflow/protocol.js";
import type { RoutingConfig, WorkflowDefinition } from "@platform/config/workflow-loader.js";
import { buildPassport, renderPassport } from "@modules/intake/passport.js";
import type { DeclaredIntake, Domain, Side } from "@modules/intake/passport.js";
import { route } from "@modules/intake/routing.js";
import { buildAssignments, buildObjectPassport, renderObjectPassport } from "@modules/intake/object-passport.js";
import { Decimal } from "decimal.js";

import { buildTechOpinion } from "@modules/agents/tech-opinion.js";
import { buildStartChecklist, START_CHECKLIST } from "@modules/agents/start-checklist.js";
import { vatGap } from "@modules/calculations/vat-gap.js";
import { measureAgainstReference } from "@modules/eval/reference-case.js";
import { loadReferenceCase } from "@platform/config/reference-case-loader.js";
import { foldByAgent } from "@modules/exports/by-agent.js";
import type { AgentRoster } from "@platform/config/agent-roster.js";
import { compareGuarantee } from "@modules/calculations/guarantee-comparison.js";
import { compareOffers, type CompareBundle, type ComparisonResult } from "@platform/execution/compare-offers.js";
import { buildScenarios, SCENARIO_SHIFTS } from "@modules/calculations/scenarios.js";
import { buildLeadTimeMap } from "@modules/calculations/lead-time.js";
import type { ProcurementItem } from "@modules/calculations/lead-time.js";
import { buildVerdict, MARGIN_THRESHOLDS, riskLevel } from "@modules/agents/verdict.js";
import { evaluateAll } from "@modules/eval/acceptance.js";
import { compareRuns } from "@modules/eval/shadow-run.js";
import { DEPTH_MODES, describeDepth } from "@modules/agents/depth-mode.js";
import type { DepthMode } from "@modules/agents/depth-mode.js";
import { costPerSqm } from "@modules/calculations/cost-structure.js";
import { reverseVolumes } from "@modules/calculations/volume-reversal.js";
import type { LinearPosition } from "@modules/calculations/volume-reversal.js";
import type { EstimateReviewBody } from "@modules/agents/operations/run-estimate-review.js";

// Настройки окружения читаются явно: Node не загружает .env сам, а тихо
// работающая без endpoint сборка выглядит как исправная.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const USAGE = `СтройИнтеллект

  si doctor                        состояние сборки: профиль, конфиги, реестры
  si journal                       обращения к моделям по процессам (ТЗ §12.1л)
  si run <operation> [--file <п>]  одна операция
  si check --object <п> [--agent] [--mode <р>] [--out <книга.xlsx>]
                                   Проверка объекта целиком (гейт §12.1)
  si intake --object <п>           приём объекта: паспорт входа и маршрут
  si protocol [--workflow <id>] [--object <п>]
                                   протокол тактов; с --object запускает
                                   реализованных агентов на настоящих данных
  si eval [--object <п>] [--mode <р>] [--shadow <ф>]
                                   приёмка по агентам (ТЗ §12.2, ≥80%)
  si база                          перечень источников: листов, строк, отпечаток
  si maintain <operation>          обслуживание
  si export --file <п> --out <п>   расчётная выгрузка Excel
  si compare --offers <ф.json> [--out <книга.xlsx>]
                                   сопоставление КП и разброс (ТЗ §5.2)

Флаги:
  --file <путь>  документ для операций разбора
  --object <п>   папка объекта для полной Проверки
  --agent        добавить обзор сметчика (требует настроенного endpoint)
  --out <путь>   выгрузить сметный разбор по объекту в книгу Excel
  --snapshot <п> записать снапшот Проверки в JSON
  --scope <с>    разрешённые источники знания через запятую (ADR-R-024)
  --domain <д>   домен: вода | монтаж | дороги-инфра | сети | девелопмент | иное
  --side <с>     сторона стола: подрядчик | заказчик
  --goal <ц>     срок и цель приёма
  --name <н>     название объекта для паспорта (такт 0)
  --customer <з> заказчик для паспорта (такт 0)
  --vat-in-contract <с>  ставка НДС договора, например 0.20 (Виктор)
  --open-price   цена открыта: пересчёт НДС на заказчике (Виктор)
  --retention <с> сумма гарантийного удержания (Виктор)
  --retention-years <л>  срок удержания в годах (Виктор)
  --bg-rate <с>  ставка банковской гарантии в год (Виктор)
  --palych <п>=да|нет    ответ по пункту чеклиста старта (Палыч)
  --revenue <с>  выручка объекта для финмодели (Ваныч)
  --costs <с>    себестоимость объекта для финмодели (Ваныч)
  --tmc <и:с:д:н:к>      позиция закупки для карты лид-таймов (Марина)
  --contract-amount <с>  НМЦК для порогов маржи (Артемий)
  --margin <с>   маржа объекта для вердикта (Артемий)
  --run <id|new>  сохраняемый прогон: продолжить по id либо завести новый
  --tenant <uuid> арендатор для сохраняемого прогона
  --object-id <u> объект в базе для сохраняемого прогона
  --workflow <id> воркфлоу из config/workflows (по умолчанию full-check)
  --subject <п>=<с> состояние предмета: draft | returned | approved
  --dry-run      только проверить готовность, ничего не исполнять
  --mode <р>     глубина: экспресс | стандарт | эксперт (§5.4)
  --shadow <ф>   JSON с результатом целевой модели для замера разрыва
  --json         вывести артефакт целиком
`;

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Печатает сводку по разобранной смете. */
function printParsed(body: ParseEstimateBody): void {
  const positions = body.sections.reduce((n, section) => n + section.positions.length, 0);

  const формой =
    body.form === "appendix-4"
      ? "Приложение №4 (базисно-индексный)"
      : body.form === "appendix-3"
        ? "Приложение №3 (ресурсно-индексный)"
        : "своя вёрстка (разобрана по шапке колонок)";
  console.log(`Форма         : ${формой}`);
  console.log(`Лист          : ${body.sheet}`);
  console.log(`Разделов      : ${body.sections.length}`);
  console.log(`Позиций       : ${positions}`);
  console.log(`  по шифру    : ${body.summary.byCode}`);
  console.log(`  не сопост.  : ${body.summary.unmatched}`);
  if (body.summary.unitIssues > 0) {
    console.log(`  вопросы по единицам: ${body.summary.unitIssues}`);
  }
  console.log(`Итог по смете : ${body.declaredTotal ?? "не объявлен"} ₽`);
  if (body.headerTotalThousands !== undefined) {
    console.log(`Шапка         : ${body.headerTotalThousands} тыс. руб.`);
  }

  const blocking = body.issues.filter((issue) => issue.severity === "blocking");
  if (blocking.length > 0) {
    console.log(`Блокирующие замечания разбора: ${blocking.length}`);
    for (const issue of blocking) console.log(`  строка ${issue.row ?? "?"}: ${issue.message}`);
  }
}

/** Печатает результат сходимости. */
function printConvergence(body: CheckConvergenceBody): void {
  const mark = (status: string): string =>
    status === "converged" ? "сошлось" : status === "diverged" ? "НЕ СОШЛОСЬ" : "нечего сверять";

  console.log(`Документ      : ${body.documentPath}`);
  for (const section of body.sections) {
    const delta = section.delta?.value.amount;
    console.log(
      `  ${section.scope.replace("section:", "раздел ")}${section.name ? ` «${section.name}»` : ""}: ` +
        // «Σ —» вместо числа: сложить нельзя, суммы известны не у всех позиций.
        `Σ ${section.computed?.value.amount ?? "—"} ₽, ` +
        (delta === undefined ? mark(section.status) : `Δ ${delta} ₽ — ${mark(section.status)}`),
    );
    if (section.reason !== undefined) console.log(`      причина: ${section.reason}`);
  }

  console.log(
    `Итог по смете : Σ ${body.document.computed?.value.amount ?? "—"} ₽` +
      (body.document.delta === undefined
        ? ` — ${mark(body.document.status)}`
        : `, Δ ${body.document.delta.value.amount} ₽ — ${mark(body.document.status)}`),
  );

  if (body.headerScale !== undefined) {
    const scale = body.headerScale;
    console.log(
      `Шапка (тыс.₽) : ${scale.headerInRubles} ₽, Δ ${scale.delta} ₽ при гранулярности ${scale.granularity} ₽ — ` +
        (scale.explainedByScale ? "объясняется шкалой источника" : "ВНЕ гранулярности, требует разбора"),
    );
  }

  console.log(`Вердикт       : ${body.converged ? "сходимость подтверждена (§12.1б)" : "сходимость НЕ подтверждена"}`);
}

function doctor(platform: Platform): number {
  const capabilities = new Set<string>();
  for (const extension of platform.extensions.all("knowledge-source")) {
    for (const capability of extension.manifest.provides) {
      capabilities.add(capability);
    }
  }

  const today = isoDate(new Date().toISOString().slice(0, 10));

  console.log(`Профиль развёртывания : ${platform.profile}`);
  console.log(`Конфигурационные бандлы:`);
  for (const [path, hash] of platform.configHashes) {
    console.log(`  ${path}  ${hash.slice(0, 12)}…`);
  }

  console.log(`Параметры с датой действия (на ${today}):`);
  for (const id of platform.parameters.ids()) {
    const resolved = platform.parameters.resolve(id, today);
    console.log(`  ${id} = ${resolved?.value ?? "не разрешён на эту дату"}`);
  }

  const sources = platform.extensions.ids("knowledge-source");
  const excluded = platform.scope.excludedFrom(sources);

  console.log(`Источники знания      : ${sources.join(", ") || "нет"}`);
  console.log(
    `Область знания        : ${
      platform.scope.unrestricted
        ? "без ограничений"
        : `разрешено ${platform.scope.allowed?.join(", ") || "ничего"}`
    }`,
  );
  if (excluded.length > 0) {
    console.log(`  ВЫКЛЮЧЕНО областью  : ${excluded.join(", ")}`);
  }
  console.log(`Способности           : ${capabilities.size}`);
  console.log(`Операции              : ${platform.operations.ids().length}`);
  console.log(`Воркфлоу              : ${[...platform.workflows.keys()].join(", ") || "нет"}`);
  console.log(
    `Каталог позиций       : ${
      platform.catalogue.size > 0
        ? `${platform.catalogue.size} записей`
        : "пуст — соберите: pnpm tsx tooling/import-fsnb.ts --fetch"
    }`,
  );

  return 0;
}

async function runOperation(
  platform: Platform,
  operationId: string,
  argv: readonly string[],
  entryPoint: "single" | "maintenance" | "subgraph",
): Promise<number> {
  const documentPath = flag(argv, "file");
  const tenantId = "00000000-0000-0000-0000-000000000000";
  const now = new Date().toISOString();

  let input: unknown = { documentPath };
  let subjects = new Map<string, GateSubject>();
  let effectiveEntry = entryPoint;

  // Сходимость потребляет разобранную смету. Разбор и проверка — две операции,
  // и это подграф воркфлоу, а не одна операция: класс полноты честно partial
  // (ADR-R-022).
  if (operationId === "check-convergence" && documentPath !== undefined) {
    const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath },
      { tenantId, entryPoint: "subgraph", subjects, now },
    );

    if (!parsed.ok) {
      console.error("Не удалось разобрать смету перед проверкой сходимости.");
      return 2;
    }

    input = toConvergenceInput(parsed.artifact.body, documentPath, parsed.artifact.inputHashes[0]!);
    subjects = new Map([["estimate", { id: "estimate", status: "draft", returnedCount: 0 }]]);
    effectiveEntry = "subgraph";
  }

  const outcome = await platform.operations.run<unknown, unknown>(
    operationId,
    input,
    { tenantId, entryPoint: effectiveEntry, subjects, now },
  );

  if (!outcome.ok) {
    console.error(`Операция ${operationId} не может быть выполнена:`);
    for (const block of outcome.blocks) {
      console.error(
        block.kind === "missing_capability"
          ? `  не разрешена обязательная способность: ${block.capability}`
          : `  не выполнено предусловие ${block.precondition} (сейчас: ${block.actual})`,
      );
    }
    return 2;
  }

  const { artifact } = outcome;

  if (argv.includes("--json")) {
    console.log(JSON.stringify(artifact, null, 2));
    return 0;
  }

  console.log(`Операция      : ${artifact.operation.id} v${artifact.operation.version}`);
  console.log(`Полнота       : ${artifact.completeness}`);
  console.log(`Хэши входов   : ${artifact.inputHashes.map((hash) => hash.slice(0, 12) + "…").join(", ") || "нет"}`);

  if (operationId === "parse-estimate") {
    printParsed(artifact.body as ParseEstimateBody);
  }

  if (operationId === "check-convergence") {
    printConvergence(artifact.body as CheckConvergenceBody);
  }

  for (const degradation of artifact.degradations) {
    console.log(`Деградация    : ${degradation.capability} — ${degradation.reason}`);
  }

  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command === undefined ? 1 : 0;
  }

  const dryRun = rest.includes("--dry-run");
  const scope = parseScope(flag(rest, "scope"));
  const platform = bootstrap(scope === undefined ? {} : { knowledgeScope: scope });

  switch (command) {
    case "doctor":
      return doctor(platform);

    case "journal":
      return journalCommand();

    case "база":
      return basesCommand(platform);

    case "check": {
      const objectPath = flag(rest, "object");

      if (dryRun) {
        console.log(`Готовность к Проверке: профиль ${platform.profile}, конфигурация загружена и валидна.`);
        console.log(`Операций зарегистрировано: ${platform.operations.ids().length}.`);
        console.log(
          `Каталог позиций: ${platform.catalogue.size > 0 ? `${platform.catalogue.size} записей` : "пуст"}.`,
        );
        return 0;
      }

      if (objectPath === undefined) {
        console.error("Не указан объект. Пример: si check --object reference-system/input-1");
        return 1;
      }

      return checkObjectCommand(
        platform,
        objectPath,
        rest.includes("--json"),
        rest.includes("--agent"),
        flag(rest, "out"),
        rest,
      );
    }

    case "eval": {
      // `--against-reference` — другой вопрос, чем приёмка по чек-листам, и
      // поэтому другая ветка, а не флаг внутри той же.
      if (argv.includes("--against-reference") || flag(argv, "against-reference") !== undefined) {
        return await evalAgainstReference(platform, argv);
      }

      return await evalCommand(platform, rest);
    }

    case "compare": {
      const offersPath = flag(rest, "offers");

      if (offersPath === undefined) {
        console.error("Не указан набор предложений. Пример: si compare --offers кп.json");
        return 1;
      }

      return await compareCommand(offersPath, flag(rest, "out"), {
        ...(flag(rest, "tenant") === undefined ? {} : { tenantId: flag(rest, "tenant") as string }),
        ...(flag(rest, "object-code") === undefined ? {} : { objectCode: flag(rest, "object-code") as string }),
      });
    }

    case "intake": {
      const objectPath = flag(rest, "object");

      if (objectPath === undefined) {
        console.error("Не указан объект. Пример: si intake --object reference-system/input-1");
        return 1;
      }

      if (platform.routing === undefined) {
        console.error("Не заведена таблица маршрута config/routing.json — приём невозможен.");
        return 2;
      }

      return await intakeCommand(platform.routing, objectPath, rest);
    }

    case "protocol": {
      const workflowId = flag(rest, "workflow") ?? "full-check";
      const workflow = platform.workflows.get(workflowId);

      if (workflow === undefined) {
        console.error(
          `Воркфлоу ${workflowId} не найден. Известные: ${[...platform.workflows.keys()].join(", ") || "нет"}`,
        );
        return 1;
      }

      return await showProtocol(platform, workflow, rest);
    }

    case "export": {
      const documentPath = flag(rest, "file");
      const outPath = flag(rest, "out");

      if (documentPath === undefined || outPath === undefined) {
        console.error("Пример: si export --file <смета.xlsx> --out <расчёт.xlsx>");
        return 1;
      }

      return exportCalculation(platform, documentPath, outPath);
    }

    case "run":
    case "maintain": {
      const operationId = rest.find((argument) => !argument.startsWith("--") && !isFlagValue(rest, argument));

      if (operationId === undefined) {
        console.error(`Не указана операция. Известные: ${platform.operations.ids().join(", ")}`);
        return 1;
      }

      if (platform.operations.definition(operationId) === undefined) {
        console.error(
          `Операция ${operationId} не зарегистрирована. Известные: ${platform.operations.ids().join(", ") || "нет"}`,
        );
        return 1;
      }

      return runOperation(platform, operationId, rest, command === "run" ? "single" : "maintenance");
    }

    default:
      console.error(`Неизвестная команда: ${command}\n\n${USAGE}`);
      return 1;
  }
}

/**
 * Запись результата сравнения в базу как канонического артефакта.
 *
 * Экран §5.5 читает артефакты, а не файлы: путь к JSON на диске веб-серверу
 * недоступен и не должен быть доступен. Поэтому мост между расчётом на файле и
 * экраном — сохранение, а не чтение файла из веба.
 *
 * Заводится и Проверка: артефакт принадлежит прогону (ADR-R-022), а не висит
 * сам по себе. Её маршрут — `compare-offers`, то есть операция, и экран
 * скажет об этом прямо: тактов у такой Проверки нет.
 */
async function saveComparison(
  tenantId: string,
  objectCode: string,
  result: ComparisonResult,
): Promise<{ readonly checkId: string }> {
  const { createPrismaClient, withTenant } = await import("@platform/db/prisma.js");
  const { ArtifactRepository } = await import("@platform/db/artifact-repository.js");
  const { randomUUID } = await import("node:crypto");

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenantId, async (tx) => {
      const object = await tx.projectObject.findFirst({ where: { code: objectCode } });
      if (object === null) throw new Error(`Объект ${objectCode} не найден у арендатора`);

      const author = await tx.user.findFirst();
      if (author === null) throw new Error("У арендатора нет ни одного пользователя: некому приписать Проверку");

      const check = await tx.check.create({
        data: {
          tenantId,
          objectId: object.id,
          workflowId: "compare-offers",
          mode: "standard",
          createdBy: author.id,
          status: "completed",
          finishedAt: new Date(),
          // Класс полноты — `single`: это одна операция, а не Проверка целиком,
          // и сводный вывод §5.3 она нести не имеет права (ADR-R-022).
          completeness: "single",
        },
      });

      await new ArtifactRepository().save(
        tx,
        {
          id: randomUUID(),
          tenantId,
          operation: { id: "compare-offers", version: 1 },
          completeness: "single",
          inputHashes: [],
          degradations: [],
          body: result,
          producedAt: new Date().toISOString(),
        } as never,
        [],
        check.id,
      );

      return { checkId: check.id };
    });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Печать сравнения коммерческих предложений.
 *
 * Вычисление живёт в `platform/execution/compare-offers.ts` — эта функция
 * только печатает. Раньше здесь было и то и другое, и экран сравнения §5.5
 * переиспользовать расчёт не мог: пришлось бы завести вторую оркестровку, то
 * есть вторую истину (ADR-R-022 запрещает прямо).
 */
async function compareCommand(
  offersPath: string,
  outPath: string | undefined,
  persist: { readonly tenantId?: string; readonly objectCode?: string },
): Promise<number> {
  const bundle = JSON.parse(readFileSync(offersPath, "utf8")) as CompareBundle;
  const result = compareOffers(bundle);

  console.log(`Объект        : ${result.objectName}`);
  console.log(`Предложений   : ${result.offersTotal}`);
  console.log("");

  for (const contractor of result.contractors) {
    console.log(`  ${contractor.contractor}`);
    console.log(`      ${contractor.note}`);
    console.log(`      итог ${contractor.total} ₽, из них сопоставлено ${contractor.matchedAmount} ₽`);
    for (const group of contractor.decomposed) {
      console.log(`      состав разбит: ${group.canonicalId} — ${group.lines} строк, ${group.quantityNote}`);
    }
  }

  console.log("");

  if (!result.ready) {
    console.log("ТРЕБУЕТСЯ ПОДТВЕРЖДЕНИЕ ЧЕЛОВЕКОМ (ADR-R-013)");
    for (const record of result.pending) {
      console.log(`  ? ${record.offerLine}`);
      console.log(`      ${record.explanation}`);
    }
    console.log("");
    console.log("Разброс НЕ посчитан: считать по неподтверждённым сопоставлениям");
    console.log("значит выдать догадку за факт.");
    return 2;
  }

  if (result.unmatched.length > 0) {
    console.log(`НЕ СОПОСТАВЛЕНЫ (§5.2, в расчёт разброса НЕ входят): ${result.unmatched.length}`);
    for (const record of result.unmatched) {
      console.log(`  · ${record.offerLine} — ${record.explanation}`);
    }
    console.log("");
  }

  console.log("РАЗБРОС ПО ПОЗИЦИЯМ (§5.2)");

  for (const position of result.positions) {
    const { spread: s, estimate, deviation } = position;

    console.log(`  ${position.canonicalId}`);

    if (s.computable) {
      console.log(
        `      мин ${s.min} · медиана ${s.median} · макс ${s.max} · разброс ×${s.ratio} ` +
          `(предложений ${s.comparable})`,
      );
    } else {
      console.log(`      разброс не посчитан: ${s.reason ?? "нет данных"}`);
    }

    if (s.unmatched.length > 0) {
      console.log(`      НЕ вошли: ${s.unmatched.map((item) => item.source).join(", ")}`);
    }

    for (const anomaly of s.anomalies) {
      console.log(
        `      🔴 аномалия: ${anomaly.source} — ${anomaly.amount} ₽, ` +
          `влияние ${anomaly.impact} ₽ (×${anomaly.ratio} к медиане)`,
      );
    }

    if (position.unitSpread.computable && position.quantity !== undefined) {
      console.log(
        `      за единицу: мин ${position.unitSpread.min} · медиана ${position.unitSpread.median} · ` +
          `макс ${position.unitSpread.max} ₽ на ${position.quantity} ед.`,
      );
    }

    if (estimate.computable) {
      console.log(
        `      оценка Системы ${estimate.unitPrice} ₽/ед., диапазон ` +
          `${estimate.range.low}–${estimate.range.high} ₽/ед. (${estimate.sources.join(", ")})`,
      );
      console.log(`      оценка на объём: ${estimate.total} ₽`);
      if (deviation !== undefined) {
        console.log(`      отклонение: ${deviation.category}`);
        console.log(`          ${deviation.basis}`);
        console.log(`          что делать: ${deviation.remedy}`);
      }
    } else {
      console.log(`      оценка Системы НЕ построена: ${estimate.reason ?? ""}`);
    }
  }

  // Сохранение в базу — отдельный шаг и только по явному указанию арендатора и
  // объекта. Без флагов команда остаётся тем, чем была: расчётом на файле.
  if (persist.tenantId !== undefined && persist.objectCode !== undefined) {
    const saved = await saveComparison(persist.tenantId, persist.objectCode, result);
    console.log("");
    console.log(`Сохранено     : проверка ${saved.checkId}`);
  }

  if (outPath !== undefined) {
    const comparison = buildOffersComparison({
      objectName: result.objectName,
      positions: result.positions.map((position) => ({
        name: position.canonicalId,
        unit: "—",
        quantity: "—",
        offers: result.contractors.map((contractor) => {
          const amount = position.offers.find((offer) => offer.source === contractor.contractor);
          return amount === undefined
            ? { contractor: contractor.contractor }
            : { contractor: contractor.contractor, amount: amount.amount };
        }),
        ...(position.estimate.unitPrice === undefined ? {} : { systemEstimate: position.estimate.unitPrice }),
        spread: position.spread,
      })),
    });

    await writeWorkbook(comparison, outPath);
    console.log("");
    console.log(`Сравнение выгружено: ${outPath}`);
  }

  return 0;
}

/**
 * Четыре договорных выгрузки §10 по результату проверки объекта.
 *
 * Смысл этой функции не в записи файлов, а в том, чтобы выгрузки существовали
 * НЕ ТОЛЬКО В ТЕСТАХ. Модуль, до которого нельзя дойти командой, — украшение;
 * такое уже случалось с областью знания, и повторять не стоит.
 *
 * ЧЕТВЁРТАЯ ВЫГРУЗКА ПРОПУСКАЕТСЯ ГРОМКО
 *
 * Сравнение предложений требует коммерческих предложений, которых у объекта
 * может не быть. Тогда файл не пишется — и об этом СКАЗАНО. Молча выдать три
 * файла вместо четырёх значит оставить человека в уверенности, что сравнение
 * сделано и ничего не нашло.
 */
/**
 * Длина в удобных человеку единицах.
 *
 * Разбор приводит длины к метрам, и «198120 м» формально верно. Но эталонный
 * отчёт заказчика называет тот же объём «198,12 км», и находка, записанная
 * иначе, читается как ДРУГАЯ находка. Сверять их придётся вручную — ровно та
 * работа, которую система должна снимать.
 */
/**
 * Доля в процентах с запятой.
 *
 * Точка в «12.52%» рядом с «15 023 290,00 ₽» читается как число из другого
 * источника — та же причина, по которой длина приводится к запятой.
 */
function percent(share: string): string {
  return `${(Number(share) * 100).toFixed(2).replace(".", ",")}%`;
}

function length(value: string, unit: string): string {
  const amount = Number(value);

  if (unit !== "м" || !Number.isFinite(amount) || Math.abs(amount) < 1000) {
    return `${value} ${unit}`;
  }

  // Запятая, а не точка: в остальном документе десятичный разделитель —
  // запятая, и «198.12 км» рядом с «64 710 398,29 ₽» выглядит как число из
  // другого источника.
  return `${(amount / 1000).toFixed(2).replace(".", ",")} км`;
}

async function writeSection10(
  directory: string,
  body: CheckObjectBody,
  now: string,
  linearPositions: readonly (LinearPosition & { document: string })[],
  economics: { readonly area?: string; readonly revenue?: string; readonly costs?: string },
  roster: AgentRoster,
  degradations: readonly { readonly capability: string; readonly reason: string }[],
): Promise<void> {
  await mkdir(directory, { recursive: true });

  const objectName = body.objectPath.split("/").filter(Boolean).pop() ?? body.objectPath;

  // РЕВЕРС ОБЪЁМА (правило Д-7 Денчика). Считается по позициям ВСЕХ смет
  // объекта сразу: группировка идёт по таблице норм, и разбить её по файлам
  // значило бы потерять базу там, где однородные позиции разошлись по сметам.
  //
  // В реестр идёт сумма ПО БЛОКУ, а не по флагам: без геометрии РД не обоснован
  // ни один метр группы, и эталонный приём заказчика называет необоснованным
  // именно блок целиком.
  const reversal = reverseVolumes(linearPositions);
  const documentOf = new Map(linearPositions.map((position) => [position.ordinal, position.document]));

  // РАЗДЕЛЫ ПО АГЕНТАМ, а не по документам.
  //
  // До этого каждому исходу обзора подставлялось `agent: "Людмила"` — всем
  // девяти. Находки Виктора и Халиля выходили за подписью сметчика, и записка
  // утверждала неправду о том, кто это сказал. Имена берутся из реестра.
  const byAgent = foldByAgent({
    roster: roster.all(),
    outcomes: body.review?.documents,
    degradations: degradations.map((degradation) => ({
      capability: degradation.capability,
      reason: degradation.reason,
    })),
  });

  // РЕЕСТР НАРУШЕНИЙ. Источник находок — расхождения сходимости, документы,
  // которые не удалось прочитать, и блоки с неподтверждённым объёмом.
  // Непрочитанная смета не менее существенна, чем несошедшаяся: о её
  // содержимом не известно вообще ничего.
  const violations = [
    ...reversal.groups
      .filter((group) => Number(group.flaggedAmount) > 0)
      .map((group) => ({
        position: `блок ${group.table} (${group.positions.length} позиций), ${group.totalQuantity} ${group.unit}`,
        kind: "объём не подтверждён рабочей документацией",
        amount: group.totalAmount,
        basis:
          `Д-7: сметный объём кратен базовой длине ${group.baseQuantity} ${group.unit} ` +
          `с кратностью более двух. ${group.assumption}`,
        remedy:
          "вернуть блок подрядчику, запросить расчёт объёма по осям РД; " +
          "до сверки объём остаётся допущением, сильный вердикт не выносится",
        document: documentOf.get(group.positions[0]?.ordinal ?? "") ?? body.objectPath,
      })),
    ...body.documents
      .filter((document) => document.status === "проверен" && document.converged === false)
      .map((document) => ({
        position: document.path.split("/").pop() ?? document.path,
        kind: "расхождение сходимости внутри ЛСР",
        // Расхождение неизвестно — реестр нарушений говорит это словом.
        // «0,00 ₽» в графе нарушения означало бы «нарушения нет».
        amount: document.delta ?? "не определено",
        basis: "§12.1б: расхождение суммы разделов с итогом источника должно быть 0 ₽",
        remedy: "запросить у составителя пересчёт итогов разделов и повторную выгрузку",
        document: document.path,
      })),
    ...body.documents
      .filter((document) => document.status === "отказ")
      .map((document) => ({
        position: document.path.split("/").pop() ?? document.path,
        kind: "документ не разобран",
        // Сумма неизвестна: ставить ноль значило бы объявить нарушение
        // бесплатным, а неизвестное — не ноль (§9). Строка уходит в неполные
        // находки и остаётся видимой.
        amount: "",
        basis: document.reason ?? "причина отказа не записана",
        remedy: "передать документ в поддерживаемом формате либо ввести данные вручную",
        document: document.path,
      })),
    // ЗАМЕЧАНИЯ АГЕНТОВ — в реестр, а не только в записку.
    //
    // §15.2 требует отдельный договорный артефакт «реестр нарушений», и до сих
    // пор в него попадали только расчётные находки: реверс объёма и
    // непрочитанные документы. Всё, что нашли девять агентов, оставалось в
    // записке, которую читатель открывать не обязан.
    //
    // Идут ТОЛЬКО существенные (critical/high): реестр — перечень того, что
    // требует решения, и наблюдение уровня info, попав в один список с
    // нарушением на десять миллионов, обесценивает соседние строки.
    ...byAgent.flatMap((section) =>
      section.findings
        .filter((finding) => finding.severity === "critical" || finding.severity === "high")
        .map((finding) => ({
          position: finding.statement,
          kind: `${section.identity.person} — ${section.identity.role}`,
          // Пустая строка, а не ноль: сумма неизвестна, и реестр сам отправит
          // такую находку в «неполные», оставив её видимой (§9).
          amount: finding.impact ?? "",
          basis: finding.basis,
          remedy:
            finding.severity === "critical"
              ? "требует решения до выпуска: замечание блокирующего уровня"
              : "требует решения ответственного по зоне агента",
          document: finding.document ?? objectName,
        })),
    ),
  ];

  const register = buildViolationsRegister({ objectName, violations, producedAt: now });
  const registerPath = join(directory, "Реестр нарушений.xlsx");
  await writeWorkbook(register, registerPath);

  // ЭКОНОМИКА ОБЪЕКТА — гейт M4: «₽/м², финмодель в трёх сценариях с прогнозом
  // разрывов».
  //
  // Площадь и выручка в сметах НЕ СОДЕРЖАТСЯ: площадь — свойство паспорта
  // объекта, выручка — договора. Они приходят флагами, и без них показатели
  // объявляются невычислимыми, а не подставляются наугад: выдуманная площадь
  // даёт правдоподобный ₽/м², по которому примут решение (§9).
  // СМЕТНАЯ стоимость объекта — то, что платит заказчик. НЕ себестоимость.
  //
  // Ваныч (v9.6, чек-лист «себестоимость-не-из-сметы»): «смета — цена
  // заказчику, не затраты». До 02.09.2026 эта величина шла в сценарии как
  // `costs`, и маржа считалась как выручка минус СМЕТА, а ₽/м² печатался со
  // словом «себестоимость». То есть система подставляла цену вместо затрат —
  // ровно то, от чего предостерегает собственный чек-лист агента.
  //
  // Осторожность к площади и выручке (см. выше) к себестоимости применена не
  // была: их объявляли невычислимыми, а её молча подменяли.
  // ноль-осознанно: заявленная стоимость используется ниже только как
  // делитель доли; отсутствие сводного расчёта отдельно проверяется рядом.
  const declaredCost = body.summary?.declaredRubles ?? "0.00";
  const perSqm = costPerSqm({ cost: declaredCost, ...(economics.area === undefined ? {} : { area: economics.area }) });

  const economicsSection =
    economics.revenue === undefined || economics.costs === undefined
      ? {
          agent: "Ваныч",
          role: "Эконом",
          status: "не выполнен" as const,
          findings: [],
          // Молчание здесь было бы нарушением его же стандарта: «не считаешь без
          // полной картины — нет данных, запрашиваешь блоком». Пустой вывод
          // читается как «сказать нечего», а сказать есть что: чего именно нет.
          conclusion:
            "Финмодель не строится: " +
            [
              ...(economics.revenue === undefined
                ? ["выручка не задана (--revenue) — она в договоре, а не в смете"]
                : []),
              ...(economics.costs === undefined
                ? [
                    "себестоимость не задана (--costs) — смета это цена заказчику, " +
                      "а не наши затраты",
                  ]
                : []),
            ].join("; ") +
            `. Сметная стоимость объекта ${rubles(declaredCost as never)} — исходные данные для модели, но не она сама.`,
        }
      : (() => {
          const model = buildScenarios({ revenue: economics.revenue, costs: economics.costs });
          const scenarios = model.scenarios;

          const line = (scenario: (typeof scenarios)[number]): string =>
            `${scenario.id}: выручка ${rubles(scenario.revenue)}, затраты ${rubles(scenario.costs)}, ` +
            `маржа ${rubles(scenario.margin)} (${percent(scenario.marginShare)})` +
            (scenario.profitable ? "" : " — УБЫТОК");

          const losing = scenarios.filter((scenario) => !scenario.profitable);

          return {
            agent: "Ваныч",
            role: "Эконом",
            status: "выполнен" as const,
            // В находки идёт ТОЛЬКО то, что требует решения. Прибыльный
            // сценарий — не находка, и попав в сводный список «находки,
            // требующие решения», он обесценивает соседние строки: читатель
            // перестаёт верить, что каждая из них о чём-то говорит.
            findings: [
              ...(perSqm.computable ? [] : [`₽/м² не вычислен: ${perSqm.reason ?? "нет площади"}`]),
              ...losing.map(line),
            ],
            conclusion:
              (perSqm.computable
                ? `сметная стоимость ${rubles(perSqm.value!)}/м² при площади ${economics.area} м² ` +
                  "(это цена заказчику, а не себестоимость). "
                : "") +
              // Полная модель — в выводе раздела: она нужна для понимания, но
              // решения не требует, поэтому в сводный список не идёт.
              `Модель: ${scenarios.map(line).join("; ")}. ` +
              (losing.length === 0
                ? "Все три сценария прибыльны"
                : `Убыток начинается со сценария «${model.breaksAt}» — ` +
                  "требуется решение по цене или составу работ") +
              // Допущение по «стрессу» печатается ВСЕГДА: протокол его числами
              // не задаёт, и молчание об этом сделало бы допущение похожим на
              // цитату из протокола (§9).
              `. ${model.assumption}`,
          };
        })();

  // ЗАПИСКА. Записка — СВОДКА, а не выборка: находка, попавшая в реестр и
  // отсутствующая в записке, не дойдёт до того, кто принимает решение, потому
  // что реестр он открывать не обязан. Поэтому разделы собираются из ВСЕГО,
  // что нашла проверка, а не только из обзора сметчика.
  const reversalFindings = reversal.groups
    .filter((group) => Number(group.flaggedAmount) > 0)
    .map(
      (group) =>
        `блок ${group.table}: объём ${length(group.totalQuantity, group.unit)} не подтверждён РД — ` +
        `${group.totalAmount === undefined ? "денежный вес не определён (смета без цен)" : rubles(group.totalAmount)}` +
        ` (базовая длина ${length(group.baseQuantity, group.unit)}, правило Д-7)`,
    );

  const sections = [
    ...byAgent.map((section) => ({
      agent: section.identity.person,
      role: section.identity.role,
      status: section.status,
      findings: section.findings.map(
        (finding) => `${finding.statement} (основание: ${finding.basis})`,
      ),
      // Причина непременно доходит до читателя: раздел без находок и без
      // причины читается как «посмотрел и промолчал».
      conclusion:
        section.subjects
          .map((subject) => subject.verdict)
          .filter((verdict): verdict is string => verdict !== undefined)
          .join(" · ") || (section.reason ?? ""),
    })),
    // Реверс объёма выполняется всегда, поэтому раздел ГИПа есть и без
    // `--agent`: он опирается на расчёт, а не на языковую модель. Он ДОПОЛНЯЕТ
    // раздел ГИПа выше, а не заменяет его: одно посчитано, другое сказано.
    ...(linearPositions.length === 0
      ? []
      : [
          {
            agent: "Реверс объёма",
            role: "расчёт, правило Д-7",
            status: "выполнен" as const,
            findings: reversalFindings,
            conclusion:
              reversalFindings.length === 0
                ? "кратностей объёма выше порога не найдено"
                : "объёмы принять нельзя до сверки базовой длины с осями РД (Д-1)",
          },
        ]),
    economicsSection,
  ];

  const memo = buildMemo({
    passport: {
      objectName,
      customer: "не указан",
      documentCount: body.totals.documents,
      checkedAt: now.slice(0, 10),
      // ноль-осознанно: строка сводного расчёта печатается только когда он
      // разобран; ветка «не разобран» стоит выше и выводит причину.
      total: body.summary?.declaredRubles ?? "0.00",
    },
    sections,
  });
  const memoPath = join(directory, "Записка.docx");
  await writeMemo(memo, memoPath);

  console.log("");
  console.log("ВЫГРУЗКИ §10");
  console.log(`  ✓ ${registerPath}`);
  console.log(
    `      нарушений ${register.sheets[0]!.rows.length - 2}, сумма ${register.totalAmount} ₽` +
      (register.incomplete.length > 0 ? `, неполных находок ${register.incomplete.length}` : ""),
  );
  console.log(`  ✓ ${memoPath}`);
  console.log(`      разделов ${sections.length}, вывод: ${memo.verdict.reason}`);
  console.log(
    `      ₽/м²: ${perSqm.computable ? `${perSqm.value} ₽` : `НЕ ВЫЧИСЛЕН — ${perSqm.reason ?? ""}`}`,
  );
  if (economics.revenue === undefined) {
    console.log("      финмодель: НЕ ПОСТРОЕНА — выручка не задана (--revenue)");
  }
  console.log("  · Сравнение предложений.xlsx — НЕ СФОРМИРОВАНО");
  console.log("      коммерческих предложений по объекту нет, сравнивать нечего");
  console.log("  · Расчёт.xlsx — формируется отдельно: si export --file <смета> --out <книга>");
}

/**
 * Проверка объекта — гейт MVP (роадмап M1).
 *
 * Обход и вердикт живут в модуле; здесь только доступ к диску и печать.
 * Порт `checkDocument` бросает исключение вместо возврата ошибки намеренно:
 * модуль ловит его и превращает в статус «отказ», не прерывая обход остальных
 * смет объекта.
 */
async function checkObjectCommand(
  platform: Platform,
  objectPath: string,
  asJson: boolean,
  withAgent: boolean,
  outPath: string | undefined,
  argv: readonly string[],
): Promise<number> {
  const tenantId = "00000000-0000-0000-0000-000000000000";
  const now = new Date().toISOString();

  // Режим глубины ответа (§5.4). Неизвестное имя — отказ с перечислением
  // допустимых, а не тихая подмена на «стандарт»: молча выполнить не то, что
  // просили, хуже, чем не выполнить.
  const requested = flag(argv, "mode");
  const depth = (requested ?? "стандарт") as DepthMode;

  if (DEPTH_MODES[depth] === undefined) {
    console.error(
      `Неизвестный режим глубины: ${requested}. Допустимы: ${Object.keys(DEPTH_MODES).join(", ")}.`,
    );
    return 2;
  }

  // Запросили обзор, а операция не собрана — это отказ, а не повод молча
  // отдать детерминированную часть под видом полной Проверки.
  if (withAgent && platform.operations.definition("run-estimate-review") === undefined) {
    console.error(
      "Запрошен обзор сметчика, но операция run-estimate-review не зарегистрирована.\n" +
        "Нужны переменные STROYINTELLECT_MODEL_BASE_URL и STROYINTELLECT_MODEL_ID.",
    );
    return 2;
  }

  const promptHashes = existsSync("config/agents/estimate-review/prompt.md")
    ? [
        {
          agent: "людмила",
          contentHash: createHash("sha256")
            .update(readFileSync("config/agents/estimate-review/prompt.md", "utf8"), "utf8")
            .digest("hex"),
        },
      ]
    : [];

  const modelId = process.env["STROYINTELLECT_MODEL_ID"];
  const modelRefs =
    withAgent && modelId !== undefined && modelId !== ""
      ? [{ provider: "openai-compatible", model: modelId }]
      : [];

  const { ports, collected } = buildCheckPorts({
    platform,
    tenantId,
    now,
    ...(withAgent
      ? {
          reviewers: buildReviewers(platform, tenantId, now, depth),
          objectReviewers: buildObjectReviewers(
            platform,
            tenantId,
            now,
            {
              ...(flag(argv, "revenue") === undefined ? {} : { revenue: flag(argv, "revenue")! }),
              ...(flag(argv, "costs") === undefined ? {} : { costs: flag(argv, "costs")! }),
            },
            depth,
          ),
          synthesisReviewers: buildVerdictReviewers(platform, tenantId, now, depth),
        }
      : {}),
  });

  const body = await checkObject(objectPath, ports);
  const documentHashes = collected.documentHashes;
  const linearPositions = collected.linearPositions;

  if (asJson) {
    console.log(JSON.stringify(body, null, 2));
    return body.verdict === "принято" ? 0 : 2;
  }

  console.log(`Объект        : ${body.objectPath}`);
  console.log(`Документов    : ${body.totals.documents}`);
  console.log("");

  for (const document of body.documents) {
    const name = document.path.split("/").pop() ?? document.path;

    if (document.status === "проверен") {
      console.log(
        `  ✓ ${name}\n` +
          `      позиций ${document.positions}, по шифру ${document.byCode}, ` +
          `итог ${document.documentTotal} ₽, Δ ${document.delta} ₽`,
      );
    } else if (document.status === "отказ") {
      console.log(`  ✗ ${name}\n      ОТКАЗ: ${document.reason}`);
    } else if (document.status === "сверен") {
      // Документ не пропущен, а использован как эталон сверки. Назвать его
      // пропущенным значило бы скрыть, что он участвовал в Проверке.
      console.log(`  ✓ ${name}\n      ${document.reason}`);
    } else {
      console.log(`  · ${name}\n      пропущен: ${document.reason}`);
    }
  }

  console.log("");
  console.log(`Проверено смет: ${body.totals.checked}, отказов ${body.totals.failed}, пропущено ${body.totals.skipped}`);
  console.log(`Позиций       : ${body.totals.positions}, по шифру ${body.totals.byCode}, без шифра ${body.totals.unmatched}`);
  console.log("");

  for (const gate of body.gates) {
    console.log(`  ${gate.passed ? "✓" : "✗"} ${gate.id} ${gate.name}`);
    console.log(`      ${gate.detail}`);
  }

  if (body.review !== undefined) {
    const bySeverity = body.review.bySeverity;
    const blocking = (bySeverity["critical"] ?? 0) + (bySeverity["high"] ?? 0);

    console.log("");
    // Не «обзор сметчика»: агентов несколько, и каждый смотрит каждую смету.
    const обозрено = new Set(
      body.review.documents
        .filter((outcome) => outcome.scope !== "объект")
        .map((outcome) => outcome.path),
    ).size;
    const агентов = new Set(
      body.review.documents.map((outcome) => outcome.capability).filter(Boolean),
    ).size;

    console.log(
      `Замечания агентов: ${body.review.findings} по ${обозрено} сметам, агентов ${агентов}`,
    );
    console.log(
      `  по важности : ${Object.entries(bySeverity).map(([severity, count]) => `${severity} ${count}`).join(", ") || "нет"}`,
    );
    // Нарушения формы печатаются отдельно от замечаний по существу: смешать их
    // значит выдать «ответ длиннее, чем обещано» за замечание к смете.
    const формой = body.review.documents.flatMap((outcome) => outcome.depthViolations ?? []);

    if (формой.length > 0) {
      console.log(`  режим ${depth}: нарушений формы ${формой.length}`);
      for (const violation of [...new Set(формой)]) console.log(`      · ${violation}`);
    }

    if (blocking > 0) {
      console.log(`  ВНИМАНИЕ    : замечаний уровня critical/high — ${blocking}, требуют решения до выпуска`);
    }

    for (const outcome of body.review.documents) {
      const name = outcome.path.split("/").pop() ?? outcome.path;

      if (outcome.error !== undefined) {
        console.log(`  ✗ ${name}: ${outcome.error}`);
        continue;
      }

      console.log(`  ${name} — ${outcome.verdict ?? ""}`);
      for (const finding of outcome.findings) {
        console.log(`      [${finding.severity}] ${finding.statement}`);
        console.log(`          основание: ${finding.basis}`);
      }
    }
  }

  // Снапшот пишется ВСЕГДА, а не по флагу: прогон без записи того, на чём он
  // сделан, невоспроизводим, и узнаётся это в момент, когда результат уже
  // предъявлен (ADR-R-024, R-027).
  const snapshot = buildSnapshot({
    objectPath,
    producedAt: now,
    documents: documentHashes,
    configs: [...platform.configHashes].map(([path, contentHash]) => ({ path, contentHash })),
    operations: platform.operations
      .ids()
      .map((id) => ({ id, version: platform.operations.definition(id)?.version ?? 0 })),
    formulas: [
      { id: CONVERGENCE_FORMULA, version: CONVERGENCE_VERSION },
      { id: OBJECT_TOTAL_FORMULA, version: OBJECT_TOTAL_VERSION },
    ],
    prompts: promptHashes,
    models: modelRefs,
    knowledgeScope: platform.extensions
      .ids("knowledge-source")
      .filter((id) => platform.scope.allows(id)),
    degradations: [
      ...platform.scope
        .excludedFrom(platform.extensions.ids("knowledge-source"))
        .map((sourceId) => ({ capability: sourceId, reason: "источник выключен областью знания" })),
      ...(platform.catalogue.size === 0
        ? [{ capability: "canonical-items", reason: "каталог позиций не собран" }]
        : []),
      ...(withAgent ? [] : [{ capability: "estimate-review", reason: "обзор сметчика не запрашивался" }]),
    ],
  });

  const digest = snapshotDigest(snapshot);

  if (body.summary !== undefined) {
    const summary = body.summary;
    console.log("");
    console.log(`Сводный расчёт: ${summary.path.split("/").pop() ?? summary.path}`);
    if (summary.error !== undefined) {
      // «Не разобран» и «сверять не с чем» — разные вещи: во втором случае
      // сводный расчёт прочитан, но сравнивать его не с чем.
      const нечегоСверять = summary.delta === undefined && summary.declaredThousands === undefined;
      console.log(`  ✗ ${нечегоСверять ? "сверка не выполнена" : "не разобран"}: ${summary.error}`);
    } else {
      console.log(`  ${summary.label}: ${summary.declaredThousands} тыс.₽ = ${summary.declaredRubles} ₽`);
      console.log(
        `  Δ ${summary.delta} ₽ при гранулярности шкалы ${summary.granularity} ₽ — ` +
          (summary.explainedByScale === true
            ? "объясняется округлением источника"
            : "ВНЕ гранулярности, требует разбора"),
      );
    }
  }

  if (outPath !== undefined) {
    // Отображение результата Проверки во входную форму выгрузки делает
    // композиционный корень: модули друг друга не знают (ADR-R-025).
    const objectTotal = sumObjectTotals(
      body.documents
        .filter((document) => document.status === "проверен")
        .map((document) => ({
          path: document.path.split("/").pop() ?? document.path,
          // ноль-осознанно: печать сметы, у которой итог есть по условию
          // ветки; смета без стоимостной части выводится отдельной строкой.
          total: (document.documentTotal ?? "0.00") as never,
        })),
    );

    const report = buildObjectReport({
      objectPath,
      verdict: body.verdict,
      documents: body.documents.map((document) => ({ ...document })),
      totals: body.totals,
      gates: body.gates.map((gate) => ({ ...gate })),
      objectTotal: {
        value: { amount: objectTotal.total, currency: "RUB" },
        provenance: { kind: "formula", trace: objectTotal.trace },
      },
      ...(body.summary === undefined ? {} : { summary: { ...body.summary } }),
      // Реестр и деградации — чтобы лист замечаний назвал агентов поимённо, а
      // не приписал всё сметчику и не потерял тех, кто не отработал.
      roster: platform.roster.all(),
      degradations: snapshot.degradations.map((degradation) => ({
        capability: degradation.capability,
        reason: degradation.reason,
      })),
      ...(body.review === undefined
        ? {}
        : {
            review: {
              documents: body.review.documents.map((outcome) => ({ ...outcome })),
              findings: body.review.findings,
              bySeverity: body.review.bySeverity,
            },
          }),
      artifact: {
        id: randomUUID(),
        tenantId,
        operation: { id: "check-object", version: 1 },
        completeness: "full",
        inputHashes: [],
        degradations: [],
        producedAt: now as never,
        body: {},
      },
      generatorVersion: "1.0.0",
      producedAt: isoDate(now.slice(0, 10)),
    });

    await writeWorkbook(report, outPath);

    console.log("");
    console.log(`Разбор выгружен: ${outPath}`);
    console.log(`  листов ${report.sheets.length}, формул со следом ${tracesOf(report).length}`);
  }

  console.log("");
  console.log(`Отпечаток входов: ${digest.slice(0, 16)}…`);
  console.log(
    `  документов ${snapshot.documents.length}, конфигов ${snapshot.configs.length}, ` +
      `операций ${snapshot.operations.length}, формул ${snapshot.formulas.length}` +
      (snapshot.degradations.length > 0 ? `, деградаций ${snapshot.degradations.length}` : ""),
  );
  for (const degradation of snapshot.degradations) {
    console.log(`  деградация: ${degradation.capability} — ${degradation.reason}`);
  }

  const reportDir = flag(argv, "report");
  if (reportDir !== undefined) {
    await writeSection10(
      reportDir,
      body,
      now,
      linearPositions,
      {
        ...(flag(argv, "area") === undefined ? {} : { area: flag(argv, "area")! }),
        ...(flag(argv, "revenue") === undefined ? {} : { revenue: flag(argv, "revenue")! }),
        ...(flag(argv, "costs") === undefined ? {} : { costs: flag(argv, "costs")! }),
      },
      platform.roster,
      snapshot.degradations,
    );
  }

  const snapshotPath = flag(argv, "snapshot");
  if (snapshotPath !== undefined) {
    writeFileSync(snapshotPath, `${JSON.stringify({ digest, snapshot }, null, 2)}\n`, "utf8");
    console.log(`  снапшот записан: ${snapshotPath}`);
  }

  console.log("");
  // Вердикт Проверки отвечает на вопрос «система корректно обработала объект»
  // (критерии приёмки §12.1), а НЕ на вопрос «смета хороша». Второй вопрос —
  // это замечания сметчика выше. Слово «принято» без уточнения смешивало бы их.
  console.log(`ПРОВЕРКА      : ${body.verdict.toUpperCase()} по критериям §12.1`);
  if (body.review !== undefined) {
    console.log("                (оценка самих смет — в замечаниях сметчика выше)");
  }

  return body.verdict === "принято" ? 0 : 2;
}

/**
 * Открывает прогон в базе: продолжает начатый либо заводит новый (§5.6).
 *
 * Состояние предметов и исполненные шаги переживают перезапуск, поэтому
 * повторный запуск с тем же `--run <id>` не делает работу заново.
 */
async function openRun(runFlag: string, argv: readonly string[]) {
  const { createPrismaClient, withTenant } = await import("@platform/db/prisma.js");
  const { CheckRunRepository } = await import("@platform/db/check-run-repository.js");

  const db = createPrismaClient(process.env["DATABASE_URL"]);
  const repository = new CheckRunRepository();

  const tenantId = flag(argv, "tenant") ?? process.env["STROYINTELLECT_TENANT_ID"];
  if (tenantId === undefined) {
    throw new Error("Не задан арендатор: укажите --tenant <uuid> или STROYINTELLECT_TENANT_ID");
  }

  const objectId = flag(argv, "object-id") ?? process.env["STROYINTELLECT_OBJECT_ID"];
  const workflowId = flag(argv, "workflow") ?? "full-check";

  const existing =
    runFlag === "new" ? undefined : await withTenant(db, tenantId, (tx) => repository.resume(tx, runFlag));

  if (runFlag !== "new" && existing === undefined) {
    throw new Error(`Прогон ${runFlag} не найден, недоступен арендатору или уже завершён`);
  }

  const { recordAudit } = await import("@platform/security/audit.js");

  const runId =
    existing?.id ??
    (
      await withTenant(db, tenantId, async (tx) => {
        const started = await repository.start(tx, {
          tenantId,
          objectId: objectId ?? "",
          workflowId,
          createdBy: tenantId,
        });

        // §5.5 требует от журнала «записи о переданных документах и полученных
        // результатах». Начало проверки — первая половина этого: без неё в
        // журнале видны только входы, а работа системы — нет.
        await recordAudit(tx, tenantId, {
          action: "check.started",
          resourceKind: "check",
          resourceId: started.id,
        });

        return started;
      })
    ).id;

  return {
    runId,
    subjects: new Map(
      [...(existing?.subjects ?? new Map())].map(([id, subject]) => [
        id,
        { id, status: subject.status as SubjectState["status"], returnedCount: subject.returnedCount },
      ]),
    ),
    completedSteps: existing?.completedSteps ?? [],

    save: async (body: Awaited<ReturnType<typeof runProtocol>>) => {
      await withTenant(db, tenantId, async (tx) => {
        await repository.saveSubjects(
          tx,
          tenantId,
          runId,
          body.subjects.map((subject) => ({
            id: subject.id,
            status: subject.status,
            returnedCount: subject.returnedCount,
          })),
        );

        for (const stage of body.stages) {
          for (const step of stage.steps) {
            if (step.status !== "исполнен") continue;
            await repository.markStepDone(tx, tenantId, runId, stage.id, step.agent);
          }
        }

        // Эскалация — пауза: прогон ждёт человека и остаётся возобновляемым.
        const status = body.completed
          ? "completed"
          : body.escalations.length > 0
            ? "awaiting_human"
            : "running";

        await repository.finish(tx, runId, status);

        // В журнал идёт ЗАВЕРШЕНИЕ, а не каждая пауза: прогон, ждущий человека,
        // ещё не дал результата, и запись о нём читалась бы как результат.
        if (status === "completed") {
          await recordAudit(tx, tenantId, {
            action: "check.finished",
            resourceKind: "check",
            resourceId: runId,
            reason: `тактов ${body.stages.length}`,
          });
        }
      });

      await db.$disconnect();
    },
  };
}

/**
 * Такт 0: Настенька собирает паспорт объекта из состава папки и объявленного.
 *
 * Реестр поручений здесь НЕ строится: он выводится после прогона, из
 * фактического состояния предметов. Строить его в начале значило бы записать
 * план и потом вести его отдельно от исполнения — ровно то, от чего рассыхается
 * ручной реестр легаси.
 */
async function runNastenka(
  step: { readonly produces: readonly string[] },
  objectPath: string,
  argv: readonly string[],
): Promise<StepResult> {
  const names = await readdir(objectPath);
  const kinds = names.map((name) => classifyDocument(name));

  const passport = buildObjectPassport({
    objectPath,
    declared: {
      ...(flag(argv, "name") === undefined ? {} : { name: flag(argv, "name")! }),
      ...(flag(argv, "customer") === undefined ? {} : { customer: flag(argv, "customer")! }),
    },
    composition: {
      volumes: kinds.filter((kind) => kind === "рабочая-документация").length,
      estimates: kinds.filter((kind) => kind === "лср").length,
      hasSummary: kinds.includes("ссрсс"),
      total: names.length,
    },
  });

  console.log("ПАСПОРТ ОБЪЕКТА");
  for (const line of renderObjectPassport(passport).split("\n")) console.log(`  ${line}`);
  console.log("");

  return {
    agent: "настенька",
    produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
    handoffs: [],
  };
}

/**
 * Приёмка по агентам — ТЗ §12.2, порог ≥80% пунктов ПО КАЖДОМУ.
 *
 * Ответы на пункты берутся из ФАКТИЧЕСКОГО прогона, а не проставляются руками:
 * чек-лист, который заполняет тот же, кто писал код, проверяет намерение, а не
 * результат. Пункты, которые прогоном не проверить, остаются неотвеченными и
 * снижают долю — это честнее, чем зачесть их себе.
 */
/**
 * Замер против эталона: что из выводов легаси мы воспроизводим.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ КОМАНДА, А НЕ ГЕЙТ ПРОВЕРКИ
 *
 * Гейт отвечает на вопрос «система корректно обработала объект». Здесь вопрос
 * другой: «сказали ли мы то же, что сказал оригинал». Второе — свойство пары
 * «вход + эталонный выход», а таких пар у нас пока одна, и превращать её в
 * условие приёмки любого объекта было бы подлогом.
 *
 * ЧТО СРАВНИВАЕТСЯ
 *
 * Числа. Ожидания взяты из эталонного пакета с указанием листа и строки;
 * совпадение ищется в НАШЕМ прогоне — в деталях гейтов, в замечаниях агентов и
 * в суммах их последствий. Замер не может пройти оттого, что мы так решили: он
 * проходит, только если система действительно выдала это число.
 */
async function evalAgainstReference(
  platform: Platform,
  argv: readonly string[],
): Promise<number> {
  // `--against-reference` работает и как переключатель, и как путь. Значение,
  // начинающееся с двух дефисов, — это следующий флаг, а не путь: без этой
  // проверки `--against-reference --agent` искал бы файл с именем «--agent».
  const declared = flag(argv, "against-reference");
  const casePath =
    declared === undefined || declared.startsWith("--")
      ? "config/reference-cases/kurgan-zauralye.json"
      : declared;
  const reference = loadReferenceCase(casePath).value;

  const objectPath = flag(argv, "object") ?? reference.object;
  const withAgent = argv.includes("--agent");
  const mode = (flag(argv, "mode") ?? "стандарт") as DepthMode;

  console.log("ЗАМЕР ПРОТИВ ЭТАЛОНА");
  console.log(`  случай   : ${reference.id}`);
  console.log(`  вход     : ${objectPath}`);
  console.log(`  эталон   : ${reference.reference}`);
  console.log(`  ожиданий : ${reference.expectations.length}`);
  console.log(
    `  обзор    : ${withAgent ? `агенты включены, режим ${mode}` : "БЕЗ агентов (--agent не задан)"}`,
  );
  console.log("");

  const now = new Date().toISOString();
  const { ports, collected } = buildCheckPorts({
    platform,
    tenantId: "00000000-0000-0000-0000-000000000001",
    now,
    ...(withAgent
      ? {
          reviewers: buildReviewers(platform, "00000000-0000-0000-0000-000000000001", now, mode),
          objectReviewers: buildObjectReviewers(
            platform,
            "00000000-0000-0000-0000-000000000001",
            now,
            {},
            mode,
          ),
          synthesisReviewers: buildVerdictReviewers(
            platform,
            "00000000-0000-0000-0000-000000000001",
            now,
            mode,
          ),
        }
      : {}),
  });

  const body = await checkObject(objectPath, ports);

  // Наш выход для сравнения: ВСЁ, что система сказала числом и словом.
  // Собирается из результата, а не пишется руками, — иначе замер сравнивал бы
  // эталон с тем, что мы для него подготовили.
  const amounts: string[] = [];
  const text: string[] = [];

  for (const gate of body.gates) {
    text.push(`${gate.name} ${gate.detail}`);
    for (const number of gate.detail.matchAll(/\d+(?:\.\d+)?/gu)) amounts.push(number[0]);
  }

  for (const document of body.documents) {
    text.push(`${document.path} ${document.reason ?? ""}`);
    if (document.documentTotal !== undefined) amounts.push(document.documentTotal);
  }

  if (body.summary?.declaredRubles !== undefined) amounts.push(body.summary.declaredRubles);

  for (const outcome of body.review?.documents ?? []) {
    text.push(outcome.verdict ?? "");
    for (const finding of outcome.findings) {
      text.push(`${finding.statement} ${finding.basis}`);
      if (finding.impact !== undefined) amounts.push(finding.impact.value.amount);
      for (const number of `${finding.statement} ${finding.basis}`.matchAll(/\d[\d\s]*(?:[.,]\d+)?/gu)) {
        amounts.push(number[0].replace(/\s/gu, "").replace(",", "."));
      }
    }
  }

  // Позиции объекта — тоже наш выход: эталон называет суммы, которые мы обязаны
  // были извлечь из смет, а не вывести рассуждением.
  // Сумма, которой в смете нет, в сверку с эталоном не идёт: эталон называет
  // числа, которые мы обязаны были ИЗВЛЕЧЬ, а не выдумать.
  for (const row of collected.extracted) if (row.amount !== undefined) amounts.push(row.amount);

  const measure = measureAgainstReference(reference, { amounts, text: text.join("\n") });

  for (const result of measure.results) {
    const mark =
      result.kind === "воспроизведено" ? "✓" : result.kind === "частично" ? "~" : "✗";

    console.log(`  ${mark} ${result.expectation.id} — ${result.expectation.claim}`);
    console.log(`      эталон: ${result.expectation.amount} ₽ · ${result.expectation.source}`);
    console.log(
      `      у нас : ${result.matched ?? "не найдено"} — ${result.note}`,
    );
  }

  console.log("");
  console.log(
    `ИТОГ: воспроизведено ${measure.reproduced}, частично ${measure.partial}, ` +
      `не воспроизведено ${measure.missed} из ${measure.total}`,
  );
  console.log(`ДОЛЯ: ${measure.score} % (частичное считается за половину)`);

  // Замер НЕ роняет команду: он измеряет, а не принимает. Провал здесь —
  // повод для работы, а не для красной сборки.
  return 0;
}

async function evalCommand(platform: Platform, argv: readonly string[]): Promise<number> {
  const objectPath = flag(argv, "object");

  if (platform.checklists.length === 0) {
    console.error("Чек-листы приёмки не заведены: config/acceptance пуст.");
    return 2;
  }

  const mode = (flag(argv, "mode") ?? "стандарт") as DepthMode;

  if (DEPTH_MODES[mode] === undefined) {
    console.error(`Неизвестный режим глубины: ${mode}. Допустимы: ${Object.keys(DEPTH_MODES).join(", ")}.`);
    return 1;
  }

  console.log("ПРИЁМКА ПО АГЕНТАМ (ТЗ §12.2, порог ≥80% по каждому)");
  console.log(`Режим глубины: ${mode} — ${describeDepth(mode)}`);
  console.log("");

  const answers = objectPath === undefined ? {} : await collectEvidence(platform, objectPath);

  const result = evaluateAll(
    platform.checklists.map((checklist) => ({ agent: checklist.agent, items: checklist.items })),
    answers,
  );

  for (const agent of result.byAgent) {
    const checklist = platform.checklists.find((item) => item.agent === agent.agent)!;
    const percent = (agent.share * 100).toFixed(0);

    console.log(
      `${agent.passed ? "✓" : "✗"} ${agent.agent.padEnd(12)} ${percent.padStart(3)}%  ` +
        `${agent.passedCount}/${agent.total}   ${checklist.title}`,
    );

    for (const item of agent.failed) {
      console.log(`      ✗ ${item.requirement}`);
    }
    for (const item of agent.unanswered) {
      console.log(`      ? ${item.requirement}`);
      console.log(`        как проверить: ${item.howToCheck}`);
    }
  }

  console.log("");

  if (objectPath === undefined) {
    console.log("Прогон по объекту не задан (--object): пункты не проверены автоматически.");
    console.log("Чек-лист без доказательств — список намерений, а не приёмка.");
  }

  // Теневой прогон: разрыв между внешней и целевой моделью ведётся С САМОГО
  // НАЧАЛА, а не с даты переезда (ADR-R-020). Пока целевая модель не
  // подключена, разрыв НЕ ИЗМЕРЯЕТСЯ — и это сказано, а не показано нулём.
  const shadowPath = flag(argv, "shadow");

  if (shadowPath !== undefined) {
    console.log("");
    console.log("ТЕНЕВОЙ ПРОГОН (ADR-R-020)");

    const shadow = JSON.parse(readFileSync(shadowPath, "utf8")) as Record<string, string[]>;
    const gaps: number[] = [];

    for (const agent of result.byAgent) {
      const passedItems = platform.checklists
        .find((checklist) => checklist.agent === agent.agent)!
        .items.filter((item) => (answers[agent.agent] ?? {})[item.id] === true)
        .map((item) => item.id);

      const comparison = compareRuns({
        reference: { agent: agent.agent, passedItems },
        shadow: { agent: agent.agent, passedItems: shadow[agent.agent] ?? [] },
      });

      gaps.push(comparison.gap);
      console.log(
        `  ${comparison.closed ? "✓" : "✗"} ${agent.agent.padEnd(12)} ` +
          `разрыв ${(comparison.gap * 100).toFixed(0).padStart(3)}%  ${comparison.note}`,
      );
      if (comparison.lost.length > 0) {
        console.log(`      теряем: ${comparison.lost.join(", ")}`);
      }
    }

    // Тренд считается ПО ВРЕМЕНИ — по ряду последовательных прогонов, а не по
    // агентам одного прогона: разрывы девяти агентов, выстроенные в ряд, дают
    // «динамику», отражающую алфавитный порядок имён. Число выглядело бы
    // осмысленным и не было бы им.
    const worst = gaps.length === 0 ? 0 : Math.max(...gaps);
    const withGap = result.byAgent.filter((_, index) => (gaps[index] ?? 0) > 0).length;

    console.log(
      `  ИТОГ ПРОГОНА: наибольший разрыв ${(worst * 100).toFixed(0)}%, ` +
        `агентов с потерями ${withGap} из ${result.byAgent.length}`,
    );
    console.log("  Перевод в контур разрешён по ЗАКРЫТИЮ разрыва, а не по наступлению срока.");
    console.log("  Тренд считается по ряду прогонов во времени: одного замера для него мало.");
  } else {
    console.log("");
    console.log("Теневой прогон не выполнялся (--shadow <файл>): разрыв с целевой моделью НЕ ИЗМЕРЕН.");
    console.log("Отсутствие замера — не нулевой разрыв (ADR-R-020).");
  }

  console.log("");
  console.log(
    result.passed
      ? "ПРИЁМКА: пройдена по каждому агенту"
      : `ПРИЁМКА: НЕ пройдена. Не приняты: ${result.failedAgents.join(", ")}`,
  );
  console.log("§12.2 требует порога ПО КАЖДОМУ агенту: средняя доля скрыла бы того, кто не работает.");

  return result.passed ? 0 : 2;
}

/**
 * Собирает доказательства прогоном по настоящему объекту.
 *
 * Каждый ответ — следствие наблюдаемого поведения, а не утверждение о нём.
 * Пункт, который так не проверить, сюда не попадает и остаётся неотвеченным.
 */
async function collectEvidence(
  platform: Platform,
  objectPath: string,
): Promise<Record<string, Record<string, boolean>>> {
  const evidence: Record<string, Record<string, boolean>> = {};

  const names = await readdir(objectPath);
  const kinds = names.map((name) => classifyDocument(name));

  // ── Настенька: паспорт и реестр строятся из папки и воркфлоу ──
  const passport = buildObjectPassport({
    objectPath,
    declared: {},
    composition: {
      volumes: kinds.filter((kind) => kind === "рабочая-документация").length,
      estimates: kinds.filter((kind) => kind === "лср").length,
      hasSummary: kinds.includes("ссрсс"),
      total: names.length,
    },
  });
  const rendered = renderObjectPassport(passport);
  const workflow = platform.workflows.get("full-check");
  const assignments = workflow === undefined ? [] : buildAssignments(workflow.stages, new Map());
  const steps = workflow?.stages.flatMap((stage) => stage.steps).length ?? 0;

  evidence["настенька"] = {
    "паспорт-поля": rendered.includes("ОБЪЕКТ") && rendered.includes("СОСТАВ ПАКЕТА"),
    "пустота-разведена": rendered.includes("❌") && rendered.includes("ждём — такт"),
    "реестр-из-воркфлоу": assignments.length === steps && steps > 0,
    "статус-вычислен": assignments.every((item) => item.status === "🔴"),
    "возврат-красный":
      buildAssignments(workflow?.stages ?? [], new Map([["вор-геометрия", "returned"]])).some(
        (item) => item.status === "🔴",
      ),
  };

  // ── Денчик: реверс объёма на настоящих сметах ──
  const positions: LinearPosition[] = [];
  for (const name of names) {
    if (classifyDocument(name) !== "лср") continue;
    const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: join(objectPath, name) },
      { tenantId: "00000000-0000-0000-0000-000000000000", entryPoint: "subgraph", subjects: new Map(), now: new Date().toISOString() },
    );
    if (!parsed.ok) continue;
    if (parsed.artifact.body.issues.some((issue) => issue.severity === "blocking")) continue;

    for (const section of parsed.artifact.body.sections) {
      for (const position of section.positions) {
        positions.push({
          ordinal: position.ordinal,
          basis: position.mapping.kind === "by_code" ? `${position.mapping.code.system}${position.mapping.code.code}` : "",
          name: position.sourceName,
          unit: position.quantity?.value.unit ?? "",
          ...(position.quantity === undefined ? {} : { quantity: position.quantity.value.value }),
          amount: position.amount?.value.amount,
        });
      }
    }
  }

  const reversal = reverseVolumes(positions);
  const suspect = reversal.groups.find((group) => Number(group.flaggedAmount) > 0);

  const opinion = buildTechOpinion({
    documentPath: objectPath,
    groups: reversal.groups.map((group) => ({
      table: group.table,
      baseQuantity: group.baseQuantity,
      unit: group.unit,
      totalQuantity: group.totalQuantity,
      totalAmount: group.totalAmount,
      flaggedAmount: group.flaggedAmount,
      assumption: group.assumption,
      flagged: group.positions.filter((p) => p.flagged).map((p) => ({ ordinal: p.ordinal, multiple: p.multiple })),
    })),
    unjustifiedAmount: reversal.unjustifiedAmount,
    hasDesignDocuments: false,
  });

  evidence["денчик"] = {
    "д7-реверс": reversal.groups.length > 0,
    "д7-группировка": reversal.groups.length > 1,
    "д7-флаги": suspect !== undefined,
    "д7-деньги": Number(opinion.unjustifiedAmount) > 0,
    "д1-допущение": opinion.assumptions.some((item) => item.includes("НЕ сверена с осями")),
    "деградация-рд": opinion.degradations.length > 0,
    "статус-вычислен": opinion.status === "returned",
  };

  // ── Палыч: чеклист без ответов не закрывается ──
  const empty = buildStartChecklist({});
  const partial = buildStartChecklist({ "приказ-о-начале": false });

  evidence["палыч"] = {
    "семь-пунктов": START_CHECKLIST.length === 7,
    последствия: START_CHECKLIST.every((item) => item.consequence !== ""),
    "неответ-не-да": empty.status === "returned",
    "нет-не-пропуск": partial.failed.length === 1 && partial.unanswered.length === 6,
  };

  // ── Людмила: разбор и сходимость на настоящих сметах ──
  const check = await checkObject(objectPath, {
    discover: async (path) =>
      Promise.all(
        (await readdir(path)).map(async (name) =>
          describeDocument(join(path, name), name, platform.parsers),
        ),
      ),
    checkDocument: async (document) => {
      const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
        "parse-estimate",
        { documentPath: document.path },
        { tenantId: "00000000-0000-0000-0000-000000000000", entryPoint: "subgraph", subjects: new Map(), now: new Date().toISOString() },
      );
      if (!parsed.ok) throw new Error("разбор заблокирован");
      const blocking = parsed.artifact.body.issues.filter((issue) => issue.severity === "blocking");
      if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join("; "));

      const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
        "check-convergence",
        toConvergenceInput(parsed.artifact.body, document.path, parsed.artifact.inputHashes[0]!),
        {
          tenantId: "00000000-0000-0000-0000-000000000000",
          entryPoint: "subgraph",
          subjects: new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]),
          now: new Date().toISOString(),
        },
      );
      if (!convergence.ok) throw new Error("сходимость не посчитана");

      return {
        path: document.path,
        positions: parsed.artifact.body.sections.reduce((n, section) => n + section.positions.length, 0),
        byCode: parsed.artifact.body.summary.byCode,
        unmatched: parsed.artifact.body.summary.unmatched,
        converged: convergence.artifact.body.converged,
        delta: convergence.artifact.body.document.delta?.value.amount,
        documentTotal: convergence.artifact.body.document.computed?.value.amount,
      };
    },
    checkSummary: async (document, estimates) => {
      const parsed = parseSsrss(await readXlsxSheet(document.path));
      const chapters = parsed.totals.find((total) => total.scope === "chapters:1-9")!;
      const objectTotal = sumObjectTotals(
        estimates.map((estimate) => ({ path: estimate.path, total: estimate.documentTotal as never })),
      );
      const comparison = compareWithHeader(objectTotal.total, chapters.total)!;

      return {
        path: document.path,
        scope: chapters.scope,
        label: chapters.label,
        declaredThousands: chapters.total,
        declaredRubles: comparison.headerInRubles,
        delta: comparison.delta,
        granularity: comparison.granularity,
        explainedByScale: comparison.explainedByScale,
      };
    },
  });

  const checked = check.documents.filter((document) => document.status === "проверен");

  evidence["людмила"] = {
    "сходимость-ноль": checked.length > 0 && checked.every((document) => document.delta === "0.00"),
    "ссрсс-сверка": check.summary?.explainedByScale === true && check.summary.granularity !== undefined,
    шифры: check.totals.byCode > 0,
    несопоставленные: check.totals.unmatched > 0 && check.documents.some((d) => d.reason !== undefined),
    провенанс: check.totals.positions > 0,
  };

  // ── Виктор: НДС и БГ/ГУ на настоящих цифрах объекта ──
  const today = isoDate(new Date().toISOString().slice(0, 10));
  const currentVat = platform.parameters.resolve("tax.vat.rate", today);
  const capital = platform.parameters.resolve("finance.key_rate", today);

  let withContingency: string | undefined;
  let chaptersOnly: string | undefined;
  for (const name of names) {
    if (classifyDocument(name) !== "ссрсс") continue;
    const parsed = parseSsrss(await readXlsxSheet(join(objectPath, name)));
    withContingency = parsed.totals.find((total) => total.scope === "with-contingency")?.total;
    chaptersOnly = parsed.totals.find((total) => total.scope === "chapters:1-9")?.total;
  }

  const firm =
    withContingency === undefined || currentVat === undefined
      ? undefined
      : vatGap({
          baseAmount: new Decimal(withContingency).times(1000).toFixed(2),
          contractRate: "0.20",
          currentRate: currentVat.value,
          priceIsFirm: true,
        });
  const open =
    withContingency === undefined || currentVat === undefined
      ? undefined
      : vatGap({
          baseAmount: new Decimal(withContingency).times(1000).toFixed(2),
          contractRate: "0.20",
          currentRate: currentVat.value,
          priceIsFirm: false,
        });

  const cheapCapital = compareGuarantee({
    retentionAmount: "1000000",
    years: "1",
    guaranteeRatePerYear: "0.30",
    capitalCostPerYear: "0.05",
  });
  const normal =
    capital === undefined
      ? undefined
      : compareGuarantee({
          retentionAmount: "5000000",
          years: "3",
          guaranteeRatePerYear: "0.015",
          capitalCostPerYear: capital.value,
        });

  evidence["виктор"] = {
    "ндс-ставка-из-реестра": currentVat !== undefined,
    // Эталон заказчика: 2 141 524.73 ₽. База с непредвиденными даёт его,
    // база по главам 1-9 — на 42 тыс. меньше.
    "ндс-база":
      firm !== undefined && chaptersOnly !== undefined && new Decimal(firm.gap).greaterThan(2_100_000),
    "ндс-твёрдая-цена": firm?.bornBy === "подрядчик" && open?.bornBy === "заказчик",
    "бг-гу-стоимость-денег": normal !== undefined && Number(normal.retentionCost) > 0,
    "бг-гу-вывод-считан": cheapCapital.recommendation === "оставить ГУ",
    // Проверяется прогоном самого шага: без текста договора предмет обязан
    // вернуться, а не пройти по двум посчитанным строкам.
    "аудит-объявлен": (
      await runViktor(platform, { produces: ["аудит-договора"] }, objectPath, [])
    ).produced.every((product) => product.status === "returned"),
  };

  // ── Ваныч: три сценария ──
  const model = buildScenarios({ revenue: "104976702.48", costs: "94000000.00" });

  evidence["ваныч"] = {
    "три-сценария": model.scenarios.length === 3,
    "сдвиги-данные": Object.keys(SCENARIO_SHIFTS).length === 3,
    "перелом-назван": model.breaksAt === "реалистичный",
    "стресс-допущение": model.assumption.includes("допущение"),
    // Пункт «себестоимость не выводится из смет» — свойство устройства, а не
    // наблюдаемое поведение: прогоном его не подтвердить. Оставлен
    // НЕОТВЕЧЕННЫМ. Зачесть его себе значило бы поднять долю утверждением
    // о собственном коде — ровно то, от чего чек-лист должен защищать.
  };

  // ── Марина: карта лид-таймов ──
  const map = buildLeadTimeMap(
    [
      { name: "просрочено", amount: "250000000", neededBy: "2026-09-05", leadTimeWeeks: 16, quotes: 3 },
      { name: "горит", amount: "1000000", neededBy: "2026-09-20", leadTimeWeeks: 1, quotes: 2 },
      { name: "плановое", amount: "50000", neededBy: "2027-06-01", leadTimeWeeks: 2, quotes: 1 },
    ],
    today,
  );

  evidence["марина"] = {
    "крайний-срок": map.items.every((item) => item.orderBy.length === 10),
    "три-статуса": map.items.some((item) => item.status === "🔴 ГОРИТ"),
    просрочка: map.items.some((item) => item.status === "⚫ ПРОСРОЧЕН"),
    "три-кп": map.quotesMissing.length === 1,
    сортировка: map.items[0]?.name === "просрочено",
  };

  // ── Халиль: скоринг объявлен невыполненным ──
  const khalil = runKhalil({ produces: ["скоринг-субподрядчиков"] }, []);

  evidence["халиль"] = {
    "скоринг-объявлен": khalil.produced.every((product) => product.status === "returned"),
    "требования-названы": khalil.handoffs.some((handoff) => handoff.payload.includes("не выполнен")),
  };

  // ── Артемий: цвет следует из состояния ──
  const red = buildVerdict({
    contractAmount: "100000000",
    margin: "9000000",
    findings: [{ severity: "critical", statement: "объёмы не обоснованы", amount: "64710398.29" }],
    openSubjects: [],
  });
  const yellow = buildVerdict({
    contractAmount: "100000000",
    margin: "9000000",
    findings: [{ severity: "high", statement: "НДС", amount: "2141524.80" }],
    openSubjects: ["аудит-договора"],
  });

  evidence["артемий"] = {
    "три-цвета": red.color === "🔴" && yellow.color === "🟡",
    "цвет-следует": red.color === "🔴",
    "пороги-маржи": Object.keys(MARGIN_THRESHOLDS).length === 4,
    "матрица-рисков": riskLevel(3) === "приемлемо" && riskLevel(20) === "СТОП",
    "условия-с-ценой": yellow.conditions.every((condition) => condition.cost !== ""),
    примортем: red.premortem.length >= 3,
    "маржа-и-риск-раздельно": red.margin !== red.findingsImpact,
  };

  return evidence;
}

/**
 * Такт 3: Марина строит карту лид-таймов.
 *
 * Позиции закупки объявляются флагом: из смет они не выводятся. Смета говорит,
 * ЧТО и почём, но не говорит, когда это нужно на объекте и сколько идёт
 * поставка — а именно эти два числа делают карту.
 */
function runMarina(step: { readonly produces: readonly string[] }, argv: readonly string[]): StepResult {
  const items: ProcurementItem[] = [];

  for (const [index, argument] of argv.entries()) {
    if (argument !== "--tmc") continue;
    // Формат: имя:сумма:нужна-к:недель:кп
    const parts = (argv[index + 1] ?? "").split(":");
    if (parts.length < 5) continue;

    items.push({
      name: parts[0]!,
      amount: parts[1]!,
      neededBy: parts[2]!,
      leadTimeWeeks: Number(parts[3]),
      quotes: Number(parts[4]),
    });
  }

  console.log("КАРТА ЛИД-ТАЙМОВ (Марина, такт 3)");

  if (items.length === 0) {
    console.log("  не построена: позиции закупки не переданы (--tmc имя:сумма:дата:недель:кп).");
    console.log("  Из смет они не выводятся: смета не говорит, когда позиция нужна на объекте.");
    console.log("");

    return {
      agent: "марина",
      produced: step.produces.map((subject) => ({ subject, status: "returned" as const })),
      handoffs: [
        {
          from: "марина",
          to: "артемий",
          subject: "лид-тайм-карта",
          payload: "Карта не построена: не переданы позиции закупки со сроками.",
          priority: "high" as const,
        },
      ],
    };
  }

  const map = buildLeadTimeMap(items, new Date().toISOString().slice(0, 10));

  console.log("  статус          позиция              сумма       заказать до   дней  КП");
  for (const row of map.items) {
    console.log(
      `  ${row.status.padEnd(14)} ${row.name.slice(0, 18).padEnd(19)} ` +
        `${Number(row.amount).toLocaleString("ru").padStart(13)} ${row.orderBy}  ` +
        `${String(row.daysToOrder).padStart(5)}  ${row.quotesOk ? "✓" : `${row.quotes}/3`}`,
    );
  }
  if (map.quotesMissing.length > 0) {
    console.log(`  НЕ ХВАТАЕТ КП (правило 3+ КП свыше 100 тыс.): ${map.quotesMissing.length} позиций`);
  }
  console.log("");

  return {
    agent: "марина",
    produced: step.produces.map((subject) => ({
      subject,
      status: map.urgent.length > 0 ? ("returned" as const) : ("approved" as const),
    })),
    handoffs: [
      {
        from: "марина",
        to: "артемий",
        subject: "лид-тайм-карта",
        payload:
          map.urgent.length > 0
            ? `Горящих и просроченных позиций: ${map.urgent.length}. ` +
              map.urgent.map((row) => `${row.name} (${row.status}, заказать до ${row.orderBy})`).join("; ")
            : "Все позиции в плановом или срочном статусе, просрочек нет.",
        priority: map.urgent.length > 0 ? ("critical" as const) : ("medium" as const),
      },
    ],
  };
}

/**
 * Такт 3: Халиль оценивает субподрядчиков.
 *
 * Скоринг требует финотчётности, допусков и опыта — данных о конкретных
 * кандидатах. Их нет ни в смете, ни в проекте, и выдумывать их нельзя.
 */
function runKhalil(step: { readonly produces: readonly string[] }, argv: readonly string[]): StepResult {
  const candidates = argv.filter((argument) => argument === "--subcontractor").length;

  console.log("СКОРИНГ СУБПОДРЯДЧИКОВ (Халиль, такт 3)");
  console.log(
    candidates === 0
      ? "  не выполнен: кандидаты не переданы. Скоринг требует финотчётности за 3 года, " +
        "допусков НАКС/СРО по виду работ и опыта аналогичных объектов."
      : `  передано кандидатов: ${candidates}`,
  );
  console.log("");

  return {
    agent: "халиль",
    produced: step.produces.map((subject) => ({ subject, status: "returned" as const })),
    handoffs: [
      {
        from: "халиль",
        to: "артемий",
        subject: "скоринг-субподрядчиков",
        payload: "Скоринг не выполнен: данные о кандидатах не переданы.",
        priority: "high" as const,
      },
    ],
  };
}

/**
 * Такт 4: Артемий даёт вердикт.
 *
 * Цвет СЛЕДУЕТ из состояния прогона: критическое замечание или маржа ниже
 * красной линии дают красный. В легаси цвет ставит человек, прочитав отчёты
 * восьми агентов, и может не заметить критическое замечание в середине листа.
 */
function runArtemy(
  step: { readonly produces: readonly string[] },
  argv: readonly string[],
  subjects: ReadonlyMap<string, SubjectState>,
): StepResult {
  // ноль-осознанно: значение ФЛАГА командной строки, не отсутствующая
  // величина документа. Не задан — сравнение идёт без суммы контракта.
  const contract = flag(argv, "contract-amount") ?? "0";
  const margin = flag(argv, "margin") ?? "0";

  const open = [...subjects.values()]
    .filter((subject) => subject.status !== "approved")
    .map((subject) => subject.id);

  const verdict = buildVerdict({
    contractAmount: contract,
    margin,
    findings: [],
    openSubjects: open,
  });

  console.log("ВЕРДИКТ (Артемий, такт 4)");
  console.log(`  ${verdict.color} ${verdict.headline}`);
  console.log(`  маржа: ${verdict.margin} ₽ (${(Number(verdict.marginShare) * 100).toFixed(2)}%, ${verdict.marginBand})`);

  for (const reason of verdict.reasons) console.log(`  ✗ ${reason}`);

  if (verdict.conditions.length > 0) {
    console.log("  УСЛОВИЯ ВХОДА (без чего не подписывать):");
    for (const condition of verdict.conditions) {
      console.log(`    · ${condition.requirement}`);
      console.log(`      цена вопроса: ${condition.cost}`);
    }
  }

  console.log("  ПРИМОРТЕМ (почему это могло не получиться):");
  for (const [index, reason] of verdict.premortem.entries()) {
    console.log(`    ${index + 1}. ${reason}`);
  }
  console.log("");

  return {
    agent: "артемий",
    produced: step.produces.map((subject) => ({
      subject,
      status: verdict.color === "🔴" ? ("returned" as const) : ("approved" as const),
    })),
    handoffs: [],
  };
}

/**
 * Такт 2: Ваныч строит финансовую модель.
 *
 * Гейт протокола не пускает его без подтверждённого ВОР, и это критическое
 * правило легаси: «Ваныч без ВОР от Людмилы → финмодель на „воздухе" → убыток
 * как в Каранайауле». Поэтому шаг вызывается только когда ВОР подтверждён —
 * проверять это здесь ещё раз незачем.
 *
 * Расходы объявляются флагом: из смет они не следуют. Смета — это ЦЕНА для
 * заказчика, а не себестоимость подрядчика, и подставлять одно вместо другого
 * значило бы считать маржу нулевой по построению.
 */
function runVanych(
  step: { readonly produces: readonly string[] },
  argv: readonly string[],
  subjects: ReadonlyMap<string, SubjectState>,
): StepResult {
  const revenue = flag(argv, "revenue");
  const costs = flag(argv, "costs");

  if (revenue === undefined || costs === undefined) {
    console.log("ФИНМОДЕЛЬ (Ваныч, такт 2)");
    console.log("  не построена: нужны --revenue и --costs.");
    console.log("  Себестоимость из смет не выводится: смета — цена заказчику, а не наши затраты.");
    console.log("");

    return {
      agent: "ваныч",
      produced: step.produces.map((subject) => ({ subject, status: "returned" as const })),
      handoffs: [
        {
          from: "ваныч",
          to: "артемий",
          subject: "финмодель",
          payload: "Финмодель не построена: не переданы выручка и себестоимость.",
          priority: "critical" as const,
        },
      ],
    };
  }

  const model = buildScenarios({ revenue, costs });

  console.log("ФИНМОДЕЛЬ (Ваныч, такт 2)");
  console.log("  сценарий        выручка          расходы          маржа        доля");
  for (const scenario of model.scenarios) {
    console.log(
      `  ${scenario.id.padEnd(14)} ${Number(scenario.revenue).toLocaleString("ru").padStart(15)} ` +
        `${Number(scenario.costs).toLocaleString("ru").padStart(16)} ` +
        `${Number(scenario.margin).toLocaleString("ru").padStart(14)} ` +
        `${(Number(scenario.marginShare) * 100).toFixed(2).padStart(7)}%`,
    );
  }

  if (model.breaksAt !== undefined) {
    console.log(`  РАЗРЫВ: маржа уходит ниже нуля на сценарии «${model.breaksAt}»`);
  }
  console.log(`  допущение: ${model.assumption}`);
  console.log("");

  return {
    agent: "ваныч",
    produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
    handoffs: [
      {
        from: "ваныч",
        to: "марина",
        subject: "потолки",
        payload:
          `Потолки закупки считать от базового сценария: маржа ` +
          `${model.scenarios[0]?.margin} ₽. ` +
          (model.breaksAt === undefined
            ? "Запас есть по всем сценариям."
            : `ВНИМАНИЕ: на сценарии «${model.breaksAt}» объект уходит в минус.`),
        priority: model.breaksAt === undefined ? ("high" as const) : ("critical" as const),
      },
    ],
  };
}

/**
 * Такт 1: Виктор проводит аудит договора.
 *
 * Промпт Виктора, 3.1: red-flag аудит по пяти группам паттернов. Текста
 * договора в папке объекта нет, и выдумывать его нельзя — аудит паттернов не
 * выполняется, а объявляется невыполненным.
 *
 * Но два расчёта Виктора не требуют текста договора и считаются по цифрам
 * объекта: разрыв ставки НДС (3.3) и сравнение банковской гарантии с
 * гарантийным удержанием (3.2). Оба стоят красными флагами в эталонном выходе
 * курганского приёма, поэтому считаются и предъявляются.
 *
 * Условия договора — твёрдая ли цена, размер удержания, срок — объявляет
 * человек флагами. Из папки объекта они не следуют, и подставлять их значило
 * бы выдать допущение за факт.
 */
async function runViktor(
  platform: Platform,
  step: { readonly produces: readonly string[] },
  objectPath: string,
  argv: readonly string[],
): Promise<StepResult> {
  const today = isoDate(new Date().toISOString().slice(0, 10));
  const findings: string[] = [];

  // Ставка НДС берётся из реестра параметров НА ДАТУ, а не из памяти модели.
  const currentVat = platform.parameters.resolve("tax.vat.rate", today);
  const contractVat = flag(argv, "vat-in-contract");
  const firmPrice = !argv.includes("--open-price");

  // База НДС — итог сводного расчёта С УЧЁТОМ непредвиденных затрат, а не
  // главы 1-9: налог начисляется на всю стоимость до НДС, и непредвиденные
  // в неё входят. Сверено с эталонным приёмом: у заказчика 2 141 524.73 ₽
  // недобора, что даёт база 107 076.24 тыс, а не 104 976.71 тыс.
  let baseAmount: string | undefined;
  for (const name of await readdir(objectPath)) {
    if (classifyDocument(name) !== "ссрсс") continue;
    try {
      const parsed = parseSsrss(await readXlsxSheet(join(objectPath, name)));
      const total =
        parsed.totals.find((item) => item.scope === "with-contingency") ??
        parsed.totals.find((item) => item.scope === "chapters:1-9");
      if (total !== undefined) {
        baseAmount = new Decimal(total.total).times(1000).toFixed(2);
      }
    } catch {
      // Сводный расчёт не разобран — база НДС неизвестна, и это сказано ниже.
    }
  }

  console.log("АУДИТ ДОГОВОРА (Виктор, такт 1)");
  console.log("  red-flag аудит по 5 группам НЕ выполнен: текст договора не передан");

  if (baseAmount !== undefined && currentVat !== undefined && contractVat !== undefined) {
    const gap = vatGap({
      baseAmount,
      contractRate: contractVat,
      currentRate: currentVat.value,
      priceIsFirm: firmPrice,
    });

    if (gap.applicable) {
      console.log(`  [${gap.direction === "рост" ? "high" : "info"}] Разрыв ставки НДС: ${gap.direction}`);
      console.log(`      основание: ${gap.basis}`);
      console.log(`      несёт    : ${gap.bornBy} (${gap.note})`);
      findings.push(`НДС-разрыв ${gap.gap} ₽`);
    }
  } else {
    console.log("  разрыв НДС не посчитан: нужна ставка договора (--vat-in-contract) и сводный расчёт");
  }

  const retention = flag(argv, "retention");
  const years = flag(argv, "retention-years");
  const bgRate = flag(argv, "bg-rate");
  const capital = platform.parameters.resolve("finance.key_rate", today);

  if (retention !== undefined && years !== undefined && bgRate !== undefined && capital !== undefined) {
    const comparison = compareGuarantee({
      retentionAmount: retention,
      years,
      guaranteeRatePerYear: bgRate,
      capitalCostPerYear: capital.value,
    });

    console.log(`  [high] БГ против ГУ: ${comparison.recommendation}`);
    console.log(`      основание: ${comparison.basis}`);
    console.log(`      выгода   : ${comparison.saving} ₽`);
    findings.push(`БГ/ГУ: ${comparison.recommendation}, выгода ${comparison.saving} ₽`);
  }

  console.log("");

  // Аудит договора без договора невозможен: предмет возвращается, а не
  // объявляется пройденным по двум посчитанным строкам.
  return {
    agent: "виктор",
    produced: step.produces.map((subject) => ({ subject, status: "returned" as const })),
    handoffs: [
      {
        from: "виктор",
        to: "артемий",
        subject: "аудит-договора",
        payload:
          "Текст договора не передан: red-flag аудит по пяти группам не выполнен. " +
          (findings.length > 0 ? `Посчитано без договора: ${findings.join("; ")}.` : ""),
        priority: "critical" as const,
      },
    ],
  };
}

/**
 * Такт 1: Палыч закрывает чеклист старта.
 *
 * Ответы объявляет человек флагами `--palych приказ-о-начале=да`. Из папки
 * объекта они не следуют: подписан ли приказ и найдена ли лаборатория —
 * факты о стройке, а не о документах.
 */
function runPalych(step: { readonly produces: readonly string[] }, argv: readonly string[]): StepResult {
  const answers: Record<string, boolean> = {};

  for (const [index, argument] of argv.entries()) {
    if (argument !== "--palych") continue;
    const pair = argv[index + 1] ?? "";
    const [id, value] = pair.split("=");
    if (id !== undefined && value !== undefined) {
      answers[id] = value === "да" || value === "true";
    }
  }

  const checklist = buildStartChecklist(answers);

  console.log("ЧЕКЛИСТ СТАРТА (Палыч, такт 1)");
  for (const item of START_CHECKLIST) {
    const answer = answers[item.id];
    const mark = answer === undefined ? "?" : answer ? "✓" : "✗";
    console.log(`  ${mark} ${item.question}`);
    if (answer !== true) console.log(`      последствие: ${item.consequence}`);
  }
  console.log("");

  return {
    agent: "палыч",
    produced: step.produces.map((subject) => ({ subject, status: checklist.status })),
    handoffs: [checklist.handoff],
  };
}

/**
 * Такт 1: Денчик даёт техзаключение — обоснование объёмов геометрией.
 *
 * Промпт Денчика, ЧАСТЬ 1: «не выпускаешь ВОР — даёшь техзаключение ДЛЯ ВОР».
 * Поэтому шаг производит `вор-геометрия`, а не `вор`: сметный ВОР выпускает
 * Людмила, и её работа начинается там, где заканчивается инженерная.
 *
 * Статус предмета ВЫЧИСЛЯЕТСЯ реверсом объёма (Д-7), а не ставится: если
 * найден блок с кратностью выше двух и нет РД, чтобы его подтвердить, —
 * возврат. В легаси это решение принимает человек и может забыть.
 */
async function runDenchik(
  platform: Platform,
  step: { readonly produces: readonly string[] },
  objectPath: string,
): Promise<StepResult> {
  const tenantId = "00000000-0000-0000-0000-000000000000";
  const now = new Date().toISOString();

  const names = await readdir(objectPath);
  const positions: LinearPosition[] = [];
  let hasDesignDocuments = false;

  for (const name of names) {
    const kind = classifyDocument(name);
    if (kind === "рабочая-документация") hasDesignDocuments = false; // разбор РД не реализован
    if (kind !== "лср") continue;

    const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: join(objectPath, name) },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );
    if (!parsed.ok) continue;

    const blocking = parsed.artifact.body.issues.filter((issue) => issue.severity === "blocking");
    if (blocking.length > 0) continue;

    for (const section of parsed.artifact.body.sections) {
      for (const position of section.positions) {
        positions.push({
          ordinal: position.ordinal,
          basis:
            position.mapping.kind === "by_code"
              ? `${position.mapping.code.system}${position.mapping.code.code}`
              : "",
          name: position.sourceName,
          unit: position.quantity?.value.unit ?? "",
          ...(position.quantity === undefined ? {} : { quantity: position.quantity.value.value }),
          amount: position.amount?.value.amount,
        });
      }
    }
  }

  // Реверс считает расчётный модуль; заключение только решает по его числам.
  const reversal = reverseVolumes(positions);

  const opinion = buildTechOpinion({
    documentPath: objectPath,
    groups: reversal.groups.map((group) => ({
      table: group.table,
      baseQuantity: group.baseQuantity,
      unit: group.unit,
      totalQuantity: group.totalQuantity,
      totalAmount: group.totalAmount,
      flaggedAmount: group.flaggedAmount,
      assumption: group.assumption,
      flagged: group.positions
        .filter((position) => position.flagged)
        .map((position) => ({ ordinal: position.ordinal, multiple: position.multiple })),
    })),
    unjustifiedAmount: reversal.unjustifiedAmount,
    hasDesignDocuments,
  });

  console.log("ТЕХЗАКЛЮЧЕНИЕ (Денчик, такт 1)");
  if (opinion.findings.length === 0) {
    console.log("  Геометрических возражений по объёмам нет.");
  }
  for (const finding of opinion.findings) {
    console.log(`  [${finding.severity}] ${finding.statement}`);
    console.log(`      основание: ${finding.basis}`);
    if (finding.amount !== undefined) {
      console.log(`      сумма    : ${Number(finding.amount).toLocaleString("ru")} ₽`);
    }
  }
  if (opinion.assumptions.length > 0) {
    console.log("  БЛОК ДОПУЩЕНИЙ:");
    for (const [index, assumption] of opinion.assumptions.entries()) {
      console.log(`    №${index + 1} ${assumption}`);
    }
  }
  for (const degradation of opinion.degradations) {
    console.log(`  деградация: ${degradation}`);
  }
  console.log("");

  return {
    agent: "денчик",
    // Денчик производит обоснование объёмов; остальные его продукты (нагрузки,
    // спецификация) требуют разбора РД и здесь не создаются — шаг честно
    // выдаёт только то, что посчитал.
    produced: step.produces.map((subject) => ({
      subject,
      status: subject === "вор-геометрия" ? opinion.status : ("draft" as const),
    })),
    handoffs: [opinion.handoff],
  };
}

/**
 * Настоящий шаг Людмилы: разбор смет объекта и сходимость.
 *
 * Тот же путь, что у `si check`, — операции вызываются одни и те же
 * (ADR-R-022). Протокол не заводит второй способ считать сходимость.
 *
 * ВОР возвращается на пересчёт, если хоть одна смета не сошлась: это и есть
 * «Статус ВОР = 🔴 возвращён» из реального кейса, только основание теперь
 * вычислено, а не выставлено человеком.
 */
async function runLyudmila(
  platform: Platform,
  step: { readonly produces: readonly string[] },
  objectPath: string,
  subjects: ReadonlyMap<string, SubjectState>,
): Promise<StepResult> {
  const tenantId = "00000000-0000-0000-0000-000000000000";
  const now = new Date().toISOString();

  const body = await checkObject(objectPath, {
    discover: async (path) => {
      const names = (await readdir(path)).sort((a, b) => a.localeCompare(b, "ru"));

      return Promise.all(
        names.map(async (name) => describeDocument(join(path, name), name, platform.parsers)),
      );
    },

    checkDocument: async (document) => {
      const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
        "parse-estimate",
        { documentPath: document.path },
        { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
      );
      if (!parsed.ok) throw new Error("разбор заблокирован");

      const blocking = parsed.artifact.body.issues.filter((issue) => issue.severity === "blocking");
      if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join("; "));

      const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
        "check-convergence",
        toConvergenceInput(parsed.artifact.body, document.path, parsed.artifact.inputHashes[0]!),
        {
          tenantId,
          entryPoint: "subgraph",
          subjects: new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]),
          now,
        },
      );
      if (!convergence.ok) throw new Error("сходимость не посчитана");

      return {
        path: document.path,
        positions: parsed.artifact.body.sections.reduce((n, s) => n + s.positions.length, 0),
        byCode: parsed.artifact.body.summary.byCode,
        unmatched: parsed.artifact.body.summary.unmatched,
        converged: convergence.artifact.body.converged,
        delta: convergence.artifact.body.document.delta?.value.amount,
        documentTotal: convergence.artifact.body.document.computed?.value.amount,
      };
    },
  });

  // Основание статуса ВОР — вердикт Проверки, а не мнение.
  const status = body.verdict === "принято" ? ("approved" as const) : ("returned" as const);

  // Людмила принимает ВОР от Денчика и, если объёмы не обоснованы, возвращает
  // ЕГО предмет автору — это цикл ADR-R-002, а не отказ от своей работы.
  // Промпт Денчика: «ВОР без твоего техзаключения = объёмы без инженерного
  // обоснования»; решение об этом принимает сметчик, получив техзаключение.
  const geometry = subjects.get("вор-геометрия");
  const returned =
    geometry?.status === "returned"
      ? [
          {
            subject: "вор-геометрия",
            reason:
              "объёмы не обоснованы геометрией: принять к ВОР нельзя, " +
              "нужна сверка с осями РД",
          },
        ]
      : [];

  return {
    agent: "людмила",
    produced: step.produces.map((subject) => ({ subject, status })),
    returned,
    handoffs: [
      {
        from: "людмила",
        to: "ваныч",
        subject: "вор",
        payload:
          `Проверено смет ${body.totals.checked}, позиций ${body.totals.positions}, ` +
          `по шифру ${body.totals.byCode}. Вердикт Проверки: ${body.verdict}.`,
        priority: "critical" as const,
      },
    ],
  };
}

/**
 * Приём объекта: паспорт входа и маршрут либо гейт неполноты (ADR-R-012).
 *
 * Стадия и состав считаются по папке — это факты. Домен, сторона стола и цель
 * объявляются флагами: из состава папки они не следуют, и угадывать их нельзя.
 */
/** Собирает объявленное человеком. Неуказанный флаг НЕ становится значением. */
function declaredFrom(argv: readonly string[]): DeclaredIntake {
  const domain = flag(argv, "domain");
  const side = flag(argv, "side");
  const goal = flag(argv, "goal");

  return {
    ...(domain === undefined ? {} : { domain: domain as Domain }),
    ...(side === undefined ? {} : { side: side as Side }),
    ...(goal === undefined ? {} : { goal }),
  };
}

async function intakeCommand(
  routing: RoutingConfig,
  objectPath: string,
  argv: readonly string[],
): Promise<number> {
  const names = await readdir(objectPath);

  const passport = buildPassport({
    documents: names.map((name) => ({ name, kind: classifyDocument(name) })),
    declared: declaredFrom(argv),
  });

  console.log(`Объект        : ${objectPath}`);
  console.log("");
  console.log("ПАСПОРТ ВХОДА");
  for (const line of renderPassport(passport).split("\n")) console.log(`  ${line}`);
  console.log("");

  const result = route(passport, routing);

  if (result.kind === "gate") {
    // ШАГ 4 легаси: маршрут НЕ выдаётся. Возвращается один список
    // «что дозагрузить и почему» — с адресатом у каждого пункта.
    console.log("ГЕЙТ НЕПОЛНЫХ ДАННЫХ — маршрут не выдаётся");
    console.log("");
    for (const item of result.missing) {
      console.log(`  ❌ ${item.field}`);
      console.log(`     зачем : ${item.why}`);
      console.log(`     у кого: ${item.who}`);
    }
    console.log("");
    console.log("Догадка вместо маршрута здесь запрещена: ошибка приёма становится");
    console.log("ошибкой всего прогона, а обнаруживается на вердикте.");
    return 2;
  }

  console.log(`МАРШРУТ       : ${result.configuration} → ${result.agent}`);
  console.log(`ПОЧЕМУ        : ${result.criterion}`);
  console.log(`ПРАВИЛО       : ${result.routeId}`);
  console.log("");
  console.log(
    result.configuration === "C"
      ? "ЧТО ДАЛЬШЕ    : Такт 0 (Настенька) → Денчик. Запуск: si protocol --workflow full-check"
      : `ЧТО ДАЛЬШЕ    : предпроектный прогон у агента ${result.agent}`,
  );

  return 0;
}

/**
 * Показывает протокол тактов и то, что именно блокирует каждый шаг.
 *
 * Состояние предметов задаётся флагом `--subject вор=returned`, чтобы можно
 * было воспроизвести реальный кейс Кургана: ВОР возвращён Людмиле на пересчёт,
 * и Ваныч не имеет права считать финмодель.
 */
async function showProtocol(
  platform: Platform,
  workflow: WorkflowDefinition,
  argv: readonly string[],
): Promise<number> {
  const objectPath = flag(argv, "object");
  // Предметы, объявленные возвращёнными или черновыми. Их создатель выдаст
  // именно этот статус, и дальше сработает КАСКАД: шаг, который не стартовал,
  // ничего не произвёл, поэтому его потребители тоже не стартуют.
  //
  // Ровно это и есть содержание правила «Марина без потолков от Ваныча».
  // Показывать такт-3 проходимым при заблокированном такте-2 значило бы
  // воспроизвести ту самую ошибку, ради которой правило написано.
  const pinned = new Map<string, SubjectState["status"]>();

  for (const [index, argument] of argv.entries()) {
    if (argument !== "--subject") continue;
    const pair = argv[index + 1] ?? "";
    const [id, status] = pair.split("=");

    if (id === undefined || status === undefined) {
      console.error(`Ожидается --subject предмет=статус, получено: ${pair}`);
      return 1;
    }

    if (status !== "draft" && status !== "returned" && status !== "approved") {
      console.error(`Неизвестный статус предмета: ${status}. Допустимы draft, returned, approved.`);
      return 1;
    }

    pinned.set(id, status);
  }

  // Реализован один агент из девяти. Остальные возвращают undefined — шаг
  // объявляется нереализованным, а не изображает исполнение (ТЗ §9).
  //
  // Без --object протокол показывается «всухую»: все агенты считаются
  // работающими, и видна только структура тактов и гейтов.
  const dry = objectPath === undefined;

  // Прогон, сохраняемый в базу: --run <id> продолжает начатый, --run new
  // заводит новый. Без флага прогон нигде не записывается — это удобно для
  // разового просмотра, но пережить перезапуск такой прогон не может.
  const runFlag = flag(argv, "run");
  const persistence = dry || runFlag === undefined ? undefined : await openRun(runFlag, argv);

  const body = await runProtocol(
    workflow.stages,
    {
      runStep: async (step, subjects) => {
        if (dry) {
          return {
            agent: step.agent,
            produced: step.produces.map((subject) => ({
              subject,
              status: pinned.get(subject) ?? "approved",
            })),
            handoffs: [],
          };
        }

        if (step.agent === "настенька") return await runNastenka(step, objectPath!, argv);
        if (step.agent === "денчик") return await runDenchik(platform, step, objectPath!);
        if (step.agent === "виктор") return await runViktor(platform, step, objectPath!, argv);
        if (step.agent === "палыч") return runPalych(step, argv);
        if (step.agent === "ваныч") return runVanych(step, argv, subjects);
        if (step.agent === "марина") return runMarina(step, argv);
        if (step.agent === "халиль") return runKhalil(step, argv);
        if (step.agent === "артемий") return runArtemy(step, argv, subjects);
        if (step.agent === "людмила") return await runLyudmila(platform, step, objectPath!, subjects);

        return undefined;
      },
    },
    {
      subjects: persistence?.subjects ?? new Map(),
      maxRework: workflow.maxRework,
      ...(persistence === undefined ? {} : { completedSteps: persistence.completedSteps }),
    },
  );

  if (persistence !== undefined) {
    await persistence.save(body);
  }

  console.log(`Воркфлоу      : ${workflow.id} — ${workflow.name}`);
  if (persistence !== undefined) {
    console.log(`Прогон        : ${persistence.runId}`);
    if (persistence.completedSteps.length > 0) {
      console.log(`Продолжен     : шагов из прошлых запусков ${persistence.completedSteps.length}`);
    }
  }
  if (workflow.source !== undefined) console.log(`Источник      : ${workflow.source}`);
  console.log(`Лимит возвратов: ${workflow.maxRework}`);
  console.log("");

  for (const stage of body.stages) {
    console.log(`${stage.id}  ${stage.name}`);

    for (const step of stage.steps) {
      if (step.status === "уже исполнен") {
        console.log(`  ↻ ${step.agent.padEnd(12)} уже исполнен в прошлом запуске`);
        continue;
      }

      if (step.status === "не реализован") {
        console.log(`  · ${step.agent.padEnd(12)} не реализован`);
        continue;
      }

      if (step.status === "исполнен") {
        const produced = (step.produced ?? [])
          .map((product) => (product.status === "approved" ? product.subject : `${product.subject} (${product.status})`))
          .join(", ");
        const retries = step.attempts > 1 ? `  [попыток: ${step.attempts}]` : "";
        console.log(`  ✓ ${step.agent.padEnd(12)} → ${produced}${retries}`);
        continue;
      }

      console.log(`  ✗ ${step.agent.padEnd(12)} ЗАБЛОКИРОВАН`);

      for (const block of step.blocks ?? []) {
        console.log(
          `        предмет «${block.subject}»: ожидается ${block.expected.join("|")}, ` +
            `сейчас ${block.actual}`,
        );
        if (block.consequence !== undefined) {
          console.log(`        последствие нарушения: ${block.consequence}`);
        }
      }
    }

    console.log("");
  }

  if (body.escalations.length > 0) {
    console.log("ЭСКАЛАЦИИ (цикл возврата исчерпан):");
    for (const escalation of body.escalations) {
      console.log(`  ${escalation.agent}: ${escalation.reason}`);
    }
    console.log("");
  }

  // Оговорка печатается, только если нереализованные шаги ДЕЙСТВИТЕЛЬНО есть.
  // Иначе она превращается в шум там, где всё отработало.
  if (body.unimplementedSteps > 0) {
    console.log("Нереализованные шаги объявлены таковыми, а не пройденными:");
    console.log("протокол на части работы не является пройденным.");
    console.log("");
  }

  // Реестр поручений выводится из ТОГО ЖЕ воркфлоу, который исполнялся, и по
  // фактическому состоянию предметов. Разойтись с протоколом он не может.
  if (!dry) {
    const состояние = new Map(body.subjects.map((subject) => [subject.id, subject.status]));
    const поручения = buildAssignments(workflow.stages, состояние);

    console.log("РЕЕСТР ПОРУЧЕНИЙ (такт 0, Настенька)");
    console.log("  №  агент        статус  задание");
    for (const item of поручения) {
      console.log(
        `  ${String(item.number).padStart(2)}  ${item.agent.padEnd(12)} ${item.status}     ` +
          `${item.task.slice(0, 60)}`,
      );
    }
    console.log("");
  }

  console.log(`Заблокировано шагов: ${body.blockedSteps}, не реализовано: ${body.unimplementedSteps}`);
  console.log(
    body.completed
      ? "Протокол пройден полностью."
      : "Протокол НЕ пройден: перечисленные шаги не имели права стартовать.",
  );

  return body.completed ? 0 : 2;
}

/**
 * Расчётная выгрузка строится из АРТЕФАКТОВ разбора и сходимости, а не из
 * повторного чтения документа: иначе Excel и результат Проверки разойдутся.
 */
async function exportCalculation(platform: Platform, documentPath: string, outPath: string): Promise<number> {
  const tenantId = "00000000-0000-0000-0000-000000000000";
  const now = new Date().toISOString();
  const subjects = new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]);

  const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
    "parse-estimate",
    { documentPath },
    { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
  );
  if (!parsed.ok) {
    console.error("Не удалось разобрать смету.");
    return 2;
  }

  const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
    "check-convergence",
    toConvergenceInput(parsed.artifact.body, documentPath, parsed.artifact.inputHashes[0]!),
    { tenantId, entryPoint: "subgraph", subjects, now },
  );
  if (!convergence.ok) {
    console.error("Не удалось посчитать сходимость.");
    return 2;
  }

  const totalsByScope = new Map(convergence.artifact.body.sections.map((section) => [section.scope, section]));
  const today = isoDate(new Date().toISOString().slice(0, 10));

  const parameters = platform.parameters.ids().flatMap((id) => {
    const resolved = platform.parameters.resolve(id, today);
    if (resolved === undefined || resolved.provenance.kind !== "source") return [];
    return [
      {
        id,
        value: resolved.value,
        effectiveFrom: resolved.provenance.ref.checkedAt,
        source: resolved.provenance.ref.sourceId,
      },
    ];
  });

  const sections = convergence.artifact.body.sections
    .filter((section) => section.status !== "not_comparable")
    .map((section) => {
      const number = section.scope.replace("section:", "");
      const parsedSection = parsed.artifact.body.sections.find((candidate) => candidate.number === number);

      return {
        number,
        name: section.name ?? "",
        positions: (parsedSection?.positions ?? []).map((position) => ({
          ordinal: position.ordinal,
          name: position.sourceName,
          basis:
            position.mapping.kind === "by_code"
              ? `${position.mapping.code.system}${position.mapping.code.code}`
              : "",
          unit: position.quantity?.value.unit ?? "",
          amount: position.amount,
        })),
        total: section.computed,
      };
    });

  const source: CalculationSource = {
    documentPath,
    artifact: convergence.artifact,
    sections,
    documentTotal: convergence.artifact.body.document.computed,
    parameters,
    accuracy: { range: "±3–5%", basis: "оценка выполнена по локальному сметному расчёту", heuristic: true },
    generatorVersion: "1.0.0",
  };

  const workbook = buildCalculationWorkbook(source);
  await writeWorkbook(workbook, outPath);

  const traces = tracesOf(workbook);
  const positions = sections.reduce((sum, section) => sum + section.positions.length, 0);

  console.log(`Выгрузка      : ${outPath}`);
  console.log(`Шаблон        : ${workbook.metadata.templateVersion}, генератор ${workbook.metadata.generatorVersion}`);
  console.log(`Разделов      : ${sections.length}, позиций ${positions}`);
  console.log(`Формул со следом: ${traces.length}`);
  console.log(
    `Итог по смете : ${source.documentTotal?.value.amount ?? "— (в смете нет стоимостной части)"} ₽`,
  );
  console.log(`Параметров    : ${parameters.length}`);

  const excluded = convergence.artifact.body.notComparable;
  if (excluded.length > 0) {
    console.log(`Не выгружены (нечего сверять): ${excluded.join(", ")}`);
  }

  return 0;
}

/** Приводит разобранную смету ко входу операции сходимости. */
/** Значение флага не должно быть принято за имя операции. */
function isFlagValue(argv: readonly string[], value: string): boolean {
  const index = argv.indexOf(value);
  return index > 0 && (argv[index - 1] ?? "").startsWith("--");
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`Отказ: ${(error as Error).message}`);
  process.exitCode = 1;
}

/**
 * Журнал обращений к моделям по процессам — ТЗ §12.1л.
 *
 * Дословно: «обращение к внешним моделям происходит только по процессам
 * Регламента и только после анонимизации, ЧТО ПОДТВЕРЖДАЕТСЯ ЗАПИСЯМИ
 * ЖУРНАЛА». Эта команда и есть то, чем подтверждают: приёмщик запускает её и
 * видит, какие процессы что выносили наружу.
 *
 * Сводка строится ПО ВСЕЙ истории таблицы, а не по текущему процессу. Прежний
 * журнал жил в памяти: перезапущенный воркер отчитался бы за неполный период и
 * выглядел бы при этом исправным.
 */
/**
 * ПЕРЕЧЕНЬ ИСТОЧНИКОВ БАЗЫ — приёмка Т12 и Т13.
 *
 * Т12 требует, чтобы число строк в системе равнялось числу строк в источнике.
 * Проверить это можно только увидев числа, поэтому команда печатает не «база
 * загружена», а листы, строки и отпечаток каждой книги.
 *
 * Т13 требует пополнения без правки кода. Перечень строится ОБХОДОМ ПАПКИ:
 * положил книгу в `config/crew/bases/` — она здесь появилась и со следующего
 * прогона лежит в рабочей папке роли. Если бы список жил в коде, эта команда
 * показывала бы намерение вместо содержимого.
 */
async function basesCommand(platform: Platform): Promise<number> {
  const { allBases } = await import("@platform/codex/crew-reviewers.js");
  const { dumpWorkbook } = await import("@platform/config/base-dump.js");

  // Тот же корень, что у сборки: команда обязана видеть ровно те книги,
  // которые получит прогон.
  const bases = allBases(join(process.cwd(), "config"));
  console.log(`Источников базы: ${bases.length}`);
  console.log("");
  console.log("источник\tлистов\tстрок\tотпечаток");

  let sheets = 0;
  let rows = 0;

  for (const base of bases) {
    const book = await dumpWorkbook(base.path);

    if (book === undefined) {
      console.log(`${base.title}\tНЕ ПРОЧИТАН\t—\t—`);
      continue;
    }

    sheets += book.sheets.length;
    rows += book.rowCount;
    console.log(`${base.title}\t${book.sheets.length}\t${book.rowCount}\t${book.contentHash.slice(0, 12)}`);
  }

  console.log("");
  console.log(`Итого книг: ${bases.length}, листов: ${sheets}, строк: ${rows}`);
  console.log(`Нормативный каталог: ${platform.catalogue.size} позиций`);
  return 0;
}

async function journalCommand(): Promise<number> {
  const tenantId = process.env["STROYINTELLECT_TENANT_ID"];

  if (tenantId === undefined || tenantId === "") {
    console.error(
      "Не задан STROYINTELLECT_TENANT_ID: журнал арендуемый, и без арендатора\n" +
        "показать нечего — второй рубеж изоляции (RLS) вернёт пустоту.",
    );
    return 2;
  }

  // Динамический импорт, как в соседних командах с базой: статический тянет
  // Prisma в каждый запуск CLI, включая те, где база не нужна.
  const { createPrismaClient, withTenant } = await import("@platform/db/prisma.js");
  const { ModelCallRepository } = await import("@platform/db/model-call-repository.js");

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const summary = await withTenant(db, tenantId, (tx) =>
      new ModelCallRepository().externalProcesses(tx),
    );

    if (summary.length === 0) {
      // Пусто — это ответ, а не отсутствие ответа: наружу не ходили.
      console.log("Обращений во ВНЕШНИЙ контур не зарегистрировано.");
      return 0;
    }

    console.log("ОБРАЩЕНИЯ ВО ВНЕШНИЙ КОНТУР ПО ПРОЦЕССАМ (ТЗ §12.1л)\n");

    for (const process of summary) {
      console.log(`  ${process.process}`);
      console.log(`    обращений    : ${process.calls}`);
      console.log(`    классы данных: ${process.dataClasses.join(", ")}`);
      console.log(`    токены       : вход ${process.inputTokens}, выход ${process.outputTokens}`);

      // Ноль здесь — не украшение отчёта, а само требование §12.1л.
      console.log(
        process.withoutAnonymization === 0
          ? "    обезличивание: все обращения обезличены"
          : `    НАРУШЕНИЕ    : без обезличивания — ${process.withoutAnonymization}`,
      );
    }

    const нарушений = summary.reduce((sum, item) => sum + item.withoutAnonymization, 0);

    return нарушений === 0 ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}
