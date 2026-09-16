# StroyIntellect 3/10/18-Day Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three consecutive releases of StroyIntellect: a legacy-complete demo in 3 days, a pilot-ready MVP in 10 days, and a full functional customer installation in 18 days.

**Architecture:** Build one modular TypeScript monolith with a Next.js App Router web/BFF process, a separate Node.js worker, PostgreSQL/Prisma, local adapter-based file storage, and Codex SDK behind a provider-neutral runtime port. The 3-day release exposes every legacy capability by importing existing prompts, commands, workflows and output contracts; the 10-day and 18-day releases replace fast adapters with structured, secure and acceptance-tested modules without changing the public product flow.

**Tech Stack:** TypeScript, Node.js 22, Next.js App Router, React, Prisma ORM, PostgreSQL, Codex SDK, Zod, Vitest, Playwright, ExcelJS, docx, SheetJS, Mammoth, pdf-parse, fast-xml-parser, Pino, Docker Compose.

---

## 1. Delivery Contract

### Release A: Day 3 — Legacy-Complete Demo MVP

This release is a real working demonstration, not a static prototype. It must:

- run against a configured real model provider through Codex SDK;
- expose all nine legacy functional agents;
- support the legacy takt 0-4 workflow;
- support all 29 APRI domain commands, three depth modes, four modifiers and four headquarters commands;
- accept `.xlsx`, `.xls`, `.docx`, Grand Estimate XML, text-layer PDF, CSV, TXT and Markdown as files available to agents;
- persist objects, documents, Checks, jobs and outputs in PostgreSQL;
- execute deterministic calculation tools for the core legacy formulas;
- generate calculation XLSX, Word note, violations XLSX and proposal comparison XLSX;
- provide all six contract screens with a simplified but coherent SaaS interface;
- show agent progress, source markers, recommendations, open questions and final verdict;
- run from Docker Compose on the 7KL demo server.

Release A may use raw-file inspection and prompt-driven extraction where structured parsers are not ready. It is not accepted as production security, contractual APRI accuracy or finished StorHaus integration.

### Release B: Day 10 — Pilot-Ready MVP

Release B keeps every Release A capability and adds:

- local accounts, secure sessions and two roles;
- immutable document versions and confirmation revisions;
- structured estimate/proposal parsing and normalization;
- multiple-proposal mapping and confirmation;
- deterministic independent estimate baseline;
- complete formula trace and object memory promotion;
- PostgreSQL RLS, append-only audit and tenant-safe artifacts;
- full export schemas and golden tests;
- replay, cancellation, retry and dead-letter operations;
- browser E2E coverage of the six-screen flow.

### Release C: Day 18 — Full Functional Customer Version

Release C keeps every earlier capability and adds:

- provider roles `primary/helper/fallback/judge` with budgets and circuit breakers;
- fail-closed egress gateway and malicious-file sandbox controls;
- versioned external `/api/v1`, structured file channel and StorHaus adapter boundary;
- APRI 14-section knowledge import profile;
- signed release bundle, migrations, rollback and smoke package;
- deployment observability, support runbooks and restore verification;
- requirement traceability, agent evals and UAT evidence package.

The real StorHaus endpoint requires the customer contract, schema and credentials by Day 11. If they are unavailable, Release C ships the contract-tested adapter plus the contractually permitted structured-file channel; it does not claim live StorHaus acceptance.

## 2. Non-Negotiable Product Parity

The Day 3 release is not complete until the following legacy surface is reachable.

### Nine functional agents

1. Project Manager / synthesis.
2. Chief Project Engineer / physics and quantities.
3. Estimator / estimate and convergence.
4. Procurement / market and lead times.
5. Contractor specialist / scoring and tender comparison.
6. Economist / cost, margin, project finance and cash flow.
7. PTO engineer / KS and as-built documentation readiness.
8. Lawyer / contract red flags.
9. Administrator functional agent / passport, open questions and coordination.

### Legacy command registry

```text
/оценка /экспресс-оценка /паспорт /гип /вор /смета /конъюнктура
/тендер /себестоимость /финмодель /бддс /выборка /эскроу /пф
/кс /ид /лидтайм /сроки /договор /гу-бг /аванс /скоринг
/контрагент /риски /допущения /сверка /база /kpi /стоп

/экспресс /стандарт /эксперт
/swot /примортем /матрица /mvp
/браинсторм /ретро /позиции /критика
```

### Legacy invariants

- Physics and confirmed quantities precede money.
- Every number has a source status or FormulaTrace.
- Unknown is never converted to zero.
- A final result always contains a recommendation.
- An open question always has an owner and deadline.
- Values older than 90 days are visibly marked for review.
- Agent conflicts are visible rather than silently merged.
- Express is at most 15 lines without tables.
- Standard cites every number.
- Expert contains at least three alternatives and a matrix.
- The accuracy marker is always visible as a contractual heuristic.

## 3. Target Repository Structure

```text
apps/
  web/
    app/
      (product)/objects/page.tsx
      (product)/objects/[objectId]/page.tsx
      (product)/objects/[objectId]/documents/page.tsx
      (product)/objects/[objectId]/comparison/page.tsx
      (product)/checks/[checkId]/page.tsx
      (product)/admin/audit/page.tsx
      api/v1/
    components/
    styles/
  worker/
    src/main.ts

modules/
  projects/
  documents/
  checks/
  agents/
  calculations/
  comparison/
  estimation/
  knowledge/
  exports/
  identity/
  audit/
  integrations/

platform/
  config/
  db/
  jobs/
  storage/
  codex/
  security/
  observability/

config/
  legacy/apri/
  agents/
  workflows/
  models/
  customers/apri/

prisma/
  schema.prisma
  migrations/

tooling/
  import-legacy.ts
  verify-architecture.ts
  verify-requirements.ts

tests/
  fixtures/
  integration/
  e2e/
```

## 4. Parallel Execution Strategy

Use three isolated implementation tracks from the first hour:

| Track | Owns | Must not edit |
|---|---|---|
| Runtime | Prisma, jobs, Codex, agents, calculations | UI component files |
| Product UI | design system, six screens, browser flow | worker and Prisma migrations |
| Legacy/QA | prompt import, command registry, fixtures, exports, E2E | runtime internals except public contracts |

Merge through typed contracts in `packages/contracts` and run the full gate after each half-day integration point.

## 5. Day-by-Day Critical Path

| Day | Required outcome |
|---:|---|
| 1 | Repository boots; PostgreSQL works; legacy bundle imports; Codex compatibility spike passes; design shell renders. |
| 2 | Jobs execute; all nine agents and commands route; documents upload; Check workspace and progress UI work. |
| 3 | Six screens, four exports, demo seed, Docker Compose and end-to-end `/оценка` pass. |
| 4-5 | Auth, RLS, immutable documents, confirmations and structured parsing. |
| 6-7 | Multi-KP mapping, independent estimate and complete calculation engine. |
| 8-9 | Memory, audit, full exports, replay and browser E2E. |
| 10 | Pilot release hardening, demo rehearsal and pilot package. |
| 11-13 | Provider harness, egress, parser sandbox and API/integration channels. |
| 14-15 | APRI knowledge profile, StorHaus contract adapter and release bundles. |
| 16-17 | Evals, UAT evidence, observability, restore and security verification. |
| 18 | Full regression, deployment rehearsal and customer release package. |

---

# Release A Tasks — Day 3 Demo MVP

### Task 1: Scaffold the executable repository

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/worker/tsconfig.json`
- Create: `packages/contracts/index.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup.ts`
- Create: `tooling/verify-architecture.ts`
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Add the root scripts and dependencies**

```json
{
  "name": "stroyintellect",
  "private": true,
  "scripts": {
    "dev:web": "next dev apps/web",
    "dev:worker": "tsx watch apps/worker/src/main.ts",
    "build:web": "next build apps/web",
    "build:worker": "tsc -p apps/worker/tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.base.json --noEmit",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "legacy:import": "tsx tooling/import-legacy.ts"
  }
}
```

Install:

```bash
pnpm add next react react-dom @openai/codex-sdk @prisma/client zod pino decimal.js exceljs docx xlsx mammoth pdf-parse fast-xml-parser argon2 lucide-react clsx tailwind-merge
pnpm add -D typescript tsx prisma vitest @vitest/coverage-v8 @playwright/test @testing-library/react @testing-library/jest-dom jsdom eslint eslint-config-next prettier @types/node @types/react @types/react-dom
```

- [ ] **Step 2: Add strict shared TypeScript configuration**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@modules/*": ["modules/*"],
      "@platform/*": ["platform/*"],
      "@contracts/*": ["packages/contracts/*"]
    }
  }
}
```

Create `packages/contracts/index.ts`:

```ts
export const contractVersion = "1.0.0" as const;
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"]
  }
});
```

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `.env.example` without credentials:

```dotenv
DATABASE_URL=postgresql://stroyintellect:stroyintellect@127.0.0.1:5432/stroyintellect
STROYINTELLECT_RELEASE_PROFILE=demo-3-day
STROYINTELLECT_DATA_ROOT=./var/data
CODEX_PROVIDER_ID=configured-provider
CODEX_MODEL_ID=configured-model
CODEX_COMPATIBILITY_TEST=0
```

Create `tooling/verify-architecture.ts` as a fail-fast import-boundary check. It must reject imports of `next`, `@prisma/client` or `@openai/codex-sdk` from `modules/**`, and reject imports from `config/customers/apri/**` inside `platform/**`.

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(path)
        ? [path]
        : [];
  });
}

const violations: string[] = [];
for (const file of sourceFiles("modules")) {
  const source = readFileSync(file, "utf8");
  if (/from ["'](?:next|@prisma\/client|@openai\/codex-sdk)/.test(source)) {
    violations.push(`${file}: domain module imports framework/runtime`);
  }
}
for (const file of sourceFiles("platform")) {
  const source = readFileSync(file, "utf8");
  if (/config\/customers\/apri/.test(source)) {
    violations.push(`${file}: platform imports APRI customer logic`);
  }
}
if (violations.length > 0) {
  throw new Error(violations.join("\n"));
}
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm dev:web",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
  ]
});
```

- [ ] **Step 3: Add the first failing smoke test**

Create `tests/integration/bootstrap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { releaseProfile } from "../../platform/config/release-profile";

describe("release profile", () => {
  it("starts as the three-day demo profile", () => {
    expect(releaseProfile()).toBe("demo-3-day");
  });
});
```

Run: `pnpm test -- tests/integration/bootstrap.test.ts`

Expected: FAIL because `platform/config/release-profile.ts` does not exist.

- [ ] **Step 4: Implement the minimal release profile**

Create `platform/config/release-profile.ts`:

```ts
const profiles = ["demo-3-day", "pilot-10-day", "full-18-day"] as const;
export type ReleaseProfile = (typeof profiles)[number];

export function releaseProfile(): ReleaseProfile {
  const value = process.env.STROYINTELLECT_RELEASE_PROFILE ?? "demo-3-day";
  if (!profiles.includes(value as ReleaseProfile)) {
    throw new Error(`Invalid STROYINTELLECT_RELEASE_PROFILE: ${value}`);
  }
  return value as ReleaseProfile;
}
```

Run: `pnpm test -- tests/integration/bootstrap.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.base.json vitest.config.ts apps platform tests docker-compose.yml .env.example
git commit -m "chore: scaffold stroyintellect runtime"
```

### Task 2: Prove Codex SDK compatibility before building the runtime

**Files:**
- Create: `platform/codex/runtime-port.ts`
- Create: `platform/codex/codex-sdk-adapter.ts`
- Create: `tests/integration/codex-compatibility.test.ts`

- [ ] **Step 1: Define the provider-neutral contract**

```ts
export type AgentTurnRequest = {
  prompt: string;
  workingDirectory: string;
  outputSchema: Record<string, unknown>;
  threadId?: string;
};

export type AgentTurnResult = {
  threadId: string;
  output: unknown;
  provider: string;
  model: string;
};

export interface AgentRuntimePort {
  run(request: AgentTurnRequest): Promise<AgentTurnResult>;
}
```

- [ ] **Step 2: Write a compatibility test against the configured endpoint**

```ts
import { describe, expect, it } from "vitest";
import { createCodexRuntime } from "../../platform/codex/codex-sdk-adapter";

describe.runIf(process.env.CODEX_COMPATIBILITY_TEST === "1")("Codex SDK", () => {
  it("starts a sandboxed thread and returns schema-bound output", async () => {
    const runtime = createCodexRuntime();
    const result = await runtime.run({
      prompt: "Return status ok",
      workingDirectory: process.cwd(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: { status: { const: "ok" } }
      }
    });
    expect(result.output).toEqual({ status: "ok" });
    expect(result.threadId).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement start/resume, working directory and output schema**

Use the pinned SDK API confirmed by the compatibility test. The adapter must create a new thread when `threadId` is absent, resume it when present, set the supplied working directory, deny arbitrary host access and return provider/model metadata.

- [ ] **Step 4: Run the real compatibility gate**

Run:

```bash
CODEX_COMPATIBILITY_TEST=1 pnpm test -- tests/integration/codex-compatibility.test.ts
```

Expected: PASS against the configured model endpoint. A mock-only pass does not satisfy this task.

- [ ] **Step 5: Commit**

```bash
git add platform/codex tests/integration/codex-compatibility.test.ts
git commit -m "feat: add codex runtime adapter"
```

### Task 3: Create the compact canonical database and PostgreSQL job queue

**Files:**
- Create: `prisma/schema.prisma`
- Create: `platform/db/prisma.ts`
- Create: `platform/jobs/job-repository.ts`
- Create: `tests/integration/job-repository.test.ts`

- [ ] **Step 1: Write the queue lifecycle test**

```ts
it("claims one queued job with a lease", async () => {
  const job = await repository.enqueue({ tenantId, type: "run-check", payload: { checkId } });
  const claimed = await repository.claim("worker-a", 60_000);
  expect(claimed?.id).toBe(job.id);
  expect(claimed?.status).toBe("RUNNING");
  expect(claimed?.leaseOwner).toBe("worker-a");
});
```

Run: `pnpm test -- tests/integration/job-repository.test.ts`

Expected: FAIL because the schema and repository do not exist.

- [ ] **Step 2: Create the initial Prisma models**

The initial schema contains `Tenant`, `User`, `ProjectObject`, `Document`, `DocumentVersion`, `Check`, `AgentRun`, `Job`, `Export` and `AuditEvent`. Use UUID primary keys, `tenantId` on tenant-owned records, JSON only for versioned payloads, and timestamps on every mutable operational record.

The `Job` model must include:

```prisma
model Job {
  id             String    @id @default(uuid())
  tenantId       String
  checkId        String?
  type           String
  version        Int       @default(1)
  payload        Json
  payloadHash    String
  idempotencyKey String    @unique
  status         JobStatus @default(QUEUED)
  attempts       Int       @default(0)
  notBefore      DateTime  @default(now())
  leaseOwner     String?
  leaseExpiresAt DateTime?
  lastError      Json?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([status, notBefore])
  @@index([tenantId, checkId])
}
```

- [ ] **Step 3: Implement atomic enqueue and `SKIP LOCKED` claim**

Use one Prisma transaction for business state plus `Job`. Use reviewed parameterized SQL for `FOR UPDATE SKIP LOCKED`. Claims must increment attempts and set a lease expiry.

- [ ] **Step 4: Run migrations and tests**

```bash
pnpm prisma migrate dev --name init
pnpm test -- tests/integration/job-repository.test.ts
```

Expected: migration succeeds and test passes.

- [ ] **Step 5: Commit**

```bash
git add prisma platform/db platform/jobs tests/integration/job-repository.test.ts
git commit -m "feat: add canonical state and job queue"
```

### Task 4: Import the complete legacy bundle as versioned product assets

**Files:**
- Create: `tooling/import-legacy.ts`
- Create: `config/legacy/apri/manifest.json`
- Create: `config/legacy/apri/supervisor-prompt.md`
- Create: `config/legacy/apri/agents/*.md`
- Create: `config/legacy/apri/workflow.md`
- Create: `config/legacy/apri/cases-lessons.md`
- Create: `config/legacy/apri/norms-base.md`
- Test: `tests/integration/legacy-import.test.ts`

- [ ] **Step 1: Write the import coverage test**

```ts
it("imports nine agents and preserves source hashes", async () => {
  const manifest = await importLegacyBundle();
  expect(manifest.agents).toHaveLength(9);
  expect(manifest.commands).toHaveLength(40);
  expect(manifest.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
});
```

- [ ] **Step 2: Implement deterministic import**

The importer reads only these canonical sources:

```text
reference-system/apri/СтройИнтеллект_Девелопмент_АПРИ_v1_0.txt
reference-system/skills/stroiintellect-master/stroiintellect-master/SKILL.md
reference-system/skills/stroiintellect-master/stroiintellect-master/references/agents-full.md
reference-system/skills/stroiintellect-master/stroiintellect-master/references/workflow.md
reference-system/skills/stroiintellect-master/stroiintellect-master/references/cases-lessons.md
reference-system/skills/stroiintellect-master/stroiintellect-master/references/norms-base.md
```

It splits `agents-full.md` by its nine `##` agent headings, normalizes line endings, writes the generated files and records SHA-256 hashes and source paths in `manifest.json`.

- [ ] **Step 3: Fail on drift instead of silently rewriting**

Add `--check` mode. It compares generated hashes with committed files and exits non-zero on drift.

- [ ] **Step 4: Generate and verify**

```bash
pnpm legacy:import
pnpm legacy:import -- --check
pnpm test -- tests/integration/legacy-import.test.ts
```

Expected: nine agents, 40 command routes and clean drift check.

- [ ] **Step 5: Commit**

```bash
git add tooling/import-legacy.ts config/legacy tests/integration/legacy-import.test.ts
git commit -m "feat: import legacy agent bundle"
```

### Task 5: Implement the legacy command and mode registry

**Files:**
- Create: `modules/agents/command-registry.ts`
- Create: `modules/agents/command-contract.ts`
- Test: `modules/agents/command-registry.test.ts`

- [ ] **Step 1: Write table-driven routing tests**

```ts
const cases = [
  ["/гип", "chief_project_engineer_agent"],
  ["/смета", "estimate_review_agent"],
  ["/финмодель", "economist_agent"],
  ["/договор", "legal_agent"],
  ["/ид", "pto_agent"],
  ["/оценка", "full_check"]
] as const;

it.each(cases)("routes %s to %s", (command, expected) => {
  expect(resolveCommand(command).route).toBe(expected);
});
```

- [ ] **Step 2: Implement all 40 routes as data**

Each command entry defines `id`, aliases, route, required agents, mode override, allowed tools and whether web access can be requested. `/стоп` maps to cancellation, not an agent prompt.

- [ ] **Step 3: Validate command completeness against the imported manifest**

The registry test compares the committed command IDs against the imported legacy list and fails on missing or extra commands.

- [ ] **Step 4: Run the tests**

Run: `pnpm test -- modules/agents/command-registry.test.ts`

Expected: PASS for all 40 routes.

- [ ] **Step 5: Commit**

```bash
git add modules/agents
git commit -m "feat: add legacy command registry"
```

### Task 6: Implement deterministic calculation tools

**Files:**
- Create: `modules/calculations/formula-registry.ts`
- Create: `modules/calculations/formula-trace.ts`
- Create: `modules/calculations/formulas/*.ts`
- Test: `modules/calculations/formulas.test.ts`

- [ ] **Step 1: Write golden formula tests**

Cover convergence, line amount, deviation, cost per square metre, credit interest, monthly cash flow gap, three margin scenarios, order deadline, reverse duration, penalty and GU-versus-BG effect.

```ts
it("calculates line amount with decimal strings", () => {
  expect(calculateLineAmount({ quantity: "12.5", unitPrice: "840.40" })).toEqual({
    value: "10505.00",
    unit: "RUB"
  });
});
```

- [ ] **Step 2: Implement decimal-safe values**

Use decimal strings at API boundaries and a single decimal library wrapper internally. Every result returns formula ID, formula version, inputs, output, unit and rounding mode.

- [ ] **Step 3: Expose calculations through a typed tool registry**

```ts
export const calculationTools = {
  "calculation.convergence": convergenceTool,
  "calculation.lineAmount": lineAmountTool,
  "calculation.deviation": deviationTool,
  "calculation.costPerSqm": costPerSqmTool,
  "calculation.credit": creditTool,
  "calculation.cashFlow": cashFlowTool,
  "calculation.marginScenarios": marginScenariosTool,
  "calculation.orderDeadline": orderDeadlineTool,
  "calculation.duration": durationTool,
  "calculation.penalty": penaltyTool,
  "calculation.guVsBg": guVsBgTool
} as const;
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- modules/calculations/formulas.test.ts`

Expected: all golden examples pass with exact decimal strings.

- [ ] **Step 5: Commit**

```bash
git add modules/calculations
git commit -m "feat: add deterministic calculation tools"
```

### Task 7: Build the nine-agent workflow host and worker

**Files:**
- Create: `modules/agents/agent-definition.ts`
- Create: `modules/checks/workflow-definition.ts`
- Create: `modules/checks/workflow-host.ts`
- Create: `apps/worker/src/main.ts`
- Test: `modules/checks/workflow-host.test.ts`

- [ ] **Step 1: Write the takt dependency test**

```ts
it("does not start finance before engineering and estimate artifacts", async () => {
  const state = checkState({ completedAgents: [] });
  expect(nextRunnableStages(state)).toEqual([
    "data_coordinator_agent",
    "chief_project_engineer_agent",
    "estimate_review_agent",
    "pto_agent",
    "legal_agent"
  ]);
  expect(nextRunnableStages(state)).not.toContain("economist_agent");
});
```

- [ ] **Step 2: Define the demo workflow**

```ts
export const legacyFullCheckWorkflow = {
  id: "legacy-full-check",
  version: 1,
  stages: [
    { id: "passport", agents: ["data_coordinator_agent"] },
    { id: "technical", agents: ["chief_project_engineer_agent", "estimate_review_agent", "pto_agent", "legal_agent"], parallel: true },
    { id: "finance", agents: ["economist_agent"], requires: ["technical"] },
    { id: "market", agents: ["procurement_agent", "contractor_search_agent"], requires: ["finance"], parallel: true },
    { id: "synthesis", agents: ["project_manager_agent"], requires: ["market"] }
  ]
} as const;
```

- [ ] **Step 3: Persist an `AgentRun` per functional agent**

Each run stores input/output hashes, prompt version, thread ID, model/provider, status, sources, tool invocations and validation errors. Agents communicate through persisted typed artifacts, never direct calls.

- [ ] **Step 4: Implement the worker loop**

The worker claims a job, materializes a Check workspace, invokes the required agent route, validates output with Zod, persists the artifact and schedules the next stage. It heartbeats while running and releases or fails the lease with a classified error.

- [ ] **Step 5: Run workflow tests and commit**

```bash
pnpm test -- modules/checks/workflow-host.test.ts
git add modules/checks modules/agents apps/worker
git commit -m "feat: orchestrate nine legacy agents"
```

### Task 8: Add document upload and Check workspaces

**Files:**
- Create: `platform/storage/storage-port.ts`
- Create: `platform/storage/local-storage-adapter.ts`
- Create: `modules/documents/file-extractor.ts`
- Create: `modules/documents/create-document-version.ts`
- Create: `apps/web/app/api/v1/objects/[objectId]/documents/route.ts`
- Test: `modules/documents/file-extractor.test.ts`

- [ ] **Step 1: Write format extraction tests**

Use one small fixture for each supported format. Assert content hash, detected MIME, extracted text length and source location metadata.

- [ ] **Step 2: Implement local immutable storage**

Store files under:

```text
var/data/<tenantId>/objects/<objectId>/documents/<documentId>/<sha256>/<filename>
```

Never overwrite an existing hash. Reject path traversal and filenames that escape the object root.

- [ ] **Step 3: Implement fast demo extraction**

- XLS/XLSX: sheet names and cell values through SheetJS.
- DOCX: text through Mammoth.
- XML: parsed structure through fast-xml-parser with DTD disabled.
- PDF: text layer through pdf-parse; reject scan-only files with an explicit status.
- CSV/TXT/MD: UTF-8 text with delimiter detection for CSV.

- [ ] **Step 4: Build the agent workspace manifest**

Every Check receives read-only `/input`, generated `/context`, writable `/work` and `/output`. The context manifest lists every file path, hash, MIME and extracted artifact.

- [ ] **Step 5: Run and commit**

```bash
pnpm test -- modules/documents/file-extractor.test.ts
git add platform/storage modules/documents apps/web/app/api/v1/objects
git commit -m "feat: add document workspaces"
```

### Task 9: Create the product-owned SaaS design system

**Files:**
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/components/ui/*.tsx`
- Create: `apps/web/components/product/*.tsx`
- Create: `apps/web/styles/tokens.css`
- Test: `apps/web/components/ui/ui-contract.test.tsx`

- [ ] **Step 1: Establish the visual language**

Use a technical editorial SaaS direction rather than generic blue cards:

- warm paper background `#F3F1EB`;
- ink foreground `#16181D`;
- graphite surfaces `#23262D`;
- signal orange `#F36B32` for action and risk;
- verified green `#267A59`;
- cool cyan `#2E7185` for sources and calculations;
- Manrope for interface text and JetBrains Mono for values, IDs and formulas;
- 4 px spacing base, 10 px controls, 16 px panels, 22 px major surfaces;
- left navigation rail, contextual top bar and split workspaces instead of a dashboard card grid.

- [ ] **Step 2: Add semantic tokens**

```css
:root {
  --si-bg: #f3f1eb;
  --si-surface: #fbfaf6;
  --si-ink: #16181d;
  --si-muted: #686b72;
  --si-border: #d8d4ca;
  --si-accent: #f36b32;
  --si-success: #267a59;
  --si-source: #2e7185;
  --si-danger: #b84134;
  --si-radius-control: 10px;
  --si-radius-panel: 16px;
  --si-shadow-panel: 0 18px 50px rgb(22 24 29 / 8%);
}
```

- [ ] **Step 3: Build reusable components**

Create `AppShell`, `Button`, `Field`, `DataTable`, `StatusBadge`, `SourceBadge`, `MetricStrip`, `AgentRail`, `TaktTimeline`, `CommandPalette`, `DocumentDropzone`, `FindingList`, `EmptyState` and `Skeleton`.

Start React component test files with `// @vitest-environment jsdom`.

- [ ] **Step 4: Verify responsive and accessibility contracts**

At 1440 px show rail + main + context panel. At 768 px collapse the context panel. At 390 px use bottom navigation and stacked content. All controls need visible focus, keyboard access and WCAG AA contrast.

- [ ] **Step 5: Run component tests and commit**

```bash
pnpm test -- apps/web/components/ui/ui-contract.test.tsx
git add apps/web/app apps/web/components apps/web/styles
git commit -m "feat: add stroyintellect design system"
```

### Task 10: Build the six product screens and Check progress

**Files:**
- Create: `apps/web/app/(product)/objects/page.tsx`
- Create: `apps/web/app/(product)/objects/[objectId]/page.tsx`
- Create: `apps/web/app/(product)/objects/[objectId]/documents/page.tsx`
- Create: `apps/web/app/(product)/objects/[objectId]/comparison/page.tsx`
- Create: `apps/web/app/(product)/checks/[checkId]/page.tsx`
- Create: `apps/web/app/(product)/admin/audit/page.tsx`
- Create: `apps/web/app/api/v1/checks/[checkId]/events/route.ts`
- Test: `tests/e2e/navigation.spec.ts`

- [ ] **Step 1: Write navigation E2E before pages exist**

```ts
test("moves through the six-screen product flow", async ({ page }) => {
  await page.goto("/objects");
  await page.getByRole("link", { name: "Демо-объект" }).click();
  await page.getByRole("link", { name: "Документы" }).click();
  await page.getByRole("link", { name: "Сравнение КП" }).click();
  await page.getByRole("button", { name: "Запустить проверку" }).click();
  await expect(page.getByText("Такт 0")).toBeVisible();
});
```

- [ ] **Step 2: Implement object list and passport**

Use a dense sortable register, not a card wall. The passport screen shows project metrics, readiness, recent Checks, document coverage and primary action.

- [ ] **Step 3: Implement documents and comparison**

Documents use a split view: file list, extraction preview and issues panel. The demo comparison screen shows proposal columns and explicitly labels raw/unconfirmed mappings.

- [ ] **Step 4: Implement Check workspace and audit**

The Check screen combines command input, takt timeline, agent rail, findings, calculations, sources and exports. Use SSE for job and agent events. Audit screen displays actor, action, object, time and trace ID.

- [ ] **Step 5: Run E2E and commit**

```bash
pnpm test:e2e -- tests/e2e/navigation.spec.ts
git add apps/web tests/e2e/navigation.spec.ts
git commit -m "feat: add six-screen product flow"
```

### Task 11: Generate the four required exports

**Files:**
- Create: `modules/exports/calculation-workbook.ts`
- Create: `modules/exports/word-note.ts`
- Create: `modules/exports/violations-workbook.ts`
- Create: `modules/exports/comparison-workbook.ts`
- Test: `modules/exports/exports.test.ts`

- [ ] **Step 1: Write structural export tests**

Assert:

- calculation XLSX has working formulas, `Параметры` sheet and highlighted inputs;
- Word note has passport, nine agent sections and consolidated conclusion;
- violations XLSX has position, violation, amount, status, basis and resolution path;
- comparison XLSX has mapped item, every proposal price, spread, system estimate, deviations and anomalies.

- [ ] **Step 2: Implement workbook builders from canonical data**

Do not calculate hidden business values only inside Excel. Every formula cell must have a matching persisted FormulaTrace. Escape spreadsheet formula injection in user-controlled text.

- [ ] **Step 3: Implement Word projection**

Use the same canonical result object as the UI and Excel exports. Include source markers and the contractual heuristic accuracy marker.

- [ ] **Step 4: Add export metadata**

Persist template version, source Check snapshot hash, generator version, content hash, timestamp and included artifact IDs.

- [ ] **Step 5: Run and commit**

```bash
pnpm test -- modules/exports/exports.test.ts
git add modules/exports
git commit -m "feat: add required result exports"
```

### Task 12: Package and accept the Day 3 demo

**Files:**
- Create: `tooling/seed-demo.ts`
- Create: `tests/e2e/full-check.spec.ts`
- Create: `Dockerfile`
- Modify: `docker-compose.yml`
- Create: `docs/runbooks/demo-3-day.md`

- [ ] **Step 1: Seed one synthetic developer object**

Create a passport, estimate fixture, three synthetic proposals, contract excerpt and financing parameters. Do not use APRI confidential data.

- [ ] **Step 2: Write the full acceptance E2E**

The test uploads files, starts `/оценка`, waits for nine agent results, verifies the final verdict and downloads all four exports.

- [ ] **Step 3: Add Docker services**

Compose contains `web`, `worker`, `postgres` and shared file volume. Health checks must wait for migrations before web/worker become ready.

- [ ] **Step 4: Run the Day 3 gate**

```bash
pnpm typecheck
pnpm test
pnpm build:web
pnpm build:worker
pnpm test:e2e -- tests/e2e/full-check.spec.ts
docker compose up --build -d
docker compose ps
```

Expected: all commands exit zero; web, worker and PostgreSQL are healthy; real Codex run completes.

- [ ] **Step 5: Tag the release commit**

```bash
git add Dockerfile docker-compose.yml tooling/seed-demo.ts tests/e2e/full-check.spec.ts docs/runbooks/demo-3-day.md
git commit -m "feat: deliver three-day legacy demo"
```

---

# Release B Tasks — Day 10 Pilot MVP

### Task 13: Add secure local identity and tenant enforcement

**Files:**
- Create: `modules/identity/password-service.ts`
- Create: `modules/identity/session-service.ts`
- Create: `platform/security/csrf.ts`
- Create: `apps/web/app/api/v1/auth/*/route.ts`
- Modify: `prisma/schema.prisma`
- Test: `tests/integration/auth.test.ts`

- [ ] Write failing tests for Argon2id hash/verify/rehash, opaque session tokens, HttpOnly/Secure/SameSite cookies, CSRF rejection and tenant-scoped actor context.
- [ ] Implement local user/admin roles and hashed server-side sessions.
- [ ] Add PostgreSQL RLS policies through a reviewed SQL migration.
- [ ] Run `pnpm test -- tests/integration/auth.test.ts` and tenant-crossing integration tests.
- [ ] Commit with `git commit -m "feat: secure local identity and tenant access"`.

### Task 14: Replace raw extraction with immutable structured revisions

**Files:**
- Create: `modules/documents/parsers/*.ts`
- Create: `modules/documents/extraction-revision.ts`
- Create: `modules/documents/confirmation-service.ts`
- Modify: `prisma/schema.prisma`
- Test: `modules/documents/parsers.test.ts`

- [ ] Write fixtures for XLS/XLSX, Grand Estimate XML, DOCX and text-layer PDF including hidden sheets, formulas, duplicates, unknown XML versions and scan detection.
- [ ] Implement typed `ExtractionRevision` with exact source locations and blocking issues.
- [ ] Implement correction as a new immutable revision and confirmation by exact subject hash.
- [ ] Prevent strong verdicts until critical revisions are confirmed.
- [ ] Commit with `git commit -m "feat: add confirmed document normalization"`.

### Task 15: Implement confirmed multi-proposal mapping

**Files:**
- Create: `modules/comparison/normalize-item.ts`
- Create: `modules/comparison/map-proposals.ts`
- Create: `modules/comparison/confirm-mapping.ts`
- Modify: `prisma/schema.prisma`
- Test: `modules/comparison/comparison.test.ts`

- [ ] Write tests for unit normalization, comparable/non-comparable separation, median, spread and unmatched items.
- [ ] Implement canonical item mapping with confidence and explanation.
- [ ] Require user confirmation for ambiguous mappings and preserve original plus confirmed versions.
- [ ] Update comparison screen to edit and confirm mappings.
- [ ] Commit with `git commit -m "feat: add confirmed proposal comparison"`.

### Task 16: Implement the independent estimate baseline

**Files:**
- Create: `modules/estimation/estimate-contract.ts`
- Create: `modules/estimation/analogue-retriever.ts`
- Create: `modules/estimation/statistical-estimator.ts`
- Create: `modules/estimation/estimate-service.ts`
- Modify: `prisma/schema.prisma`
- Test: `modules/estimation/estimate-service.test.ts`

- [ ] Write tests proving contractor proposal prices are not used as the estimate target.
- [ ] Retrieve approved historical analogues by region, product, period and canonical item.
- [ ] Calculate range, median, adjustments and confidence deterministically.
- [ ] Persist dataset manifest, analogue IDs, adjustments and FormulaTrace.
- [ ] Commit with `git commit -m "feat: add independent estimate baseline"`.

### Task 17: Add object memory, immutable Check snapshots and audit

**Files:**
- Create: `modules/checks/check-snapshot.ts`
- Create: `modules/projects/object-memory.ts`
- Create: `modules/audit/audit-service.ts`
- Modify: `prisma/schema.prisma`
- Test: `modules/projects/object-memory.test.ts`

- [ ] Write tests that rejected findings never enter future object memory.
- [ ] Pin documents, mappings, parameters, formulas, prompts, models and memory version in each Check.
- [ ] Promote findings to `ObjectMemoryProjection` only after human sign-off.
- [ ] Make audit append-only and retain actor, tenant, reason, trace IDs and payload hash.
- [ ] Commit with `git commit -m "feat: add immutable checks and object memory"`.

### Task 18: Complete job operations and replay safety

**Files:**
- Modify: `platform/jobs/job-repository.ts`
- Create: `platform/jobs/job-runner.ts`
- Create: `modules/checks/cancel-check.ts`
- Test: `tests/integration/job-recovery.test.ts`

- [ ] Write tests for heartbeat, expired lease recovery, retry budget, cancellation, dead-letter and idempotent export regeneration.
- [ ] Implement bounded concurrent claims and classified retry rules.
- [ ] Resume interrupted Codex threads only within the same Check snapshot.
- [ ] Add admin replay with reason and audit event.
- [ ] Commit with `git commit -m "feat: harden job execution and replay"`.

### Task 19: Accept and package the Day 10 pilot

**Files:**
- Create: `tests/e2e/pilot-flow.spec.ts`
- Create: `docs/runbooks/pilot-10-day.md`
- Create: `docs/evals/legacy-command-coverage.md`

- [ ] Run every legacy command against deterministic fixtures or the configured model route and record route/output-schema coverage.
- [ ] Run the complete object → documents → confirmation → comparison → Check → sign-off → exports browser flow.
- [ ] Verify RLS, session, CSRF, queue recovery and export golden tests.
- [ ] Build and rehearse Docker deployment from an empty database.
- [ ] Commit with `git commit -m "feat: deliver ten-day pilot mvp"`.

---

# Release C Tasks — Day 18 Full Functional Version

### Task 20: Harden the provider harness

**Files:**
- Create: `platform/codex/route-policy.ts`
- Create: `platform/codex/retry-policy.ts`
- Create: `platform/codex/circuit-breaker.ts`
- Create: `platform/codex/usage-budget.ts`
- Test: `platform/codex/provider-harness.test.ts`

- [ ] Test primary/helper/fallback/judge routes, provider independence, `Retry-After`, cumulative time/cost budgets and persistent half-open recovery.
- [ ] Implement schema repair once, then fallback or `needs_review`.
- [ ] Record provider, model, retries, fallback, tokens, cost and validation trace.
- [ ] Enforce the APRI external-provider monthly cap through installation config.
- [ ] Commit with `git commit -m "feat: harden model provider harness"`.

### Task 21: Enforce malicious-file and fail-closed egress security

**Files:**
- Create: `platform/security/file-quarantine.ts`
- Create: `platform/security/parser-sandbox.ts`
- Create: `platform/security/egress-gateway.ts`
- Create: `config/customers/apri/egress-policy.json`
- Test: `tests/integration/security-boundaries.test.ts`

- [ ] Test MIME spoofing, archive bombs, path traversal, VBA/DDE/OLE, XXE, Office external links and direct worker outbound.
- [ ] Run parsers without network or host filesystem access.
- [ ] Allow outbound only through the gateway with destination, purpose, data class, TLS and budget checks.
- [ ] Enforce non-overridable removal of documents, customer identifiers, addresses and raw result/history; store transmitted-field and redaction-rule manifests.
- [ ] Commit with `git commit -m "feat: enforce data contour security"`.

### Task 22: Add the external API, file channel and StorHaus contract adapter

**Files:**
- Create: `apps/web/app/api/v1/openapi.json`
- Create: `modules/integrations/integration-port.ts`
- Create: `modules/integrations/file-channel-adapter.ts`
- Create: `modules/integrations/storhaus-adapter.ts`
- Create: `config/integrations/storhaus.contract.json`
- Modify: `prisma/schema.prisma`
- Test: `modules/integrations/integrations.test.ts`

- [ ] Test `/api/v1` service auth, `Idempotency-Key`, decimal strings, RFC 9457 errors and compatibility policy.
- [ ] Implement structured inbound/outbound files with validation, quarantine, rejected-row reasons and delivery audit.
- [ ] Implement StorHaus mapping only from the versioned customer-supplied contract; fail startup when live mode is enabled without schema or credentials.
- [ ] Use `IntegrationOutboxEvent` only for external delivery and controlled replay.
- [ ] Commit with `git commit -m "feat: add customer integration channels"`.

### Task 23: Import and govern the APRI 14-section knowledge profile

**Files:**
- Create: `modules/knowledge/import-profile.ts`
- Create: `config/customers/apri/knowledge-import-profile.json`
- Create: `modules/knowledge/knowledge-service.ts`
- Modify: `prisma/schema.prisma`
- Test: `modules/knowledge/knowledge-import.test.ts`

- [ ] Encode all 14 agreed sections and mandatory numeric fields.
- [ ] Add preview, validation, confirmation and immutable import version.
- [ ] Mark values older than 90 days as `review_due` everywhere they are used.
- [ ] Allow agents to propose changes but require human publication and regression gate.
- [ ] Commit with `git commit -m "feat: add apri knowledge import profile"`.

### Task 24: Add signed release, migrations, rollback and observability

**Files:**
- Create: `tooling/build-release-bundle.ts`
- Create: `tooling/verify-release-bundle.ts`
- Create: `docs/runbooks/update-and-rollback.md`
- Create: `docs/runbooks/restore-verification.md`
- Create: `platform/observability/telemetry.ts`
- Test: `tests/integration/release-bundle.test.ts`

- [ ] Build a manifest containing image digests, migrations, config schemas, prompts, workflows, policies, eval subset and rollback metadata.
- [ ] Verify signatures offline before migration.
- [ ] Run migration, smoke subset and rollback rehearsal against a database copy.
- [ ] Emit health, queue, agent, provider, parser, export and integration metrics without document contents or secrets.
- [ ] Commit with `git commit -m "feat: add signed release operations"`.

### Task 25: Build requirement, agent-eval and UAT evidence

**Files:**
- Modify: `docs/requirements/apri-2026-08-11-requirements.yaml`
- Create: `tooling/verify-requirements.ts`
- Create: `docs/evals/agent-checklists/*.yaml`
- Create: `docs/evals/uat-protocol.md`
- Test: `tests/integration/requirement-coverage.test.ts`

- [ ] Add literal source anchors and hashes for every active TЗ requirement.
- [ ] Link each requirement to code, config, tests and evidence.
- [ ] Evaluate all nine agents on positive, negative, incomplete and conflict fixtures.
- [ ] Measure extraction, convergence, violations recall, agent checklists, Stage 2 ₽/m² threshold and Stage 3 estimate threshold using the signed UAT corpus.
- [ ] Commit with `git commit -m "test: add contract and agent acceptance evidence"`.

### Task 26: Accept and package the Day 18 release

**Files:**
- Create: `tests/e2e/customer-release.spec.ts`
- Create: `docs/runbooks/customer-installation.md`
- Create: `docs/releases/18-day-release-manifest.md`

- [ ] Deploy from an empty customer-like host using only the release bundle and installation config.
- [ ] Run auth, RLS, malicious-file, egress, provider fallback, queue recovery, API/file integration, exports and six-screen E2E gates.
- [ ] Run the full requirement verifier and UAT subset.
- [ ] Verify restore and rollback, then record evidence hashes in the release manifest.
- [ ] Commit with `git commit -m "feat: deliver full eighteen-day release"`.

---

## 6. Acceptance Gates by Release

| Gate | Day 3 | Day 10 | Day 18 |
|---|:---:|:---:|:---:|
| Real Codex provider run | Required | Required | Required |
| Nine agent outputs | Required | Required | Required |
| 40 legacy command routes | Required | Required | Required |
| Six product screens | Required | Required | Required |
| Four required exports | Required | Golden-tested | Contract-tested |
| PostgreSQL persistence and jobs | Required | Recovery-tested | Operationally tested |
| Structured parser and confirmation | Preview only | Required | Security-hardened |
| Multi-KP comparison | Demonstration mapping | Confirmed mapping | UAT-tested |
| Independent estimate | Prompt + basic deterministic tools | Deterministic baseline | Calibrated and evidenced |
| Auth/RLS/CSRF | Demo access only | Required | Security-tested |
| Egress gateway | Provider allowlist | Audited policy | Network-enforced fail-closed |
| StorHaus | Not claimed | Adapter boundary | Live if contract supplied; file fallback otherwise |
| Signed release and rollback | No | Deployment script | Required |
| Contract UAT evidence | No | Pilot evidence | Required package |

## 7. Scope Cuts That Are Not Allowed

To preserve the user's requirement, do not remove these from the Day 3 release:

- any of the nine agent identities;
- any command in the legacy command registry;
- takt dependency rules;
- source status markers and recommendations;
- all six screen routes;
- all four export buttons;
- real model execution;
- PostgreSQL persistence;
- a visually coherent responsive design system.

If schedule pressure appears, reduce depth of structured extraction, automation of proposal mapping, breadth of deterministic formulas and operational hardening. Do not replace the working product with static mock screens.

## 8. Critical Dependencies

1. A working Codex SDK-compatible provider endpoint and credentials are required in the first two hours.
2. Node.js 22, Docker, Docker Compose and PostgreSQL must be available before Task 1 completes.
3. The demo dataset must be synthetic or explicitly approved for the 7KL demo server.
4. The StorHaus schema, test endpoint and credentials must arrive by Day 11 for live integration by Day 18.
5. The inference-node responsibility conflict remains governed by `ADR-V3-005` and requires a signed protocol/change request for APRI delivery.
6. Three-day delivery assumes parallel agentic implementation tracks with integration checkpoints twice per day.

## 9. Final Verification Commands

Run before every release claim:

```bash
pnpm typecheck
pnpm test
pnpm build:web
pnpm build:worker
pnpm test:e2e
pnpm legacy:import -- --check
pnpm tsx tooling/verify-architecture.ts
pnpm tsx tooling/verify-requirements.ts
docker compose config
docker compose up --build -d
docker compose ps
```

Day 3 may omit `verify-requirements.ts` only because literal requirement linking is scheduled for Release C. It may not omit typecheck, unit tests, builds, E2E, legacy drift verification or a real Codex provider run.
