---
title: "СтройИнтеллект: security, tenancy и data handling"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: system
horizon: delivery
scope: security-tenancy-data-handling
project: stroyintellekt
source: contract-owner-decisions-and-architecture
related:
  - 00-product-scope-and-source-policy.md
  - 01-contract-requirements-and-acceptance.md
  - 04-canonical-data-and-structured-output.md
  - 05-knowledge-and-parameter-platform.md
  - 06-document-ingestion-and-normalization.md
  - 08-retrieval-rag-and-llm-gateways.md
  - 10-api-queue-and-runtime-state.md
  - 12-deployment-observability-and-recovery.md
  - 13-testing-evals-and-delivery-gates.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: security, tenancy и data handling

## 1. Цель

Спецификация задаёт изоляцию десятков организаций, безопасность файлов и provider calls, audit trail и retention boundaries. APRI является pilot tenant и не получает special-case архитектуру.

## 2. Tenant model

```yaml
tenant:
  tenant_id: uuid
  slug: string
  legal_name: string
  status: provisioning | active | suspended | deleting | deleted
  isolation_profile_id: string
  data_policy_id: string
  provider_policy_id: string
  created_at: date-time
```

Все tenant-owned entities обязаны иметь `tenant_id`. Исключения:

- platform public reference data;
- global schema/catalog definitions без customer data;
- infrastructure records, не содержащие tenant payload.

Любое исключение явно cataloged.

## 3. Isolation profiles

```yaml
isolation_profile:
  profile_id: string
  database: shared_rls | dedicated_schema | dedicated_database
  object_storage: tenant_prefix | dedicated_bucket
  queue: shared_partitioned | dedicated
  vector_index: shared_filtered | tenant_namespace | dedicated
  encryption_key: shared_kms | tenant_kms
```

MVP может использовать shared infrastructure только при доказанных row-level/partition filters и adversarial tests.

## 4. Identity and authorization

Договорный pilot использует две tenant-роли:

| Role | Scope |
|---|---|
| `user` | Upload, run, review, export и параметры расчёта |
| `admin` | Права user, users, knowledge upload и journal |

`platform_operator` и `security_auditor` являются системными identities, а не дополнительными customer roles. Customer roles сверх `user|admin` и object-level RBAC находятся вне pilot scope.

Authorization decision:

```yaml
authorization_decision:
  decision_id: uuid
  actor_id: uuid
  tenant_id: uuid
  resource_type: string
  resource_id: uuid | null
  action: string
  policy_version: string
  verdict: allow | deny
  reason_code: string
  trace_id: string
```

Tenant context берётся из verified identity/session, а не из недоверенного body.

## 5. Tenant propagation

`tenant_id`, `actor_id`, `trace_id` обязательны:

- API request context;
- database transaction context;
- storage adapter key/path;
- queue message;
- job lease;
- retrieval query;
- cache key;
- audit event;
- export artifact;
- provider policy check.

Отсутствие tenant context = fail closed.

## 6. Database controls

- Row-level security либо эквивалентная enforced policy;
- composite keys/indexes включают tenant scope;
- foreign keys не связывают разные tenants;
- background worker устанавливает tenant context до query;
- privileged service role не используется в business request path;
- migrations тестируются на сохранение policies;
- backups сохраняют encryption и access boundaries.

Прямой query без tenant predicate/policy должен блокироваться автоматически либо выявляться static/runtime tests.

## 7. Storage adapter

```text
tenants/{tenant_id}/projects/{project_id}/documents/{document_id}/versions/{version_id}/{object_id}
```

Controls:

- server-generated keys;
- tenant-scoped filesystem root в MVP;
- private buckets и short-lived signed URLs только для optional object-storage adapter;
- авторизованный API download или signed URL;
- content-disposition safe filename;
- MIME/content validation;
- checksum;
- encryption at rest;
- access logging;
- no public ACL;
- tenant-bound authorization before signing.

## 8. File handling

Uploads проходят:

1. size/rate limit;
2. streaming checksum;
3. type detection;
4. quarantine;
5. обязательные archive/type checks и malware scan, если он включён утверждённой security policy;
6. parser sandbox;
7. immutable storage;
8. normalized snapshot workflow.

Запрещено:

- исполнять macros/DDE/OLE;
- разрешать XML external entities;
- загружать external links;
- доверять filename extension;
- передавать raw customer files внешнему provider.

## 9. Data classification

В pilot scope все customer documents/artifacts по умолчанию имеют class `confidential`.

Отдельный restricted-data detector выявляет secrets, credentials, session/token material и иные поля, запрещённые к provider transfer. Такие данные никогда не отправляются provider.

Многоуровневая tenant-configurable classification является roadmap и не нужна для закрытия договорной приёмки. Публичные нормативы могут иметь platform-public visibility только после отдельного corpus admission.

## 10. Redaction

Redaction pipeline:

```text
canonical payload
→ field allowlist
→ deterministic identifier masking
→ pattern detectors
→ tenant-specific dictionary
→ residual validation
→ payload hash
→ provider policy decision
```

Authoritative schema `RedactionResult` находится в spec 04. Provider call разрешён только при:

- `decision = allow`;
- `residual_validation.status = passed`;
- `residual_validation.residual_findings` пуст;
- `outbound_payload_hash` совпадает с фактически отправляемым payload.

## 11. Provider boundary

```yaml
provider_policy:
  policy_id: string
  allowed_providers: []
  allowed_regions: []
  allowed_data_classes: []
  allowed_purposes: []
  retention_mode: no_training_no_storage | approved_retention
  raw_file_transfer: false
  enabled: boolean
```

Provider call требует:

- tenant opt-in/policy;
- allowed purpose;
- passed redaction;
- approved model/provider;
- transport encryption;
- request/response metadata audit;
- no secrets in prompt;
- no provider training where contract disallows.

В pilot/contract scope `raw_file_transfer` всегда `false`. Будущая exception потребует отдельного owner decision, source classification и security acceptance и не изменяет текущий запрет.

## 12. Secrets

- secrets только в approved secret manager/environment injection;
- нет secrets в repo, logs, traces, prompts, exports;
- rotation и revocation процедуры;
- separate credentials by environment;
- least privilege;
- startup fail closed при missing secret;
- secret scanners в CI.

## 13. Cache and search isolation

Cache key включает:

```text
tenant_id + actor_acl_hash + resource_scope + version/snapshot
```

Запрещены:

- global cache для tenant-private result;
- vector query без pre-filter/final ACL check;
- embedding tenant-private content в platform-public index;
- reuse provider response между tenants;
- metrics labels с raw document/customer data.

## 14. Queue and worker isolation

Queue message:

```yaml
job_context:
  tenant_id: uuid
  project_id: uuid
  actor_id: uuid
  analysis_id: uuid
  job_id: uuid
  trace_id: string
  policy_snapshot_id: string
```

Worker:

- validates signed message/envelope;
- устанавливает tenant context;
- проверяет resource ownership;
- не принимает tenant override из payload;
- очищает temporary files;
- пишет audit event;
- не меняет immutable snapshots.

## 15. Audit

Audit events immutable append-only:

```yaml
audit_event:
  audit_event_id: uuid
  occurred_at: date-time
  tenant_id: uuid | null
  actor_type: user | service | system
  actor_id: uuid | null
  action: string
  resource_type: string
  resource_id: uuid | null
  verdict: success | denied | failed
  reason_code: string | null
  trace_id: string
  metadata_hash: sha256 | null
```

Raw file content, secrets и full prompts в audit не пишутся.

## 16. Retention and deletion

Retention policy задаёт сроки для:

- source files;
- normalized/calculation snapshots;
- exports;
- provider metadata;
- operational logs;
- audit logs;
- backups.

Deletion workflow:

```text
request
→ authorization
→ legal/contract hold check
→ tenant suspension
→ active storage deletion
→ search/vector/cache deletion
→ backup expiry tracking
→ deletion certificate
```

Immutable audit может сохранять факт удаления без удалённого payload.

## 17. Incident handling

Security event types:

- cross-tenant access;
- suspected malware;
- provider data policy breach;
- leaked secret;
- unauthorized export;
- tampered snapshot/audit chain;
- anomalous download.

Cross-tenant evidence требует:

- immediate affected-path block;
- result/cache invalidation;
- incident creation;
- tenant/security notification по policy;
- forensic preservation;
- release blocker до verified fix.

## 18. Threat scenarios

Обязательные fixtures:

- tenant ID tampering;
- IDOR;
- signed URL reuse;
- cache poisoning;
- vector index leakage;
- malicious XLS/DOCX/PDF/XML;
- zip bomb/path traversal;
- prompt injection;
- provider payload with residual PII;
- forged queue message;
- SSRF through external document links;
- log injection;
- stale ACL after user removal.

## 19. Acceptance

- cross-tenant data leakage = 0;
- все tenant-owned rows/objects/messages имеют tenant scope;
- tenant из body не переопределяет verified context;
- file parser не исполняет active content;
- external entity/link network access = 0;
- provider calls при failed redaction = 0;
- raw customer-file transfers to external providers = 0;
- residual sensitive fields в acceptance corpus = 0;
- public storage access/ACL = 0;
- secret scan findings = 0;
- audit coverage для privileged/data-changing actions = 100%;
- deletion test удаляет active/cache/search copies;
- restore сохраняет isolation policies.

## 20. Решения до реализации

| ID | Решение |
|---|---|
| `DEC-SEC-001` | MVP isolation profile |
| `DEC-SEC-002` | Identity provider и MFA policy |
| `DEC-SEC-003` | KMS topology |
| `DEC-SEC-004` | Malware scanner requirement |
| `DEC-SEC-005` | Retention periods и legal hold |
| `DEC-SEC-006` | Approved providers/regions |
| `DEC-SEC-007` | Tenant deletion SLA |
| `DEC-SEC-008` | Security notification SLA |
