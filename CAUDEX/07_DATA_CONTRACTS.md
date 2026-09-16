# 07. Data Contracts — первый продуктовый контур СтройИнтел

## 1. Назначение

Этот документ фиксирует минимальные контракты данных для первого продуктового контура СтройИнтел: от исходного документа до канонического бизнес-факта.

Цель — убрать зависимость бизнес-логики от конкретной формы Excel/PDF/DOCX и не допускать ситуацию, когда один и тот же смысл по-разному трактуется разными модулями или LLM-агентами.

Главный принцип:

> Сначала источник превращается в проверяемый canonical payload, и только потом запускаются расчёты, статусы и findings.

Ни один parser не имеет права напрямую менять бизнес-статус работы без прохождения валидации.

---

## 2. Общий envelope входного документа

Любой импортируемый источник приводится к единому envelope:

```ts
interface IngestedDocument {
  documentId: string;
  projectId: string;
  documentType: DocumentType;
  originalName: string;
  version?: string;
  checksum: string;
  sourceParty?: string;
  documentDate?: string;
  receivedAt: string;
  parserProfile?: string;
  parseStatus: 'parsed' | 'partial' | 'failed';
  parseWarnings: ParseWarning[];
  sourceRef: SourceRef;
}
```

Критически важны `checksum`, `version` и `sourceRef`: без них невозможно доказать, из какой версии документа получен конкретный факт.

---

## 3. SourceRef

```ts
interface SourceRef {
  documentId: string;
  sheet?: string;
  page?: number;
  row?: number;
  cellRange?: string;
  section?: string;
  fragment?: string;
  extractionMethod?: 'parser' | 'rule' | 'fuzzy' | 'llm' | 'manual';
  model?: string;
  confidence?: number;
  confirmationStatus?: 'confirmed' | 'unconfirmed' | 'rejected';
}
```

Правила:

1. `confidence` не заменяет источник.
2. AI-extracted value без `fragment`/`SourceRef` не принимается.
3. Значение `confirmed` означает подтверждение бизнес-факта, а не уверенность модели.
4. Если источник не позволяет восстановить точный фрагмент, это должно быть отдельным warning.

---

## 4. Контракт плановой работы

Источники: смета, ВОР, ведомость объёмов, утверждённый план работ.

```ts
interface PlannedWorkInput {
  externalCode?: string;
  name: string;
  unit: string;
  plannedQuantity: number;
  unitPrice?: number;
  plannedAmount?: number;
  section?: string;
  location?: string;
  commercialBasisRef?: string;
  sourceRef: SourceRef;
}
```

### Обязательные поля для создания `WorkItem`

- `name`;
- `unit`;
- `plannedQuantity`;
- `sourceRef`.

### Nullable

- цена;
- сумма;
- внешний код;
- location;
- раздел.

Отсутствующая цена **не должна превращаться в 0**. В таком случае monetary metrics для работы получают `UNKNOWN_PRICE`.

---

## 5. Контракт суточного факта

Источники: суточная форма, сменный рапорт, структурированная форма прораба.

```ts
interface DailyProgressInput {
  eventDate: string;
  workCode?: string;
  workName?: string;
  quantity: number;
  unit: string;
  location?: string;
  performer?: string;
  basis?: string;
  note?: string;
  sourceRef: SourceRef;
}
```

### Инварианты

1. `quantity` — прирост за событие/смену, а не нарастающий итог.
2. `quantity > 0`, кроме корректирующего события с отдельным типом.
3. Нельзя суммировать факты с разными единицами без явного conversion rule.
4. Неоднозначный `workCode`/`workName` не должен молча прикрепляться к ближайшему WorkItem.

### Matching result

```ts
interface WorkMatch {
  progressEventId: string;
  candidateWorkItemIds: string[];
  selectedWorkItemId?: string;
  method: 'exact_code' | 'exact_alias' | 'rules' | 'fuzzy' | 'llm' | 'manual';
  confidence?: number;
  status: 'matched' | 'needs_review' | 'unmatched' | 'rejected';
}
```

`fuzzy`/`llm` match ниже threshold остаётся `needs_review`.

---

## 6. Контракт ОЖР

ОЖР может подтверждать как количественный факт, так и только факт события.

```ts
interface OjrEntryInput {
  entryDate: string;
  text: string;
  workCode?: string;
  quantity?: number;
  unit?: string;
  location?: string;
  performer?: string;
  sourceRef: SourceRef;
}
```

### Два режима результата

#### Quantified event

Если в записи однозначно есть объём и единица:

```ts
kind = 'progress_candidate'
```

#### Evidence-only event

Если запись доказывает выполнение/операцию, но не содержит количественного объёма:

```ts
kind = 'evidence_only'
```

Второй режим **никогда не создаёт количество автоматически**.

---

## 7. Контракт evidence

```ts
interface EvidenceInput {
  evidenceType:
    | 'OJR'
    | 'AOSR'
    | 'EXECUTIVE_SCHEME'
    | 'GEODESY'
    | 'PHOTO'
    | 'VOR'
    | 'HANDOVER_ACT'
    | 'PASSPORT'
    | 'LETTER'
    | 'OTHER';
  eventDate?: string;
  linkedWorkCandidate?: string;
  scopeQuantity?: number;
  unit?: string;
  status: 'available' | 'signed' | 'draft' | 'missing_signature' | 'disputed';
  sourceRef: SourceRef;
}
```

Evidence не считается достаточным сам по себе. Достаточность определяется rule matrix:

`work type → required evidence → acceptance condition`.

---

## 8. Контракт коммерческого основания

Источники: договор, приложение, допсоглашение, согласованная ВОР, письмо.

```ts
interface CommercialBasisInput {
  basisType: 'CONTRACT' | 'ADDENDUM' | 'APPROVED_VOR' | 'LETTER' | 'OTHER';
  number?: string;
  date?: string;
  validFrom?: string;
  validTo?: string;
  scopeDescription?: string;
  sourceRef: SourceRef;
}
```

Для дополнительных/изменённых работ отсутствие основания создаёт blocker `COMMERCIAL_BASIS_MISSING`, а не предполагаемую стоимость к оплате.

---

## 9. Контракт КС-2

```ts
interface Ks2Input {
  documentNumber?: string;
  documentDate?: string;
  periodFrom?: string;
  periodTo?: string;
  counterparty?: string;
  status: 'draft' | 'submitted' | 'accepted' | 'rejected' | 'partial';
  lines: Ks2LineInput[];
  sourceRef: SourceRef;
}

interface Ks2LineInput {
  externalCode?: string;
  name: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  sourceRef: SourceRef;
}
```

### Правило

`document created != submitted != accepted`.

Отдельные события должны отражать каждую стадию.

---

## 10. Контракт КС-3

```ts
interface Ks3Input {
  documentNumber?: string;
  documentDate?: string;
  periodFrom?: string;
  periodTo?: string;
  amount?: number;
  status: 'draft' | 'submitted' | 'accepted' | 'rejected';
  relatedKs2Refs?: string[];
  sourceRef: SourceRef;
}
```

КС-3 подтверждает денежное оформление принятых работ, но не заменяет bank/payment event.

---

## 11. Контракт платежа

Источники: банковская выписка, платёжный реестр, бухгалтерская система.

```ts
interface PaymentInput {
  paymentId: string;
  paymentDate: string;
  amount: number;
  currency: string;
  payer?: string;
  payee?: string;
  purpose?: string;
  relatedDocumentRefs?: string[];
  sourceRef: SourceRef;
}
```

### Правило связи

Связь платежа с КС/обязательством может быть:

- exact;
- rule-based;
- manual-confirmed;
- unresolved.

Нельзя считать оплату конкретной работы только потому, что общий приход денег был на счёт.

---

## 12. Контракт графика работ

```ts
interface ScheduleActivityInput {
  externalCode?: string;
  name: string;
  plannedStart?: string;
  plannedFinish?: string;
  durationDays?: number;
  predecessorCodes?: string[];
  milestone?: boolean;
  location?: string;
  sourceRef: SourceRef;
}
```

КСГ может быть источником календарной логики, но не должен автоматически считаться идентичным `WorkItem`. Нужна отдельная mapping relation `ScheduleActivity ↔ WorkItem`.

---

## 13. Контракт blocker

```ts
interface Blocker {
  id: string;
  projectId: string;
  workItemId?: string;
  type:
    | 'WORK_MATCH_UNRESOLVED'
    | 'QUANTITY_UNKNOWN'
    | 'UNIT_MISMATCH'
    | 'MISSING_EVIDENCE'
    | 'MISSING_SIGNATURE'
    | 'COMMERCIAL_BASIS_MISSING'
    | 'KS2_NOT_PREPARED'
    | 'KS2_NOT_SUBMITTED'
    | 'KS2_NOT_ACCEPTED'
    | 'PAYMENT_NOT_LINKED'
    | 'DATA_CONFLICT'
    | 'DOUBLE_COUNT_RISK'
    | 'SOURCE_STALE'
    | 'OTHER';
  status: 'open' | 'resolved' | 'waived';
  openedAt: string;
  resolvedAt?: string;
  severity: 'info' | 'warning' | 'critical';
  sourceRefs: SourceRef[];
  explanationCode: string;
}
```

`explanationCode` должен быть детерминированным кодом причины. LLM может превратить его в человекочитаемый текст, но не изменить тип blocker.

---

## 14. UNKNOWN как самостоятельное состояние

СтройИнтел должен различать минимум:

- `0` — известное нулевое значение;
- `null/unknown` — источник не дал значения;
- `not_applicable` — значение не применимо;
- `conflicted` — есть противоречащие источники;
- `unconfirmed` — значение предложено, но не подтверждено.

Пример:

`plannedAmount = 0` и `plannedAmount = UNKNOWN` — разные состояния и должны вести к разным findings.

---

## 15. Conflict resolution

При конфликте источников система не выбирает «самый похожий» автоматически без правила.

Минимальная модель:

```ts
interface DataConflict {
  field: string;
  candidates: {
    value: unknown;
    sourceRef: SourceRef;
    sourcePriority?: number;
  }[];
  resolutionStatus: 'auto_rule' | 'manual_required' | 'resolved';
  selectedValue?: unknown;
  resolutionReason?: string;
}
```

Приоритет источников должен задаваться конфигурацией по типу факта.

---

## 16. Validation stages

Каждый документ проходит четыре уровня:

```text
PARSED
  ↓
SCHEMA_VALID
  ↓
SEMANTIC_VALID
  ↓
BUSINESS_ACCEPTED
```

### PARSED

Файл технически прочитан.

### SCHEMA_VALID

Обязательные поля извлечены и имеют допустимые типы.

### SEMANTIC_VALID

Единицы, даты, коды, связи и значения не противоречат базовым правилам.

### BUSINESS_ACCEPTED

Факт достаточно надёжен, чтобы участвовать в расчётах/статусах.

LLM output может пройти `PARSED` и `SCHEMA_VALID`, но не обязан автоматически стать `BUSINESS_ACCEPTED`.

---

## 17. Минимальный canonical pipeline

```text
Raw file
  ↓
Document profile
  ↓
Parser
  ↓
Raw extracted records
  ↓
Schema validation
  ↓
Normalization
  ↓
Matching / conflict detection
  ↓
Business validation
  ↓
Canonical events/entities
  ↓
Deterministic calculations
  ↓
Findings / Blockers
  ↓
UI / optional AI explanation
```

---

## 18. Acceptance для data contracts

Контракт считается пригодным для реализации, если на Волковском можно для существенной выборки строк показать путь:

`source cell/fragment → parsed value → normalized value → matched WorkItem → business event → calculation/finding`.

Если любой переход не трассируется, соответствующий факт не должен считаться доказанным.
