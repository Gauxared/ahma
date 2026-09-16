---
title: "СтройИнтеллект: платформа знаний и параметров"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: data
horizon: strategic
scope: knowledge-parameter-platform
project: stroyintellekt
source: /home/govard/projects/7rl/stroyintellekt/03.08.26_ТЗ_СтройИнтеллект_Приложение№1_к_КП_АПРИ.docx
related:
  - 00-product-scope-and-source-policy.md
  - 01-contract-requirements-and-acceptance.md
  - 02-legacy-rule-and-parameter-traceability.md
  - 03-domain-workflow-and-competency-contracts.md
  - 04-canonical-data-and-structured-output.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: платформа знаний и параметров

## 1. Цель

Опорная база не моделируется как «13 Excel-листов в БД». Тринадцать листов ТЗ являются договорным import profile АПРИ, тогда как платформа должна поддерживать больше типов данных, отраслей, нормативов, параметров и компаний.

Платформа управляет:

- знаниями;
- параметрами и их значениями;
- формулами;
- исполнимыми правилами;
- нормативами;
- источниками;
- версиями и immutable snapshots;
- tenant overlays;
- import mappings;
- retrieval-проекциями.

## 2. Обязательные основания

ТЗ требует:

- dated parameters для НДС и ключевой ставки;
- Excel-опорную базу установленной структуры;
- value, unit, year, source, status и checked date;
- warning для значений старше 90 дней;
- заполнение базы по данным Заказчика;
- подтверждение базы АПРИ до этапа 2.

Legacy доказывает, что фактическая модель шире 13 листов:

- отдельная нормативная база Денчика;
- компетентностные базы;
- отраслевые профили `apri`, `modc`, `unihim`, `uralsetstroy`;
- специализированные коэффициенты и алгоритмы;
- case/lesson records;
- разные измерения применимости.

## 3. Граница platform truth

Runtime-истиной являются опубликованные typed revisions и зафиксированный `KnowledgeSnapshot`.

Не являются runtime-истиной:

- имя Excel-листа;
- номер строки без версии источника;
- Excel formula;
- prompt text;
- embedding;
- LLM response;
- исторический пример без authority/status;
- mutable «последнее значение».

## 4. Доменные типы

| Тип | Назначение |
|---|---|
| `KnowledgeRecord` | Текстовое или структурированное знание |
| `ParameterDefinition` | Тип, unit, constraints и override policy параметра |
| `ParameterValue` | Значение с применимостью, authority и периодом действия |
| `FormulaDefinition` | Контракт детерминированного вычисления |
| `ExecutableRule` | Типизированное условие, validation или prohibition |
| `NormDocument` | Нормативный документ |
| `NormClause` | Конкретный пункт редакции норматива |
| `SourceDocument` | Загруженный или официальный источник |
| `SourceFragment` | Адресуемый fragment источника |
| `RecordRevision` | Immutable редакция записи |
| `KnowledgeVersion` | Публикационный набор revisions |
| `KnowledgeSnapshot` | Конкретный набор revisions для AnalysisRun |
| `ImportBatch` | Результат одного импорта |
| `ImportMappingProfile` | Маппинг внешнего формата на canonical types |
| `TenantOverlay` | Tenant-specific дополнение или переопределение |
| `EvidenceChunk` | Поисковая проекция source/record |

Одна универсальная таблица с десятками nullable columns запрещена.

## 5. Общий envelope revision

```yaml
record_id: uuid
record_kind: parameter_value
semantic_key: finance.vat.rate

tenancy:
  scope: platform | tenant
  tenant_id: uuid | null

revision:
  revision_id: uuid
  revision_no: 3
  status: draft | validated | published | superseded | archived
  created_at: date-time
  created_by: uuid
  published_at: date-time | null
  content_hash: sha256

applicability:
  domains: []
  region_codes: []
  object_types: []
  product_types: []
  work_types: []
  project_ids: []
  contractor_profiles: []
  scenarios: []
  valid_from: date | null
  valid_to: date | null

authority:
  level: official | platform_curated | tenant_confirmed | project_confirmed | historical | assumption
  confirmation_status: confirmed | unconfirmed | rejected
  confirmed_by: uuid | null
  confirmed_at: date-time | null

provenance:
  source_refs: []
  legacy_fragment_ids: []
  import_batch_id: uuid | null

freshness:
  checked_at: date | null
  stale_after: date | null
  state: current | review_due | stale | expired | unknown

acl:
  visibility: platform | tenant | restricted
  roles: []
```

### 5.1 Invariants

- `published` revision immutable;
- исправление создаёт новую revision;
- numeric/executable record требует SourceRef;
- `platform` record имеет `tenant_id = null`;
- `tenant` record требует `tenant_id`;
- пересекающиеся values одного semantic key проходят conflict check;
- content hash вычисляется по normalized content;
- stale record не удаляется автоматически;
- запись другого tenant недоступна ни через SQL, FTS, cache, vectors, snapshot или export.

## 6. ParameterDefinition

```yaml
parameter_id: finance.vat.rate
name_ru: Ставка НДС
value_type: decimal
unit: ratio
allowed_range:
  min: "0"
  max: "1"
precision:
  scale: 4
  rounding: ROUND_HALF_UP
required_dimensions:
  - valid_from
override_policy: official_only | tenant_allowed | project_allowed
missing_behavior: insufficient_data | request_human | not_applicable
freshness_policy_id: official-rate
```

Definition и Value разделены. Изменение value не меняет type contract.

## 7. ParameterValue

```yaml
semantic_key: finance.vat.rate
value: "0.22"
unit: ratio
applicability:
  region_codes: ["RU"]
  valid_from: "2026-01-01"
  valid_to: null
authority:
  level: official
freshness:
  checked_at: "2026-07-15"
  stale_after: "2026-10-13"
provenance:
  source_refs: ["uuid"]
```

### 7.1 Измерения применимости

Платформа допускает расширяемые dimensions:

- tenant и project;
- страна и регион;
- тип продукта и объекта;
- строительная система;
- вид работ;
- ФЕР/ГЭСН/resource code;
- поставщик или подрядчик;
- currency и tax regime;
- дата и период;
- scenario;
- price level;
- методика;
- accuracy class.

`null` у dimension означает «не ограничивает применимость», а не «неизвестно».

## 8. Resolution policy

Детерминированный порядок:

1. tenant и ACL filter;
2. applicability на `as_of`;
3. required dimensions;
4. specificity;
5. разрешённый tenant/project overlay;
6. authority;
7. freshness;
8. результат `resolved`, `conflict`, `not_found` или `stale_only`.

```yaml
parameter_id: work.market_coefficient
context:
  tenant_id: apri
  region: RU-CHE
  work_code: "27-06"
  as_of: "2026-08-05"
candidates:
  - revision_id: platform-default
    specificity: 2
    value: "0.92"
  - revision_id: apri-confirmed
    specificity: 4
    value: "0.89"
selected_revision_id: apri-confirmed
resolution_policy_version: 1.0.0
status: resolved
```

Implicit «последнее значение выигрывает» запрещено.

## 9. Tenant overlays

```yaml
overlay_id: uuid
tenant_id: apri
target_semantic_key: cost.benchmark.rub_per_sqm
operation: replace | narrow | extend | disable
base_revision_id: uuid | null
value_revision_id: uuid
applicability:
  product_types: [comfort]
  region_codes: [RU-CHE]
reason: Подтверждено на закрытых объектах АПРИ
approved_by: uuid
approved_at: date-time
```

Правила:

- tenant не изменяет platform record;
- официальный статус норматива не переопределяется tenant;
- tenant может задавать более строгую policy;
- prices, lead times и benchmarks переопределяются только согласно `override_policy`;
- overlay version входит в KnowledgeSnapshot.

## 10. FormulaDefinition

```yaml
formula_id: cost.deviation.total
version: 1.0.0
implementation_ref: calculations.cost_deviation:calculate
inputs:
  contractor_unit_price:
    type: MoneyPerUnit
    required: true
  reference_unit_price:
    type: MoneyPerUnit
    required: true
  quantity:
    type: Quantity
    required: true
output:
  type: Money
  unit: RUB
parameter_dependencies: []
rounding:
  mode: ROUND_HALF_UP
  scale: 2
  stage: final
test_fixture_refs: []
origin_refs: []
```

Алгоритм находится в проверяемом code module. Knowledge хранит versioned contract, dependency и applicability.

Запрещено:

- исполнять Python/SQL/JavaScript из импортированного файла;
- использовать `eval`;
- исполнять Excel formula как runtime business logic;
- публиковать formula без fixtures;
- подставлять default при unknown без ResolutionTrace.

## 11. ExecutableRule

```yaml
rule_id: source.numeric-value-required-fields
version: 1.0.0
event: before_calculation
require:
  - record.unit
  - record.provenance.source_refs
  - record.freshness.checked_at
  - record.authority.level
on_failure:
  outcome: insufficient_data
  severity: blocker
  message_code: KNOWLEDGE_NUMERIC_SOURCE_REQUIRED
origin_refs: []
```

Свободный текст становится active rule только после typed representation, review, version и test.

## 12. Нормативы

```yaml
norm_id: minstroy.order.344pr
jurisdiction: RU
document_type: order
number: 344/пр
title: string
issuer: Минстрой России
editions:
  - edition_id: uuid
    issued_at: date
    effective_from: date | null
    effective_to: date | null
    status: active | repealed | replaced | unknown
    replaces: []
    replaced_by: []
    official_source_ref: uuid
    checked_at: date
```

NormClause:

```yaml
clause_id: uuid
norm_edition_id: uuid
clause_path: п.6.40
text: string
topics: []
rule_refs: []
content_hash: sha256
```

Норматив без edition, status и checked date не используется как подтверждённое основание.

## 13. KnowledgeVersion и Snapshot

```yaml
knowledge_version_id: uuid
tenant_id: uuid
label: apri-pilot-2026.08
status: draft | validated | published | superseded
included_revision_ids: []
import_batch_ids: []
published_by: uuid
published_at: date-time
manifest_hash: sha256
```

```yaml
snapshot_id: uuid
tenant_id: uuid
analysis_id: uuid
as_of: date-time
resolution_policy_version: 1.0.0
applicability_context_hash: sha256
tenant_overlay_version: uuid
record_revision_ids: []
formula_catalog_version: 1.0.0
retrieval_profile: file_first | rag_enabled
retrieval_profile_version: string
retrieval_corpus_manifest_hash: sha256
embedding_index_version: string | null
embedding_model_id: string | null
embedding_model_dimension: integer | null
chunking_config_hash: sha256 | null
ranking_config_hash: sha256
reranker_config_hash: sha256 | null
snapshot_hash: sha256
```

Snapshot immutable и содержит только revisions одного tenant плюс разрешённые platform records.

## 14. Freshness

Для pilot numeric values действует policy 90 дней.

```yaml
policy_id: apri.numeric.default
applies_to:
  - parameter_value
  - price
  - benchmark
  - lead_time
review_after_days: 90
stale_behavior: use_with_warning | review_required | block
```

Поведение определяется parameter class:

- любое numeric value старше 90 дней получает `review_due` и warning по ТЗ;
- official dated rate может оставаться юридически/расчётно действующим, но warning о давности проверки не скрывается;
- market price требует review;
- stale source сохраняется в trace;
- stale не преобразуется в current автоматически.

## 15. Conflict model

Conflict возникает при:

- равной specificity и разных values;
- несовместимых authority sources;
- overlapping validity;
- разных units без допустимого conversion;
- официальном и tenant status conflict;
- неразрешённой formula version.

Результат:

```yaml
status: conflict
candidates: []
reason_code: KNOWLEDGE_AMBIGUOUS_VALUE
required_action: human_review
```

LLM не выбирает numeric winner.

## 16. Excel import

### 16.1 APRI profile

Тринадцать листов ТЗ маппятся на canonical record kinds через `ImportMappingProfile`.

```yaml
profile_id: apri-reference-base-v1
source_format: xlsx
sheet_mappings:
  "01. Расценки на работы":
    record_kind: parameter_value
    semantic_namespace: work.price
    header_row: 4
    columns: {}
validation_rules: []
```

### 16.2 Import pipeline

```text
upload
→ hash and store source
→ detect mapping profile
→ parse raw cells and formulas as data
→ validate headers/types/units
→ propose canonical records
→ show diff and errors
→ human confirmation
→ publish KnowledgeVersion
```

Import сохраняет:

- raw cell value;
- normalized value;
- formula text как source metadata;
- sheet/range;
- source hash;
- correction trace;
- importer version.

Excel formula не исполняется как platform rule.

## 17. Расширение базы

Новый knowledge module добавляется без изменения core tables:

1. новый namespace и record schema;
2. allowed applicability dimensions;
3. validation policy;
4. resolution policy;
5. import mapping;
6. retrieval projection;
7. fixtures и acceptance.

Примеры будущих модулей:

- дорожное строительство;
- промышленные объекты;
- сети;
- техника и механизмы;
- сварка и термообработка;
- региональные logistics;
- новые нормативные семейства;
- новые financial parameters.

## 18. EvidenceRetriever

```python
class EvidenceRetriever(Protocol):
    async def retrieve(
        self,
        query: EvidenceQuery,
        snapshot_id: UUID,
        actor: ActorContext,
    ) -> EvidenceSet: ...
```

Обе реализации используют один snapshot и один ACL contract.

### 18.1 File-first

- exact semantic key;
- typed parameter resolution;
- metadata filters;
- PostgreSQL FTS;
- deterministic source ranking.

### 18.2 RAG-enabled

Добавляет:

- pgvector semantic retrieval;
- rank fusion;
- optional reranking;
- structured chunking неструктурированных документов.

RAG не имеет права:

- менять selected numeric parameter;
- ослаблять ACL;
- превращать unknown в факт;
- скрывать stale/conflict;
- ухудшать provenance;
- смешивать embedding model versions.

## 19. Comparative retrieval eval

Оба трека реализуются и сравниваются на одном eval corpus.

Метрики:

- exact parameter accuracy;
- retrieval recall@10;
- citation precision;
- no-source safe response;
- stale/conflict handling;
- ACL leakage;
- latency;
- provider cost;
- answer completeness;
- effect on competency checklist.

Gate:

```yaml
exact_parameter_regression: 0
acl_leakage: 0
unsupported_numeric_claims: 0
citation_precision_min: 0.95
no_source_safe_response_min: 0.98
```

До production admission `G7` профиль `rag_enabled` имеет status `test_eval_only`, а production tenant analyses используют `file_first`. После `G7 = pass` выбор default/tenant policy оформляется отдельным owner decision.

## 20. Acceptance

- 13 листов АПРИ импортируются через mapping profile;
- новый sheet/type добавляется без изменения core schema;
- каждый numeric record имеет unit, source, authority, validity и freshness;
- published revisions immutable;
- старый AnalysisRun воспроизводим по snapshot;
- tenant overlay не изменяет platform revision;
- cross-tenant SQL/FTS/vector leakage = 0;
- stale и conflict отображаются в canonical result;
- формулы используют typed parameters и FormulaTrace;
- file-first и RAG проходят parity по deterministic truth;
- импортированный Excel не исполняет произвольный code;
- фактическая база может расти без переписывания Calculation Engine и competency contracts.
