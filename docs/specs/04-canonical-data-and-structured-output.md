---
title: "СтройИнтеллект: canonical data и structured output"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: data
horizon: delivery
scope: canonical-data-structured-output
project: stroyintellekt
source: /home/govard/projects/7rl/stroyintellekt/docs/architecture_optimal.md
related:
  - 00-product-scope-and-source-policy.md
  - 01-contract-requirements-and-acceptance.md
  - 02-legacy-rule-and-parameter-traceability.md
  - 03-domain-workflow-and-competency-contracts.md
  - 05-knowledge-and-parameter-platform.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: canonical data и structured output

## 1. Цель

Canonical data contract исключает ситуацию, когда одна ошибка параметра незаметно искажает расчёт, LLM-вывод, UI и выгрузки.

Каждый параметр, число и утверждение:

- имеет тип и schema path;
- имеет unit;
- отличает `unknown` от `0`;
- имеет источник или FormulaTrace;
- принадлежит immutable snapshot;
- валидируется до публикации;
- одинаково интерпретируется всеми adapters.

## 2. Источник истины

Внутренний источник истины — versioned canonical result в PostgreSQL.

```text
Document versions
→ confirmed normalized snapshots
→ knowledge/config/workflow snapshots
→ Calculation Engine
→ competency structured outputs
→ canonical AnalysisResult
→ UI / Excel / Word adapters
```

Excel:

- является входным и выходным adapter;
- может содержать рабочие формулы для пользователя;
- не меняет canonical state после скачивания;
- не является runtime-зависимостью Calculation Engine.

## 3. Snapshot set

Каждый `AnalysisRun` фиксирует:

```yaml
snapshot_set:
  document_snapshot_ids: []
  normalized_snapshot_ids: []
  knowledge_snapshot_id: uuid
  config_bundle_id: uuid
  mode: express | standard | expert
  mode_policy_version: string
  workflow_version: string
  competency_versions: {}
  formula_catalog_version: string
  canonical_schema_version: string
  retrieval_profile: file_first | rag_enabled
  retrieval_profile_version: string
  retrieval_corpus_manifest_hash: sha256
  embedding_index_version: string | null
  embedding_model_id: string | null
  embedding_model_dimension: integer | null
  chunking_config_hash: sha256 | null
  ranking_config_hash: sha256
  reranker_config_hash: sha256 | null
  provider_profile_id: string
  created_at: date-time
  snapshot_set_hash: sha256
```

Изменение любого элемента создаёт новый snapshot set и новый AnalysisRun.

## 4. Canonical envelope

```json
{
  "schema_version": "1.0.0",
  "analysis_id": "uuid",
  "tenant_id": "uuid",
  "project_id": "uuid",
  "requested_by": "uuid",
  "mode": "standard",
  "state": "completed_with_warnings",
  "created_at": "2026-08-05T12:00:00Z",
  "snapshot_set_ref": "uuid",
  "input_status": {
    "confirmed": true,
    "missing_required": [],
    "warnings": []
  },
  "calculations": [],
  "competencies": [],
  "findings": [],
  "conflicts": [],
  "summary": {},
  "quality": {},
  "audit_refs": []
}
```

Unknown top-level fields запрещены. Missing required fields приводят к schema failure.

## 5. Типизированное значение

```json
{
  "parameter_id": "PAR-cost.total",
  "value": "1250000.25",
  "data_type": "decimal",
  "unit": "RUB",
  "status": "calculated",
  "precision": {
    "scale": 2,
    "rounding": "ROUND_HALF_UP"
  },
  "source_refs": [],
  "calculation_ref": "calc-run-uuid",
  "as_of": "2026-08-05",
  "freshness": "current",
  "confidence": null
}
```

### 5.1 Статусы

| Status | Значение |
|---|---|
| `source_confirmed` | Значение напрямую подтверждено источником |
| `calculated` | Получено Calculation Engine |
| `estimate` | Оценка с явным диапазоном или методикой |
| `assumption` | Принятое допущение |
| `unknown` | Значение отсутствует |
| `conflict` | Есть несовместимые источники |
| `not_applicable` | Параметр не применим |

`unknown`, `conflict` и `not_applicable` не имеют numeric fallback.

### 5.1.1 Import mapping

Canonical ontology не использует `fact` и `no_data` как runtime statuses:

| External/import status | Canonical status |
|---|---|
| `fact` | `source_confirmed` |
| `estimate`, `ориентир` | `estimate` |
| `no_data`, `нет данных` | `unknown` |

`calculated` создаётся только Calculation Engine. `unknown` не может содержать numeric value.

### 5.2 Единицы

Используются canonical unit codes:

```text
RUB
RUB_PER_M2
RUB_PER_UNIT
RATIO
PERCENT
DAY
MONTH
M2
M3
M
KG
TONNE
HOUR
PERSON
PERSON_HOUR
```

Преобразование unit выполняется отдельной версионируемой функцией и попадает в FormulaTrace.

## 6. SourceRef

```yaml
source_ref_id: uuid
source_type: document | knowledge | user_confirmation | official_source
source_id: uuid
source_version_id: uuid
fragment_id: uuid | null
location:
  kind: paragraph | table_cell | xlsx_cell | xlsx_range | xml_path | page_span
  value: string
content_hash: sha256
ownership_scope: platform | tenant
tenant_id: uuid | null
captured_at: date-time
```

SourceRef всегда указывает на конкретную версию и location. Ссылка только на filename недостаточна.

`tenant_id = null` разрешён только при `ownership_scope = platform` для прошедшего admission platform-public source. Tenant-owned source всегда требует свой `tenant_id`; requester tenant/ACL context хранится отдельно от ownership.

## 7. FormulaTrace

```json
{
  "calculation_run_id": "uuid",
  "formula_id": "FOR-cost-deviation-v1",
  "formula_version": "1.0.0",
  "implementation_hash": "sha256",
  "inputs": {
    "contractor_price": {
      "value": "5200.00",
      "unit": "RUB_PER_UNIT",
      "parameter_id": "PAR-cost.contractor-unit-price",
      "source_ref": "uuid"
    },
    "reference_price": {
      "value": "5100.00",
      "unit": "RUB_PER_UNIT",
      "parameter_id": "PAR-cost.reference-unit-price",
      "source_ref": "uuid"
    },
    "quantity": {
      "value": "7500",
      "unit": "M3",
      "parameter_id": "PAR-work.quantity",
      "source_ref": "uuid"
    }
  },
  "expression_label": "(contractor_price-reference_price)*quantity",
  "raw_result": "750000.0000",
  "rounding": {
    "mode": "ROUND_HALF_UP",
    "scale": 2,
    "stage": "final"
  },
  "result": {
    "value": "750000.00",
    "unit": "RUB"
  }
}
```

Формула не может читать mutable current value. Все inputs принадлежат snapshot set.

## 8. Claim и Citation

```yaml
claim_id: uuid
statement: string
status: supported | calculated | assumption | unknown | conflict
severity: critical | high | medium | low | info
parameter_refs: []
calculation_refs: []
citation_refs: []
legal_boundary: recommendation_only | specialist_review_required | null
```

```yaml
citation_id: uuid
claim_id: uuid
source_ref_id: uuid
quote_or_value: string
retrieval_score: decimal | null
retrieval_profile: file_first | rag_enabled | null
```

Фактический claim без citation запрещён. Числовой claim без SourceRef или FormulaTrace запрещён.

## 9. Finding

```yaml
finding_id: uuid
competency_code: string
finding_type: overpayment | document_gap | schedule_risk | contract_risk | data_conflict | other
title: string
summary: string
severity: critical | high | medium | low | info
financial_effect:
  value_ref: uuid | null
schedule_effect:
  days_ref: uuid | null
claims: []
recommendation_refs: []
status: open | accepted | mitigated | rejected
```

Finding не дублирует числа строкой. Он ссылается на typed values.

## 10. Recommendation

```yaml
recommendation_id: uuid
action: string
owner: string
due_at: date-time | null
expected_effect_refs: []
preconditions: []
risk_if_ignored: string
status: proposed | approved | rejected | completed
```

Рекомендация без конкретного действия запрещена. Формулировка «уточнить» требует owner и due date.

## 11. Competency result

```yaml
competency_code: vanych_finance
competency_version: 1.0.0
run_id: uuid
state: succeeded | blocked | insufficient_data | not_applicable
input_snapshot_refs: []
findings: []
claims: []
recommendations: []
assumptions: []
unknowns: []
conflicts: []
open_questions: []
source_refs: []
calculation_refs: []
quality_checks: []
```

Provider response не сохраняется как canonical result до:

1. JSON parse;
2. strict schema validation;
3. unknown-field rejection;
4. reference resolution;
5. numeric-origin validation;
6. policy checks;
7. output normalization.

## 12. Summary

```yaml
budget_status: on_track | at_risk | critical | insufficient_data
base_margin:
  value_ref: uuid
adjusted_margin:
  value_ref: uuid
accuracy:
  range: "±3–5%"
  basis: with_estimate
critical_threshold:
  value_ref: uuid | null
top_risk_refs: []
corrective_measure_refs: []
continuation_conditions: []
conflict_refs: []
```

Summary не может повысить confidence относительно исходных values.

## 13. Validation layers

### 13.1 Structural

- JSON syntax;
- schema version exists;
- required fields;
- enum values;
- no unknown fields.

### 13.2 Semantic

- unit совместим с parameter definition;
- Decimal scale разрешён;
- source/calculation refs существуют;
- tenant IDs совпадают;
- dates и validity intervals корректны;
- `unknown` не содержит numeric value;
- `calculated` содержит FormulaTrace.

### 13.3 Cross-object

- все refs принадлежат AnalysisRun;
- competency dependencies завершены;
- summary refs существуют;
- export mapping покрывает обязательные fields;
- snapshot hashes совпадают.

### 13.4 Business

- обязательные inputs режима присутствуют;
- critical conflicts не скрыты;
- источники не stale без warning;
- legal boundary присутствует;
- четыре legacy-запрета соблюдены.

## 14. Schema evolution

Правила SemVer:

- patch: уточнение description без изменения shape;
- minor: новое optional поле с безопасным default;
- major: удаление/переименование поля, изменение type/unit/status semantics.

Migration:

- historical result не переписывается;
- adapter поддерживает текущую и утверждённые предыдущие major versions;
- export фиксирует schema version;
- compatibility tests обязательны.

## 15. Excel, Word и UI

### 15.1 Excel

- читает canonical result;
- переносит source values и Calculation Engine results;
- может создавать эквивалентные рабочие формулы;
- выделяет editable input cells;
- содержит лист parameters и provenance;
- проходит formula/reference validation;
- изменение файла не синхронизируется обратно автоматически.

### 15.2 Word

- не содержит самостоятельных расчётов;
- использует typed values и claims;
- сохраняет source markers и disclaimers.

### 15.3 UI

- отображает `unknown`, `assumption`, `conflict` и stale state раздельно;
- не подменяет пустое значение нулём;
- показывает источник и FormulaTrace;
- не рассчитывает новый business result на client side.

## 16. Security invariants

- tenant ID берётся из trusted identity context;
- cross-tenant ref запрещён;
- raw confidential payload не попадает в canonical result;
- audit хранит hashes и metadata, а не лишний sensitive text;
- provider-specific fields остаются вне domain schema;
- retrieved content рассматривается как data, не instruction.

### 16.1 RedactionResult

Перед внешним LLM-вызовом создаётся проверяемый результат:

```yaml
redaction_result_id: uuid
tenant_id: uuid
source_version_id: uuid
policy_version: string
detector_bundle_version: string
detected_entities:
  person: integer
  phone: integer
  email: integer
  tax_id: integer
  bank_details: integer
  organization: integer
replacement_map_ref: encrypted_ref
residual_validation:
  status: passed | failed
  residual_findings: []
outbound_payload_hash: sha256 | null
decision: allow | block
reason_codes: []
created_at: date-time
```

Rules:

- `residual_validation.status != passed` запрещает outbound transfer;
- detector exception возвращает `block`, а не fallback;
- audit сохраняет metadata и payload hash без raw sensitive payload;
- replacement map tenant- и analysis-scoped;
- curated redaction corpus включает ФИО, телефоны, email, ИНН, банковские реквизиты, названия объектов и подрядчиков;
- acceptance: остаточные реквизиты в разрешённом outbound payload на corpus = 0.

## 17. Acceptance

- 100% contract parameters имеют canonical paths;
- 100% numeric outputs имеют SourceRef или FormulaTrace;
- invalid provider output не публикуется;
- `unknown`, `0` и `not_applicable` различаются во всех adapters;
- одна и та же snapshot set даёт воспроизводимый Calculation Engine result;
- UI, Excel и Word согласованы с canonical result;
- экспортные Excel-формулы после пересчёта совпадают с canonical values;
- старый result остаётся неизменным после обновления документов, знаний и config;
- cross-tenant schema/reference tests проходят с нулём утечек.
- один RAG snapshot повторно использует тот же corpus manifest, index, embedding, chunking, ranking и reranker config;
- redaction negative corpus не допускает outbound payload с остаточными реквизитами.
