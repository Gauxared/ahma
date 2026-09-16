---
title: "СтройИнтеллект: трассировка legacy-правил и параметров"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: domain
horizon: delivery
scope: legacy-rule-parameter-traceability
project: stroyintellekt
source: /home/govard/projects/7rl/stroyintellekt/reference-system
related:
  - 00-product-scope-and-source-policy.md
  - 01-contract-requirements-and-acceptance.md
  - 03-domain-workflow-and-competency-contracts.md
  - 04-canonical-data-and-structured-output.md
  - 05-knowledge-and-parameter-platform.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: трассировка legacy-правил и параметров

## 1. Цель

Спецификация определяет доказуемую трассировку:

- всех входных параметров;
- всех выходных и вычисляемых параметров;
- всех формул;
- всех исполнимых правил;
- всех межкомпетентных передач;
- всех статусов, единиц, ограничений и запретов;
- известных legacy-дефектов.

Целевое покрытие — 100% этих сущностей. Текущее фактическое покрытие имеет status `not_measured`, пока каталоги не извлечены и не проверены.

Пояснительный текст без исполнимого поведения не входит в denominator, но сохраняется как source fragment с classification `explanatory`.

## 2. Корпус источников

### 2.1 Канонические источники

- корневое ТЗ;
- девять `reference-system/v8.2_*.docx`;
- `reference-system/stroiintellect-master.skill`;
- `reference-system/construction-cost-analysis.skill`;
- распакованные `_extracted_skills/`;
- десять корневых опорных XLSX;
- `reference-system/input-1/`;
- `reference-system/output-1/`.

### 2.2 Условные источники

- `reference-system/apri/`;
- `reference-system/modc/`;
- `reference-system/unihim/`;
- `reference-system/uralsetstroy/`;
- `reference-system/СтройИнтеллект_BRD_v4.0.docx`;
- HTML-прототипы.

Условный источник входит в acceptance denominator только после owner decision.

## 3. Denominator

Fragment является исполнимым, если задаёт хотя бы одно:

- обязательное действие или запрет;
- precondition или stop condition;
- ветвление workflow;
- формулу или параметр;
- временной норматив;
- допустимый диапазон;
- источник, freshness или status policy;
- формат обязательного результата;
- handoff между компетенциями;
- обработку неизвестного значения;
- критерий качества или приёмки.

Параметром считается типизированное значение, которое:

- вводится пользователем;
- извлекается parser;
- поступает из knowledge/config;
- вычисляется Calculation Engine;
- передаётся между компетенциями;
- публикуется через API, UI, Excel или Word;
- влияет на ветвление, порог, ставку или вывод.

## 4. Стабильные идентификаторы

```text
SRC-<source>-<version>
FRG-<source>-<location>-<hash8>
RUL-<domain>-<number>
PAR-<canonical-path>
FOR-<domain>-<name>-v<major>
HND-<producer>-<consumer>-<number>
OUT-<artifact>-<canonical-path>
CNF-<number>
DEC-<date>-<number>
FIX-<domain>-<number>
```

Примеры:

```text
RUL-CORE-001
PAR-finance.project_credit.rate
FOR-cost-deviation-v1
HND-lyudmila-vanych-001
OUT-excel.summary.first_cash_gap.amount
FIX-export-supply-001
```

ID не зависит от пути будущей реализации.

## 5. Каталоги

### 5.1 Source

```yaml
source_id: SRC-TZ-1.0
path: string
source_type: docx | xlsx | markdown | xml | html
version: string
sha256: string
priority: integer
canonicality: canonical | conditional | reference
extraction_status: pending | extracted | verified | failed
extractor_version: string
```

### 5.2 Fragment

```yaml
fragment_id: FRG-TZ-p79-a13f8b22
source_id: SRC-TZ-1.0
location:
  kind: paragraph | table_cell | xlsx_cell | xlsx_range | line_range
  value: string
original_text: string
normalized_text: string
content_hash: sha256
classification: rule | parameter | formula | handoff | output | example | explanatory
classification_reason: string
review_status: pending | reviewed | approved
```

### 5.3 Rule

```yaml
rule_id: RUL-CORE-001
fragment_refs: []
normalized_rule: string
rule_type: instruction | prohibition | precondition | validation | transition | timing | reconciliation | output_contract
competency: string | null
trigger: string
preconditions: []
inputs: []
outputs: []
failure_code: string | null
severity: info | warning | blocking | critical
disposition: implemented | config | test_only | roadmap | superseded_by_tz | conflict | not_applicable | reference_only
requirement_refs: []
schema_refs: []
code_refs: []
config_refs: []
test_refs: []
decision_ref: string | null
```

### 5.4 Parameter

```yaml
parameter_id: PAR-finance.project_credit.rate
canonical_path: finance.project_credit.rate
name_ru: Ставка проектного кредита
direction: input | output | derived | config | handoff
data_type: decimal | integer | string | boolean | date | enum | object | array
unit: ratio
nullable: false
unknown_policy: reject | preserve_unknown | request_human
constraints: []
effective_date_required: true
source_required: true
freshness_days: 90
producer: user | parser | calculation_engine | competency | config
consumers: []
formula_id: string | null
disposition: implemented | config | test_only | roadmap | superseded_by_tz | conflict | not_applicable | reference_only
requirement_refs: []
decision_ref: string | null
source_fragment_refs: []
schema_refs: []
export_paths:
  api: string | null
  ui: string | null
  excel: string | null
  word: string | null
test_refs: []
```

### 5.5 Formula

```yaml
formula_id: FOR-cost-deviation-v1
source_fragment_refs: []
inputs: []
output: PAR-cost.deviation.total
expression_label: "(contractor_price-reference_price)*quantity"
implementation_ref: string
rounding:
  mode: ROUND_HALF_UP
  scale: 2
valid_from: date
valid_to: date | null
reconciliation_rules: []
golden_case_refs: []
negative_case_refs: []
```

### 5.6 Handoff

```yaml
handoff_id: HND-lyudmila-vanych-001
producer: lyudmila_estimator
consumer: vanych_finance
trigger: estimate_review_completed
required_payload: []
blocking: true
missing_payload_behavior: block | warn | request_human
source_fragment_refs: []
workflow_refs: []
test_refs: []
```

## 6. Disposition

| Disposition | Смысл | Evidence |
|---|---|---|
| `implemented` | Runtime-поведение | schema/code/config + test |
| `config` | Версионируемые данные | schema + validation test |
| `test_only` | Negative или regression fixture | fixture + test |
| `roadmap` | Не входит в pilot | owner decision |
| `superseded_by_tz` | Отменено ТЗ | requirement ref |
| `conflict` | Требует решения | conflict record |
| `not_applicable` | Не относится к scope | reviewer reason |
| `reference_only` | Пример или терминология | classification reason |

`implemented` без теста запрещён. `conflict`, влияющий на pilot result, блокирует release.

## 7. Подтверждённые core rules

| ID | Правило | Источник |
|---|---|---|
| `RUL-CORE-001` | Физика предшествует стоимости и деньгам | master workflow |
| `RUL-CORE-002` | Людмила не финализирует смету без обоснованных объёмов Денчика | master workflow |
| `RUL-CORE-003` | Ваныч не финализирует финансовую модель без ВОР и условий договора | master workflow |
| `RUL-CORE-004` | Марина и Халиль получают потолки от Ваныча | master workflow |
| `RUL-CORE-005` | Такт синтеза не закрывается при незакрытом critical | master workflow |
| `RUL-CORE-006` | «В работе» без даты не является результатом | master skill |
| `RUL-CORE-007` | «Уточнить» без ответственного и срока не является результатом | master skill + ТЗ §9 |
| `RUL-CORE-008` | Ответ без рекомендации не принимается | master skill |
| `RUL-CORE-009` | Цифра без источника и даты не принимается | master skill |
| `RUL-CORE-010` | Норматив без подтверждённого статуса является допущением | `references/norms-base.md` |
| `RUL-CORE-011` | `unknown` не преобразуется в ноль | architecture control |
| `RUL-CORE-012` | LLM не выполняет арифметику §6.2 ТЗ | ТЗ §6.2 |

## 8. Подтверждённые handoff

```text
Настенька → паспорт и реестр
Артемий intake → маршрут
Денчик → Людмила: ВОР и физическое обоснование
Денчик → Ваныч: нагрузки, объёмы и инженерные ограничения
Денчик → Марина: спецификация
Денчик → Халиль: технические требования
Палыч → Артемий/Настенька: статус ИД и blockers
Виктор → Ваныч: аванс, удержание, порядок оплаты, штрафные параметры
Людмила → Ваныч: ВОР, сметные суммы, расхождения
Ваныч → Марина/Халиль: потолки
Марина/Халиль/Палыч/Виктор → Ваныч: риски и финансовые эффекты
Все применимые компетенции → Артемий: structured results
Настенька → Артемий: полнота, открытые вопросы, deadlines
```

Каждый handoff требует отдельной schema и integration test.

Обязательный stable ID прямой передачи:

```yaml
handoff_id: HND-denchik-vanych-001
producer: denchik_engineer
consumer: vanych_finance
trigger: engineering_result_confirmed
required_payload:
  - engineering_constraints
  - confirmed_quantities
  - loads
blocking: true
missing_payload_behavior: block
```

## 9. Parameter coverage rules

Параметр считается покрытым только когда заполнены:

- canonical path;
- type и unit;
- nullable и unknown policy;
- producer и consumers;
- source requirement;
- freshness/effective date;
- constraints;
- schema refs;
- formula ref для derived value;
- disposition;
- requirement или owner decision reference;
- API/UI/Excel/Word mapping;
- positive, boundary и negative tests.

Coverage:

```text
parameter_coverage =
  parameters_with_all_required_links / executable_parameters_total
```

Release gate: `parameter_coverage = 100%`.

## 10. Rule coverage rules

Правило считается покрытым только когда:

- reviewed source fragments существуют;
- normalized behavior однозначно;
- disposition не `pending`;
- requirement или owner decision указан;
- schema/config/code ref указан для active behavior;
- test/eval ref проверяет нормальный и запрещённый путь.

Coverage:

```text
rule_coverage =
  executable_rules_with_complete_disposition / executable_rules_total
```

Release gate: `rule_coverage = 100%`.

## 11. Regression corpus

`reference-system/input-1/` и `reference-system/output-1/` используются как:

- structure baseline;
- business-semantic baseline;
- formula/provenance fixture;
- source для golden и negative cases.

Regression не требует байтового совпадения. Сравниваются:

- обязательные сущности и параметры;
- числовые значения с contract rounding;
- статусы и provenance;
- handoff completeness;
- структура Excel/Word;
- критические выводы и рекомендации;
- отсутствие известных дефектов.

## 12. Известный negative fixture

`reference-system/output-1/05_Снабжение_и_поставки_Зауралье.xlsx` содержит ссылку на несуществующий лист `05_Скоуп_оборуд` вместо фактического `05_Объём_поставки_оборуд`.

Disposition:

```yaml
fixture_id: FIX-export-supply-001
disposition: test_only
expected_new_system_behavior: export_has_no_broken_sheet_references
```

Legacy-дефект сохраняется как evidence, но не воспроизводится.

## 13. Conflict workflow

```yaml
conflict_id: CNF-001
entity_refs: []
source_fragment_refs: []
conflict_type: value | scope | formula | timing | responsibility | terminology
description: string
temporary_behavior: block | use_tz | use_owner_decision
owner: product_owner
status: open | decided | superseded
decision_ref: string | null
```

Примеры уже выявленных конфликтов:

- права по объектам есть в тяжёлой архитектуре, но исключены ТЗ;
- 10 пользователей ошибочно превращены в 10 полных analyses;
- текущий optimal DAG поздно запускал Палыча, Виктора и Настеньку;
- часть legacy-функций подрядного scoring и КС-2/КС-3 шире pilot scope;
- Excel содержит рабочие формулы, но не является внутренним расчётным ядром.

## 14. Extraction и review pipeline

1. Инвентаризация и hash источников.
2. Детерминированное извлечение paragraphs, tables, cells, formulas и named ranges.
3. Классификация executable candidate.
4. Нормализация rule/parameter/formula/handoff.
5. Human review критических и конфликтных записей.
6. Связь с requirements и schemas.
7. Связь с tests/evals.
8. Coverage report.
9. Release gate.

LLM может предлагать классификацию, но не утверждает disposition и не закрывает coverage.

## 15. Definition of Done

- все canonical sources имеют hash и extraction status;
- все executable candidates reviewed;
- `parameter_coverage = 100%`;
- `rule_coverage = 100%`;
- все formulas имеют version, inputs, units, rounding и fixtures;
- все handoff имеют producer/consumer schemas и tests;
- каждый active conflict решён или блокирует соответствующий slice;
- regression corpus проходит;
- negative fixtures не воспроизводятся;
- coverage report не смешивает explanatory fragments с denominator.
