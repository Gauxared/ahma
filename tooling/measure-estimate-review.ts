/**
 * Замер прогона Сметчика на реальном объёме (T4, docs/m1-tasks.md).
 *
 * Нужен не для отчётности: ТЗ §11 задаёт нормативы времени ответа (экспресс
 * 15 минут, стандарт 1 час, эксперт 5 часов), а спайк M0 показал разброс
 * латентности тривиального хода от 5.6 до 71 секунды. При девяти агентах это
 * прямо угрожает нормативу, и цифру надо иметь до того, как агентов станет
 * девять.
 *
 * Запуск: pnpm tsx tooling/measure-estimate-review.ts
 */
import { existsSync } from "node:fs";

import { bootstrap } from "../platform/bootstrap.js";
import { checkEstimate, topPositionsByShare } from "../modules/calculations/estimate-checks.js";
import type { PositionForCheck } from "../modules/calculations/estimate-checks.js";
import type { ParseEstimateBody } from "../modules/documents/operations/parse-estimate.js";
import type { CheckConvergenceBody } from "../modules/calculations/operations/check-convergence.js";
import type { EstimateReviewBody } from "../modules/agents/operations/run-estimate-review.js";
import { KURGAN_LSR, kurganPath } from "../tests/fixtures/kurgan.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const platform = bootstrap();

if (platform.operations.definition("run-estimate-review") === undefined) {
  console.error(
    "Операция агента не зарегистрирована: не заданы STROYINTELLECT_MODEL_BASE_URL и STROYINTELLECT_MODEL_ID.",
  );
  process.exit(2);
}

const TENANT = "00000000-0000-0000-0000-000000000000";
const subjects = new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]);

interface Row {
  readonly file: string;
  readonly positions: number;
  readonly promptChars: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly findings: number;
  readonly rejected: number;
}

const rows: Row[] = [];

for (const entry of KURGAN_LSR) {
  const path = kurganPath(entry.file);
  const now = new Date().toISOString();
  const context = { tenantId: TENANT, entryPoint: "subgraph" as const, subjects, now };

  const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
    "parse-estimate",
    { documentPath: path },
    { ...context, subjects: new Map() },
  );
  if (!parsed.ok) {
    console.error(`Не разобрана: ${entry.file}`);
    continue;
  }

  const positions: PositionForCheck[] = parsed.artifact.body.sections.flatMap((section) =>
    section.positions.map((position) => ({
      ordinal: position.ordinal,
      section: section.number,
      name: position.sourceName,
      basis: position.mapping.kind === "by_code" ? `${position.mapping.code.system}${position.mapping.code.code}` : "",
      unit: position.quantity?.value.unit ?? "",
      amount: position.amount?.value.amount,
      row:
        position.amount?.provenance.kind === "source" &&
        position.amount.provenance.ref.locator.kind === "row"
          ? position.amount.provenance.ref.locator.row
          : 0,
    })),
  );

  const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
    "check-convergence",
    {
      documentPath: path,
      contentHash: parsed.artifact.inputHashes[0]!,
      sections: parsed.artifact.body.sections.map((section) => ({
        number: section.number,
        name: section.name,
        declaredTotal: section.declaredTotal,
        positionTotals: section.positions.map((position) => position.amount?.value.amount),
      })),
      declaredTotal: parsed.artifact.body.declaredTotal,
      headerTotalThousands: parsed.artifact.body.headerTotalThousands,
    },
    context,
  );
  if (!convergence.ok) continue;

  const checks = checkEstimate(positions);
  const top = topPositionsByShare(positions, { minShare: "0.05", limit: 5 });

  const review = await platform.operations.run<unknown, EstimateReviewBody>(
    "run-estimate-review",
    {
      documentPath: path,
      contentHash: parsed.artifact.inputHashes[0]!,
      hasEstimate: true,
      convergence: {
        converged: convergence.artifact.body.converged,
        documentTotal: convergence.artifact.body.document.computed?.value.amount,
        documentDelta: convergence.artifact.body.document.delta?.value.amount,
        sections: convergence.artifact.body.sections.map((section) => ({
          scope: section.scope,
          name: section.name ?? "",
          computed: section.computed?.value.amount,
          delta: section.delta?.value.amount,
          status: section.status,
        })),
      },
      checks,
      topPositions: top,
    },
    context,
  );

  if (!review.ok) {
    console.error(`Агент не отработал: ${entry.file}`);
    for (const block of review.blocks) console.error(`  ${JSON.stringify(block)}`);
    continue;
  }

  const body = review.artifact.body;

  rows.push({
    file: entry.file.slice(0, 30),
    positions: positions.length,
    promptChars: 0,
    inputTokens: body.run.inputTokens,
    outputTokens: body.run.outputTokens,
    latencyMs: body.run.latencyMs,
    findings: body.findings.length,
    rejected: body.rejected.length,
  });

  console.log(`\n═══ ${entry.file.slice(0, 46)}`);
  console.log(`Позиций: ${positions.length}   сходимость: ${convergence.artifact.body.converged ? "0 ₽" : "нарушена"}`);
  console.log(`Токены: вход ${body.run.inputTokens}, выход ${body.run.outputTokens}   время: ${body.run.latencyMs} мс`);
  console.log(`Точность: ${body.accuracy.range} (${body.accuracy.heuristic ? "договорная эвристика" : "?"})`);
  console.log(`Вердикт: ${body.verdict}`);

  for (const finding of body.findings) {
    const impact = finding.impact === undefined ? "" : `, влияние ${finding.impact.value.amount} ₽`;
    console.log(`  [${finding.severity}] ${finding.statement}${impact}`);
    console.log(`      основание: ${finding.basis}`);
  }

  for (const rejected of body.rejected) {
    console.log(`  ОТКЛОНЕНО: «${rejected.statement}» — ${rejected.reason}`);
  }
}

console.log("\n═══════════════════ СВОДКА ═══════════════════");
console.log(`${"файл".padEnd(32)} ${"поз.".padStart(5)} ${"вход".padStart(7)} ${"выход".padStart(6)} ${"мс".padStart(7)} ${"замеч.".padStart(7)}`);
for (const row of rows) {
  console.log(
    `${row.file.padEnd(32)} ${String(row.positions).padStart(5)} ${String(row.inputTokens).padStart(7)} ` +
      `${String(row.outputTokens).padStart(6)} ${String(row.latencyMs).padStart(7)} ${String(row.findings).padStart(7)}`,
  );
}

const totalPositions = rows.reduce((sum, row) => sum + row.positions, 0);
const totalLatency = rows.reduce((sum, row) => sum + row.latencyMs, 0);
const maxLatency = Math.max(...rows.map((row) => row.latencyMs));

console.log(`\nВсего позиций: ${totalPositions}`);
console.log(`Суммарное время одного агента: ${(totalLatency / 1000).toFixed(1)} с, максимум на файл: ${(maxLatency / 1000).toFixed(1)} с`);
console.log(`Экстраполяция на девять агентов: ${((totalLatency * 9) / 1000 / 60).toFixed(1)} мин`);
console.log(`Норматив §11 «стандарт»: 60 мин`);
