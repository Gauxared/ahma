---
title: "СтройИнтеллект: ingestion и normalization документов"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: system
horizon: delivery
scope: document-ingestion-normalization
project: stroyintellekt
source: /home/govard/projects/7rl/stroyintellekt/03.08.26_ТЗ_СтройИнтеллект_Приложение№1_к_КП_АПРИ.docx
related:
  - 01-contract-requirements-and-acceptance.md
  - 02-legacy-rule-and-parameter-traceability.md
  - 04-canonical-data-and-structured-output.md
  - 07-calculation-engine.md
  - 09-security-tenancy-and-data-handling.md
  - 13-testing-evals-and-delivery-gates.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: ingestion и normalization документов

## 1. Цель

Модуль принимает файл, создаёт immutable версию, безопасно извлекает данные и provenance, нормализует их в canonical schema и передаёт человеку для подтверждения.

Модуль не:

- выполняет бизнес-расчёты;
- выбирает опорное значение;
- исполняет Excel formula, macro, DDE или embedded code;
- структурно разбирает PDF в договорном MVP;
- выполняет OCR;
- превращает неоднозначное значение в подтверждённое.

```text
upload
→ security checks
→ type detection
→ parser
→ raw extraction
→ normalization
→ validation and reconciliation
→ human correction
→ confirmed snapshot
```

## 2. Форматы

| Формат | Контракт | Ограничение |
|---|---|---|
| `.xlsx` | Позиции, таблицы, hierarchy и totals | Формулы сохраняются как metadata |
| `.xls` | То же через отдельный BIFF adapter | Без офисной автоматизации в request path |
| ГРАНД-Смета XML | Разбор утверждённых namespaces/versions | Неизвестная версия блокирует confirmation |
| `.docx` | Paragraphs, tables, contract text | Embedded objects не исполняются |
| PDF с text layer | Page spans и текст для LLM | Без структурного извлечения сметы |
| PDF без text layer | `unsupported_scan` | OCR вне scope |
| АРПС | `unsupported_format` | Вне scope |

## 3. DocumentVersion

```yaml
document_version_id: uuid
document_id: uuid
tenant_id: uuid
project_id: uuid
document_role: estimate | contractor_offer | quantities | contract | other
original_filename: string
storage_key: string
size_bytes: integer
sha256: sha256
declared_mime: string | null
detected_mime: string
format: xls | xlsx | grand_xml | docx | pdf
uploaded_by: uuid
created_at: date-time
security:
  malware_scan: pending | passed | failed | not_configured
  archive_check: pending | passed | failed | not_applicable
  encrypted: boolean
  quarantine_reason_codes: []
  verdict: pending | allow | quarantine | block
parser:
  state: not_started | queued | parsing | parsed | failed | unsupported
  parser_id: string | null
  parser_version: string | null
```

`DocumentVersion` immutable. Повторная загрузка создаёт новую версию даже при совпадении логического `Document`.

## 4. SourceLocation и raw extraction

```yaml
source_location:
  kind: xlsx_cell | xlsx_range | xls_cell | xml_path | docx_paragraph | docx_table_cell | pdf_page_span
  value: string
  page: integer | null
  sheet: string | null
  row: integer | null
  column: string | null
  content_hash: sha256
```

```yaml
raw_field_id: uuid
semantic_hint: string | null
raw_value: string | null
raw_formula: string | null
cached_formula_value: string | null
source_location: SourceLocation
extraction_method: structural | text_layer | metadata
parser_confidence:
  value: decimal | null
  reason_codes: []
```

Ссылка только на filename недостаточна.

## 5. NormalizedRow

```yaml
normalized_row_id: uuid
row_kind: estimate_position | section_total | document_total | contract_clause | text_fragment | unknown
source_document_version_id: uuid
source_locations: []
position:
  external_id: string | null
  parent_external_id: string | null
  code: string | null
  code_system: string | null
  name: string | null
  position_type: work | material | transport | equipment | other | unknown
values:
  quantity:
    value: decimal-string | null
    unit: string | null
    status: source_confirmed | unknown | conflict
  unit_price:
    value: decimal-string | null
    unit: string | null
    tax_basis: with_vat | without_vat | unknown
    price_level_date: date | null
    status: source_confirmed | unknown | conflict
  declared_amount:
    value: decimal-string | null
    unit: RUB | null
    status: source_confirmed | unknown | conflict
completeness:
  required_fields: []
  missing_fields: []
  state: complete | incomplete | ambiguous
parser_confidence:
  value: decimal | null
  reason_codes: []
content_hash: sha256
```

Parser не создаёт canonical status `calculated`.

## 6. Validation и reconciliation

```yaml
validation_issue:
  issue_id: uuid
  code: string
  severity: info | warning | blocking
  row_ref: uuid | null
  field_path: string | null
  message: string
  source_locations: []
  suggested_action: accept | correct | provide_data | replace_file | specialist_review
```

```yaml
reconciliation:
  scope: section | document
  declared_total: decimal-string | null
  calculated_total: decimal-string | null
  difference: decimal-string | null
  unit: RUB
  rounding_policy_ref: string
  state: matched | explained_difference | unexplained_difference | insufficient_data | not_applicable
  explanations: []
```

Знак:

```text
difference = calculated_total - declared_total
```

`unexplained_difference != 0.00 RUB` блокирует договорный gate сходимости.

## 7. Human correction

```yaml
correction_patch:
  correction_id: uuid
  normalized_revision_id: uuid
  row_ref: uuid
  field_path: string
  old_value: object
  new_value: object
  reason: string
  corrected_by: uuid
  corrected_at: date-time
  source_type: human_correction
```

Исправление:

- не перезаписывает raw extraction;
- создаёт новую normalized revision;
- пересчитывает validation/reconciliation;
- требует автора и причины;
- может быть подтверждено только в tenant scope.

## 8. NormalizedSnapshot

```yaml
normalized_snapshot_id: uuid
tenant_id: uuid
project_id: uuid
document_version_ids: []
normalized_revision_ids: []
parser_bundle_version: string
normalization_schema_version: string
validation_summary:
  blocking: integer
  warnings: integer
  reconciliation_state: matched | explained_difference | unexplained_difference | insufficient_data | not_applicable
confirmed: boolean
confirmed_by: uuid | null
confirmed_at: date-time | null
snapshot_hash: sha256
```

Calculation Engine получает только confirmed snapshot без blocking issues.

Security gate:

- parsing разрешён только при `security.verdict = allow`;
- confirmation разрешён только при `security.verdict = allow`;
- failed content/type/archive validation возвращает `quarantine` или `block`;
- `malware_scan = not_configured` допустим только если scanner не обязателен в утверждённой security policy и остальные обязательные controls прошли;
- `pending`, `quarantine` и `block` никогда не переходят в parsing/confirmation автоматически.

## 9. Parser ports

```python
class DocumentParser(Protocol):
    async def parse(
        self,
        document: DocumentVersionRef,
        context: ParseContext,
    ) -> ParseResult: ...
```

```python
class DocumentNormalizer(Protocol):
    async def normalize(
        self,
        extraction: RawExtraction,
        profile: NormalizationProfile,
    ) -> NormalizationResult: ...
```

```python
class NormalizationValidator(Protocol):
    async def validate(
        self,
        revision: NormalizedRevision,
        context: ValidationContext,
    ) -> ValidationResult: ...
```

```python
class ReconciliationService(Protocol):
    def reconcile(
        self,
        rows: Sequence[NormalizedRow],
        totals: Sequence[DeclaredTotal],
        policy: RoundingPolicy,
    ) -> Sequence[ReconciliationResult]: ...
```

## 10. Lifecycle

```text
uploaded
→ security_scanning
→ type_detected
→ parsing
→ parsed
→ normalizing
→ input_review
→ confirmed
```

Terminal/exception states:

```text
quarantined
unsupported_format
unsupported_scan
encrypted_unsupported
parse_failed
rejected_by_user
superseded
```

Переход `security_scanning → type_detected` разрешён только при `SecurityVerdict.allow`; `quarantine` и `block` являются terminal security outcomes до отдельного authorised disposition.

Новая версия документа supersedes approval только для новых runs. Исторический snapshot не меняется.

## 11. Format controls

### 11.1 XLSX

- OOXML читается без исполнения formulas;
- formula text и cached value сохраняются раздельно;
- hidden sheets/rows не игнорируются молча;
- external links не загружаются;
- workbook date system фиксируется;
- merged ranges сохраняют provenance.

### 11.2 XLS

- отдельный read-only BIFF adapter;
- OLE container проверяется;
- VBA/DDE/embedded objects не исполняются;
- адреса sheet/cell сохраняются;
- encrypted/corrupt BIFF возвращает blocking issue;
- выбранная библиотека фиксируется lockfile и corpus tests.

### 11.3 XML

- DTD, external entities и network schema resolution запрещены;
- namespace/version обязательны;
- неизвестная версия возвращает `unsupported_schema_version`;
- XML path входит в SourceRef.

### 11.4 DOCX

- сохраняется порядок paragraphs/tables;
- external relationships не загружаются;
- embedded OLE только обнаруживается;
- contract text проходит redaction перед provider.

### 11.5 PDF

- проверяется usable text layer;
- сохраняются pages и spans;
- scan возвращает `unsupported_scan`;
- legacy regex parser не закрывает договорный extraction gate.

## 12. Security controls

Обязательны:

- MIME detection по содержимому;
- server-generated storage key;
- path traversal rejection;
- checksum;
- archive bomb protection;
- quarantine;
- no macro/DDE/embedded execution;
- no XML external entities;
- no external-link fetching;
- tenant-scoped storage;
- fail-closed redaction.

Размеры файлов, batch limits и обязательность malware scanner являются конфигурируемыми engineering controls и утверждаются после risk/load evidence.

## 13. Idempotency

```yaml
parse_key:
  tenant_id: uuid
  document_sha256: sha256
  parser_id: string
  parser_version: string
  mapping_profile_version: string
  normalization_schema_version: string
```

Одинаковый ключ даёт тот же raw/normalized hash. Human correction имеет отдельный revision hash.

## 14. Acceptance

- ≥95% корректных позиций на контрольном наборе;
- 0 ₽ необъяснённого расхождения;
- 100% принятых чисел имеют SourceLocation;
- незамеченное изменение знака или decimal separator = 0;
- PDF scan исключён из denominator и возвращает явный status;
- `unknown` не преобразуется в `0`;
- correction создаёт новую revision;
- расчёт до confirmation невозможен;
- смета ≥2 000 позиций обрабатывается;
- malicious XML/Office fixtures не исполняют код;
- остаточные реквизиты в разрешённом outbound payload = 0.

## 15. Решения до реализации

| ID | Решение |
|---|---|
| `DEC-ING-001` | Denominator позиции и merged/split matching |
| `DEC-ING-002` | Поддерживаемые версии ГРАНД XML |
| `DEC-ING-003` | BIFF-библиотека `.xls` |
| `DEC-ING-004` | Password-protected files |
| `DEC-ING-005` | Confidence calibration |
| `DEC-ING-006` | Роль подтверждающего correction |
| `DEC-ING-007` | Upload/security limits и обязательность malware scanner |
| `DEC-ING-008` | Критерий usable PDF text layer |
