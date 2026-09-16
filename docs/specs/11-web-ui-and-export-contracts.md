---
title: "СтройИнтеллект: web UI и export contracts"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: product
horizon: delivery
scope: web-ui-export
project: stroyintellekt
source: contract-owner-decisions-and-architecture
related:
  - 01-contract-requirements-and-acceptance.md
  - 03-domain-workflow-and-competency-contracts.md
  - 04-canonical-data-and-structured-output.md
  - 06-document-ingestion-and-normalization.md
  - 07-calculation-engine.md
  - 10-api-queue-and-runtime-state.md
  - 13-testing-evals-and-delivery-gates.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: high
---

# СтройИнтеллект: web UI и export contracts

## 1. Цель

Web UI обеспечивает полный пользовательский путь от загрузки документов до утверждённого отчёта, сохраняя traceability, явные unknown/conflicts и human gates.

XLSX и DOCX являются обязательными договорными export adapters. PDF и JSON могут быть optional engineering adapters. UI и canonical result не зависят от workbook formulas.

## 2. Product surfaces

| Surface | Назначение |
|---|---|
| Tenant/project selector | Выбор разрешённого tenant/project |
| Project dashboard | Документы, analyses, status, blockers |
| Upload center | Загрузка и processing status |
| Input review | Проверка normalized rows и corrections |
| Analysis setup | Snapshot, revision, retrieval track |
| Run progress | DAG, events, retry/cancel |
| Competency workspace | Outputs, evidence, approvals |
| Results | KPIs, deviations, conclusions |
| Trace viewer | SourceRef, FormulaTrace, rule decisions |
| Export center | Формирование и скачивание artifacts |

## 3. Navigation

```text
/projects
/projects/{projectId}
/projects/{projectId}/documents
/projects/{projectId}/documents/{documentId}/versions/{versionId}
/projects/{projectId}/input-review/{snapshotId}
/projects/{projectId}/analyses/{analysisId}
/projects/{projectId}/runs/{runId}
/projects/{projectId}/runs/{runId}/competencies/{competencyId}
/projects/{projectId}/runs/{runId}/results
/projects/{projectId}/runs/{runId}/exports
```

Route access всегда проверяется server-side.

## 4. UI state contract

Каждый async surface отображает:

- loading;
- empty;
- partial;
- success;
- warning;
- blocking;
- failed;
- stale/superseded;
- permission denied.

UI не показывает optimistic success до подтверждённого API transition.

## 5. Upload center

Для файла отображаются:

- filename/type/size/checksum suffix;
- document role;
- upload/security/parser/normalization states;
- blocking/warning count;
- superseded version;
- retry/replace actions;
- unsupported reason.

PDF scan должен явно показывать, что OCR не поддерживается в текущем scope.

## 6. Input review

Таблица normalized rows:

| Колонка | Требование |
|---|---|
| Source location | Sheet/cell, XML path, paragraph/page |
| Code/name | Raw и normalized при различии |
| Quantity/unit | Typed value/status |
| Price/amount | Typed value/status |
| Confidence | Если calibrated |
| Issues | Blocking/warnings |
| Correction | New value + reason |

Controls:

- filters по status/issue/section;
- side-by-side source context;
- correction history;
- reconciliation totals;
- confirmation only with zero blocking issues;
- confirmation subject hash.

Unknown и zero визуально различаются.

## 7. Analysis setup

Пользователь выбирает:

- confirmed normalized snapshot;
- approved knowledge/parameter revision;
- retrieval track, если policy позволяет;
- применимые optional competencies;
- run label.

UI не предлагает draft/blocked revisions. Default track задаётся tenant/system policy, не скрытой UI логикой.

## 8. Progress and DAG

Для competency node:

- status;
- dependencies;
- attempts;
- start/finish;
- blocker/failure code;
- approval gate;
- output artifact links;
- pruning reason.

Обязателен direct path `Денчик → Ваныч`. Параллельные `Марина || Халиль` отображаются независимо.

## 9. Competency workspace

Каждый результат разделяется на:

- structured findings;
- source evidence;
- calculated indicators;
- assumptions/unknowns;
- recommendations;
- approval state.

Factual claim открывает exact SourceRef. Calculated value открывает FormulaTrace. Пользователь не должен искать provenance в отдельном downloaded file.

## 10. Approvals

Approval dialog показывает:

- subject type/id/hash;
- snapshot/revision versions;
- blocking/warning summary;
- approver role;
- decision options;
- mandatory reason для reject/request changes.

При stale subject hash approval action блокируется и UI требует refresh.

## 11. Results

Обязательные sections:

- executive summary;
- input completeness;
- declared/reference/calculated totals;
- deviations and saving potential;
- competency findings;
- risks;
- recommendations;
- unresolved unknowns/conflicts;
- source/citation coverage;
- methodology/version manifest.

Цвет не является единственным сигналом. Все statuses имеют text/icon labels.

## 12. Trace viewer

Trace viewer поддерживает:

- recursive formula inputs;
- source document navigation;
- rule/formula IDs and versions;
- selected reference value and rejected candidates;
- rounding steps;
- evidence claims/citations;
- correction/approval history;
- immutable snapshot identifiers.

## 13. Export contract

```yaml
export_manifest:
  export_id: uuid
  tenant_id: uuid
  project_id: uuid
  analysis_run_id: uuid
  artifact_type: analysis_xlsx | violations_registry_xlsx | report_docx
  template_id: string
  template_version: string
  source_snapshot_hash: sha256
  knowledge_snapshot_id: uuid
  knowledge_manifest_hash: sha256
  engine_version: string
  generated_at: date-time
  generated_by: uuid
  content_hash: sha256
```

Все exports строятся из одного approved canonical result snapshot.

Для optional PDF/JSON используется тот же manifest с дополнительным adapter type; наличие этих adapters не входит в договорный acceptance gate.

## 14. XLSX export

Workbook является представлением, не calculation engine.

Минимальные sheets:

1. `Резюме`;
2. `Исходные данные`;
3. `Позиции`;
4. `Компетенции`;
5. `Риски`;
6. `Источники`;
7. `Методология`;
8. `Трассировка`.

Requirements:

- итоговые canonical values сохраняются в export artifact;
- согласованные договорные расчётные ячейки содержат рабочие formulas и выделенные inputs;
- workbook formulas после пересчёта обязаны совпадать с canonical values, но не являются authoritative runtime;
- machine-readable stable headers/IDs;
- units/statuses;
- source/formula IDs;
- no macros/external links;
- no hidden authoritative data;
- opening/re-saving workbook не меняет canonical result.

## 15. Additional export contracts

### 15.1 Optional PDF export

PDF содержит:

- tenant/project/report identity;
- generation timestamp/version manifest;
- readable tables;
- page numbers;
- source footnotes/references;
- unresolved issues;
- approval status;
- content hash or artifact ID.

PDF не должен утверждать, что recommendation является verified fact.

### 15.2 Обязательный реестр нарушений XLSX

`violations_registry_xlsx` формируется как отдельный договорный artifact.

Минимальная строка:

```yaml
violation_id: uuid
position_ref: string
position_name: string
violation_type: string
amount:
  value: decimal-string | null
  unit: RUB
  status: source_confirmed | calculated | estimate | unknown | conflict | not_applicable
basis_claim_ref: uuid
basis_source_refs: []
resolution_path: string
owner: string | null
due_at: date-time | null
```

Требования:

- одна canonical row на каждое зарегистрированное нарушение;
- сумма без FormulaTrace/SourceRef запрещена;
- `unknown` не заменяется нулём;
- основание ссылается на claim/evidence;
- путь урегулирования не может быть пустым;
- полнота реестра сравнивается с canonical findings по типу `violation`.

## 16. DOCX export

DOCX предназначен для редактируемого экспертного отчёта:

- stable heading hierarchy;
- structured tables;
- claim/source references;
- version manifest;
- visible warning for modified-after-export content не гарантируется платформой;
- embedded macros/external objects отсутствуют.

## 17. Optional JSON export

JSON следует canonical schema spec 04 и включает:

- schema version;
- envelope;
- snapshot/revision refs;
- typed outputs;
- FormulaTrace refs;
- claims/citations;
- export manifest.

## 18. Accessibility

Baseline:

- keyboard navigation;
- visible focus;
- labels/errors associated with controls;
- semantic headings/tables;
- text alternatives;
- contrast;
- no color-only meaning;
- screen-reader status announcements;
- modal focus management;
- zoom/reflow для основных workflows.

Target: WCAG 2.1 AA для contractual user journeys.

## 19. Responsive behavior

Primary target: desktop/tablet для больших сметных таблиц. Mobile поддерживает:

- dashboard/status;
- review summary;
- approval decision;
- artifact download.

Bulk correction/large-table workflows могут требовать desktop и должны честно сообщать это.

## 20. Performance

UI budgets утверждаются после baseline measurements. До этого обязательны:

- pagination/virtualization для ≥2 000 positions;
- no full document payload in list endpoints;
- progressive loading;
- cancellable requests;
- export as async job;
- no polling storm;
- client error observability without sensitive payload.

## 21. Error messages

Пользователь получает:

- что произошло;
- что затронуто;
- retryable ли ошибка;
- что сделать;
- trace ID.

Internal stack/provider details не показываются.

## 22. Export parity

Один canonical field должен иметь одинаковое значение/status/unit во всех formats. Differences допускаются только presentation-wise и фиксируются template rules.

Parity validator для всех enabled formats сравнивает:

- totals;
- key indicators;
- row counts;
- unresolved issue count;
- FormulaTrace/source coverage;
- manifest identifiers.

## 23. Acceptance

- пользователь проходит upload → review → confirm → run → approve → export;
- unknown и zero не смешиваются;
- блокирующая issue исключает confirmation;
- factual claim открывает source;
- calculated value открывает FormulaTrace;
- stale approval блокируется;
- ≥2 000 positions остаются usable через virtualization/pagination;
- обязательные XLSX/DOCX totals совпадают с canonical snapshot;
- отдельный `violations_registry_xlsx` содержит позицию, нарушение, сумму, основание и путь урегулирования;
- optional PDF/JSON при включении проходят тот же parity validator;
- XLSX не нужен для воспроизведения calculation;
- keyboard-only contractual journey проходит;
- tenant/user не видит чужие routes/artifacts;
- download требует authorization/signed URL;
- export manifest/hash сохраняются.

## 24. Решения до реализации

| ID | Решение |
|---|---|
| `DEC-UI-001` | Frontend stack/design system |
| `DEC-UI-002` | WCAG conformance statement |
| `DEC-UI-003` | Required export formats per contract stage |
| `DEC-UI-004` | Export template ownership/versioning |
| `DEC-UI-005` | Mobile scope |
| `DEC-UI-006` | Progress update transport |
