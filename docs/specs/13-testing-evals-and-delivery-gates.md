---
title: "СтройИнтеллект: testing, evals и delivery gates"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: quality
horizon: delivery
scope: testing-evals-delivery-gates
project: stroyintellekt
source: contract-owner-decisions-legacy-and-architecture
related:
  - 01-contract-requirements-and-acceptance.md
  - 02-legacy-rule-and-parameter-traceability.md
  - 03-domain-workflow-and-competency-contracts.md
  - 04-canonical-data-and-structured-output.md
  - 05-knowledge-and-parameter-platform.md
  - 06-document-ingestion-and-normalization.md
  - 07-calculation-engine.md
  - 08-retrieval-rag-and-llm-gateways.md
  - 09-security-tenancy-and-data-handling.md
  - 10-api-queue-and-runtime-state.md
  - 11-web-ui-and-export-contracts.md
  - 12-deployment-observability-and-recovery.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: testing, evals и delivery gates

## 1. Цель

Quality system доказывает:

- соответствие договорным требованиям;
- 100% traceability result-affecting parameters/rules;
- deterministic calculations;
- tenant/security isolation;
- качество dual retrieval;
- grounded LLM outputs;
- recoverability;
- готовность каждого delivery stage.

Review или demo без deterministic evidence не закрывает gate.

## 2. Evidence model

```yaml
verification_evidence:
  evidence_id: string
  gate_id: string
  requirement_ids: []
  test_suite_id: string
  test_run_id: string
  artifact_refs: []
  environment: string
  release_id: string | null
  corpus_snapshot_id: string | null
  status: passed | failed | blocked | not_run
  executed_at: date-time
  executor: string
  result_hash: sha256
```

`not_run` не может повысить readiness.

## 3. Test layers

| Layer | Scope |
|---|---|
| Static | Formatting, schema, types, dependency/security scans |
| Unit | Pure functions, parsers, formulas, rules |
| Property | Decimal/rounding/aggregation/invariants |
| Contract | API/events/provider/export schemas |
| Integration | DB/storage/queue/search/provider adapters |
| Regression | Legacy cases and known defects |
| E2E | Contractual user journeys |
| Security | Isolation, authz, malicious files, redaction |
| Performance | Users, files, runs, queues |
| Recovery | Backup, restore, failover, replay |
| Retrieval eval | File-first/RAG quality |
| LLM eval | Schema, grounding, claims, safety |

## 4. Requirement coverage

Requirement coverage matrix:

```yaml
requirement_coverage:
  requirement_id: string
  source_ref: string
  acceptance_criterion: string
  implementing_specs: []
  test_ids: []
  evidence_ids: []
  status: uncovered | planned | passed | failed | blocked
```

Правила:

- у каждого contractual requirement есть acceptance criterion;
- engineering control не маскируется под contractual requirement;
- owner decision имеет decision source;
- roadmap item не закрывает current acceptance;
- strengthened requirement явно marked engineering target.

## 5. Traceability gates

Rule/parameter coverage из spec 02:

- 100% result-affecting parameters cataloged;
- 100% executable legacy rules cataloged;
- 100% formulas have implementation disposition;
- 100% handoffs mapped;
- conflicts have explicit disposition;
- no orphan source fragments affecting results;
- no implemented formula/rule without source or owner decision;
- legacy exceptions are fixtures, not hidden comments.

## 6. Test corpus

Corpus partitions:

```text
train/dev configuration corpus
validation corpus
acceptance corpus
adversarial security corpus
performance corpus
recovery corpus
```

Acceptance labels не используются для tuning. Corpus manifest versioned and immutable.

Required case classes:

- valid XLS/XLSX;
- valid/unknown-version GRAND XML;
- DOCX contract/table;
- PDF text layer;
- PDF scan unsupported;
- missing/conflicting fields;
- decimal/sign/unit edge cases;
- ≥2 000 positions;
- malicious Office/XML/PDF;
- cross-tenant ACL attempts;
- prompt injection;
- provider outage;
- queue redelivery/worker crash;
- known broken Excel reference.

## 7. Parser and normalization gates

- ≥95% correct positions on acceptance denominator;
- 100% accepted numbers have SourceLocation;
- parser idempotency hash stable;
- unknown does not become zero;
- blocking issues prevent confirmation;
- correction creates revision and audit;
- reconciliation difference = `0.00 RUB` or explicitly explained;
- unsupported scan/format has explicit status;
- active content/network access not executed.

`≥95%` не отменяет gate `0 ₽` для unexplained financial difference.

## 8. Calculation gates

- repeated run gives same result hash;
- 100% result-affecting outputs have FormulaTrace;
- Decimal/units/rounding policy tests pass;
- formula/rule dependency cycles rejected;
- unregistered formula/rule rejected;
- missing/conflict behavior verified;
- property and mutation tests pass;
- legacy golden cases pass or have approved intentional-difference decision;
- LLM/Excel unavailable does not affect deterministic result;
- totals reconcile.

Property/mutation tests являются engineering quality controls и не расширяют буквальные критерии договорной приёмки.

## 9. Workflow/runtime gates

- proven DAG edges present;
- direct `Денчик → Ваныч` handoff tested;
- `Ваныч → Марина || Халиль` parallel behavior tested;
- pruning trace required;
- state transition model enforced;
- idempotent API and queue redelivery;
- lease expiry recovery;
- cancel/retry behavior;
- stale approval rejected;
- outbox/state atomicity;
- dead-letter visibility.

## 10. Security gates

Release blocking:

- cross-tenant leakage = 0;
- authorization bypass = 0;
- residual sensitive fields in outbound acceptance corpus = 0;
- provider call after failed redaction = 0;
- malicious file code/network execution = 0;
- public object ACL = 0;
- committed secrets = 0;
- forged queue messages rejected;
- tenant isolation preserved by migrations/restores;
- deletion flow verified.

Any confirmed cross-tenant leak is critical release blocker.

## 11. Retrieval evaluation

### 11.1 Shared protocol

- same queries;
- equivalent corpus;
- same ACL/effective-date filters;
- fixed snapshots;
- blind acceptance set;
- repeated runs where provider/model variability exists.

### 11.2 Metrics

- Recall@K;
- Precision@K;
- MRR;
- nDCG;
- citation precision/recall;
- downstream answer groundedness;
- unsupported claim rate;
- latency;
- cost;
- human preference;
- task success;
- leakage/safety.

### 11.3 Decision rule

RAG admission requires:

- security gates pass;
- retrieval/grounding thresholds pass;
- no material regression against file-first on critical queries;
- approved latency/cost;
- rollback proof;
- owner decision.

If RAG improves aggregate metric but fails critical legal/normative query, admission fails.

## 12. LLM evaluation

Dataset includes:

- schema-compliant tasks;
- ambiguous/missing evidence;
- conflicting sources;
- prompt injection;
- Russian construction terminology;
- factual vs recommendation separation;
- source citation;
- redaction-sensitive payloads.

Metrics:

- JSON schema validity;
- field-level accuracy;
- factual claim support;
- citation accuracy;
- hallucination/unsupported claim rate;
- refusal/unknown correctness;
- sensitive-data residual rate;
- latency/cost;
- deterministic non-LLM fallback success.

## 13. Export gates

- обязательная XLSX/DOCX parity;
- для `REQ-TZ-10-03` и `ACC-TZ-12-03` отдельный `violations_registry_xlsx` содержит 100% canonical violations и обязательные поля: позиция, нарушение, сумма/status, основание и путь урегулирования;
- totals/key indicators equal canonical snapshot;
- manifests/versions included;
- FormulaTrace/source coverage preserved;
- no macros/external links in XLSX/DOCX;
- договорные XLSX formulas после пересчёта совпадают с canonical values;
- optional PDF readable/paginated, если adapter включён;
- optional JSON schema valid, если adapter включён;
- export retry does not create duplicate authoritative artifact;
- re-opening Excel does not change canonical result.

## 14. UI/E2E gates

Contractual journeys:

1. sign in and select tenant/project;
2. upload supported document;
3. review/correct/confirm;
4. create analysis and run;
5. inspect DAG/progress;
6. review evidence/calculations;
7. approve/reject;
8. export/download.

Checks:

- keyboard-only;
- accessibility automated + manual;
- error/retry states;
- permission boundaries;
- stale state;
- large-table usability;
- source/trace navigation.

Accessibility/WCAG controls являются engineering product-quality target; договорный gate остаётся привязанным к пяти пользовательским экранам и согласованному UAT.

## 15. Performance gates

Separate scenarios:

- 10 simultaneous APRI users;
- one large 2 000+ position file;
- concurrent uploads;
- configurable concurrent full analyses;
- queue backlog/recovery;
- export load;
- provider throttling.

Report always distinguishes user concurrency from full-analysis concurrency.

Thresholds are owner-approved engineering targets after baseline; they are not silently contractual.

## 16. Recovery gates

- scheduled backup success;
- restore drill;
- source/result hash validation after restore;
- isolation/RLS validation;
- queue/outbox/in-flight reconciliation;
- duplicate provider/artifact prevention;
- file-first availability;
- RAG index rebuild parity if admitted;
- measured RPO/RTO against approved targets.

## 17. Delivery stages

### 17.1 Договорные stage gates

Компонентные gates ниже не заменяют три договорных этапа.

#### Stage S1, день 30

Evidence:

- доступ и provider configuration;
- три режима и их versioned policies;
- initial knowledge base;
- эталонные образцы;
- согласованный competency checklist;
- ответы всех девяти компетенций на согласованных эталонах;
- intermediate acceptance record.

#### Stage S2, день 60

Evidence:

- deterministic calculations и financial model;
- supported parsers/normalization;
- договорные `analysis_xlsx`, `report_docx`, `violations_registry_xlsx`;
- formula/export parity;
- intermediate acceptance record.

#### Stage S3, день 90

Evidence:

- пять верхнеуровневых экранов;
- PostgreSQL queue/DAG;
- operation journal;
- full contractual acceptance corpus на двух объектах;
- training/handoff;
- pilot deployment;
- final acceptance record.

Для каждого stage:

- результат передаётся на промежуточную проверку;
- customer decision ожидается один рабочий день;
- замечание должно ссылаться на ТЗ;
- задержка customer decision или обязательной dependency фиксируется и сдвигает только зависимые сроки;
- `DEP-TZ-15-*` имеет status/evidence;
- failed/missing evidence не может быть заменён component-gate verdict.

### Gate G0: Specification ready

- specs 00–13 internally consistent;
- decisions/blockers cataloged;
- requirement and traceability matrices defined;
- no unresolved contradiction on core scope.

### Gate G1: Foundation ready

- canonical schemas;
- tenant/auth skeleton;
- storage/database/queue baseline;
- CI/static/security checks;
- release/version manifests.

### Gate G2: Ingestion ready

- parsers/normalization/review;
- parser corpus gates;
- immutable snapshots;
- reconciliation;
- malicious-file controls.

### Gate G3: Deterministic analysis ready

- parameter/rule/formula catalogs;
- calculation engine;
- legacy parity;
- FormulaTrace;
- workflow DAG/runtime.

### Gate G4: User product ready

- web flow;
- approvals;
- result/trace viewer;
- exports and parity;
- accessibility/e2e.

### Gate G5: Retrieval comparison ready

- file-first baseline;
- RAG test/eval setup;
- fixed snapshots/corpus;
- offline eval report;
- no production admission implied.

### Gate G6: Pilot ready

- contractual acceptance mapped;
- security/performance/recovery;
- APRI pilot runbook/support;
- open critical blockers = 0;
- owner/customer approval where required.

### Gate G7: RAG production admission

- G6 passed;
- shadow/canary proof;
- approved metrics/cost;
- rollback;
- explicit owner decision.

## 18. Gate verdict

```yaml
gate_record:
  gate_id: G0 | G1 | G2 | G3 | G4 | G5 | G6 | G7
  release_id: string | null
  verdict: pass | conditional | blocked | fail | not_run
  criteria: []
  evidence_ids: []
  blockers: []
  approved_by: []
  decided_at: date-time | null
  next_action: string
```

`conditional` не разрешён для critical security, traceability или calculation integrity criteria.

## 19. CI pipeline

Per change:

```text
format/lint
→ schema/type checks
→ unit/property tests
→ contract tests
→ dependency/license/secret scans
```

Milestone/release:

```text
integration
→ legacy regression
→ security/adversarial
→ UI E2E/accessibility
→ retrieval/LLM evals
→ performance
→ backup/restore
→ release manifest
→ gate decision
```

## 20. Flaky and nondeterministic tests

- flaky tests не игнорируются;
- quarantine имеет owner, reason, expiry;
- quarantined critical gate = blocker;
- provider evals report distribution and sample count;
- deterministic core tests не используют live provider;
- snapshots/models/prompts pinned.

## 21. Defect severity

| Severity | Пример | Release |
|---|---|---|
| `critical` | Leakage, wrong financial sign/total, source fabrication | block |
| `major` | Broken contractual workflow/export, lost trace | block |
| `normal` | Non-critical behavior with workaround | decision |
| `minor` | Cosmetic/non-blocking | may defer |

## 22. Acceptance of quality system

- every contractual requirement maps to executable evidence or explicit external/customer acceptance;
- every result-affecting rule/parameter has coverage;
- test evidence reproducible by release/corpus/snapshot IDs;
- `not_run` cannot become pass;
- zero tolerance gates enforced automatically where possible;
- full-analysis concurrency not conflated with 10 users;
- file-first and RAG compared fairly;
- production RAG disabled until G7;
- recovery proof is an executed restore, not backup existence;
- critical defect prevents release.

## 23. Decisions before implementation

| ID | Decision |
|---|---|
| `DEC-QA-001` | Exact retrieval/LLM thresholds |
| `DEC-QA-002` | Performance budgets and full-analysis concurrency |
| `DEC-QA-003` | Approved SLO/RPO/RTO |
| `DEC-QA-004` | Acceptance corpus governance |
| `DEC-QA-005` | Customer acceptance responsibilities |
| `DEC-QA-006` | Required browser/device matrix |
| `DEC-QA-007` | Gate approvers |
