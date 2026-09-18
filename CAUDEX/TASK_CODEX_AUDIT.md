# TASK — Read-only технический аудит СтройИнтел относительно CAUDEX v1.1

## 0. Режим работы

Ты работаешь как **технический аудитор существующего репозитория**, а не как архитектор нового продукта и не как feature developer.

Главная задача — проверить, насколько текущая реализация СтройИнтел соответствует аналитической базе `CAUDEX/`, и вернуть доказуемую карту миграции.

### Жёсткие ограничения

Во время этой задачи запрещено:

- изменять production-код;
- рефакторить существующие модули;
- создавать новые runtime-модули;
- добавлять LLM-роли, agents, crew modes или orchestration;
- менять схемы БД;
- менять prompts/config ради «улучшения»;
- создавать UI;
- удалять legacy code;
- начинать реализацию backlog.

Разрешено создать **только один итоговый файл**:

```text
CAUDEX/AUDIT_REPORT.md
```

После создания отчёта остановись.

---

## 1. Источник решений

Перед аудитом прочитай CAUDEX в следующем порядке:

```text
CAUDEX/README.md
CAUDEX/01_PRODUCT_BOUNDARY.md
CAUDEX/02_AS_IS_VOLKOVSKY.md
CAUDEX/03_AI_BOUNDARY.md
CAUDEX/04_PROBLEM_MAP.md
CAUDEX/05_TO_BE.md
CAUDEX/06_DOMAIN_MODEL.md
CAUDEX/07_DATA_CONTRACTS.md
CAUDEX/08_MVP_REQUIREMENTS.md
CAUDEX/09_ACCEPTANCE_CASES.md
CAUDEX/10_CURRENT_CODE_MAPPING.md
CAUDEX/11_DELIVERY_BACKLOG.md
CAUDEX/12_TARGET_ARCHITECTURE.md
CAUDEX/13_ANALYTICS_SUMMARY.md
CAUDEX/ADDENDUM_V1_1_NEW_MATERIALS.md
```

### Приоритет документов

Если документы конфликтуют:

```text
ADDENDUM_V1_1_NEW_MATERIALS.md
  > более ранние CAUDEX-документы
  > текущий README/product narrative
  > legacy prompts / role descriptions
```

CAUDEX описывает **target первого product contour**, но не означает автоматическую команду удалить legacy.

---

## 2. Главный вопрос аудита

Нужно ответить:

> Какой минимальный набор существующего кода можно переиспользовать, чтобы реализовать vertical slice
>
> `WorkItem → ProgressEvent → Evidence → Submission → Acceptance → Payment → Blocker/Finding`
>
> без big-bang rewrite и без превращения agentic runtime в обязательную часть business flow?

---

## 3. Сначала проверь факты, не доверяй документам вслепую

Особое внимание новым заявлениям из материалов 16.09.2026:

- `config/thresholds/registry.json` якобы создан;
- hardcoded thresholds якобы вынесены из calculations;
- architecture gate якобы проверяет threshold literals и unused thresholds;
- SPI/CPI/EAC/SV/CV якобы реализованы;
- EVM dashboard якобы реализован;
- 1956 test suites якобы зелёные.

В текущем GitHub `main` при предварительной проверке CAUDEX эти изменения **не были обнаружены**.

Не делай вывод «документ врёт» автоматически. Установи максимально точно:

- есть ли код под другим именем;
- есть ли упоминания в history/docs/tests;
- соответствует ли README текущему коду;
- мог ли материал описывать локальную/неотправленную версию;
- какие утверждения можно доказать текущим checkout, а какие нельзя.

Используй статусы:

```text
CONFIRMED
PARTIAL
NOT_FOUND
CONFLICTED
STALE_DOCUMENTATION
CANNOT_VERIFY
```

---

## 4. Обязательные направления аудита

### A. Repository inventory

Построй предметную карту по каталогам:

```text
apps/
modules/
packages/
platform/
config/
```

Не перечисляй каждый файл. Выделяй только компоненты, влияющие на target contour.

### B. Existing canonical model

Проверь подробно:

```text
modules/canonical/
packages/contracts/
```

Ответь:

- что уже похоже на `WorkItem`;
- как сегодня определяется identity позиции;
- где хранится match history;
- есть ли aliases;
- есть ли units normalization;
- поддерживается ли ambiguity/manual confirmation;
- можно ли расширить существующий contract без нового параллельного domain package.

### C. Intake / documents / storage

Проверь:

```text
modules/documents/
modules/intake/
platform/storage/
```

Для каждого нужного источника первого contour оцени:

```text
estimate/VOR
daily report
OJR
executive docs
KS-2
KS-3
contract/addendum
payment source
KSG
```

Статус:

```text
SUPPORTED
PARTIAL
GENERIC_READER_ONLY
NO_PROFILE
MISSING
```

Отделяй физическое чтение файла от предметного извлечения структуры.

### D. Calculations / config

Проверь:

```text
modules/calculations/
config/formulas/
config/parameters/
config/thresholds/ if exists
platform/config/
```

Составь список:

- реально config-driven calculations;
- оставшиеся hardcoded domain thresholds;
- formula trace/provenance;
- fail-closed validation;
- реальные EVM artifacts, если есть.

Не предлагай переносить всё в config автоматически. В config должны уходить изменяемые business parameters, а algorithm structure может оставаться кодом.

### E. Agentic dependency graph

Проверь:

```text
modules/agents/
config/agents/
config/crew/
config/routing.json
platform/execution/
platform/runtime/
modules/workflow/
```

Нужно разделить:

1. **generic reusable AI/runtime infrastructure**;
2. **semantic capabilities, которые можно вызвать точечно**;
3. **role/persona orchestration**;
4. **legacy dependencies, без которых сейчас check-object не работает**.

Ответь отдельно:

> можно ли новый work-control flow запустить без crew/role routing, сохранив существующие parsers/storage/runtime adapters?

### F. Persistence

Проверь текущую DB/repository модель.

Найди ближайшие reuse points для:

```text
SourceDocument
WorkItem
WorkItemAlias / WorkMatch
ProgressEvent
Evidence
Submission / SubmissionLine
AcceptanceEvent
PaymentEvent / Allocation
Blocker
Finding
DataConflict
```

Не проектируй финальную Prisma schema. Нужен gap analysis.

### G. UI/read models

Проверь, какие существующие экраны можно адаптировать и какие тесно связаны с agent reports.

Target MVP остаётся:

```text
Work Pipeline
Blocker Queue
WorkItem Detail
```

Четыре dashboard из новых материалов — target projections, а не обязательный MVP scope.

### H. Data quality

Определи, какие данные уже позволяют построить `DataQualitySnapshot`:

- parse status;
- extraction status;
- source version/conflict;
- provenance coverage;
- unmatched/ambiguous matches;
- human review;
- finding evidence completeness.

Отдельный AI-agent для качества данных не предлагать.

### I. EVM semantic audit

Даже если код SPI/CPI/EAC существует, проверь отдельно семантику входов.

Не считать EVM предметно готовым без доказательства:

```text
PV definition
EV definition
AC definition
status date
budget/scope mapping
source priority
conflict policy
control example
```

Особо проверь риск:

```text
AC == KS-2/KS-3/customer payment
```

Такое равенство не принимается без явного доказательства business semantics.

### J. CPM / schedule

Раздели две способности:

```text
1. импорт существующей сети + CPM/float calculation;
2. автоматическое построение сети из raw documents/reference rules.
```

Покажи, что реально существует сейчас и что нужно только для второго этапа.

---

## 5. Проверка `10_CURRENT_CODE_MAPPING.md`

Для каждой существенной строки mapping присвой итог:

```text
CONFIRM
CHANGE_CLASSIFICATION
SPLIT
INSUFFICIENT_EVIDENCE
```

И укажи конкретный file/directory evidence.

Классы остаются:

```text
REUSE
ADAPT
FREEZE
REMOVE_CANDIDATE
MISSING
```

Важно: `REMOVE_CANDIDATE` не означает удалить сейчас.

---

## 6. Minimum Vertical Slice

После аудита предложи **один** минимальный технический vertical slice.

Он должен заканчиваться проверяемым результатом примерно такого уровня:

```text
real source document(s)
  → parsed record
  → canonical WorkItem
  → ProgressEvent
  → deterministic lifecycle snapshot
  → at least one Blocker/Finding
  → source trace
```

Если разумно включить `Evidence` или `Submission` уже в первый slice — обоснуй.

Не выбирай slice по принципу «что проще написать». Он должен доказать основную архитектурную гипотезу CAUDEX.

---

## 7. Что должно быть в `CAUDEX/AUDIT_REPORT.md`

Используй следующую структуру.

### 1. Executive conclusion

Не больше ~1 страницы:

- насколько CAUDEX совместим с текущим кодом;
- rewrite нужен / не нужен;
- главный reuse asset;
- главный architectural gap;
- главный риск миграции.

### 2. Verification of new-material claims

Таблица:

| Claim | Status | Evidence | Comment |
|---|---|---|---|

Обязательно thresholds/EVM/tests/dashboard claims.

### 3. Validated current-code mapping

Таблица:

| Area | CAUDEX classification | Audit result | Evidence paths | Recommendation |
|---|---|---|---|---|

### 4. Domain gap analysis

По сущностям CAUDEX:

| Target entity/capability | Existing nearest analogue | Gap | Action |
|---|---|---|---|

### 5. Agentic dependency assessment

Покажи:

- что reusable;
- что legacy-only;
- что является coupling risk;
- можно ли запустить новый flow без crew.

### 6. Input/document support matrix

По типам документов первого contour.

### 7. Persistence gap

Без финальной schema, только reuse/gaps.

### 8. EVM semantic audit

Чёткий verdict:

```text
READY
FORMULAS_ONLY
PARTIAL
NOT_READY
```

с причиной.

### 9. Recommended minimum vertical slice

Конкретные существующие reuse points и missing pieces.

### 10. Proposed first implementation sequence

Не весь backlog. Только первые 3–6 PR-sized задач после аудита.

Для каждой:

```text
CAUDEX ref
existing files reused
new boundary needed
acceptance case
risk
```

### 11. Contradictions / decisions required

Только реальные вопросы, которые нельзя решить чтением кода.

Не создавай искусственные вопросы ради human-in-the-loop.

### 12. Final recommendation

Одно из:

```text
PROCEED_WITH_CAUDEX
PROCEED_WITH_CORRECTIONS
BLOCKED_BY_MISSING_PRODUCT_DECISION
```

и 3–5 причин.

---

## 8. Требования к evidence

Каждый существенный вывод в отчёте должен иметь file-level evidence.

Хорошо:

```text
modules/canonical/match-ledger.ts
platform/storage/docx-reader.ts
config/formulas/registry.json
```

Плохо:

```text
«по архитектуре видно»
«похоже, система умеет»
«скорее всего»
```

Если не удалось доказать — пиши `CANNOT_VERIFY`.

---

## 9. Что нельзя делать в отчёте

Не нужно:

- рекламировать multi-agent подход;
- переименовывать весь репозиторий;
- предлагать микросервисы без необходимости;
- проектировать event sourcing framework ради event sourcing;
- вводить Kafka/Redis/vector DB только «на будущее»;
- превращать каждый бизнес-шаг в отдельный service;
- создавать универсальный construction ontology до MVP;
- объявлять legacy мусором без dependency evidence;
- считать количество написанного кода аргументом за сохранение функции.

---

## 10. Главный архитектурный фильтр

Для любого компонента задавай вопрос:

> Помогает ли он доказуемо перевести строительную работу от источника к canonical fact, lifecycle state, blocker/finding или пользовательскому решению?

Если нет — он может быть полезен другому сценарию, но не является автоматически частью первого product contour.

Для AI дополнительный фильтр:

> Есть ли здесь реальная неопределённость, которую обычный parser/rule/algorithm решает хуже?

Если нет — не предлагай LLM.

---

## 11. Stop condition

После того как `CAUDEX/AUDIT_REPORT.md` создан:

1. не меняй код;
2. не начинай первый PR;
3. не создавай task-файлы;
4. кратко сообщи, что аудит завершён и какие решения требуют подтверждения человека;
5. остановись.
