# Технический аудит текущего `Gauxared/ahma` относительно CAUDEX v1.1

**Scope проверки.** Read-only checkout `origin/main` на commit `a8ec8964e4e746ab4158a0c75ef22443e7c97aec` (18.09.2026). Проверены все документы CAUDEX в порядке из `TASK_CODEX_AUDIT.md`; при конфликте применялся `ADDENDUM_V1_1_NEW_MATERIALS.md`. Полная Git-history доступной ветки `main` также проверена. Ни production-код, ни существующие документы CAUDEX не изменялись.

Статусы в отчёте: `CONFIRMED`, `PARTIAL`, `NOT_FOUND`, `CONFLICTED`, `STALE_DOCUMENTATION`, `CANNOT_VERIFY`.

## 1. Executive conclusion

CAUDEX совместим с текущей технической базой, но не с текущим **предметным центром runtime**. Rewrite не нужен: у проекта есть зрелые переиспользуемые reader/adapters, source/version persistence, provenance, unknown-safe расчёты, formula trace, matching по коду и human confirmation. Однако они обслуживают поток `object package → check-object → role/agent reports → Artifact`, а не ledger работы и её переходов.

Главный reuse asset — связка `modules/canonical/` + `packages/contracts/` + `modules/documents/`/`platform/storage/` + `platform/db/`: она уже хранит документные версии и строки, умеет exact matching, нормализует единицы, не считает неизвестное нулём и сохраняет ссылку на источник. Главный architectural gap — отсутствие persisted `WorkItem` и событий `ProgressEvent → Evidence → Submission → Acceptance → Payment`, количественного lifecycle engine и first-class `Blocker/Finding`. Поэтому существующий `Position` — ближайшая **строка сметы**, а не работа, объединяющая план, факт и деньги.

Главный риск миграции — использовать `Artifact.body`, `AgentRun.findings` или agent prompt как источник business truth. Они привязаны к `Check`, role flow и JSON-отчёту, не дают idempotent quantity ledger, allocation платежа или lifecycle частичных объёмов. Второй риск — ошибочно считать EVM/четыре dashboard реализованными: доступный main этого не подтверждает.

**Вердикт:** новый deterministic work-control flow можно строить рядом с `check-object`, без crew/routing и без big-bang rewrite. Для полного требуемого контура сперва нужны новые business contracts/persistence; для первого доказательного slice достаточно плановой позиции + суточного факта + evidence/ОЖР и blocker `performed_not_evidenced` или `performed_not_submitted`.

## 2. Verification of new-material claims

| Claim | Status | Evidence | Comment |
|---|---|---|---|
| Создан `config/thresholds/registry.json` | `NOT_FOUND` | В checkout отсутствует каталог `config/thresholds/`; `config/` содержит `formulas/`, `parameters/`, но не `thresholds/`. | Полная history `main` не содержит изменений по этому пути. Реализация могла быть только в недоступной локальной/неотправленной копии; в current main не доказана. |
| Шесть domain thresholds вынесены из calculations | `CONFLICTED` | `modules/calculations/lead-time.ts` (`QUOTE_THRESHOLD=100_000`, `REQUIRED_QUOTES=3`, `BURNING_DAYS=14`, `URGENT_DAYS=42`); `volume-reversal.ts` (`TOLERANCE=0.005`, `FLAG_ABOVE=2`); `deviation-class.ts` (`MARKET_TOLERANCE=0.05`). | `config/formulas/registry.json` существует, но это реестр формул, а не изменяемых порогов. Часть чисел может быть algorithm structure, но перечисленные business alert/quote thresholds остаются в коде. |
| Architecture gate проверяет threshold literals и unused thresholds | `PARTIAL` | `tooling/verify-architecture.ts` проверяет formula id/version, зарегистрированные но неиспользуемые **формулы**, dated VAT/key-rate literals, isolation и unwired exports. | В gate нет загрузки threshold registry, проверки threshold literals или unused thresholds. Документация новых материалов в этой части `STALE_DOCUMENTATION` относительно checkout. |
| SPI/CPI/EAC/SV/CV реализованы | `NOT_FOUND` | Нет calculation/EVM файлов или формул в `modules/calculations/` и `config/formulas/registry.json`; exact search вне CAUDEX/docs/product находит EVM только в agent prompt `config/agents/finance-model/source-prompt.txt`. | Prompt не является deterministic calculation artifact и не содержит PV/EV/AC semantics. Git history main не содержит EVM-related commits. |
| EVM dashboard реализован | `NOT_FOUND` | `apps/web/app/` содержит object/check/agent/document views; нет EVM route/read model. EVM text есть в `config/agents/finance-model/source-prompt.txt`, а не в application view. | Dashboard output из prompt не подтверждает UI/read model. |
| 1956 test suites зелёные | `CANNOT_VERIFY` | В tree 206 `*.test.*`/`*.spec.*` файлов; `package.json` задаёт `vitest run`; в checkout нет `node_modules`. | Текущий запуск не выполнялся без зависимостей. «1956» встречается только в `CAUDEX/source-materials/2026-09-16/spec-analiticheskiy-sloy_2.md`; это reported claim, а не проверяемый результат checkout. |
| Formula registry/trace и fail-closed formula validation существуют | `CONFIRMED` | `config/formulas/registry.json`, `platform/config/formula-registry.ts`, `tooling/verify-architecture.ts`, `prisma/schema.prisma` model `FormulaTrace`. | 16 formula registrations и matching `formulaId`/version in calculation code; это сильный reusable pattern, но не EVM. |

## 3. Validated current-code mapping

| Area | CAUDEX classification | Audit result | Evidence paths | Recommendation |
|---|---|---|---|---|
| Deterministic calculations | REUSE | `CONFIRM` | `modules/calculations/*.ts`, `*.test.ts` | Reuse style/trace only; add lifecycle calculations separately. |
| Formula registry | REUSE | `CONFIRM` | `config/formulas/registry.json`, `platform/config/formula-registry.ts`, `tooling/verify-architecture.ts` | Preserve registry and fail-closed version/use checks; add only genuinely configurable business parameters. |
| Document/storage readers | REUSE | `CONFIRM` | `platform/storage/adapters.ts`, `universal-reader.ts`, `xlsx-reader.ts`, `docx-reader.ts`, `pdf-reader.ts`, `archive-expander.ts` | Reuse physical reading; add first-contour profiles above it. |
| Canonical matching / units | ADAPT | `CONFIRM` | `modules/canonical/item-registry.ts`, `map-position.ts`, `match-ledger.ts`, `units.ts` | Extend the existing contract toward WorkItem; do not make a parallel domain package. |
| Contracts / provenance | ADAPT | `CONFIRM` | `packages/contracts/domain.ts`, `packages/contracts/provenance.ts` | Retain primitives and SourceRef; add lifecycle types in this package. |
| Intake | ADAPT | `CHANGE_CLASSIFICATION` | `modules/intake/passport.ts`, `routing.ts`, `object-passport.ts` | Current intake is package/passport and agent-routing support, not independent SourceDocument intake. Split document registration from routing. |
| Workflow | ADAPT / SPLIT | `CONFIRM` | `modules/workflow/check-object.ts`, `platform/execution/check-executor.ts` | Leave `check-object` intact; create a separate deterministic application workflow. |
| DB / repositories | REUSE / ADAPT | `CONFIRM` | `prisma/schema.prisma`, `platform/db/extraction-repository.ts`, `artifact-repository.ts` | Reuse tenancy, transaction and version patterns; add ledger persistence rather than JSON artifact fields. |
| Jobs, queue, security | REUSE | `CONFIRM` | `platform/jobs/job-repository.ts`, `platform/queue/`, `platform/security/` | Reuse unchanged when new flow is made asynchronous. |
| Reference/eval | REUSE / ADAPT | `PARTIAL` | `modules/eval/`, `config/reference-cases/`, `CAUDEX/09_ACCEPTANCE_CASES.md` | Evaluation infrastructure exists, but AC-01…AC-21 fixtures/golden matrix are not found as runnable CAUDEX tests. |
| Web shell | ADAPT | `CONFIRM` | `apps/web/app/page.tsx`, `apps/web/app/objects/[code]/documents/page.tsx`, `apps/web/lib/check-read-model.ts` | Reuse shell/auth/read pattern; present read models rather than agent report pages. |
| General exports | ADAPT / FREEZE | `SPLIT` | `modules/exports/by-agent.ts`, `agent-report.ts` | Agent-oriented exports freeze; reusable tabular/file mechanisms may adapt after structured Finding exists. |
| Agents and agent configs | FREEZE / selective ADAPT | `CONFIRM` | `modules/agents/`, `config/agents/*` | Preserve only controlled extraction/matching/explanation adapters; do not add roles. |
| Crew/routing/agentic execution | FREEZE → REMOVE_CANDIDATE | `CONFIRM` | `config/crew/`, `config/routing.json`, `platform/execution/agentic-reviewers.ts`, `platform/codex/crew-reviewers.ts` | Keep legacy compatible; it is not a dependency of the proposed flow. `REMOVE_CANDIDATE` means later dependency decision only. |
| LLM adapter/journal | REUSE | `CONFIRM` | `platform/runtime/agent-runtime-port.ts`, `openai-compatible-adapter.ts`, `call-journal.ts`, `platform/db/model-call-repository.ts` | Reuse only where an ambiguity persists after deterministic parsing/matching. |
| Closure/lifecycle contour | MISSING | `CONFIRM` | Absence from `prisma/schema.prisma`, `modules/calculations/`, `apps/web/app/`; current `Check`/`Artifact` models are check-oriented. | Establish new contracts, persisted ledger and deterministic engines incrementally. |

## 4. Domain gap analysis

| Target entity/capability | Existing nearest analogue | Gap | Action |
|---|---|---|---|
| SourceDocument/version | `Document`/`DocumentVersion` | Has object, hash, immutable revision and storage path; lacks first-contour profile, parse status/warnings/source priority as business contract. | ADAPT existing model/repository. |
| WorkItem / alias | `CanonicalItem`, `Position` | Canonical item is norm-code catalogue; Position is an estimate line. Neither is persistent cross-source work identity/alias. | ADD WorkItem and alias boundary in existing contracts/DB. |
| WorkMatch | `MatchLedger`, `PositionMapping` | In-memory key is `offerLine`; no persistence, SourceRef, source-to-WorkItem record or match method lifecycle. | ADAPT ledger semantics into persisted match record. |
| ProgressEvent | Extracted Position and `ExtractionRevision` | Versioned extraction exists; no date, incremental/cumulative semantics, idempotency or WorkItem match. | MISSING. |
| Evidence / readiness | Document/version and agent findings | Readers can read files; no evidence taxonomy/requirements or deterministic readiness. | MISSING. |
| Submission / Acceptance | `Artifact`, agent findings | No KS-2 line, submitted/accepted/rejected state or partial quantity. | MISSING. |
| Payment / allocation | `finance.ts`, `finance-model.ts` | Cash-flow and finance formulas exist, but no payment source ingestion or allocation to acceptance/work. | MISSING. |
| Blocker / Finding | `ReviewFinding`, `AgentRun.findings` | Has severity/basis/optional source/impact but is agent report JSON; lacks lifecycle transition, resolved state, rule and persisted business identity. | ADAPT for display vocabulary only; MISSING as domain ledger. |
| DataConflict | `ExtractionRevision` | Revision/history exists, but no source-priority/conflict policy between business facts. | MISSING. |
| DataQualitySnapshot | document counts, positions, unmatched, `acquisition`, check degradations | Inputs exist partially in `DocumentVersion`, `Position`, `MatchLedger`, `Artifact`; no aggregate contract/read model. | MISSING projection, not a new agent. |
| CPM imported schedule | schedule agent/prompt and generic spreadsheet readers | No activity/dependency/calendar model or CPM/float algorithm found. | MISSING phase-2 capability; raw-network generation is separately MISSING. |

## 5. Agentic dependency assessment

**Reusable infrastructure.** `platform/storage/*` readers, `platform/runtime/*` strict schema/adapter/call journal, `platform/db/model-call-repository.ts`, document extraction revision, and canonical utilities do not require crew. They can support structured fallback extraction, candidate matching or explanation once called from the new workflow.

**Semantic capabilities, not business authority.** `modules/documents/vision-extract.ts`, `modules/canonical/text-match.ts`, `modules/agents/*` and configured prompts can be evaluated as optional boundary adapters. Their output must carry source fragment, confidence and confirmation; it must not write lifecycle quantity/payment state directly.

**Legacy-only orchestration and coupling.** `modules/workflow/check-object.ts` defines a complete object check around `DocumentReview`/`ReviewFinding`. `platform/execution/check-executor.ts` selects pipeline, agentic or Codex crew reviewers (`buildReviewers`, `buildAgenticReviewers`, `buildCrewReviewers`); `modules/intake/routing.ts` is explicitly derived from `config/routing.json`; web agent pages read `AgentRun`/check artifacts. This is coupling to check/report UX, not a reusable prerequisite for a work ledger.

**Answer:** **yes**. A new work-control flow can run with LLM/crew disabled while reusing parsers, storage, unit handling, exact code matching, provenance and DB transactions. This is also consistent with `check-executor.ts`: its deterministic document path works when model capability is absent, but it currently ends at a check artifact rather than CAUDEX lifecycle facts.

## 6. Input/document support matrix

`SUPPORTED` means a named structural parser exists; `GENERIC_READER_ONLY` means bytes/text/tables can be read but no business profile exists.

| First-contour source | Status | Evidence | Audit finding |
|---|---|---|---|
| Estimate / LSR | SUPPORTED | `modules/documents/operations/parse-estimate.ts`, `parsers/ssrss.ts`, `parsers/grand-smeta.ts`, `platform/storage/*-reader.ts` | Structured estimate parsing and positions/provenance exist. |
| VOR | GENERIC_READER_ONLY | `platform/storage/xlsx-reader.ts`, `docx-sheet-reader.ts`, `modules/workflow/check-object.ts` kind `книга-не-смета` | Readable non-estimate workbook is deliberately not parsed as a WorkItem plan profile. |
| Daily report | NO_PROFILE | `platform/storage/universal-reader.ts`, `modules/documents/parser-registry.ts` | Physical formats may be read; no daily quantity/date parser or ProgressEvent output. |
| OJR | NO_PROFILE | same generic reader/registry evidence | No OJR field extraction, evidence typing or no-quantity outcome contract. |
| Executive docs | PARTIAL | `modules/documents/design-documents.ts`, `platform/storage/pdf-reader.ts`, `docx-reader.ts` | Text layer can feed legacy technical review; not executive-document/evidence profile. |
| KS-2 | NO_PROFILE | `modules/documents/` parser inventory; no KS-2 parser/contract | No SubmissionLine or submitted-state extraction. |
| KS-3 | NO_PROFILE | same | No commercial summary profile or acceptance/payment semantics. |
| Contract / addendum | GENERIC_READER_ONLY | `platform/storage/docx-reader.ts`, `docx-reader.test.ts`, `modules/intake/object-passport.ts` | Reads text/tables; passport exposes optional contract number/price, not obligations/change basis. |
| Payment source | MISSING | no payment parser in `modules/documents/`, no Payment model in `prisma/schema.prisma` | Finance calculations accept supplied values; they do not ingest/allocate payment facts. |
| KSG | GENERIC_READER_ONLY | `platform/storage/xlsx-reader.ts`; schedule agent config `config/agents/schedule/` | No schedule profile, activity graph, CPM or float calculation. |

## 7. Persistence gap

The closest reusable persisted chain is `ProjectObject → Document → DocumentVersion → Position`, with immutable content hashes, source row/sheet, tenant isolation, and `ExtractionRevision`. `Artifact`, `AgentRun` and `FormulaTrace` preserve check/run output and formula trace, but cannot substitute a domain ledger: `Artifact.body` and `AgentRun.findings` are JSON scoped to a check, and no schema model names WorkItem, ProgressEvent, Evidence, Submission, Acceptance, Payment, Allocation, Blocker, Finding or DataConflict.

Reuse points: `prisma/schema.prisma` tenant/RLS patterns; `platform/db/extraction-repository.ts` save/version transaction; `DocumentVersion.contentHash`; `Position.sourceRow`, `sheet`, `acquisition`; and `packages/contracts/provenance.ts`. Gaps to add incrementally are persistent IDs/aliases/matches, events with idempotency and source version, evidence/readiness, commercial/acceptance/payment allocation, conflict resolution and derived blockers/findings. No final Prisma schema is proposed by this audit.

## 8. EVM semantic audit

**Verdict: NOT_READY.**

There is no current deterministic EVM calculation, formula-registry record, persistence model or UI projection. More importantly, none of the semantic gates is evidenced in code: no PV baseline plus budgeted scope mapping; no EV method and status date; no AC cost methodology; no source priority/conflict policy; no unit/currency policy; and no control reference case. Existing finance model and agent prompt are not substitutes.

`AC == KS-2/KS-3/customer payment` is **not evidenced and must not be assumed**. `modules/calculations/finance.ts`/`finance-model.ts` operate on supplied finance inputs; the data model has no KS-2/KS-3/payment allocation. Per CAUDEX v1.1, until a cost source and definition are accepted, AC is `UNKNOWN` and CPI/EAC are not computable.

CPM is likewise `NOT_FOUND`: no activity/dependency/calendar/float model or graph algorithm appears in `modules/` or `packages/`. Importing a supplied network and calculating CPM is a later deterministic capability; creating a network from raw documents is a distinct, still unimplemented capability and is not a prerequisite for the closure MVP.

## 9. Recommended minimum vertical slice

Use one real/sanitised reference package containing a parsed estimate/plan row, one daily report record and one OJR/evidence record for the same work. The slice is:

`estimate/VOR → parsed planned record → WorkItem (exact-code match) → daily ProgressEvent → OJR Evidence → deterministic lifecycle snapshot → Blocker/Finding + source trace`.

Include **Evidence** in this first slice: it proves CAUDEX's key distinction `performed != evidenced` and exercises the core architectural hypothesis—facts, provenance and deterministic rule create an actionable blocker without a crew. Defer Submission/Acceptance/Payment to the next slice; they need document profiles and commercial/allocation semantics not currently present. Select data that can yield either `performed_not_evidenced` (missing required OJR) or `performed_not_submitted`; output must expose planned/performed/evidenced quantities, unknown reasons, match status and SourceRef.

Reuse `parse-estimate.ts`/storage readers, `CanonicalItemRegistry` and `mapPosition.ts` for exact-code plan mapping, `units.ts`, provenance primitives, `Document`/`DocumentVersion` transaction pattern, and formula trace style. Missing pieces are WorkItem persistence, daily/OJR profile/envelope, ProgressEvent idempotency, evidence requirement rule, lifecycle aggregation and blocker record. Crew/routing are explicitly outside the call graph.

## 10. Proposed first implementation sequence

| PR-sized task | CAUDEX ref | Existing files reused | New boundary needed | Acceptance case | Risk |
|---|---|---|---|---|---|
| 1. Contracts-only work ledger primitives | 06, 07; 11 B-01 | `packages/contracts/domain.ts`, `provenance.ts`, canonical primitives | WorkItem, alias/match, ProgressEvent/Evidence contracts and unknown/conflict semantics | AC-03, AC-04, AC-09 as pure tests | Duplicating `CanonicalItem` instead of defining an explicit relationship. |
| 2. Persist source/work/match/events minimally | 07; 08 FR-02–05; 11 B-02/B-03/E-01 | `prisma/schema.prisma`, `platform/db/extraction-repository.ts`, version/hash patterns | Ledger persistence and idempotency key, without changing legacy check tables | AC-06, AC-07, AC-08 | Treating a document revision as an event or collapsing incremental/cumulative semantics. |
| 3. Plan + daily/OJR profile envelope | 07; 08 FR-01/04/07; 11 C-01–C-04 | `platform/storage/*`, `modules/documents/parser-registry.ts`, `parse-estimate.ts` | IngestedDocument/profile outputs for plan, daily fact and OJR | AC-03 | Confusing readable text with a structurally extracted business fact. |
| 4. Exact WorkItem matching and unit gate | 08 FR-03/06; 11 D-01/D-02/E-03 | `item-registry.ts`, `map-position.ts`, `units.ts`, `match-ledger.ts` semantics | Persistent alias/WorkMatch and review status | AC-04, AC-09 | Allowing an unconfirmed fuzzy candidate to affect quantities. |
| 5. Deterministic first lifecycle + blocker | 06; 08 FR-08–10/13/20; 11 E-04/F-01–F-03/H-01–H-02 | calculation test/trace conventions and provenance | Quantity aggregation, evidence requirement, `performed_not_evidenced` finding | AC-01, AC-02 | Treating missing evidence or missing quantity as zero. |
| 6. Reference fixture/golden gate before UI | 09; 11 K-01/K-02 | `modules/eval/`, existing Vitest configuration | Executable reference package and CAUDEX acceptance matrix subset | AC-01–AC-04, AC-06–AC-09 | Project-specific fixture logic concealed as generic rules. |

## 11. Contradictions / decisions required

1. **PV/EV/AC contract.** A product owner/finance owner must define PV, EV, AC, status date, budget/scope mapping, source priority and conflict policy with a control example. Code cannot infer whether customer revenue documents or cash receipts constitute actual cost.
2. **Evidence requirement profiles.** The business must approve which evidence is required by work type, and when an OJR/other document is sufficient. This cannot be recovered from a generic reader or agent prompt.
3. **Location of the reported 16.09 implementation.** Available `main` and its full history do not contain thresholds/EVM/dashboard changes. If a local branch/copy is authoritative, it must be supplied for a separate audit; current status remains unverified, not a claim that the material is false.
4. **Reference source set and commercial role.** Choose the permitted real/sanitised daily/OJR sources and state whether the planned/commercial basis is contractor revenue, subcontractor cost, or another role before the closure/payment stages.

## 12. Final recommendation

**PROCEED_WITH_CORRECTIONS**

1. Preserve and reuse the verified deterministic/document/provenance foundation; no big-bang rewrite is justified.
2. Correct the current-code map to distinguish in-memory canonical matching and check/report persistence from a persisted work lifecycle ledger.
3. Treat threshold registry, threshold-literal gate, EVM formulas/dashboard and 1956-green claim as `NOT_FOUND`/`CANNOT_VERIFY` for the accessible main, not as implemented capabilities.
4. Start with the evidence-aware plan/daily/OJR vertical slice and prove it without LLM/crew.
5. Do not start EVM or the four dashboard projections until the required business semantics and canonical facts exist.


