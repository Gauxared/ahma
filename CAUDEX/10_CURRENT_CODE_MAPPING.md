# 10. Current Code Mapping — СтройИнтел

## 1. Назначение

Этот документ сопоставляет существующий код СтройИнтел с целевым продуктовым контуром, зафиксированным в `01–09` CAUDEX.

Цель — **не переписать проект с нуля** и не объявить весь существующий agentic-код ошибкой. В репозитории уже есть сильные инженерные решения: детерминированные расчёты, provenance, парсеры, canonical matching, ports/adapters, тесты и инфраструктура исполнения.

Проблема находится выше уровнем: текущий runtime и продуктовая история во многом организованы вокруг ролей/агентов и «полной проверки объекта», тогда как первый доказуемый продуктовый контур должен быть организован вокруг бизнес-сущностей и переходов:

`WorkItem → ProgressEvent → Evidence → Submission → Acceptance → Payment → Blocker/Finding`.

Поэтому миграция выполняется **эволюционно**, через повторное использование существующего ядра и добавление нового vertical slice параллельно действующему сценарию.

---

## 2. Классификация

### `REUSE`

Компонент уже соответствует целевым принципам. Сохраняем поведение и используем как основу нового контура.

### `ADAPT`

Компонент полезен, но его контракт или предметная семантика должны быть расширены/перенаправлены на модель CAUDEX.

### `FREEZE`

Компонент не удаляется и может оставаться для совместимости/экспериментов, но **новая продуктовая функциональность поверх него не строится**, пока MVP CAUDEX не доказан.

### `REMOVE`

Кандидат на вывод из основного runtime **после** появления замены и dependency-аудита. Этот документ не является командой немедленно удалять код.

### `MISSING`

Способность требуется CAUDEX, но в текущем репозитории не обнаружена как полноценная доменная реализация.

---

## 3. Итоговая карта верхнего уровня

| Область репозитория | Решение | Причина |
|---|---|---|
| `modules/calculations/` | **REUSE** | Детерминированные расчёты с тестами — правильный центр вычислений |
| `config/formulas/` + formula registry loader | **REUSE** | Формулы вынесены в явный реестр, есть traceability |
| `modules/documents/` | **REUSE / ADAPT** | Сильная база парсинга; расширить профилями документов первого контура |
| `platform/storage/` | **REUSE** | Чтение XLS/XLSX/CSV/DOCX/PDF/архивов — инфраструктурный актив |
| `modules/canonical/` | **ADAPT** | Matching/units/ledger уже близки к нужному ядру, но целевая сущность — `WorkItem` и события жизненного цикла |
| `packages/contracts/` | **ADAPT** | Сохраняем primitives/provenance, расширяем canonical domain contracts |
| `modules/intake/` | **ADAPT** | Текущий intake нужно расширить от паспорта/маршрутизации к `SourceDocument` и data contracts |
| `modules/workflow/` | **ADAPT / SPLIT** | Не ломать `check-object`; добавить независимый workflow монетизации |
| `platform/db/` | **REUSE / ADAPT** | Репозитории и tenant isolation полезны; нужна persistence-модель новых сущностей |
| `platform/jobs/`, `queue/`, `security/` | **REUSE** | Общая production-инфраструктура не зависит от product narrative |
| `modules/eval/` + reference cases | **REUSE / ADAPT** | Отличная основа для `AC-01…AC-21` и shadow runs |
| `apps/web/` | **ADAPT** | Новый UI должен стать exception-first и читать canonical read model |
| `modules/exports/` | **ADAPT / FREEZE** | Общие отчёты переиспользуем; agent-persona exports не развиваем |
| `modules/agents/` | **FREEZE / SELECTIVE ADAPT** | Не основной runtime; отдельные semantic/explanation capabilities можно извлечь |
| `config/agents/` | **FREEZE** | Не расширять количество цифровых должностей |
| `config/crew/` | **FREEZE → REMOVE candidate** | Оркестрация экипажа не является ядром первого продукта |
| `platform/execution/*agentic*` | **FREEZE** | Сохраняем совместимость, но не строим новый lifecycle поверх agent conversations |
| `platform/runtime/` LLM adapter/call journal | **REUSE** | Нужен для разрешённых AI-use-cases на границе системы |
| `config/routing.json` agent routing | **FREEZE → REMOVE candidate** | Маршрут пользователя к «Оркестру/Light/агенту» заменяется маршрутом данных и бизнес-процесса |
| новый closure/lifecycle contour | **MISSING** | Это главный gap относительно CAUDEX |

---

## 4. Что в текущем проекте уже сделано правильно

### 4.1 Детерминированные расчёты

`modules/calculations/` содержит отдельные вычислительные модули с тестами. Реестр `config/formulas/registry.json` формализует входы, единицы, округления и источник правила.

Особенно показателен `calculation.finance-model`: в реестре прямо зафиксировано, что формула была вынесена в код после нестабильных результатов роли-экономиста на одинаковом входе.

Это не legacy, который требуется заменить. Это архитектурный паттерн, который нужно **расширить на lifecycle, blockers, readiness и payment state**.

### 4.2 Provenance и unknown-safe подход

Текущий README уже декларирует:

- неизвестное не равно нулю;
- silent skip запрещён;
- числа считает код;
- результат должен иметь след до источника.

`packages/contracts/provenance.ts` и существующие контракты дают техническую основу для `SourceRef` из `06_DOMAIN_MODEL.md` / `07_DATA_CONTRACTS.md`.

### 4.3 Документный слой

`modules/documents/` и `platform/storage/` уже решают значительную часть тяжёлой инфраструктурной работы:

- format detection;
- Excel/CSV;
- DOCX;
- sheet abstractions;
- archive handling;
- extraction revisions;
- parser registry.

Первый MVP не должен создавать второй параллельный «универсальный загрузчик». Нужно добавить product-specific document profiles поверх существующих adapters/parsers.

### 4.4 Canonical matching

В `modules/canonical/` уже присутствуют:

- `item-registry`;
- `map-position`;
- `match-ledger`;
- `text-match`;
- stemming;
- unit normalization.

Это очень близко к нужному pipeline:

`exact → aliases/rules → fuzzy → AI candidate → review`.

Следующий шаг — сделать объектом сопоставления не абстрактную строку анализа, а устойчивый `WorkItem`, а результат матчинга хранить как самостоятельный audit record.

### 4.5 Архитектурные границы

Текущий проект уже разделён на `apps → platform → modules → packages`, а README описывает автоматическую проверку архитектурных импортов.

CAUDEX **не предлагает новую платформенную архитектуру**. Новый продуктовый контур должен лечь внутрь уже существующей схемы.

---

## 5. `REUSE` — сохраняем как базовые активы

### `modules/calculations/`

Сохранить подход «одно бизнес-правило/расчёт → чистая функция → тест → формула/trace».

Новые детерминированные модули должны следовать тому же стилю, например:

```text
progress-aggregation
lifecycle-quantities
readiness
blocker-age
monetization-gap
payment-allocation
```

### `platform/storage/` и общие document readers

Использовать как физический input layer. Новый business parser не должен открывать файл напрямую, если существующий adapter уже умеет дать workbook/text/sheet representation.

### Provenance primitives

Сохранить и расширить существующий trace до:

`SourceDocument/version → source location → extracted record → canonical fact → rule → Finding`.

### Formula/parameter infrastructure

Сохранить `config/formulas`, `platform/config/formula-registry`, parameter loader и fail-closed validation.

Добавить конфигурации:

- evidence requirement profiles;
- matching thresholds;
- source priorities;
- blocker thresholds/SLA;
- unit conversions;
- effective dates.

### `modules/eval/`

Использовать как основу автоматизации CAUDEX acceptance cases. Не создавать отдельный тестовый framework только для нового контура.

### Общая production-инфраструктура

DB connection, tenancy, security, jobs, queue, storage, logging и общие runtime adapters не зависят от смены product boundary и должны сохраняться.

---

## 6. `ADAPT` — сильные части, которым меняем предметный контракт

### 6.1 `modules/canonical/` → canonical work identity

**Сейчас:** есть инструменты нормализации и сопоставления позиций.

**Нужно:**

```text
WorkItem
WorkItemAlias
WorkMatch
ProgressEvent match
ScheduleActivity match
SubmissionLine match
```

`match-ledger` должен стать фундаментом истории сопоставлений, включая method/confidence/confirmation status.

### 6.2 `packages/contracts/` → domain contracts CAUDEX

Существующие `domain.ts`, primitives и provenance расширяются сущностями из `06_DOMAIN_MODEL.md`:

```text
SourceDocument
WorkItem
ProgressEvent
Evidence
CommercialBasis
Submission / SubmissionLine
AcceptanceEvent
PaymentObligation / PaymentEvent / PaymentAllocation
Blocker
Finding
DataConflict
```

Важно: не создавать для них новый пакет только потому, что это «новая версия продукта». Если `packages/contracts` является общей границей типов, целевая модель должна жить там.

### 6.3 `modules/intake/` → document intake

Текущий intake содержит passport/routing-сценарии, но product target требует регистрации каждого source document независимо от того, какому агенту он потом достанется.

Новый intake должен выдавать:

```text
IngestedDocument
parse status
profile
checksum/version
warnings
SourceRef
```

Agent routing не должен быть обязательной частью успешного импорта.

### 6.4 `modules/workflow/`

Не переписывать `check-object.ts` поверх нового смысла.

Лучше добавить новый независимый application workflow, концептуально:

```text
ingest-project-facts
build-work-lifecycle
recalculate-findings
```

После доказательства CAUDEX можно решить, какие части старого `check-object` становятся shared services, а какие остаются legacy/estimate-audit flow.

### 6.5 Persistence

`platform/db/` уже содержит repositories для artifacts, runs, extraction и model calls.

Нужно добавить persistence для canonical business ledger. Это **не** должна быть одна JSON-колонка «итог анализа агента».

Минимальные хранимые сущности первого vertical slice:

```text
SourceDocument
WorkItem / Alias
ProgressEvent
Evidence
Submission / Line
AcceptanceEvent
PaymentEvent / Allocation
Blocker
Finding
```

### 6.6 UI

`apps/web/` сохраняется как приложение, но product home первого контура должен быть построен не вокруг запуска ролей, а вокруг исключений.

Минимальные views из `08_MVP_REQUIREMENTS.md`:

1. Work pipeline;
2. Blocker queue;
3. WorkItem detail/timeline.

Существующие экраны проверки объекта можно оставить доступными как legacy/secondary flow до принятия решения об их выводе.

### 6.7 Exports

Полезные общие exports — calculation workbook, object report, violations register и т.п. — могут быть адаптированы к structured Findings.

Agent-centric exports (`by-agent`, `agent-report`) не должны определять новую schema продукта.

---

## 7. `FREEZE` — не удаляем, но перестаём расширять как product core

### 7.1 `config/agents/`

В конфигурации уже существуют отдельные agent capabilities для contract audit, estimate review, executive docs, finance, procurement, schedule, verdict и др.

До прохождения CAUDEX acceptance запрещается:

- добавлять новую должность только потому, что возник новый business question;
- дублировать deterministic rule внутри prompt;
- создавать нового агента вместо новой domain entity/rule.

Существующие агенты могут работать в старом flow.

### 7.2 `config/crew/`

`core-rules`, dispatcher prompt, role tree и bases — развитая экспериментальная оркестрация.

Для первого CAUDEX contour она не является необходимой зависимостью. Замораживаем feature development.

Если позже появится бизнес-сценарий, где многошаговый autonomous research действительно выигрывает у обычного pipeline, crew может быть подключён как **один adapter/capability**, но не как каркас предметной модели.

### 7.3 Agentic execution

`platform/execution/agentic-*` и связанные reviewer/coordinator flows остаются совместимыми с текущим продуктом, но новый lifecycle engine от них не зависит.

Критический тест архитектуры:

> СтройИнтел должен уметь построить `performed_not_submitted` и `accepted_not_paid` при полностью отключённой LLM.

### 7.4 Persona-based acceptance

Существующие `config/acceptance/*.json`, привязанные к отдельным персонам/ролям, не заменяют acceptance cases нового продукта.

Новые release gates должны быть привязаны к бизнес-сценариям `AC-01…AC-21`, а не к тому, удовлетворён ли конкретный цифровой персонаж.

### 7.5 Agent routing

`config/routing.json` явно маршрутизирует кейсы к `Light`, «Оркестру 9 + Штаб» и именованным агентам.

Для CAUDEX product flow это secondary concern. Основной маршрут должен быть:

`document type → parser profile → canonical facts → deterministic engines → exception queue`.

---

## 8. `REMOVE` — только кандидаты после migration gate

На текущем этапе **не удаляем код массово**. REMOVE означает: после появления целевого replacement Codex/разработчик должен доказать отсутствие production dependency и только потом подготовить отдельный cleanup PR.

Кандидаты:

### 8.1 Agent-created business truth

Любой путь, в котором свободный verdict/текст роли напрямую становится:

- финансовым значением;
- lifecycle state;
- фактом оплаты;
- фактом наличия документа;
- readiness status

без structured validation, должен быть заменён canonical rule/fact pipeline.

### 8.2 Дублирующие вычисления в prompt

Если конкретная арифметика уже существует в `modules/calculations`, её prompt-версия не должна оставаться параллельным источником истины.

### 8.3 Product navigation, существующая только ради выбора «экипажа»

После подтверждения нового product home можно выводить из основного UX элементы, единственная ценность которых — выбирать количество/персоналии цифровых сотрудников.

### 8.4 Crew dispatcher как обязательный runtime gateway

Если новый workflow может работать без dispatcher, dispatcher не должен оставаться обязательной точкой входа всего продукта.

---

## 9. `MISSING` — основные gaps до MVP

### M-01. Canonical `WorkItem`

Нужна устойчивая бизнес-сущность, связывающая план, факт, ОЖР, график, evidence и закрытие.

### M-02. Source document lifecycle

Нужна формальная модель `SourceDocument` с checksum/version/status и неизменяемым provenance до версии источника.

Части механизма могут уже существовать в extraction/artifact storage, но они должны быть приведены к business contract `07_DATA_CONTRACTS.md`.

### M-03. `ProgressEvent` ledger

Нужны:

- idempotency;
- incremental/cumulative semantics;
- unit validation;
- duplicate/double-count detection;
- matching status.

### M-04. Evidence registry + readiness engine

Нужен отдельный registry документов/доказательств и конфигурируемая матрица:

`work type → required evidence → acceptance condition`.

### M-05. Submission/Acceptance model

Нужно различать:

`KS-2 exists → draft → submitted → partial/accepted/rejected`.

Файл с названием КС-2 сам по себе не является acceptance event.

### M-06. Payment obligation/allocation

Нужна связь принятого коммерческого объёма с обязательством и банковскими `PaymentEvent`; общий приход на счёт не равен оплате конкретной работы.

### M-07. Quantity lifecycle engine

Нужен deterministic engine, рассчитывающий одновременно:

```text
planned
performed
evidenced
submitted
accepted
paid
```

в том числе частичные объёмы.

### M-08. Blocker engine

Blocker должен быть first-class entity:

- type;
- blocked transition;
- opened/resolved at;
- owner when known;
- required action;
- monetary exposure;
- source refs;
- rule id.

### M-09. Data conflict/source priority

Нужен механизм конфликтующих значений и приоритетов источников. LLM не выбирает источник истины по уверенности текста.

### M-10. Product read models

Нужны read models:

- Work pipeline;
- Blocker queue;
- WorkItem timeline/detail.

### M-11. Волковский как executable reference case

Материалы Волковского должны превратиться из демонстрационной аналитики в fixtures/golden expectations по ключевым AC.

### M-12. Второй объект

Обязателен для проверки отсутствия объектного hardcode.

---

## 10. Что НЕ нужно строить заново

Чтобы не повторить ту же проблему уже под названием «новая архитектура», запрещён big-bang rewrite следующих механизмов без отдельного доказательства необходимости:

- универсального file reader;
- LLM provider abstraction;
- queue/job subsystem;
- tenant/security subsystem;
- formula registry;
- provenance abstraction;
- canonical text/unit utilities;
- test framework;
- весь web shell.

CAUDEX меняет **центр предметной модели и пользовательского результата**, а не требует новой технологической платформы.

---

## 11. Предлагаемая migration strategy

### Stage A — Product guardrail

Никаких новых ролей, crew modes и dashboard sections без связи с FR/AC CAUDEX.

Существующий product остаётся работоспособным.

### Stage B — Canonical contracts

Расширить `packages/contracts` и persistence новыми сущностями. Добавить migration tests.

### Stage C — Первый input vertical slice

На одном наборе Волковского:

`плановая работа + суточный факт + ОЖР → WorkItem + ProgressEvent + Evidence`.

Добиться provenance/idempotency/UNKNOWN-safe поведения.

### Stage D — Closure vertical slice

Добавить:

`Evidence readiness → Submission/KS-2 → Acceptance → Payment`.

### Stage E — Findings/Blockers

Расчёт:

```text
performed_not_evidenced
performed/evidenced_not_submitted
submitted_not_accepted
accepted_not_paid
```

без LLM.

### Stage F — UI

Подключить три exception-first views к canonical read model.

### Stage G — AI boundary

Только после deterministic path:

- extraction fallback;
- semantic candidate matching;
- finding explanation.

### Stage H — Acceptance + retirement

Запустить `AC-01…AC-20` и второй объект `AC-21`.

После этого провести dependency audit legacy agent paths и принять отдельные решения `KEEP / ARCHIVE / REMOVE`.

---

## 12. Как использовать Codex после фиксации CAUDEX

Codex не должен получать задачу «улучши архитектуру СтройИнтел».

Его задача должна быть ограничена:

```text
CAUDEX/ является утверждённой продуктовой и системной базой.
Не расширяй product scope и не проектируй новые agent roles/orchestration layers.

1. Проведи dependency-level audit текущего репозитория относительно
   CAUDEX/06–10.
2. Для конкретных файлов/модулей уточни classification:
   REUSE / ADAPT / FREEZE / REMOVE / MISSING.
3. Найди места, где LLM output является источником business truth.
4. Найди существующие реализации, которые уже закрывают M-01…M-12,
   чтобы не дублировать код.
5. Подготовь минимальный migration plan и task-файлы.
6. Не меняй код до утверждения плана.
```

Так Codex используется как **технический аудитор и исполнитель**, а не как генератор ещё одного уровня платформы.

---

## 13. Вывод

Текущий СтройИнтел не требует уничтожения и переписывания.

В проекте уже есть большая часть **технических строительных блоков**, которые нужны целевому продукту. Не хватает прежде всего связующего предметного ядра:

> единая работа → события факта → доказательства → предъявление → принятие → деньги → blockers.

Главный архитектурный поворот поэтому не `agents → no agents`, а:

```text
БЫЛО:
object package → orchestration/roles → reports

СТАНОВИТСЯ:
source documents → canonical business facts → deterministic state/findings → UI
                                              └→ optional AI at ambiguity/explanation boundaries
```

Агент перестаёт быть единицей архитектуры продукта. Единицей архитектуры становится **бизнес-факт и проверяемый переход состояния**.
