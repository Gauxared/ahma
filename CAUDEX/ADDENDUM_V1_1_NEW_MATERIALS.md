# CAUDEX v1.1 — уточнения по новым материалам

## 1. Назначение

Этот addendum фиксирует изменения аналитической базы после изучения двух новых материалов коллеги:

- `analytics-dashboards.md`;
- `spec-analiticheskiy-sloy_2.md` от 15–16.09.2026.

Документ **не отменяет** CAUDEX `01–13`, а уточняет несколько решений, которые стали видны после появления новой информации. Если формулировка этого addendum конфликтует с более ранним CAUDEX-документом, для первого product contour действует версия из этого файла.

Главный вывод после новых материалов: направление коллеги заметно сблизилось с CAUDEX — особенно по доказательности, config-driven правилам, запрету выдумывать отсутствующие входы и отделению формул от LLM. При этом остаются предметные границы, которые необходимо зафиксировать до реализации.

---

## 2. Что подтверждено новыми материалами

### 2.1. Целевая форма продукта — цифровой штаб, а не BI ради BI

Полезная формула из новых материалов:

```text
отклонение → доказательство → влияние → решение
```

Это совместимо с нашей моделью:

```text
canonical facts
  → deterministic Finding / Blocker
  → impact
  → owner/action
  → UI
  → optional AI explanation
```

Следовательно, dashboard является **read model над доменным ядром**, а не источником собственной бизнес-логики.

### 2.2. Quality/readiness должен быть видим пользователю

Новый материал явно выделяет dashboard качества данных:

- обработанные / нераспознанные документы;
- конфликтующие версии;
- source/evidence coverage;
- GAP;
- human review;
- закрытые/открытые критические расхождения.

Это подтверждает CAUDEX-принцип `UNKNOWN != 0` и требует отдельного read model качества данных.

### 2.3. Config-driven thresholds — правильное направление

В обновлённой спецификации заявлено, что 16.09:

- создан `config/thresholds/registry.json`;
- шесть hardcoded threshold вынесены из TypeScript;
- у порогов есть source/effective date/action;
- architecture gate запрещает возвращение числовых порогов в calculations;
- создан EVM calculation block и экран, который при отсутствии PV/EV/AC показывает причины невычислимости.

Это полностью соответствует архитектурному направлению CAUDEX.

**Однако:** на момент проверки текущего `main` репозитория `Gauxared/ahma` эти изменения не обнаружены: `config/thresholds/` отсутствует, а code search не находит `SPI`/`EAC`. В репозитории доступна только ветка `main`.

Поэтому до технического аудита этот статус фиксируется как:

```text
REPORTED IN NEW MATERIALS / NOT VERIFIED IN CURRENT GITHUB MAIN
```

Codex обязан установить, где находится реализация: неотправленный commit, другая копия проекта, локальная ветка либо расхождение документа с репозиторием. До этого CAUDEX не считает эти возможности подтверждённым кодом.

---

## 3. Уточнение роли аналитика: discovery ≠ production runtime

Ранняя спецификация коллеги формулирует абсолютное правило:

> аналитик не должен оказаться в цепочке «документы пришли → аналитик поработал → система запустилась».

Для зрелого production runtime это правильная цель, но она не должна запрещать product discovery.

Фиксируем два разных режима.

### Discovery analyst

На этапе исследования аналитик **может и должен** вручную разбирать reference objects, чтобы восстановить:

- AS-IS;
- реальные источники истины;
- типовые ошибки;
- решения пользователей;
- boundary cases;
- false positives;
- golden expectations.

Разовый анализ Волковского в `02_AS_IS_VOLKOVSKY.md` является нормальной discovery-работой, а не архитектурной ошибкой.

### Production analyst

После формализации методики результат аналитика должен переходить в систему в виде:

- document profile;
- rule/specification;
- threshold/parameter;
- evidence requirement profile;
- reference case;
- formula semantics;
- directory/reference data.

Production-прогон объекта не должен требовать ручного участия аналитика.

### Решение

```text
ручной анализ допустим для discovery и построения эталона;
ручной аналитик не является обязательным runtime-компонентом продукта.
```

Это заменяет абсолютный запрет ранней спецификации.

---

## 4. Уточнение управленческого Finding

Новые материалы предлагают эталонную карточку:

```text
Проблема
→ Источник
→ Причина
→ Влияние на срок
→ Влияние на деньги
→ Ответственный
→ Решение
→ Срок закрытия
```

CAUDEX принимает эту форму как **target management projection** объекта `Finding/Blocker`.

Целевая read model расширяется полями:

```text
finding_type
problem
source_refs[]
cause_code / cause_text?
schedule_impact?
monetary_impact?
owner_ref?
required_action?
decision_status?
due_at?
evidence_coverage
data_quality_status
rule_id
```

### Важное ограничение

Не все поля могут быть вычислены всегда.

Например:

- нет календарной сети → `schedule_impact = NOT_COMPUTABLE`;
- нет цены/commercial basis → `monetary_impact = NOT_COMPUTABLE`;
- ответственность не определена правилами → `owner_ref = UNKNOWN`.

LLM может переформулировать `problem/cause/action` для человека, но не имеет права выдумать отсутствующий impact или owner.

---

## 5. Data Quality Read Model

Добавляется отдельная производная модель:

```text
DataQualitySnapshot
```

Минимально:

```text
project_id
as_of
source_documents_total
parsed_documents
partially_parsed_documents
failed_documents
unsupported_documents
stale_sources
conflicting_versions
unmatched_records
ambiguous_matches
human_review_required
facts_with_provenance_ratio
evidence_coverage_ratio?
open_data_conflicts
critical_findings_with_complete_evidence
```

### Правило

Это **не новый отдельный data-quality домен** и не новый агент.

Snapshot агрегируется из уже существующих:

- `SourceDocument`;
- parse status;
- `SourceRef`;
- `WorkMatch`;
- `DataConflict`;
- `Finding`;
- human review state.

Он нужен, чтобы пользователь понимал, насколько надёжен управленческий вывод.

---

## 6. Четыре dashboard из новых материалов: target vision, не MVP scope

Материалы предлагают:

1. dashboard руководителя/собственника;
2. строительный dashboard;
3. финансовый dashboard;
4. dashboard качества данных.

CAUDEX принимает их как **будущие projections**, но не расширяет из-за этого MVP.

Первый vertical slice по-прежнему:

```text
Work Pipeline
Blocker Queue
WorkItem Detail
```

Почему:

- эти три представления непосредственно проверяют lifecycle;
- они заставляют построить canonical facts;
- после них управленческий/строительный/финансовый dashboard становятся агрегатами, а не отдельными островами логики.

Запрещено строить четыре dashboard раньше, чем под ними существует единый canonical ledger.

---

## 7. EVM: вводится semantic gate

Новая спецификация правильно оставляет задачу определения `PV / EV / AC` незакрытой. Это необходимо сохранить как blocking requirement.

Наличие формул:

```text
SPI = EV / PV
CPI = EV / AC
EAC = BAC / CPI
```

ещё не означает, что EVM реализован предметно корректно.

### 7.1. PV

`PV` не равно просто датам из КСГ.

Нужно определить:

```text
baseline schedule
+ budgeted value per WorkItem/work package
+ status date
→ planned value as of date
```

Без привязки календаря к budgeted scope `PV` не определён.

### 7.2. EV

`EV` не равно сырому физическому `%` из суточки/ОЖР.

Нужно определить методику earned value:

- какой объём считается earned;
- по какой budget basis;
- на каком уровне WorkItem;
- допускается ли partial earning;
- какой факт достаточен: performed или evidenced/accepted — решение методики должно быть явным.

Суточка/ОЖР дают вход для physical progress, но не автоматически EV.

### 7.3. AC

Особо важное правило:

```text
AC != автоматически КС-2 / КС-3 / входящие платежи
```

`AC` — actual cost фактически выполненной работы по принятой cost methodology.

КС-2/КС-3 заказчику и поступление денег — это в первую очередь revenue/acceptance/cash-in contour. Они могут быть источником AC только в конкретной договорной роли и при явно заданной семантике, например для подтверждённых затрат субподрядчика.

До определения cost source `AC = UNKNOWN`, а CPI/EAC не вычисляются.

### 7.4. Acceptance gate EVM

EVM считается готовым не тогда, когда экран рисует SPI/CPI, а когда существует документированная спецификация:

```text
PV definition
EV definition
AC definition
status date
scope/budget mapping
source priority
conflict policy
unit/currency policy
control example
```

и контрольный reference case подтверждает числа.

---

## 8. CPM / календарная логика: разделяем две разные способности

Обновлённая спецификация частично смешивает:

### A. Рассчитать критический путь по существующему графику

Если входной КСГ уже содержит:

- activities;
- duration;
- dependencies;
- calendar;

то CPM/float рассчитываются обычным графовым алгоритмом.

Для этого **не нужен** справочник типовых отраслевых длительностей.

### B. Построить/восстановить календарную сеть из сырых документов

Если сеть отсутствует, тогда действительно нужны:

- типовые durations;
- dependency rules;
- technological lags;
- region/climate rules;
- human confirmation для неоднозначностей.

### Решение MVP

Сначала поддержать импорт и deterministic calculation существующего КСГ.

Автоматическая генерация календарной сети — отдельная capability и не является prerequisite для первого closure/monetization vertical slice.

---

## 9. `WorkItem` и «код работы»

Новая спецификация правильно требует устойчивой связи «смета ↔ факт», но формулировка «код работы — канонический ключ» уточняется.

Целевая модель:

```text
WorkItem.id                — внутренняя identity
WorkItem.canonical_code?   — удобный стабильный business code
WorkItemAlias[]            — коды и названия источников
WorkMatch                  — доказательство сопоставления
```

Код из ЦИМ/сметы/КСГ не должен становиться единственной identity системы, поскольку:

- код может отсутствовать;
- разные источники используют разные коды;
- один код может менять название/гранулярность;
- legacy documents могут быть только текстовыми.

Exact code match имеет самый высокий приоритет, но identity принадлежит `WorkItem`.

---

## 10. Обновление `10_CURRENT_CODE_MAPPING.md`

До Codex-аудита к карте текущего кода применяются следующие поправки.

| Capability | Статус CAUDEX v1.0 | v1.1 |
|---|---|---|
| threshold registry | предполагалось добавить | **REPORTED IMPLEMENTED, NOT VERIFIED IN CURRENT MAIN** |
| EVM formulas | отсутствовали | **REPORTED IMPLEMENTED, NOT VERIFIED IN CURRENT MAIN; semantic inputs unresolved** |
| EVM UI | отсутствовал | **REPORTED IMPLEMENTED, NOT VERIFIED IN CURRENT MAIN** |
| data quality dashboard | не выделен отдельно | **TARGET READ MODEL; implementation not established** |
| management impact card | Finding/Blocker | **EXPANDED projection: impact/owner/action/due date** |
| canonical WorkItem | MISSING | **still required** |
| lifecycle/closure engine | MISSING | **still required** |

Codex должен проверять текущий код, а не принимать таблицу из нового документа как факт реализации.

---

## 11. Обновление backlog

Перед началом production coding в `11_DELIVERY_BACKLOG.md` логически добавляются четыре задачи.

### P0 — EVM semantic contract

Определить PV/EV/AC по реальным данным и проверить на reference case.

Не блокирует первый closure MVP, но блокирует заявление «EVM готов».

### P1 — Finding management projection

Расширить read model `Finding/Blocker` полями impact/owner/action/due date без переноса бизнес-логики в UI.

### P1/P2 — Data quality snapshot

Собрать quality view из canonical ingestion/matching/conflict/evidence state.

### P2+ — Existing KSG import + CPM

Сначала считать сеть, которую дал заказчик. Генерацию сети по отраслевым справочникам вынести в отдельную следующую способность.

---

## 12. Решение v1.1

Новые материалы **не меняют продуктовый pivot CAUDEX**.

Они усиливают его:

- dashboard должен быть штабом решений, а не коллекцией метрик;
- доказательность и качество данных должны быть видимы;
- thresholds/formulas должны жить вне prompt;
- EVM не должен считать отсутствующие входы;
- AI остаётся на границе неоднозначности.

Главные нерешённые вопросы после v1.1:

```text
1. Где находится заявленная реализация thresholds/EVM относительно текущего GitHub main?
2. Как строго определяются PV / EV / AC?
3. Как существующий canonical matching переиспользуется для WorkItem identity?
4. Как минимально встроить lifecycle ledger без rewrite текущего check-object flow?
```

Именно на эти вопросы должен ответить следующий read-only Codex audit.
