# 11. Delivery Backlog — первый продуктовый контур СтройИнтел

## 1. Назначение

Этот backlog переводит `01–10` CAUDEX из аналитики в последовательность поставки.

Он намеренно построен **по бизнес-способностям и acceptance cases**, а не по количеству экранов, агентов или технологических слоёв.

Основное правило исполнения:

> Каждая задача должна закрывать конкретный FR/AC и оставлять после себя проверяемый вертикальный результат.

Если задача не может быть связана с требованием/acceptance case, она не входит в первый product contour без отдельного решения.

---

## 2. Общие delivery guardrails

До прохождения MVP release gate:

1. не добавлять новые LLM-роли и crew modes;
2. не расширять dashboard ради новых визуализаций без нового canonical fact;
3. не переписывать существующую platform infrastructure без blocking reason;
4. не использовать LLM для арифметики, lifecycle state и финансовых facts;
5. не делать big-bang replacement текущего `check-object` flow;
6. каждый новый business fact обязан иметь provenance;
7. `UNKNOWN != 0`;
8. каждый PR должен ссылаться на CAUDEX requirement/acceptance case.

---

## 3. Приоритеты

### P0 — foundation / release blocker

Без этого следующий слой нельзя считать корректным.

### P1 — core MVP

Нужен для ответа на основной вопрос `выполнено → деньги`.

### P2 — usable product

Нужен пользователю для ежедневной работы, но строится только поверх P0/P1.

### P3 — controlled AI / extensions

Разрешается после устойчивого deterministic path.

---

# EPIC A — Product guardrails и baseline

**Priority:** P0  
**Цель:** защитить проект от параллельного расползания scope во время миграции.

## A-01. Зафиксировать CAUDEX как decision source

### Изменения

- добавить ссылку на `CAUDEX/README.md` в developer documentation;
- описать статус CAUDEX: product/system decision baseline первого контура;
- запретить автоматическое трактование CAUDEX как команды удалить legacy flows.

### DoD

- разработчик/агент перед feature work видит CAUDEX;
- PR template/task prompt требует CAUDEX reference;
- существующий runtime не сломан.

## A-02. Создать migration feature boundary

Выбрать namespace/module boundary для нового vertical slice без смешения с agent flow.

Рекомендуемая семантика, не обязательное имя каталога:

```text
work-control / closure / lifecycle
```

### DoD

- новый flow может развиваться независимо от `modules/agents`;
- не нарушены существующие architecture checks;
- нет обратного импорта domain → platform.

---

# EPIC B — Canonical contracts и persistence

**Priority:** P0  
**Связь:** FR-02, FR-03, FR-04, FR-07, FR-09, FR-11, FR-12, FR-13; `06_DOMAIN_MODEL`, `07_DATA_CONTRACTS`.

## B-01. Расширить domain contracts

Добавить/адаптировать в `packages/contracts`:

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

### DoD

- типы отражают nullable/unknown semantics;
- money/quantity не имеют implicit default `0`;
- provenance является частью значимых facts;
- compile/test existing contracts green.

## B-02. Persistence schema

Добавить хранение canonical ledger.

### DoD

- миграция БД идемпотентна/версионируема;
- tenant/project ownership соблюдается;
- events не хранятся только как opaque agent JSON;
- есть repository tests.

## B-03. Source document versioning

Реализовать:

```text
checksum
version/revision
received_at
parse_status
source location
```

### Acceptance

- AC-06 duplicate import;
- AC-07 new document version.

---

# EPIC C — Intake и document profiles

**Priority:** P0/P1  
**Связь:** FR-01, FR-02, FR-20.

## C-01. Общий `IngestedDocument` envelope

Адаптировать существующие storage/document adapters к контракту `07_DATA_CONTRACTS.md`.

### DoD

Каждый файл получает явный outcome:

```text
parsed
partial
unsupported
failed(reason)
```

Silent skip отсутствует.

## C-02. Profile — плановая работа

Первый профиль для сметы/ВОР/plan source должен выдавать `PlannedWorkInput`.

### DoD

Минимум:

```text
name
unit
plannedQuantity
sourceRef
```

Цена nullable и не превращается в zero.

## C-03. Profile — суточный факт

Извлекает `DailyProgressInput`.

### DoD

- quantity semantics = INCREMENT по контракту;
- сохраняются date/code/name/unit/location/basis/source;
- возможный cumulative input не суммируется без проверки.

## C-04. Profile — ОЖР

Разделить исходы:

```text
quantified progress candidate
evidence-only event
```

### Acceptance

- AC-03.

## C-05. Profiles — KS-2 / KS-3 / payment

Минимальные структуры из `07_DATA_CONTRACTS.md`.

### DoD

Наличие файла не означает submitted/accepted/paid без подтверждающего события/статуса.

---

# EPIC D — WorkItem identity и matching

**Priority:** P0/P1  
**Связь:** FR-03, FR-06; AC-04, AC-05, AC-09, AC-21.

## D-01. `WorkItem` registry

Адаптировать существующий `modules/canonical` к устойчивому `WorkItem`.

### DoD

- source row != WorkItem;
- aliases хранятся отдельно;
- изменение source wording не создаёт новую работу автоматически.

## D-02. Exact/rule matching

Pipeline:

```text
explicit canonical/external code
→ exact alias
→ normalized/rule match
```

### Acceptance

AC-04 проходит без LLM call.

## D-03. Fuzzy candidate matching

Переиспользовать `text-match`, stem, units и match ledger.

### DoD

- candidate list;
- score/method;
- ambiguous result = `needs_review`;
- business quantity не меняется до confirmation policy.

## D-04. AI matching fallback

**Priority:** P3, не блокирует deterministic MVP.

LLM вызывается только после exact/rules/fuzzy gate.

### Acceptance

AC-05; source fragment + model + confidence + confirmation status сохраняются.

---

# EPIC E — Progress ledger и защита факта

**Priority:** P1  
**Связь:** FR-04, FR-05, FR-10, FR-20.

## E-01. `ProgressEvent` ledger

Регистрировать количественный факт событием.

### DoD

- idempotency key/source linkage;
- event date;
- work item;
- quantity/unit;
- quantity semantics;
- validation/match status;
- SourceRef.

## E-02. Double-count detection

Обнаруживать минимум:

- повторный импорт;
- cumulative-vs-increment suspicion;
- aggregated operations;
- duplicate source event.

### Acceptance

AC-06, AC-08, AC-10.

## E-03. Units validation

Использовать существующий canonical units layer.

### Acceptance

AC-09: incompatible unit без conversion rule → `UNIT_MISMATCH`, quantity comparable = UNKNOWN.

## E-04. Plan/fact engine

Детерминированно считать:

```text
performed = Σ valid increments
remaining = plan - performed
ratio = performed / plan
last_progress_at
```

### DoD

- без LLM;
- данные с conflict/unknown не смешиваются с confirmed;
- result traceable до events.

---

# EPIC F — Evidence и commercial readiness

**Priority:** P1  
**Связь:** FR-07, FR-08; AC-01, AC-02, AC-11, AC-12.

## F-01. Evidence registry

Добавить `Evidence` как отдельную сущность.

### DoD

Evidence имеет type/status/source и может покрывать конкретный quantity/scope.

## F-02. Evidence requirement profiles

Конфигурация:

```text
work_type + conditions → required evidence
```

Не prompt.

### DoD

- version/effective date;
- rule id;
- source/reference of rule;
- tests.

## F-03. Readiness engine

Результаты вида:

```text
READY_FOR_SUBMISSION
MISSING_AOSR
MISSING_GEODESY
MISSING_HANDOVER_ACT
```

### Acceptance

AC-02, AC-12.

## F-04. Commercial basis

Добавить baseline/addendum/approved change/letter basis.

### Acceptance

AC-11: выполненная допработа без основания не становится гарантированной выручкой.

---

# EPIC G — Submission / Acceptance / Payment

**Priority:** P1  
**Связь:** FR-09–FR-12; AC-13…AC-19.

## G-01. KS-2 as `Submission`

Статусы:

```text
DRAFT
SUBMITTED
RETURNED_FOR_REVISION
PARTIALLY_ACCEPTED
ACCEPTED
REJECTED
```

### Acceptance

AC-13, AC-14.

## G-02. Partial acceptance

Поддержать line/quantity partial acceptance.

### Acceptance

AC-15.

## G-03. Payment obligation

На основании принятого объёма/договора формировать ожидаемое обязательство с due date, если вычислимо.

## G-04. Payment event + allocation

Поддержать exact/rule/manual/unresolved allocation.

### Acceptance

AC-16, AC-17.

## G-05. Source conflict

Добавить DataConflict/source priority resolution.

### Acceptance

AC-19.

---

# EPIC H — Lifecycle, blockers и findings

**Priority:** P1  
**Связь:** FR-09, FR-13–FR-16.

## H-01. Quantity lifecycle engine

Read model по одной работе на дату:

```text
planned_quantity
performed_quantity
evidenced_quantity
submitted_quantity
accepted_quantity
paid_amount/equivalent
```

### DoD

Состояние — производное от events, а не свободно редактируемый общий enum.

## H-02. Blocker engine

Минимальные rules:

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
PAYMENT_NOT_LINKED / OVERDUE
DATA_CONFLICT
DOUBLE_COUNT_RISK
```

### DoD

Blocker содержит transition, rule id, openedAt, required action, source refs.

## H-03. Blocker age

Возраст считается детерминированно от корректного business event.

## H-04. Monetary exposure

Рассчитывать только при известной применимой цене/сумме.

### Acceptance

AC-18: неизвестная цена → UNKNOWN, не `0 ₽`.

## H-05. Findings

Структурировать минимум:

```text
PERFORMED_NOT_EVIDENCED
EVIDENCED_NOT_SUBMITTED
SUBMITTED_NOT_ACCEPTED
ACCEPTED_NOT_PAID
QUANTITY_CONFLICT
COMMERCIAL_BASIS_MISSING
```

Finding является входом UI/export/LLM explanation.

---

# EPIC I — Exception-first UI

**Priority:** P2  
**Связь:** FR-17, FR-18.

## I-01. Work Pipeline

Колонки минимум:

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

### DoD

Каждая значимая цифра раскрывается до source lineage.

## I-02. Blocker Queue

Фильтры:

- severity;
- type;
- transition;
- owner, если известен;
- age;
- monetary exposure.

## I-03. WorkItem Detail

Timeline:

- progress;
- evidence;
- submissions;
- acceptance;
- payments;
- conflicts;
- blockers;
- source links.

### Ограничение

UI не пересчитывает business logic самостоятельно.

---

# EPIC J — Controlled AI boundary

**Priority:** P3  
**Связь:** FR-06, FR-19; `03_AI_BOUNDARY.md`.

## J-01. Structured extraction fallback

LLM получает source fragment и schema, возвращает candidate fields.

### DoD

- source fragment retained;
- model/method/confidence stored;
- output проходит validation pipeline;
- canonical state напрямую не меняется.

## J-02. Semantic WorkItem candidate

Реализуется только как fallback D-04.

## J-03. Finding explanation

Вход:

```text
Finding + computed facts + blockers + SourceRefs
```

Выход — текст.

### Acceptance

AC-20: объяснение не может изменить числа/статусы и создать новый canonical fact.

## J-04. AI observability

Сохранять call journal/cost/latency/model/error для разрешённых AI calls.

Не считать число LLM calls product KPI.

---

# EPIC K — Reference cases и release gate

**Priority:** P0/P1 до release  
**Связь:** `09_ACCEPTANCE_CASES.md`.

## K-01. Волковский fixture pack

Подготовить обезличенный/контролируемый test dataset из признанных источников.

Критические scenarios:

- AC-01 performed not submitted;
- AC-02 missing evidence;
- AC-03 OЖР without quantity;
- AC-10 earthwork aggregation;
- AC-11 missing commercial basis;
- AC-12 missing equipment handover;
- AC-16 accepted not paid, если исходники позволяют подтвердить сценарий.

### DoD

Каждый expected result имеет source refs и не основан на dashboard narrative как единственном источнике истины.

## K-02. Machine-readable acceptance matrix

Формат fixture:

```text
case_id
inputs
expected entities/events
expected blockers
expected findings
expected values
forbidden outputs
```

## K-03. Второй объект

Прогнать тот же flow без project-specific code.

### Acceptance

AC-21.

## K-04. Release gate

MVP готов, когда:

- AC-01…AC-20 green на fixtures;
- критические кейсы подтверждены Волковским;
- AC-21 green;
- silent skips = 0;
- deterministic rerun стабилен;
- critical findings имеют provenance.

---

# EPIC L — Legacy retirement после доказательства MVP

**Priority:** после release gate.

## L-01. Dependency audit agentic paths

Codex строит file-level graph для:

- `modules/agents`;
- `config/agents`;
- `config/crew`;
- `platform/execution/agentic-*`;
- agent-centric exports;
- agent routing.

Результат:

```text
KEEP — реальная отдельная capability
ARCHIVE/FREEZE — legacy compatibility
ADAPT — полезная capability переносится за AI boundary
REMOVE — replacement доказан, зависимостей нет
```

## L-02. Удаление дублирующих sources of truth

Удалять/отключать только после equivalence tests.

## L-03. Product navigation cleanup

Новый default user flow = work/blocker pipeline.

Agent/research mode, если сохранён, становится secondary tool, а не основным способом пользоваться СтройИнтел.

---

## 4. Рекомендуемый порядок первых PR

### PR-01 — Contracts only

`B-01`, тесты, без UI и БД-логики.

### PR-02 — Persistence + SourceDocument

`B-02`, `B-03`.

### PR-03 — Plan + daily/OЖР intake

`C-01…C-04`.

### PR-04 — WorkItem matching

`D-01…D-03`, без LLM.

### PR-05 — Progress ledger / plan-fact

`E-01…E-04`.

### PR-06 — Evidence/readiness/commercial basis

`F-01…F-04`.

### PR-07 — KS-2/acceptance/payment

`G-01…G-05`.

### PR-08 — Lifecycle/blockers/findings

`H-01…H-05`.

### PR-09 — Reference acceptance before fancy UI

`K-01`, `K-02`: убедиться, что backend действительно отвечает на product question.

### PR-10 — Minimal product UI

`I-01…I-03`.

### PR-11 — AI fallback/explanation

`J-01…J-04`, только после deterministic path.

### PR-12 — Second object / release gate

`K-03`, `K-04`.

---

## 5. Что отдавать Codex первым

Не весь backlog сразу.

Первая техническая задача для Codex после утверждения CAUDEX:

```text
Проведи READ-ONLY dependency audit и подготовь файл
CAUDEX/CODEX_AUDIT_01.md.

Основа решений: CAUDEX/06_DOMAIN_MODEL.md,
07_DATA_CONTRACTS.md, 08_MVP_REQUIREMENTS.md,
09_ACCEPTANCE_CASES.md, 10_CURRENT_CODE_MAPPING.md,
11_DELIVERY_BACKLOG.md.

Не меняй product scope.
Не добавляй агентов/оркестрацию.
Не пиши production code.

Для B-01…E-04:
1. найди существующий код, который можно переиспользовать;
2. перечисли точные файлы и зависимости;
3. предложи минимальный file-level change plan;
4. укажи риски обратной совместимости;
5. укажи тесты, которые должны остаться green;
6. отдельно отметь, где предложение CAUDEX дублирует уже существующую реализацию.
```

После review этого аудита Codex получает **один PR-sized task**, начиная с `B-01`, а не автономное «доведи СтройИнтел до новой архитектуры».

---

## 6. Definition of Done backlog item

Любой пункт backlog закрыт только если одновременно выполнено:

```text
implementation exists
+ tests exist
+ source/business rule trace exists
+ related AC passes
+ no silent fallback
+ no new unapproved AI source of truth
+ existing supported flow either remains green or migration is explicit
```

Фраза «агент теперь лучше понимает документ» сама по себе не является DoD.

---

## 7. Итог

Главный порядок поставки:

```text
contracts
→ source/provenance
→ WorkItem/matching
→ fact ledger
→ evidence/readiness
→ KS-2/acceptance/payment
→ blockers/findings
→ acceptance fixtures
→ UI
→ AI fallback/explanation
→ second object
→ legacy retirement
```

Это намеренно противоположно последовательности:

```text
новый агент → новый prompt → новый экран → поиск задачи для него
```

СтройИнтел сначала должен стать надёжной системой бизнес-фактов и переходов. AI после этого усиливает отдельные узкие места, а не держит систему на себе.
