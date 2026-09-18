# 12. Target Architecture — первый продуктовый контур СтройИнтел

## 1. Назначение

Этот документ фиксирует **целевую архитектуру первого продуктового контура** СтройИнтел после продуктового поворота, описанного в `01–11` CAUDEX.

Цель — не спроектировать новую платформу поверх существующей, а определить, **как встроить контур контроля выполнения и монетизации работ в текущий репозиторий**, максимально переиспользуя уже работающие parser/storage/config/runtime/eval компоненты.

Архитектура строится вокруг бизнес-фактов и переходов:

`WorkItem → ProgressEvent → Evidence → Submission → Acceptance → Payment → Blocker/Finding`.

LLM-агенты, роли и crew orchestration не являются центром этой архитектуры.

---

## 2. Архитектурная цель

Система должна из набора первичных источников построить доказуемое состояние каждой существенной работы:

```text
Запланировано
    ↓
Выполнено
    ↓
Подтверждено
    ↓
Предъявлено
    ↓
Принято
    ↓
Оплачено
```

На каждом переходе система должна уметь ответить:

- какой факт подтверждает переход;
- какой источник подтверждает факт;
- какой rule/calculation применён;
- чего не хватает для следующего состояния;
- сколько времени открыт blocker;
- каков денежный эффект, если он вычислим.

Если ответ не доказуем — состояние остаётся `UNKNOWN / PARTIAL / CONFLICTED`, а не достраивается предположением.

---

## 3. Принцип слоёв

```text
┌──────────────────────────────────────────────────────────┐
│                       apps/                              │
│  web / api / cli                                        │
│  Work Pipeline | Blocker Queue | WorkItem Detail        │
└────────────────────────────┬─────────────────────────────┘
                             │ read/write use-cases
┌────────────────────────────▼─────────────────────────────┐
│                product application layer                │
│  import source                                           │
│  register progress                                       │
│  resolve match                                           │
│  evaluate readiness                                      │
│  register submission / acceptance / payment             │
│  build lifecycle snapshot                                │
└────────────────────────────┬─────────────────────────────┘
                             │ canonical contracts
┌────────────────────────────▼─────────────────────────────┐
│                  domain / deterministic core            │
│  WorkItem ledger                                         │
│  lifecycle calculations                                  │
│  evidence rules                                          │
│  blocker engine                                          │
│  findings                                                │
│  matching policy                                         │
│  UNKNOWN/conflict semantics                              │
└────────────────────────────┬─────────────────────────────┘
                             │ ports
┌────────────────────────────▼─────────────────────────────┐
│                       platform/                          │
│  db | storage | jobs | queue | config | runtime         │
│  existing parser/storage/LLM adapters                   │
└──────────────────────────────────────────────────────────┘
```

Существующее правило зависимости сохраняется:

`apps → platform/application → modules/domain → packages/contracts`

Доменные модули не должны импортировать БД, filesystem, HTTP или LLM runtime.

---

## 4. Новый продуктовый boundary

Новый vertical slice должен иметь отдельную предметную границу и не встраиваться внутрь `modules/agents/`.

Рекомендуемая семантика каталога:

```text
modules/work-control/
  lifecycle/
  matching/
  evidence/
  blockers/
  findings/
  snapshots/
```

Название может быть другим (`closure`, `work-lifecycle`), но смысл обязателен:

> это домен движения строительной работы от плана к деньгам, а не оркестратор экспертных ролей.

Существующий `modules/workflow/check-object.ts` не переписывается в первой итерации. Новый contour развивается рядом и использует общие нижние компоненты.

---

## 5. SourceDocument + ingestion boundary

### 5.1 Вход

Первый contour принимает:

- смету / ВОР;
- суточную форму;
- ОЖР;
- исполнительную документацию;
- КС-2 / КС-3;
- договор / ДС / письма;
- платёжные источники;
- КСГ как источник календарной логики.

### 5.2 Существующее переиспользование

Нельзя создавать второй универсальный file-ingestion стек.

Используются существующие:

- `modules/documents/`;
- `platform/storage/`;
- format detector;
- parser registry;
- XLS/XLSX/CSV abstractions;
- DOCX/PDF readers;
- archive handling.

Над ними добавляются **document profiles** первого продуктового контура.

### 5.3 Результат ingestion

Каждый файл сначала становится `SourceDocument` + набором raw extracted records.

Парсер не имеет права напрямую установить:

- `EVIDENCED`;
- `SUBMITTED`;
- `ACCEPTED`;
- `PAID`;
- monetary finding.

Он только извлекает данные и provenance.

---

## 6. Canonical data layer

Центральные контракты определены в `06_DOMAIN_MODEL.md` и `07_DATA_CONTRACTS.md`.

Минимальный runtime-набор:

```text
SourceDocument
SourceRef
WorkItem
WorkItemAlias
ProgressEvent
Evidence
CommercialBasis
Submission
SubmissionLine
AcceptanceEvent
PaymentObligation
PaymentEvent
PaymentAllocation
Blocker
Finding
DataConflict
```

### Ключевое архитектурное решение

Source of truth — **ledger фактов и событий**, а не один мутируемый статус WorkItem.

Например, допустимо одновременно:

```text
planned      = 100 м³
performed    = 80 м³
evidenced    = 60 м³
submitted    = 50 м³
accepted     = 45 м³
paid         = 20 м³ equivalent / linked amount
```

UI получает `WorkLifecycleSnapshot`, но snapshot является read model, а не первичным фактом.

---

## 7. Matching architecture

В существующем `modules/canonical/` уже есть важные элементы matching-ядра: registry, ledger, text matching, stemming и units.

Целевой pipeline:

```text
exact canonical/external code
        ↓
confirmed alias
        ↓
explicit mapping rule
        ↓
normalized text / fuzzy match
        ↓
AI candidate generation
        ↓
confidence + ambiguity gate
        ↓
manual review when required
```

### Правило

LLM не является первым matcher.

Результат любого неочевидного match хранится как самостоятельный объект/record:

```text
candidate ids
selected id?
method
confidence?
status
source
confirmation
```

Ни fuzzy, ни LLM match не должны молча менять количественный факт.

---

## 8. Lifecycle engine

Lifecycle engine — главный новый deterministic module.

Он не хранит «магический статус», а вычисляет слои объёма и переходы по событиям.

Минимальные функции концептуально:

```text
calculatePerformed(workItem, events)
calculateEvidenceCoverage(workItem, evidence, profile)
calculateSubmitted(workItem, submissions)
calculateAccepted(workItem, acceptanceEvents)
calculatePaid(workItem, allocations)
buildLifecycleSnapshot(...)
```

Результат должен быть воспроизводим без LLM.

---

## 9. Evidence readiness engine

`Evidence` и `ProgressEvent` хранятся отдельно.

Для `work_type` применяется versioned `EvidenceRequirementProfile`.

Пример:

```text
HIDDEN_CONCRETE_WORK
  require:
    OJR_RECORD
    AOSR
    EXECUTIVE_SCHEME when applicable
```

Engine отвечает не на вопрос «есть ли какой-то АОСР», а:

> какой выполненный объём покрыт достаточным набором evidence.

Отсюда вычисляется `evidenced_quantity` и blockers следующего перехода.

---

## 10. Blocker / Finding engine

Это основной управленческий слой MVP.

### Blocker

Описывает, что мешает следующему переходу:

```text
WORK_MATCH_UNRESOLVED
QUANTITY_UNKNOWN
UNIT_MISMATCH
MISSING_EVIDENCE
MISSING_SIGNATURE
COMMERCIAL_BASIS_MISSING
KS2_NOT_PREPARED
KS2_NOT_SUBMITTED
KS2_NOT_ACCEPTED
PAYMENT_NOT_LINKED
PAYMENT_OVERDUE
DATA_CONFLICT
DOUBLE_COUNT_RISK
SOURCE_STALE
```

### Finding

Описывает воспроизводимый вывод:

```text
PERFORMED_NOT_EVIDENCED
EVIDENCED_NOT_SUBMITTED
SUBMITTED_NOT_ACCEPTED
ACCEPTED_NOT_PAID
QUANTITY_CONFLICT
COMMERCIAL_BASIS_MISSING
```

Каждый blocker/finding имеет:

- entity reference;
- rule id;
- inputs;
- source refs;
- deterministic severity/type;
- computed values if available.

LLM не создаёт тип finding и не решает, существует ли blocker.

---

## 11. Money boundary

Финансовые состояния делятся минимум на три разных понятия:

```text
commercial amount
accepted obligation
cash payment
```

Они не должны смешиваться.

### Запрещено

- считать общий приход денег оплатой конкретной работы без allocation;
- считать неизвестную цену как 0;
- считать физически выполненную допработу гарантированной выручкой без commercial basis;
- считать деньги текстом LLM.

### Разрешено

Использовать существующий deterministic calculation layer и formula registry для денежных вычислений.

---

## 12. Persistence

Существующий `platform/db/` сохраняется как инфраструктурная основа.

Новый contour добавляет persistence для canonical ledger и read models.

Минимальные требования:

- versioned `SourceDocument`;
- checksum/idempotency;
- immutable provenance для исторических facts;
- event/fact records не перезаписываются без audit trail;
- tenant isolation сохраняется;
- повторный импорт не удваивает факт;
- изменение source version порождает новую revision/conflict path.

Snapshot/cache допускаются только как производные данные.

---

## 13. Application use-cases

UI/API не должны напрямую собирать бизнес-логику из таблиц БД.

Нужен application layer с явными use-cases, например:

```text
ImportProjectSource
CreateOrUpdateWorkItems
RegisterProgressEvents
ResolveWorkMatch
RegisterEvidence
RegisterSubmission
RegisterAcceptance
RegisterPayment
AllocatePayment
EvaluateWorkLifecycle
ListOpenBlockers
GetWorkItemTrace
```

Use-case orchestrates domain + ports, но не переносит формулы в controller/UI.

---

## 14. UI architecture MVP

Первый UI состоит не из универсального dashboard, а из трёх рабочих read models.

### 14.1 Work Pipeline

```text
WorkItem
plan
performed
evidenced
submitted
accepted
paid
blocker
age
monetary exposure
```

### 14.2 Blocker Queue

Exception-first очередь:

- severity;
- blocker type;
- age;
- affected work;
- required action;
- monetary exposure;
- source trace.

### 14.3 WorkItem Detail

- lifecycle timeline;
- source refs;
- events;
- evidence coverage;
- submissions;
- acceptance;
- payments;
- conflicts;
- blockers/findings.

UI не содержит отдельные формулы определения статусов.

---

## 15. AI boundary в архитектуре

LLM runtime из `platform/runtime/` остаётся инфраструктурным активом.

В первом contour разрешены только три типа вызова.

### A. Extraction fallback

Извлечение кандидатов фактов из слабоструктурированного текста/документа.

Output обязан содержать provenance, fragment и confidence там, где применимо.

### B. Semantic candidate matching

Когда exact/rules/fuzzy не дали безопасного решения, LLM может предложить кандидатов WorkItem.

Результат проходит deterministic gate / review.

### C. Explanation

LLM получает готовый structured Finding/Snapshot и объясняет его пользователю.

Она не меняет canonical facts.

### Не допускается в MVP

- multi-agent debate как способ вычислить status;
- выбор финансового результата «ролью-экономистом»;
- агентное вычисление процента готовности;
- генерация отсутствующего количества/цены;
- автономное распределение спорного платежа;
- новые цифровые должности для каждого view.

---

## 16. Что происходит с текущими agentic flows

Текущие:

- `config/agents/`;
- `config/crew/`;
- agent routing;
- `modules/agents/`;
- agentic execution modes

не удаляются первой миграцией.

Стратегия:

```text
legacy flow ────────────────┐
                            ├─ common parsers/storage/runtime
new work-control flow ──────┘
```

После прохождения MVP часть старых capabilities может быть:

- подключена как explanation/semantic service;
- оставлена отдельным экспертным режимом;
- архивирована как experimental;
- удалена после dependency-аудита.

Но новый домен не зависит от agent conversations.

---

## 17. EVM, schedule и prediction

### Schedule

После устойчивых `WorkItem + ProgressEvent` подключается `ScheduleActivity / Dependency`.

CPM/float/critical path рассчитываются кодом по сети.

### EVM

EVM включается после появления доказуемых:

- PV;
- EV;
- AC.

Если один контур неполон — `NOT_COMPUTABLE`.

### Predictive ML

Не является foundation MVP.

Он появляется только при наличии:

- накопленного event corpus;
- устойчивых target labels;
- baseline deterministic model;
- измеримого uplift относительно правил/эвристик.

---

## 18. Testing architecture

Существующие `modules/eval/`, reference cases и unit-test культура должны стать release backbone нового contour.

Уровни:

```text
unit tests
  ↓
domain invariant tests
  ↓
parser/profile fixtures
  ↓
acceptance cases AC-01…AC-20
  ↓
Volkovsky reference case
  ↓
second-project portability case AC-21
  ↓
shadow run against legacy outputs where useful
```

Критические проверки должны проверять не только правильный output, но и **forbidden output**.

Примеры:

- нет объёма → система не создаёт quantity;
- нет цены → не создаёт `0 ₽`;
- ambiguously matched → не влияет на progress;
- общий bank inflow → не переводит WorkItem в `PAID`;
- повторный import → не удваивает event.

---

## 19. Deployment / migration strategy

Миграция идёт vertical slices, не big bang.

```text
Phase 1  contracts + persistence
Phase 2  estimate/daily/OJR intake
Phase 3  WorkItem + matching
Phase 4  progress ledger
Phase 5  evidence readiness
Phase 6  submission / acceptance
Phase 7  payment / allocation
Phase 8  blockers/findings
Phase 9  three MVP views
Phase 10 controlled AI fallback/explanation
Phase 11 second-object validation
```

Каждая phase должна давать проверяемый canonical artifact и закрывать CAUDEX acceptance cases.

---

## 20. Architectural invariants

### ARCH-01
`UNKNOWN != 0`.

### ARCH-02
Любой business-significant fact имеет provenance.

### ARCH-03
Parser извлекает данные, но не устанавливает lifecycle business status.

### ARCH-04
LLM output не становится canonical fact без validation policy.

### ARCH-05
UI не содержит независимую lifecycle/finance business logic.

### ARCH-06
WorkItem не равен строке одного source document.

### ARCH-07
Lifecycle state является производным от ledger событий/объёмов.

### ARCH-08
Повторный импорт идемпотентен.

### ARCH-09
Legacy agent flow не является dependency нового domain core.

### ARCH-10
Object-specific различия реализуются через profiles/config/reference data, а не `if (project === ...)`.

---

## 21. Definition of Done архитектуры v1

Target architecture считается доказанной, когда на reference case можно пройти полный путь:

```text
source document
  → extracted record
  → normalized canonical fact
  → WorkItem match
  → validated event/evidence
  → lifecycle calculation
  → blocker/finding
  → UI read model
  → source trace
```

и тот же runtime проходит второй объект **без изменения базовой state machine**.

Это и является архитектурной границей первого СтройИнтел как продукта.
