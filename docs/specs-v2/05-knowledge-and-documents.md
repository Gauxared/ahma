---
title: "Knowledge & Documents"
date_created: 2026-08-05
type: spec
status: superseded
superseded_by: docs/architecture_v3.md
layer: backend
scope: knowledge-documents
project: stroyintellekt
source: docs/architecture_optimal2.md §4.4, §3, reference-system/apri/*.xlsx
---

# 05. Knowledge & Documents

## 1. Назначение

Два подсистемы:
- **Knowledge** — опорная база (Excel 13 листов) per tenant: цены, нормы, бенчмарки. Зарегистрирована как Codex Tool `search_knowledge`
- **Documents** — загрузка, парсинг, сверка, redaction входных документов проекта (ЛСР, КП, договор). Предоставляются как контекст в Codex thread

## 2. Knowledge (Опорная база)

### 2.1 Структура листов

Из Части 4 промпта — карта 13 листов:

| # | Лист | Содержание | Пример данных |
|---|------|-----------|---------------|
| 1 | Прайс работ | Rate card по видам СМР, регионам | Монолит 15200 ₽/м³, Чел. |
| 2 | Материалы | Металл, бетон, трубы, кабель | Арматура А500 65000 ₽/т |
| 3 | Оборудование-длинноцикл | Цены, лид-таймы, импорт/РФ | Лифт OTIS 3.2 млн, 16 нед |
| 4 | Себестоимость ₽/м² | По сегментам и регионам | Эконом: 72000, Бизнес: 112000 |
| 5 | ПФ и эскроу | Ставки, банки, условия | Сбер 23%, ДОМ.РФ 19% |
| 6 | Ставки труда | Оклады/ставки по специальностям | Монтажник 3200 ₽/день, Чел. |
| 7 | Нормативы выработки | Чел-ч/ед по операциям | Монолит 0.8 чел-ч/м³ |
| 8 | Алгоритмы | Все формулы (→ Calc Engine) | ФОТ = оклад/30 × дни × 1.44 |
| 9 | Нормбаза | Документ → статус «действует» | СП 124.13330.2012 ✅ |
| 10 | Реестр объектов | Провенанс цифр | Каранайаул: 96000 ₽/м² |
| 11 | Уроки | Кейсы и ошибки | Урок Д-3: 5≠7 объектов |
| 12 | Сверка расчёт-факт | Факт vs оценка | ЖК Зауралье: ±3.2% |
| 13 | Подрядчики/аналоги | Скоринг, РФ-аналоги | Grundfos → Wilo → ЭМИС |

### 2.2 Import Flow

```
Опорная_база_Девелопмент_АПРИ_v1.xlsx
         │
         ▼
   openpyxl: parse each sheet
         │
         ▼
   Normalize: {name, value, unit, year, source, status, checked_date}
         │
         ▼
   PostgreSQL: KNOWLEDGE_BASE (tenant_id, name, version, records JSONB)
         │
         ▼
   Index: full-text search + category index
```

### 2.3 Record Schema

```json
{
  "sheet": "2_materials",
  "category": "арматура",
  "name": "Арматура А500С Ø12-32",
  "value": "65000.00",
  "unit": "₽/т",
  "year": 2026,
  "source": "КП поставщика Металлсервис",
  "status": "fact",
  "region": "Челябинская обл.",
  "checked_date": "2026-07-15",
  "freshness_status": "ok",
  "tags": ["металл", "арматура", "КЖ"]
}
```

### 2.4 Search Tool

```json
{
  "name": "search_knowledge",
  "description": "Поиск в опорной базе по листу, категории, региону. Возвращает цены, нормы, бенчмарки с источниками и датами.",
  "parameters": {
    "type": "object",
    "properties": {
      "sheet": {
        "type": "string",
        "enum": ["1_prices", "2_materials", "3_equipment", "4_cost_sqm", "5_pf_escrow", "6_labor_rates", "7_output_norms", "8_algorithms", "9_norms_base", "10_objects_registry", "11_lessons", "12_fact_check", "13_contractors"],
        "description": "Номер листа опорной базы"
      },
      "query": {
        "type": "string",
        "description": "Текстовый запрос: название, категория, ключевое слово"
      },
      "region": {
        "type": "string",
        "description": "Регион (необязательно)"
      }
    },
    "required": ["sheet", "query"]
  }
}
```

**Response:**
```json
{
  "results": [
    {
      "name": "Арматура А500С Ø12-32",
      "value": "65000.00",
      "unit": "₽/т",
      "source": "КП Металлсервис",
      "status": "✅ ФАКТ",
      "date": "2026-07-15",
      "freshness": "ok"
    }
  ],
  "total_found": 1,
  "freshness_warning": null
}
```

### 2.5 Freshness Check

Из Части 9 промпта: цены/индексы старше 90 дней → ⚠.

```python
def check_freshness(record: dict) -> str:
    checked = date.fromisoformat(record["checked_date"])
    age_days = (date.today() - checked).days
    
    if age_days <= 90:
        return "ok"
    elif age_days <= 180:
        return "warning"     # ⚠ рекомендуется обновить
    else:
        return "stale"       # ❌ обязательно обновить
```

## 3. Documents (Входные документы)

### 3.1 Поддерживаемые форматы

| Формат | Mime | Parser | Типичный контент |
|--------|------|--------|-----------------|
| Excel (.xlsx) | `application/vnd.openxmlformats-...spreadsheetml.sheet` | openpyxl | ЛСР, сметы, ВОР, КП |
| XML (.xml) | `application/xml` | lxml | Сметы GrandSmeta |
| Word (.docx) | `application/vnd.openxmlformats-...wordprocessingml.document` | python-docx | Договоры, ТЗ |
| PDF (.pdf) | `application/pdf` | pdfplumber | КП, акты (text-based) |

### 3.2 Parse Pipeline

```python
class DocumentParser:
    """Мультиформатный парсер."""
    
    async def parse(self, file: UploadFile) -> ParsedDocument:
        mime = detect_mime(file)
        
        match mime:
            case "xlsx":
                return await self.parse_excel(file)
            case "xml":
                return await self.parse_xml(file)
            case "docx":
                return await self.parse_docx(file)
            case "pdf":
                return await self.parse_pdf(file)
            case _:
                raise UnsupportedFormat(mime)
    
    async def parse_excel(self, file) -> ParsedDocument:
        wb = openpyxl.load_workbook(file)
        
        # Detect type: ЛСР, ВОР, КП, etc.
        doc_type = detect_document_type(wb)
        
        # Extract structured data
        match doc_type:
            case "estimate":
                sections = extract_estimate_sections(wb)
                grand_total = extract_grand_total(wb)
                convergence = calc_convergence(
                    [str(s["total"]) for s in sections],
                    str(grand_total),
                )
                return ParsedDocument(
                    type="estimate",
                    sections=sections,
                    grand_total=grand_total,
                    convergence=convergence,
                )
            case "commercial_offer":
                positions = extract_positions(wb)
                return ParsedDocument(type="commercial_offer", positions=positions)
```

### 3.3 Document Type Detection

| Признаки в файле | Тип | Parsed structure |
|-------------------|-----|-----------------|
| Листы с «ЛСР», номера разделов, расценки | `estimate` | sections, positions, grand_total |
| «Коммерческое предложение», позиции с ценами | `commercial_offer` | positions, total |
| «Ведомость объёмов работ» | `vor` | sections, volumes |
| «Договор подряда», статьи | `contract` | clauses, key_terms |
| Таблица с несколькими КП | `tender` | offers, comparison |

### 3.4 Convergence Check (автоматическая)

При загрузке сметы автоматически проверяем:

```
Σ(ЛСР разделов) = Итог свода ?
```

Если Δ ≠ 0 — показываем warning. Уроки legacy: в Каранайауле ЛСР 08-01 выпала на 3,5 млн.

### 3.5 Read Document Tool

```json
{
  "name": "read_document_section",
  "description": "Чтение секции загруженного документа по имени или номеру раздела.",
  "parameters": {
    "type": "object",
    "properties": {
      "document_id": {"type": "string"},
      "section": {"type": "string", "description": "Номер или название раздела"}
    },
    "required": ["document_id", "section"]
  }
}
```

## 4. Redaction (Анонимизация)

Перед отправкой документов в Codex — удаление персональных данных:

### 4.1 Что удаляем

| Тип ПД | Паттерн | Замена |
|--------|---------|--------|
| ФИО | Regex: Ивановы/Петровы patterns | `[ФИО_УДАЛЕНО]` |
| ИНН | `\d{10,12}` в контексте ИНН | `[ИНН_УДАЛЕНО]` |
| Телефон | `+7\d{10}`, `8\d{10}` | `[ТЕЛЕФОН_УДАЛЕНО]` |
| Email | standard email regex | `[EMAIL_УДАЛЕНО]` |
| Паспорт | серия/номер patterns | `[ПАСПОРТ_УДАЛЕНО]` |
| Расчётный счёт | `\d{20}` в контексте р/с | `[СЧЁТ_УДАЛЕНО]` |

### 4.2 Что НЕ удаляем

- Наименование юридического лица (ПАО «АПРИ», АО «МОДЦ»)
- ИНН юрлица (публичные данные)
- Адрес объекта строительства
- Технические данные (объёмы, расценки, нормативы)
- Даты документов

### 4.3 Redaction Flow

```python
async def redact_document(parsed: ParsedDocument) -> ParsedDocument:
    """Анонимизация перед отправкой в LLM."""
    redacted = deep_copy(parsed)
    
    for field in redacted.text_fields():
        field.value = apply_redaction_rules(field.value)
    
    redacted.redaction_applied = True
    redacted.redaction_log = collect_redaction_log()
    
    return redacted
```

## 5. Storage

### 5.1 Файлы

MVP: local filesystem (`/data/documents/{tenant_id}/{sha256}`)

```
/data/
├── documents/
│   ├── apri/
│   │   ├── abc123.xlsx     # оригинал
│   │   └── abc123.json     # parsed_data
│   └── modc/
│       └── ...
└── knowledge/
    ├── apri/
    │   └── opornaya_baza_v1.json   # импортированная база
    └── modc/
        └── ...
```

### 5.2 Дедупликация

Файлы с одинаковым `sha256` + `tenant_id` не дублируются. При повторной загрузке возвращаем существующий `document_id`.
