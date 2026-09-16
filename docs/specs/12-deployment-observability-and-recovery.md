---
title: "СтройИнтеллект: deployment, observability и recovery"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: operations
horizon: delivery
scope: deployment-observability-recovery
project: stroyintellekt
source: architecture-and-engineering-controls
related:
  - 01-contract-requirements-and-acceptance.md
  - 09-security-tenancy-and-data-handling.md
  - 10-api-queue-and-runtime-state.md
  - 13-testing-evals-and-delivery-gates.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: high
---

# СтройИнтеллект: deployment, observability и recovery

## 1. Цель

Спецификация задаёт production topology, release discipline, telemetry, backup/restore и incident recovery. Значения SLO, RPO, RTO и capacity являются engineering decisions до подтверждения измерениями и owner approval.

## 2. Environments

| Environment | Назначение | Customer data |
|---|---|---|
| `local` | Development | prohibited by default |
| `test` | Automated validation | synthetic |
| `staging` | Release candidate, eval/load | sanitized/synthetic |
| `production` | Customer operation | allowed |
| `dr` | Recovery capability | encrypted controlled copy |

Production, DR, backups, logs, documents, knowledge и result artifacts размещаются в РФ. Открытым остаётся выбор российского provider/region, а не географический invariant.

Credentials, databases, filesystem roots, PostgreSQL queue tables и provider projects разделены по environment.

## 3. Deployable components

MVP topology:

- один application image с entrypoints `api` и `worker`;
- Web frontend/API;
- worker с ingestion, calculation, DAG, retrieval, LLM gateway и export modules;
- PostgreSQL как business store, RLS boundary и queue;
- local filesystem через storage adapter;
- reverse proxy;
- backup job;
- Prometheus/Grafana.

Optional adapters после отдельных admission decisions:

- pgvector для `rag_enabled`;
- external object storage;
- dedicated cache;
- separate broker;
- dedicated tracing backend.

Каждый deployed component имеет version/build digest и health contract. Optional adapter не является MVP dependency.

## 4. Release artifact

```yaml
release_manifest:
  release_id: string
  commit_sha: string
  build_id: string
  application_image_digest: string
  frontend_image_digest: string | null
  api_schema_version: string
  database_schema_version: string
  canonical_schema_version: string
  workflow_definition_version: string
  formula_rule_bundle_versions: []
  parser_bundle_version: string
  retrieval_policy_versions: []
  export_template_versions: []
  created_at: date-time
```

Production deploy использует immutable digests, не floating tags.

## 5. Deployment strategy

Baseline:

- reproducible Docker Compose/environment configuration;
- repeatable environment provisioning;
- rolling or blue/green deploy;
- backward-compatible database expansion before application switch;
- readiness/liveness/startup probes;
- pre-deploy backup/checkpoint for risky migrations;
- post-deploy smoke tests;
- explicit rollback decision.

## 6. Health endpoints

| Endpoint | Meaning |
|---|---|
| `/health/live` | Process alive, no dependency checks |
| `/health/ready` | Can receive work |
| `/health/startup` | Initialization complete |
| `/health/dependencies` | Privileged/operator dependency detail |

Readiness учитывает критические dependencies. Optional RAG/provider outage не делает file-first calculation path недоступным, если fallback allowed.

## 7. Configuration

- versioned configuration;
- environment overrides;
- secret references, не secret values;
- startup validation;
- dynamic changes audited;
- feature flags tenant-aware;
- production defaults fail closed;
- formula/rule/knowledge revisions не подменяются обычным feature flag.

## 8. Database migrations

Migration policy:

- expand → migrate/backfill → switch → contract;
- backup/restore proof для destructive migration;
- tenant isolation policies проверяются;
- rollback или forward-fix plan;
- long locks предотвращаются;
- schema/data migration разделяются;
- immutable historical artifacts не переписываются.

## 9. Observability pillars

### 9.1 Logs

Structured fields:

```yaml
timestamp: date-time
level: debug | info | warning | error | critical
service: string
environment: string
trace_id: string | null
span_id: string | null
tenant_id: uuid | null
project_id: uuid | null
analysis_run_id: uuid | null
job_id: uuid | null
event: string
status: string | null
error_code: string | null
```

Raw document text, secrets, PII, prompts и signed URLs не логируются.

### 9.2 Metrics

Required:

- request rate/errors/latency;
- auth/authorization denials;
- uploads/parser outcomes;
- queue depth/age;
- worker utilization/lease expiry/retries;
- run duration by stage;
- calculation/reconciliation failures;
- approval wait;
- retrieval latency/quality samples;
- provider errors/tokens/cost;
- redaction blocks;
- export outcomes;
- database/cache/storage health;
- backup/restore status.

Tenant ID не используется как high-cardinality metric label без controlled strategy.

### 9.3 Traces

Distributed trace связывает:

```text
API request
→ outbox
→ queue publish
→ worker
→ parser/calculation/retrieval/provider/export
→ artifact
```

## 10. Business and quality telemetry

- run completion/failure/cancel rate;
- input blocking issue rate;
- reconciliation state;
- FormulaTrace coverage;
- factual claim grounding rate;
- source coverage;
- file-first/RAG comparison;
- human correction rate;
- approval rejection/rework rate;
- report generation success.

Metrics не повышают acceptance без закреплённого corpus/gate.

## 11. Alerting

Severity:

| Severity | Пример |
|---|---|
| `SEV-1` | Cross-tenant leak, widespread outage, data loss |
| `SEV-2` | Core workflow unavailable, queue stuck, failed restore |
| `SEV-3` | Degraded provider/export, elevated errors |
| `SEV-4` | Non-urgent anomaly/capacity warning |

Alerts должны быть actionable:

- symptom;
- impact;
- dashboard/runbook;
- owner/escalation;
- trace/example IDs;
- no sensitive payload.

## 12. SLO model

До утверждения numerical SLO система измеряет:

- availability core UI/API;
- successful upload/parse;
- queue dispatch latency;
- analysis completion rate;
- report/export success;
- provider-independent calculation availability;
- restore success.

Contractual SLA из spec 01 не заменяется engineering SLO и не расширяется молча.

## 13. Capacity

Capacity plan отдельно моделирует:

- up to 10 simultaneous APRI users;
- file sizes/2 000+ positions;
- concurrent uploads;
- concurrent analysis runs;
- worker pools by job type;
- provider rate limits;
- database connections;
- object/vector storage growth.

Ресурсные limits и autoscaling основаны на measured queue age/service time.

## 14. Backup

Объекты backup:

- relational database;
- filesystem storage/version manifests;
- active knowledge/parameter/formula/rule bundles;
- export templates;
- search/vector indexes либо reproducible manifests;
- configuration/IaC;
- audit/security evidence по policy.

Search/vector indexes могут восстанавливаться rebuild, если corpus/index/model snapshot сохранён и RTO достигается.

## 15. Backup controls

- encryption;
- separate credentials;
- immutability/retention where required;
- automated completion checks;
- periodic restore drills;
- tenant/deletion/legal-hold alignment;
- checksums;
- access audit;
- production backup недоступен application write credentials.

## 16. Recovery

```text
declare incident
→ contain
→ select recovery point
→ restore infrastructure/data
→ validate isolation and integrity
→ rebuild derived indexes/caches
→ run smoke/regression checks
→ reopen traffic/workers
→ reconcile in-flight jobs
→ post-incident review
```

In-flight jobs после restore:

- не считаются completed только по PostgreSQL queue claim/ack;
- сверяются с JobExecution/outbox/artifact hashes;
- safe jobs переисполняются idempotently;
- external provider operations проверяются по operation record.

## 17. Recovery validation

Restore proof включает:

- database integrity;
- tenant isolation/RLS;
- source file checksums;
- immutable snapshot/result hashes;
- audit continuity;
- knowledge/revision availability;
- queue/outbox reconciliation;
- file-first operation;
- RAG rebuild parity, если production-admitted;
- artifact download authorization;
- sample end-to-end analysis.

## 18. Rollback

Application rollback разрешён, если previous version совместима с current schema. Если нет:

- traffic stop/forward fix;
- explicit incident decision;
- historical artifacts сохраняются;
- no automatic destructive DB rollback.

RAG has independent rollback to file-first. Provider model/prompt change has version pin and rollback.

## 19. Dependency degradation

| Dependency unavailable | Expected behavior |
|---|---|
| LLM provider | Calculation/file-first remain; generation waits/fails explicitly |
| Vector store | Fallback file-first where allowed |
| Export renderer | Run results preserved, export retry |
| Cache | Degraded latency, no correctness loss |
| Queue | New async work blocked; state preserved |
| Object storage | Upload/artifact unavailable; no silent data loss |
| Database | Service unavailable/read-only containment |

## 20. Operational runbooks

Required:

- queue backlog/stuck leases;
- parser failure spike;
- calculation/reconciliation regression;
- provider outage/rate limit;
- redaction failure spike;
- suspected cross-tenant access;
- filesystem/storage adapter corruption/unavailability;
- database failover/restore;
- vector index rebuild;
- export outage;
- secret rotation;
- release rollback.

## 21. Production readiness gate

Before production:

- release manifest complete;
- validators/evals/security/load passed;
- migrations rehearsed;
- backup completed;
- restore drill passed within approved targets;
- alerts/dashboards/runbooks exist;
- on-call/escalation assigned;
- secrets rotated/verified;
- tenant isolation tested;
- rollback exercised;
- open critical blockers = 0.

## 22. Acceptance

- deployment reproducible from IaC/manifests;
- every running component maps to immutable build digest;
- traces cross API → queue → worker → artifact;
- logs contain no acceptance-corpus secrets/PII;
- queue age/worker failure alerts fire in test;
- backup restore reproduces sample result hashes;
- RLS/isolation survives restore/migration;
- file-first works during vector/LLM outage;
- in-flight jobs reconcile without duplicate artifacts;
- release rollback/safe forward-fix rehearsed;
- capacity test distinguishes 10 users from full-analysis concurrency;
- production admission impossible with failed restore/security/test gates.

## 23. Решения до реализации

| ID | Решение |
|---|---|
| `DEC-OPS-001` | Hosting/runtime platform |
| `DEC-OPS-002` | Approved SLO/RPO/RTO |
| `DEC-OPS-003` | Российский hosting provider/region при неизменном РФ residency invariant |
| `DEC-OPS-004` | Observability stack |
| `DEC-OPS-005` | Backup retention/immutability |
| `DEC-OPS-006` | On-call/escalation model |
| `DEC-OPS-007` | Autoscaling and capacity limits |
