# 06. Canonical Domain Model — СтройИнтел

## 1. Назначение

Этот документ задаёт минимальную каноническую модель первого продуктового контура СтройИнтел.

Цель модели — обеспечить одну и ту же предметную семантику для:

- parsers/intake;
- calculations;
- blockers;
- API;
- UI;
- exports;
- optional AI explanation.

Организационные роли и LLM-персоны не являются доменными сущностями.

---

## 2. Основные сущности

```text
Project
 ├─ WorkItem
 │   ├─ ProgressEvent
 │   ├─ Evidence
 │   ├─ CommercialBasis
 │   ├─ SubmissionLine
 │   │    └─ Submission
 │   │         └─ AcceptanceEvent
 │   └─ Blocker
 │
 ├─ ScheduleActivity / Dependency
 ├─ PaymentObligation
 │    └─ PaymentEvent
 └─ SourceDocument
```

Связи платежей и закрывающих документов могут быть many-to-many и не должны насильно сводиться к одной строке.

---

## 3. `Project`

Представляет строительный объект/контрактный контур, внутри которого интерпретируются работы и события.

Минимальные поля:

```text
id
external_code?
name
contract_id?
customer_party_id?
contractor_party_id?
start_date?
contract_due_date?
currency
status
created_at
```

### Инвариант

Все бизнес-события принадлежат конкретному `Project`.

---

## 4. `SourceDocument`

Описывает источник, а не извлечённый из него бизнес-факт.

Поля:

```text
id
project_id
document_type
original_name
version
checksum
source_party?
document_date?
received_at
parser_profile?
parse_status
parse_error?
storage_ref
```

`document_type` например:

- ESTIMATE;
- VOR;
- DAILY_REPORT;
- OJR;
- AOSR;
- EXECUTIVE_SCHEME;
- GEODESY;
- KS2;
- KS3;
- HANDOVER_ACT;
- CONTRACT;
- ADDENDUM;
- LETTER;
- PAYMENT_STATEMENT;
- SCHEDULE.

### Инвариант

Любой производный факт должен иметь provenance до `SourceDocument` и, когда возможно, до листа/строки/страницы/фрагмента.

---

## 5. `SourceRef`

Переиспользуемая value object для traceability.

```text
source_document_id
sheet?
page?
row?
cell_range?
section?
fragment?
parser_method?
extraction_method?
```

Для AI extraction дополнительно:

```text
model?
confidence?
confirmation_status?
```

### Правило

Никакое поле `confidence` не заменяет provenance.

---

## 6. `WorkItem`

Главная каноническая единица работы.

Не равно:

- строке конкретного Excel;
- записи ОЖР;
- activity КСГ;
- строке КС-2.

Все перечисленные сущности **ссылаются** на `WorkItem`.

Минимальные поля:

```text
id
project_id
canonical_code
name
work_type
location?
planned_quantity?
unit?
baseline_unit_price?
baseline_amount?
parent_work_item_id?
commercial_scope_status
active_from?
active_to?
source_refs[]
```

### `canonical_code`

Это внутренний устойчивый идентификатор в рамках проекта/организации. Правило его образования должно быть отдельно специфицировано.

### `work_type`

Используется для выбора evidence profile и дополнительных правил.

### Инвариант

Смена текста/названия в source document не создаёт новый `WorkItem`, если физическая/коммерческая сущность работы та же.

---

## 7. `WorkItemAlias`

Для сопоставления разных источников.

```text
id
work_item_id
source_system_or_document_type
alias_code?
alias_name?
location_hint?
valid_from?
valid_to?
source_ref
match_method
confirmation_status
```

Это позволяет хранить локальные коды ЦИМ без превращения их в универсальный ключ системы.

---

## 8. `ProgressEvent`

Событие фактического производства.

```text
id
project_id
work_item_id?
event_date
operation_type?
quantity?
unit?
quantity_semantics
location?
crew_or_executor?
source_ref
match_status
validation_status
created_at
```

### `quantity_semantics`

Примеры:

- INCREMENT;
- CUMULATIVE;
- EXCAVATION;
- TRANSPORT;
- BACKFILL;
- INSTALLATION;
- COUNT;
- UNKNOWN.

### Инварианты

1. Для plan/fact используется только валидированная количественная семантика.
2. Событие без количества может подтверждать `activity occurred`, но не увеличивает выполненный объём.
3. `UNKNOWN` не преобразуется в 0.

---

## 9. `Evidence`

Подтверждение выполнения/допустимости перехода.

```text
id
project_id
work_item_id?
evidence_type
status
covered_quantity?
unit?
effective_date?
source_ref
validated_at?
validated_by?
```

Типы могут включать:

- OJR_RECORD;
- AOSR;
- EXECUTIVE_SCHEME;
- GEODESY;
- PHOTO;
- QUALITY_CERTIFICATE;
- LAB_RESULT;
- HANDOVER_ACT;
- VOR;
- APPROVAL_LETTER;
- OTHER.

### Инвариант

Evidence existence и evidence coverage — разные вещи.

Наличие одного АОСР не означает автоматически, что он покрывает весь выполненный объём.

---

## 10. `EvidenceRequirementProfile`

Определяет, что требуется для конкретного `work_type`/context.

```text
id
version
work_type
conditions[]
required_evidence[]
effective_from
effective_to?
source
```

Пример логики:

```text
IF work_type = HIDDEN_CONCRETE_WORK
THEN require OJR_RECORD + AOSR
AND require EXECUTIVE_SCHEME when project_policy says so
```

Это конфигурация/правило, а не prompt.

---

## 11. `CommercialBasis`

Подтверждает право включить работу в коммерческий контур.

```text
id
project_id
work_item_id
basis_type
status
valid_from?
valid_to?
amount_limit?
quantity_limit?
source_ref
```

`basis_type`:

- CONTRACT_BASELINE;
- APPROVED_ESTIMATE;
- ADDENDUM;
- APPROVED_CHANGE;
- AUTHORIZED_LETTER;
- OTHER.

### Инвариант

Физическое выполнение не создаёт коммерческое основание автоматически.

---

## 12. `Submission`

Бизнес-транзакция предъявления объёма.

```text
id
project_id
submission_type
number?
revision
status
prepared_at?
submitted_at?
counterparty_id?
source_document_id?
total_amount?
currency
```

`submission_type` может начинаться с `KS2`, но модель не должна быть жёстко привязана только к одному документу.

Статусы:

```text
DRAFT
SUBMITTED
RETURNED_FOR_REVISION
PARTIALLY_ACCEPTED
ACCEPTED
REJECTED
CANCELLED
```

---

## 13. `SubmissionLine`

Связывает предъявление с работой.

```text
id
submission_id
work_item_id
quantity
unit
amount?
source_ref?
```

### Инвариант

`SUBMITTED quantity` считается по линиям фактически предъявленного документа, а не по readiness или performed quantity.

---

## 14. `AcceptanceEvent`

Фиксирует реакцию второй стороны на предъявление.

```text
id
submission_id
accepted_at
result
accepted_amount?
source_ref
comment?
```

Для частичной приёмки требуется детализация по линиям либо отдельная сущность `AcceptanceLine`.

В MVP допустимо сразу проектировать `AcceptanceLine`, если source documents позволяют восстановить частичность.

---

## 15. `PaymentObligation`

Представляет ожидаемое денежное обязательство, вытекающее из договора/принятого объёма.

```text
id
project_id
basis_submission_id?
basis_acceptance_id?
amount
currency
due_date?
status
source_ref
```

Статусы:

```text
EXPECTED
DUE
PARTIALLY_PAID
PAID
OVERDUE
DISPUTED
```

---

## 16. `PaymentEvent`

Фактическое движение денег.

```text
id
project_id
payment_date
amount
currency
payer?
payee?
purpose?
source_ref
```

Связь платежа с обязательством оформляется отдельно.

---

## 17. `PaymentAllocation`

```text
id
payment_event_id
payment_obligation_id
allocated_amount
allocation_method
confirmation_status
```

`allocation_method`:

- EXACT_REFERENCE;
- RULE_BASED;
- MANUAL;
- AI_SUGGESTED.

AI-suggested allocation не считается подтверждённой автоматически.

---

## 18. `Blocker`

Управленческая сущность, означающая невозможность или риск следующего перехода.

```text
id
project_id
work_item_id?
entity_type
entity_id
blocker_type
blocked_transition
severity
opened_at
resolved_at?
owner_ref?
required_action
monetary_exposure?
source_refs[]
rule_id
```

### Типовые переходы

- PERFORMED → EVIDENCED;
- EVIDENCED → SUBMITTED;
- SUBMITTED → ACCEPTED;
- ACCEPTED → PAID.

### Типовые blocker types

См. `05_TO_BE.md`.

### Инвариант

Blocker должен быть воспроизводим из фактов и правила `rule_id`.

---

## 19. Состояние WorkItem — производное, а не хранимый единственный статус

Нельзя хранить одно поле:

```text
status = "EVIDENCED"
```

и считать задачу решённой.

Для работы могут одновременно существовать количественные слои:

```text
planned_quantity      = 100
performed_quantity    = 80
evidenced_quantity    = 60
submitted_quantity    = 50
accepted_quantity     = 45
paid_equivalent       = 20
```

Стадии вычисляются на основании event ledger.

---

## 20. `WorkLifecycleSnapshot`

Read model для UI/API.

```text
work_item_id
as_of
planned_quantity?
performed_quantity?
evidenced_quantity?
submitted_quantity?
accepted_quantity?
paid_amount?
current_blockers[]
last_progress_at?
oldest_open_blocker_at?
monetization_gap_amount?
data_quality_status
```

Snapshot можно кешировать, но source of truth остаются canonical events/documents.

---

## 21. `Finding`

Результат deterministic analysis, который можно показать пользователю или объяснить LLM.

```text
id
project_id
finding_type
severity
entity_ref
message_template_id
inputs
rule_id
source_refs[]
created_at
```

Примеры:

- `PERFORMED_NOT_EVIDENCED`;
- `EVIDENCED_NOT_SUBMITTED`;
- `ACCEPTED_NOT_PAID`;
- `QUANTITY_CONFLICT`;
- `COMMERCIAL_BASIS_MISSING`.

### Правило

LLM explanation строится **из Finding**, а не создаёт Finding свободным текстом.

---

## 22. `ScheduleActivity` и `Dependency`

Подключаются после первого vertical slice, но сразу должны быть совместимы с `WorkItem`.

```text
ScheduleActivity
  id
  project_id
  work_item_id?
  name
  baseline_start?
  baseline_finish?
  forecast_start?
  forecast_finish?
  duration?

Dependency
  predecessor_activity_id
  successor_activity_id
  relation_type
  lag
```

Это позволит рассчитывать CPM/float кодом.

---

## 23. Состояния качества данных

Для любой вычисляемой величины полезно различать:

```text
CONFIRMED
PARTIAL
CONFLICTED
UNKNOWN
NOT_APPLICABLE
```

Например:

- работа может быть `performed_quantity = UNKNOWN`;
- evidence readiness может быть `PARTIAL`;
- payment allocation — `CONFLICTED`.

Это лучше одного общего confidence score.

---

## 24. Инварианты первого контура

### INV-01

`UNKNOWN != 0`.

### INV-02

Любая финансово/сроково значимая цифра имеет provenance и rule/formula trace.

### INV-03

LLM output не изменяет canonical fact без validation/confirmation policy.

### INV-04

`performed_quantity <= planned_quantity` не является универсальным законом: переработка/допработа возможны. Превышение создаёт finding, а не молча обрезается до плана.

### INV-05

`evidenced_quantity` не может превышать фактически выполненный объём без conflict finding.

### INV-06

`accepted_quantity` не выводится из `submitted_quantity` без AcceptanceEvent.

### INV-07

`paid` не выводится из `accepted` без PaymentEvent/Allocation.

### INV-08

Один source record может быть superseded новой версией, но история не удаляется.

### INV-09

Любое автоматическое сопоставление хранит method и confidence/validation result.

### INV-10

UI не создаёт business facts.

---

## 25. Что НЕ входит в доменную модель

Следующие понятия могут существовать в application/UI layer, но не должны становиться основными domain entities только потому, что уже есть в продукте:

- «агент-сметчик»;
- «агент-эконом»;
- «экипаж»;
- conversational turn;
- prompt response;
- dashboard card;
- цвет виджета.

Domain model описывает строительный процесс и доказательства, а не форму текущей реализации.

---

## 26. Следующий шаг

На базе этой модели требуется создать `07_DATA_CONTRACTS.md`:

- source contracts по основным документам;
- canonical payloads;
- validation rules;
- nullable/unknown policy;
- matching contracts;
- API/read models первого vertical slice.

После data contracts можно переходить к `MVP_REQUIREMENTS` и mapping существующего кода СтройИнтел на новую модель.

---

## 27. Source basis

- `CAUDEX/01_PRODUCT_BOUNDARY.md`;
- `CAUDEX/02_AS_IS_VOLKOVSKY.md`;
- `CAUDEX/03_AI_BOUNDARY.md`;
- `CAUDEX/04_PROBLEM_MAP.md`;
- `CAUDEX/05_TO_BE.md`;
- существующие calculation/config/source-trace patterns СтройИнтел;
- пакет материалов Волковского ГОК.
