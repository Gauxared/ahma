# 09. Acceptance Cases — СтройИнтел

## 1. Назначение

Этот документ описывает минимальный набор reference/acceptance cases, через которые должен пройти первый продуктовый контур СтройИнтел.

Acceptance case — не демонстрационный сценарий UI и не пример промпта. Это проверяемая цепочка:

`исходные документы → canonical facts → deterministic result → expected finding/status`.

Для каждого кейса должен существовать набор исходных source refs и ожидаемый результат.

---

## 2. AC-01 — выполнено, но не предъявлено

### Бизнес-смысл

Работа физически выполнена, но объём не включён в КС-2.

### Inputs

- WorkItem существует;
- плановый объём известен;
- есть подтверждённый ProgressEvent;
- required evidence достаточно;
- отсутствует SubmissionLine/КС-2 для выполненного объёма.

### Expected

```text
state = EVIDENCED
blocker = KS2_NOT_PREPARED or KS2_NOT_SUBMITTED
finding = performed_not_submitted
```

Если известна цена, рассчитывается monetary impact зависшего объёма.

### Reference

На Волковском этот паттерн соответствует сценарию КЖ/готового физического фронта, который ещё нужно превратить в закрывающий контур.

---

## 3. AC-02 — физика есть, evidence недостаточно

### Inputs

- ProgressEvent подтверждён;
- для типа работы требуется AOSR/geodesy/другой evidence;
- обязательный evidence отсутствует или не подписан.

### Expected

```text
state = PERFORMED
blocker = MISSING_EVIDENCE or MISSING_SIGNATURE
next_transition = EVIDENCED
```

Система не имеет права повышать состояние до `EVIDENCED` по текстовому выводу LLM.

---

## 4. AC-03 — запись ОЖР без объёма

### Inputs

ОЖР содержит явное описание выполненной операции, но количественного значения нет.

### Expected

- создаётся evidence/event marker;
- `performedQuantity` не увеличивается;
- создаётся `QUANTITY_UNKNOWN`, если количественный факт необходим для следующего расчёта;
- AI не генерирует примерный объём.

---

## 5. AC-04 — точное сопоставление по коду

### Inputs

Суточная запись содержит канонический код существующего WorkItem.

### Expected

```text
match.method = exact_code
match.status = matched
```

AI не вызывается.

---

## 6. AC-05 — semantic matching с review

### Inputs

- код отсутствует;
- текст близок к одной/нескольким плановым работам;
- exact/rule match не сработал.

### Expected

- fuzzy/LLM формирует кандидатов;
- сохраняются confidence/source fragment;
- при неоднозначности `status = needs_review`;
- факт не влияет на количество WorkItem до подтверждения.

---

## 7. AC-06 — повторный импорт одной суточки

### Inputs

Один и тот же источник импортируется дважды без изменения checksum.

### Expected

- второй импорт идемпотентен;
- ProgressEvent не дублируется;
- plan/fact не меняется;
- возможно событие/audit record повторной попытки, но не бизнес-факт.

---

## 8. AC-07 — новая версия документа

### Inputs

Загружается изменённая версия ранее импортированного документа.

### Expected

- создаётся новая версия SourceDocument;
- изменения между facts отслеживаются;
- старый provenance сохраняется;
- система не переписывает исторический источник без следа.

---

## 9. AC-08 — накопительный факт ошибочно подан как суточный

### Inputs

Несколько записей для одной работы выглядят как нарастающий итог, хотя контракт ожидает приращение.

### Expected

- data-quality rule обнаруживает риск;
- создаётся `DATA_CONFLICT`/`DOUBLE_COUNT_RISK`;
- данные не суммируются молча;
- пользователь видит причину блокировки.

---

## 10. AC-09 — конфликт единиц

### Inputs

План — м³, факт — т, conversion rule отсутствует.

### Expected

```text
blocker = UNIT_MISMATCH
performedQuantityComparable = UNKNOWN
```

Нельзя использовать LLM для произвольной конвертации без утверждённого коэффициента/основания.

---

## 11. AC-10 — агрегированные земмассы

### Inputs

Один источник содержит агрегат, смешивающий выемку, перемещение и обратную засыпку, а смета/закрытие различает операции.

### Expected

- прямое распределение по WorkItem запрещено;
- создаётся `DOUBLE_COUNT_RISK`;
- для закрытия требуется источник с разделёнными операциями/геодезией/ВОР.

Этот кейс обязателен для Волковского reference case.

---

## 12. AC-11 — допработа без коммерческого основания

### Inputs

Есть ProgressEvent для дополнительной/изменённой работы, но нет договора/ДС/согласованной ВОР/письма, допускающего предъявление.

### Expected

```text
blocker = COMMERCIAL_BASIS_MISSING
state <= EVIDENCED
```

Система может показать понесённый объём/себестоимость, если данные есть, но не должна выдавать его как гарантированную выручку.

---

## 13. AC-12 — давальческое оборудование без передачи

### Inputs

Физический монтаж связан с supplied/customer equipment, но акт передачи/комплектности отсутствует или спорен.

### Expected

`MISSING_HANDOVER_EVIDENCE` или общий `MISSING_EVIDENCE` с соответствующим explanation code.

Монтажный факт не исчезает, но readiness к закрытию блокируется по настроенному rule matrix.

---

## 14. AC-13 — КС-2 создан, но не предъявлен

### Inputs

КС-2 существует со статусом draft.

### Expected

```text
state = EVIDENCED
blocker = KS2_NOT_SUBMITTED
```

Факт наличия файла КС-2 не переводит объём в `SUBMITTED`.

---

## 15. AC-14 — КС-2 предъявлен, но не принят

### Inputs

КС-2 имеет подтверждение отправки/предъявления, но нет acceptance event.

### Expected

```text
state = SUBMITTED
blocker = KS2_NOT_ACCEPTED
```

Возраст blocker считается с даты предъявления.

---

## 16. AC-15 — частично принятый КС-2

### Inputs

Из предъявленного объёма принята только часть.

### Expected

- принятая часть достигает `ACCEPTED`;
- отклонённая/ожидающая часть остаётся `SUBMITTED`;
- WorkItem не получает один упрощённый глобальный статус вместо распределения объёмов.

---

## 17. AC-16 — принят, но не оплачен

### Inputs

Есть acceptance event, но отсутствует связанный PaymentEvent после наступления срока оплаты.

### Expected

```text
state = ACCEPTED
finding = accepted_not_paid
blocker = PAYMENT_NOT_LINKED / PAYMENT_OVERDUE
```

Если срок оплаты известен, считается overdue age.

---

## 18. AC-17 — общий приход денег не равен оплате работы

### Inputs

На банковском счёте есть входящий платёж, но его нельзя однозначно связать с конкретным обязательством/КС.

### Expected

- платёж сохраняется;
- связь = unresolved;
- WorkItem не переводится в `PAID`;
- возможно finding `UNALLOCATED_PAYMENT`.

---

## 19. AC-18 — неизвестная цена

### Inputs

Объём выполнен и подтверждён, но unit price/amount отсутствует в допустимом источнике.

### Expected

```text
monetaryImpact = UNKNOWN
blocker/finding = UNKNOWN_PRICE (если показатель нужен)
```

Никакого `0 руб.`.

---

## 20. AC-19 — конфликт двух источников

### Inputs

Два признанных источника дают разные значения одного business fact.

### Expected

- создаётся `DataConflict`;
- применяется explicit source-priority rule, если он существует;
- иначе `manual_required`;
- UI показывает оба источника;
- LLM не выбирает победителя на основании стилистической уверенности.

---

## 21. AC-20 — AI explanation не меняет факты

### Inputs

Структурированный finding передаётся explanatory LLM.

### Expected

- текст может быть переформулирован;
- все численные/статусные утверждения должны соответствовать payload;
- отсутствие значения должно звучать как отсутствие данных;
- generated explanation не создаёт canonical facts.

---

## 22. AC-21 — второй объект

### Цель

Проверить, что система не превратилась в автоматизацию одного Волковского Excel.

### Expected

Новый объект проходит тот же pipeline без условий вида:

```ts
if (project === 'Волковский') { ... }
```

Допустима новая конфигурация:

- document profile;
- aliases;
- evidence requirements;
- thresholds;
- source priorities.

Изменение базовой state machine под один объект считается failure архитектуры.

---

## 23. Acceptance matrix

Каждый кейс должен храниться в формате, пригодном для автоматизации:

```text
case_id
input fixtures
expected canonical entities/events
expected blockers
expected findings
expected computed values
forbidden outputs
source refs
```

`forbidden outputs` особенно важен для AI/data-quality кейсов: тест должен проверять не только правильный результат, но и отсутствие опасного вывода.

---

## 24. Release gate

Первый MVP нельзя считать готовым по количеству реализованных экранов или агентов.

Release gate:

- AC-01…AC-20 проходят на fixture/reference данных;
- ключевые кейсы AC-01, AC-02, AC-03, AC-10, AC-11, AC-12, AC-16 подтверждены на Волковском;
- AC-21 подтверждён на втором объекте;
- нет silent skips;
- critical finding имеет provenance;
- повторный прогон на одинаковых данных даёт одинаковый deterministic result.
