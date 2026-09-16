---
title: "СтройИнтеллект: API, queue и runtime state"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: system
horizon: delivery
scope: api-queue-runtime-state
project: stroyintellekt
source: architecture-and-owner-decisions
related:
  - 03-domain-workflow-and-competency-contracts.md
  - 04-canonical-data-and-structured-output.md
  - 06-document-ingestion-and-normalization.md
  - 07-calculation-engine.md
  - 08-retrieval-rag-and-llm-gateways.md
  - 09-security-tenancy-and-data-handling.md
  - 11-web-ui-and-export-contracts.md
  - 12-deployment-observability-and-recovery.md
  - 13-testing-evals-and-delivery-gates.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: API, queue и runtime state

## 1. Цель

Runtime предоставляет стабильный API и durable execution model для:

- загрузки и подтверждения входных данных;
- запуска анализа;
- исполнения competency DAG;
- human review/approval;
- retry/cancel;
- формирования exports;
- просмотра progress и evidence.

API request не держит долгий расчёт синхронно.

## 2. Architectural boundary

```text
Web/UI/API client
→ API service
→ transaction + outbox
→ queue
→ orchestrator/workers
→ immutable snapshots/artifacts
→ event/progress API
```

Business truth хранится в database/snapshots, не в PostgreSQL queue lease и не в process memory.

## 3. Public API conventions

- prefix `/api/v1`;
- JSON UTF-8;
- UUID IDs;
- ISO 8601 UTC timestamps;
- decimal numbers в domain payload передаются strings;
- optimistic concurrency через `revision`/ETag;
- mutation requests поддерживают `Idempotency-Key`;
- trace ID возвращается клиенту;
- errors соответствуют RFC 9457 Problem Details.

```yaml
problem:
  type: uri
  title: string
  status: integer
  detail: string
  instance: string
  code: string
  trace_id: string
  field_errors: []
```

## 4. Core resources

| Resource | Назначение |
|---|---|
| `/projects` | Tenant projects |
| `/documents` | Logical documents |
| `/document-versions` | Immutable uploads |
| `/normalized-snapshots` | Input revisions/confirmation |
| `/analyses` | User-facing analysis |
| `/analysis-runs` | Immutable execution attempts |
| `/competency-runs` | DAG node executions |
| `/approvals` | Human decisions |
| `/artifacts` | Reports/exports/evidence |
| `/events` | Progress/audit-facing events |

## 5. Endpoint baseline

```text
POST   /api/v1/projects
GET    /api/v1/projects/{project_id}

POST   /api/v1/projects/{project_id}/documents
POST   /api/v1/documents/{document_id}/versions
GET    /api/v1/document-versions/{version_id}

GET    /api/v1/document-versions/{version_id}/normalization
PATCH  /api/v1/normalized-revisions/{revision_id}
POST   /api/v1/normalized-snapshots/{snapshot_id}/confirm

POST   /api/v1/projects/{project_id}/analyses
GET    /api/v1/analyses/{analysis_id}
POST   /api/v1/analyses/{analysis_id}/runs
GET    /api/v1/analysis-runs/{run_id}
POST   /api/v1/analysis-runs/{run_id}/cancel
POST   /api/v1/analysis-runs/{run_id}/retry

GET    /api/v1/analysis-runs/{run_id}/competencies
GET    /api/v1/analysis-runs/{run_id}/events

POST   /api/v1/approvals/{approval_id}/decisions
POST   /api/v1/analysis-runs/{run_id}/exports
GET    /api/v1/artifacts/{artifact_id}
```

## 6. Analysis

```yaml
analysis:
  analysis_id: uuid
  tenant_id: uuid
  project_id: uuid
  title: string
  active_run_id: uuid | null
  created_by: uuid
  created_at: date-time
  updated_at: date-time
  revision: integer
```

## 7. AnalysisRun

```yaml
analysis_run:
  run_id: uuid
  tenant_id: uuid
  analysis_id: uuid
  snapshot_set_ref: uuid
  snapshot_set_hash: sha256
  normalized_snapshot_id: uuid
  knowledge_snapshot_id: uuid
  knowledge_manifest_hash: sha256
  workflow_definition_version: string
  execution_policy_version: string
  mode: express | standard | expert
  mode_policy_version: string
  retrieval_track: file_first | rag_enabled
  retrieval_snapshot_ref: string
  status: queued | running | waiting_approval | completed | completed_with_warnings | failed | cancelled
  created_by: uuid
  created_at: date-time
  started_at: date-time | null
  completed_at: date-time | null
  heartbeat_at: date-time | null
  input_hash: sha256
  result_hash: sha256 | null
```

Run immutable по входным snapshots/policies. Retry после `failed` создаёт новый `AnalysisRun`; исторический run не переходит обратно в `queued`.

## 8. CompetencyRun

```yaml
competency_run:
  competency_run_id: uuid
  tenant_id: uuid
  analysis_run_id: uuid
  competency_id: string
  phase_contract_id: string
  attempt: integer
  status: pending | ready | queued | running | succeeded | failed | blocked | skipped_not_applicable | cancelled
  dependency_refs: []
  input_snapshot_hash: sha256
  output_artifact_ids: []
  started_at: date-time | null
  finished_at: date-time | null
  failure_code: string | null
  lease_owner: string | null
  lease_expires_at: date-time | null
```

`phase_contract_id` ссылается на versioned contract конкретной компетенции, например `contract_effect`, `preliminary_model`, `final_model`, `intake`, `synthesis`. `skipped_not_applicable` допустим только по recorded pruning decision.

## 9. State transitions

```text
queued → running
running → waiting_approval → running
running → completed
running → completed_with_warnings
running → failed
queued|running|waiting_approval → cancelled
```

Для `CompetencyRun` authoritative enum задан в §8. `blocked` является состоянием competency node, а не `AnalysisRun`. Повторный запуск после `failed` создаёт новый run с новой identity.

Любой transition:

- проверяется state machine;
- записывается atomically;
- создаёт `DomainEvent`;
- включает actor/reason;
- не перезаписывает historical event.

## 10. DomainEvent

```yaml
domain_event:
  event_id: uuid
  tenant_id: uuid
  aggregate_type: analysis | run | competency | approval | artifact
  aggregate_id: uuid
  aggregate_revision: integer
  event_type: string
  payload: object
  occurred_at: date-time
  actor_type: user | service | system
  actor_id: uuid | null
  trace_id: string
```

Events применяются для progress/integration, но canonical current state хранится в transactional store.

## 11. Queue message

```yaml
job_message:
  message_id: uuid
  job_id: uuid
  job_type: parse | normalize | calculate | competency | retrieve | llm | export
  tenant_id: uuid
  project_id: uuid
  analysis_run_id: uuid | null
  competency_run_id: uuid | null
  attempt: integer
  input_refs: []
  policy_snapshot_id: string
  trace_id: string
  created_at: date-time
  not_before: date-time | null
  signature: string
```

Payload содержит references, не raw documents.

## 12. Transactional outbox

State mutation и outbox event записываются в одной transaction:

```text
BEGIN
  validate transition/revision
  update aggregate
  insert domain_event
  insert outbox record
COMMIT
```

Publisher доставляет at-least-once. Consumers обязаны быть idempotent.

## 13. Idempotency

API:

```text
tenant_id + actor_id + route + Idempotency-Key
```

Analysis execution identity:

```text
tenant_id
+ snapshot_set_ref
+ snapshot_set_hash
```

`snapshot_set_hash` commits normalized/knowledge snapshots, mode policy, workflow/config versions и retrieval track/snapshot из spec 04. Дублируемые поля `AnalysisRun` служат индексируемой проекцией и обязаны совпадать с snapshot set.

Job:

```text
job_type + tenant_id + immutable input refs + mode/policy/version bundle
```

`JobExecution` хранит:

```yaml
job_execution:
  job_key: sha256
  state: started | succeeded | failed
  owner: string
  output_refs: []
  result_hash: sha256 | null
  updated_at: date-time
```

Повторная delivery возвращает существующий result либо безопасно продолжает lease.

## 14. Leases and recovery

Worker захватывает lease:

- owner;
- acquired_at;
- expires_at;
- heartbeat_at;
- attempt.

Expired lease не означает автоматически, что external provider call не состоялся. Для side-effecting gateways нужен operation record/idempotency key.

## 15. Retry policy

| Failure | Retry |
|---|---|
| transient network/provider | exponential backoff + jitter |
| rate limit | `Retry-After`/backoff |
| worker crash | lease recovery |
| invalid input/schema | no automatic retry |
| security/ACL/redaction | no retry, incident/block |
| deterministic formula failure | no retry until data/rule revision |
| export temporary failure | bounded retry |

Max attempts и delays versioned в `ExecutionPolicy`.

После exhaustion job переходит в failed/dead-letter state с operator-visible reason.

## 16. DAG orchestration

Orchestrator:

1. читает versioned workflow definition;
2. применяет applicability/pruning rules;
3. создаёт competency runs;
4. публикует ready nodes;
5. принимает immutable outputs;
6. активирует dependents;
7. открывает approval gates;
8. завершает synthesis.

Proven DAG из spec 03:

```text
Настьёнка
├─ Денчик ─→ Людмила ─→ Ваныч
│          └──────────→ Ваныч
├─ Палыч
└─ Виктор

Ваныч → Марина || Халиль
```

## 17. Human approval

```yaml
approval:
  approval_id: uuid
  tenant_id: uuid
  analysis_run_id: uuid
  approval_type: input_confirmation | competency_review | final_report
  status: pending | approved | rejected | expired | superseded
  subject_refs: []
  required_role: string
  created_at: date-time
  decided_at: date-time | null
```

```yaml
approval_decision:
  decision_id: uuid
  approval_id: uuid
  decision: approve | reject
  reason: string
  actor_id: uuid
  actor_role: string
  subject_hash: sha256
  decided_at: date-time
```

Approval привязан к exact subject hash. Изменённый artifact требует нового approval.

## 18. Cancel and retry

Cancel:

- записывает cancellation request/event без введения нового canonical status;
- прекращает публикацию новых nodes;
- workers проверяют cancellation token между безопасными этапами;
- completed immutable outputs сохраняются;
- partial artifacts не становятся approved.

Retry:

- создаёт новый `AnalysisRun`;
- фиксирует ссылку на исходный failed/cancelled run;
- проверяет compatibility snapshots/versions;
- может переиспользовать immutable output только через explicit hash-compatible cache policy;
- не меняет historical records.

## 19. Progress

```yaml
run_progress:
  total_nodes: integer
  terminal_nodes: integer
  running_nodes: integer
  waiting_approval_nodes: integer
  failed_nodes: integer
  skipped_not_applicable_nodes: integer
  percent: decimal
  current_stage: string
  updated_at: date-time
```

Percent вычисляется по versioned weighting policy, не является contractual SLA.

Client updates:

- SSE baseline;
- bounded polling fallback при недоступности SSE;
- WebSocket не обязателен;
- event stream tenant-authorized.

## 20. Concurrency and limits

Contractual baseline: до 10 одновременных пользователей APRI.

Отдельно измеряются:

- active sessions;
- concurrent uploads;
- concurrent analysis runs;
- worker concurrency;
- provider concurrency;
- tenant quotas.

Нельзя трактовать contractual baseline как 10 параллельных full analyses без load-test evidence и owner decision.

## 21. Export jobs

Export создаётся только из immutable approved/result snapshot:

```yaml
export_job:
  export_job_id: uuid
  tenant_id: uuid
  analysis_run_id: uuid
  artifact_type: analysis_xlsx | violations_registry_xlsx | report_docx
  template_version: string
  source_snapshot_hash: sha256
  status: queued | running | completed | failed
  artifact_id: uuid | null
```

PDF и JSON могут быть добавлены как optional engineering adapters, но не входят в договорный export gate. `violations_registry_xlsx` является отдельным обязательным договорным artifact.

## 22. API security

- authentication;
- tenant authorization;
- CSRF protection при cookie sessions;
- rate limiting;
- upload limits;
- request size/schema validation;
- object-level authorization;
- no raw exception leakage;
- security headers;
- signed artifact download;
- audit data-changing/privileged actions.

## 23. Acceptance

- API mutation retry не создаёт duplicate run/job;
- повторная доставка PostgreSQL queue job не создаёт duplicate artifact/provider operation;
- state transition вне graph отклоняется;
- input/approval subject hash предотвращает stale approval;
- worker crash восстанавливается через lease;
- tenant context обязателен во всех messages/jobs;
- direct `Денчик → Ваныч` dependency сохранена;
- `skipped_not_applicable` competency имеет pruning trace;
- cancel не публикует новые nodes;
- retry создаёт новый AnalysisRun и не меняет historical run;
- 10 simultaneous APRI users проходят load scenario;
- full-analysis concurrency сообщается отдельно;
- event/outbox delivery не теряет committed transition.

## 24. Решения до реализации

| ID | Решение |
|---|---|
| `DEC-RUN-001` | PostgreSQL queue lease, polling и delivery semantics |
| `DEC-RUN-002` | API framework/auth session model |
| `DEC-RUN-003` | Lease/heartbeat intervals |
| `DEC-RUN-004` | Retry/DLQ policy |
| `DEC-RUN-005` | SSE reconnect и polling fallback policy |
| `DEC-RUN-006` | Tenant quotas |
| `DEC-RUN-007` | Cross-run hash-compatible cache policy |
