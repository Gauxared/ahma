---
title: "СтройИнтеллект: calculation engine"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: system
horizon: delivery
scope: calculation-engine
project: stroyintellekt
source: /home/govard/projects/7rl/stroyintellekt/reference-system
related:
  - 02-legacy-rule-and-parameter-traceability.md
  - 03-domain-workflow-and-competency-contracts.md
  - 04-canonical-data-and-structured-output.md
  - 05-knowledge-and-parameter-platform.md
  - 06-document-ingestion-and-normalization.md
  - 10-api-queue-and-runtime-state.md
  - 13-testing-evals-and-delivery-gates.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: calculation engine

## 1. Цель и граница

Calculation Engine детерминированно:

- выбирает опорные значения по versioned policy;
- исполняет зарегистрированные formulas/rules;
- рассчитывает отклонения, коммерческие и экспертные показатели;
- сохраняет FormulaTrace и rule decisions;
- воспроизводит результат по immutable snapshot.

LLM не является calculator, не определяет арифметический результат и не скрывает отсутствие обязательного параметра.

## 2. Preconditions

Расчёт разрешён, только если:

- `NormalizedSnapshot.confirmed = true`;
- blocking validation issues отсутствуют;
- `KnowledgeSnapshot` существует и immutable;
- все включённые revisions имеют status `published`;
- tenant overlay включён в manifest snapshot;
- все обязательные parameters/rules/formulas разрешены;
- input snapshot, knowledge snapshot, engine version и rounding policy immutable.

## 3. CalculationRun

```yaml
calculation_run_id: uuid
tenant_id: uuid
project_id: uuid
analysis_id: uuid
normalized_snapshot_id: uuid
knowledge_snapshot_id: uuid
knowledge_manifest_hash: sha256
mode: express | standard | expert
mode_policy_version: string
formula_set_version: string
rule_set_version: string
engine_version: string
rounding_policy_id: string
created_at: date-time
started_at: date-time | null
completed_at: date-time | null
state: queued | running | completed | failed | blocked
result_snapshot_id: uuid | null
input_hash: sha256
result_hash: sha256 | null
failure_code: string | null
```

## 4. Typed values

Engine принимает только canonical typed values из spec 04.

Ручное подтверждение не создаёт отдельный numeric status: используется `source_confirmed` с `SourceRef.source_type = user_confirmation`.

```yaml
value:
  value: decimal-string | null
  unit: canonical-unit-code | null
  status: source_confirmed | calculated | estimate | assumption | unknown | conflict | not_applicable
  source_refs: []
```

`unit` обязан принадлежать authoritative canonical unit registry из spec 04 §5.2. Calculation Engine не определяет сокращённый локальный enum.

Инварианты:

- `unknown != 0`;
- `not_applicable != unknown`;
- операции над несовместимыми units запрещены;
- binary float для денег запрещён;
- все конверсии единиц явные и traceable;
- `conflict` блокирует зависимый расчёт, если rule не определяет иной исход.

## 5. Внутренняя numeric policy

| Область | Тип |
|---|---|
| Деньги | arbitrary precision decimal |
| Проценты | decimal fraction, например `0.1700` |
| Количество | decimal |
| Индексы | decimal |
| Сроки | integer days |

Каждая formula определяет:

- scale входов;
- промежуточную precision;
- rounding mode;
- момент rounding;
- output unit;
- handling missing/conflict values.

## 6. ReferenceValuePolicy

```yaml
reference_value_policy:
  policy_id: string
  version: string
  scope: project | section | position | parameter
  ordered_sources:
    - source_type: contract | estimate | tenant_parameter | normative | market | expert
      required_statuses: []
      freshness_rule: string | null
      applicability_rule_id: string | null
  conflict_strategy: block | require_human | select_by_rule
  missing_strategy: block | mark_unknown | require_human
```

```yaml
reference_value_decision:
  decision_id: uuid
  parameter_key: string
  candidates: []
  selected_candidate_id: uuid | null
  policy_id: string
  policy_version: string
  reason_code: string
  rule_trace_refs: []
  decided_by: engine | human
```

Selection не может зависеть от порядка строк или неявного значения по умолчанию.

## 7. FormulaDefinition

```yaml
formula_definition:
  formula_id: string
  formula_version: string
  name: string
  expression_language: stroyexpr-v1
  expression: string
  input_schema: object
  output_schema: object
  rounding_policy_id: string
  missing_value_policy: block | unknown | not_applicable
  source_rule_refs: []
  test_fixture_refs: []
  status: draft | active | deprecated | blocked
```

Разрешённый expression language:

- арифметика;
- comparison;
- boolean conditions;
- `min`, `max`, `abs`, `sum`;
- conditional expression;
- explicit unit conversion;
- lookup в versioned ParameterSnapshot.

Запрещены network, filesystem, time-now, randomness, eval и provider calls.

## 8. RuleDefinition

```yaml
rule_definition:
  rule_id: string
  rule_version: string
  rule_kind: applicability | selection | validation | pruning | classification | threshold
  predicate: string
  on_true: object
  on_false: object
  priority: integer
  source_rule_refs: []
  status: draft | active | deprecated | blocked
```

Rule ordering задаётся `priority`, dependency graph и explicit tie-break. Цикл в graph блокирует release revision.

## 9. Domain calculations

### 9.1 Позиция

```text
calculated_amount = quantity × selected_unit_price
deviation_abs = contractor_amount - reference_amount
deviation_pct = deviation_abs / reference_amount
```

`deviation_pct` не рассчитывается при `reference_amount = 0` без явной domain rule.

### 9.2 Агрегации

- section total;
- document total;
- accepted scope total;
- unsupported scope total;
- saving potential;
- risk-adjusted value;
- schedule/equipment/other competency indicators.

Агрегация исключает `not_applicable`, но не превращает `unknown` в ноль.

### 9.3 Коммерческие показатели

Показатели discount, margin, profitability, financing and tax effects задаются только через cataloged FormulaDefinition и ParameterSnapshot. Формулы из legacy artifacts должны иметь RuleID/FormulaID и regression fixture.

## 10. FormulaTrace

```yaml
formula_trace:
  trace_id: uuid
  calculation_run_id: uuid
  formula_id: string
  formula_version: string
  expression_hash: sha256
  inputs:
    - name: string
      value: object
      source_refs: []
      producing_trace_id: uuid | null
  steps:
    - operation: string
      operands: []
      raw_result: decimal-string | boolean | null
      rounded_result: decimal-string | null
  result:
    value: object
  rounding_policy_id: string
  source_rule_refs: []
  created_at: date-time
```

Для каждого result-affecting output trace обязателен.

## 11. Execution graph

```text
load snapshots
→ validate manifests
→ resolve typed inputs
→ select reference values
→ build formula/rule dependency DAG
→ execute topologically
→ validate outputs
→ reconcile totals
→ create immutable ResultSnapshot
```

Engine должен быть:

- deterministic;
- side-effect free внутри расчётного ядра;
- restartable;
- idempotent по run key;
- independent от Excel/LLM/UI.

## 12. ResultSnapshot

```yaml
result_snapshot_id: uuid
calculation_run_id: uuid
input_hash: sha256
knowledge_snapshot_id: uuid
knowledge_manifest_hash: sha256
engine_version: string
outputs: object
formula_trace_ids: []
rule_decision_ids: []
validation_summary:
  blocking: integer
  warnings: integer
reconciliation:
  declared_total: decimal-string | null
  calculated_total: decimal-string | null
  difference: decimal-string | null
  state: matched | explained_difference | unexplained_difference | insufficient_data
created_at: date-time
result_hash: sha256
```

Snapshot immutable. Recalculation создаёт новый run и новый snapshot.

## 13. Errors

| Code | Meaning | Gate |
|---|---|---|
| `MISSING_REQUIRED_PARAMETER` | Нет обязательного parameter | block |
| `PARAMETER_CONFLICT` | Не разрешён конфликт | block |
| `UNIT_MISMATCH` | Несовместимые units | block |
| `FORMULA_CYCLE` | Цикл dependency graph | block release/run |
| `FORMULA_UNREGISTERED` | Formula вне manifest | block |
| `RULE_UNREGISTERED` | Rule вне manifest | block |
| `DIVISION_BY_ZERO` | Не покрыто explicit rule | block |
| `NON_DETERMINISTIC_DEPENDENCY` | Обнаружен запрещённый input | block |
| `RECONCILIATION_FAILED` | Необъяснённая разница | block contract gate |
| `ENGINE_INTERNAL_ERROR` | Internal failure | retry/fail |

## 14. Service ports

```python
class CalculationEngine(Protocol):
    async def execute(self, request: CalculationRequest) -> CalculationResult: ...
```

```python
class FormulaRegistry(Protocol):
    def resolve(self, formula_id: str, version: str) -> FormulaDefinition: ...
```

```python
class RuleRegistry(Protocol):
    def resolve_bundle(self, manifest: RuleManifest) -> RuleBundle: ...
```

```python
class ReferenceValueResolver(Protocol):
    def resolve(
        self,
        candidates: Sequence[CandidateValue],
        policy: ReferenceValuePolicy,
    ) -> ReferenceValueDecision: ...
```

## 15. Idempotency

```text
run_key = sha256(
  tenant_id
  + normalized_snapshot_id
  + knowledge_snapshot_id
  + knowledge_manifest_hash
  + mode
  + mode_policy_version
  + formula_set_version
  + rule_set_version
  + engine_version
  + rounding_policy_id
)
```

Одинаковый ключ обязан давать одинаковый `result_hash`.

## 16. Legacy parity

До production admission:

- 100% cataloged executable rules имеют implementation mapping;
- 100% result-affecting parameters имеют disposition;
- контрольные legacy cases воспроизводятся;
- известный broken Excel-reference fixture распознаётся как invalid reference, а не принимается как expected result;
- расхождения классифицируются как intentional correction или regression;
- intentional correction требует owner decision и обновлённого fixture.

## 17. Acceptance

- repeated run по тому же key даёт тот же hash;
- 100% result-affecting outputs имеют FormulaTrace;
- unsupported/missing input не становится `0`;
- unit mismatch блокируется;
- unregistered formula/rule не исполняется;
- Excel отсутствует в runtime dependency graph;
- LLM provider недоступен, но calculation остаётся воспроизводимым;
- declared/calculated totals сходятся до `0.00 RUB` либо разница объяснена;
- property tests покрывают rounding, aggregation, monotonicity и boundary conditions;
- mutation tests не пропускают изменение знака, коэффициента или порядка выбора.

## 18. Решения до реализации

| ID | Решение |
|---|---|
| `DEC-CALC-001` | Decimal precision и rounding policies |
| `DEC-CALC-002` | Финальный DSL `stroyexpr-v1` |
| `DEC-CALC-003` | Каталог ReferenceValuePolicy |
| `DEC-CALC-004` | Правила нулевого denominator |
| `DEC-CALC-005` | Допуски reconciliation вне договорного MVP |
| `DEC-CALC-006` | Порядок экспертных и tenant overrides |
