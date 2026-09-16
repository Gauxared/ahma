---
title: "Data Model & Storage"
date_created: 2026-08-05
type: spec
status: superseded
superseded_by: docs/architecture_v3.md
layer: backend
scope: data-model
project: stroyintellekt
source: docs/architecture_optimal2.md §6
---

# 06. Data Model & Storage

## 1. Назначение

PostgreSQL 16 — единственное хранилище данных. 8 основных таблиц + 2 служебных = 10. Без Redis, без внешних очередей.

## 2. ER-диаграмма

```mermaid
erDiagram
    TENANT ||--o{ USER : has
    TENANT ||--o{ PROJECT : owns
    TENANT ||--o{ KNOWLEDGE_BASE : owns
    PROJECT ||--o{ DOCUMENT : contains
    PROJECT ||--o{ ANALYSIS : runs
    ANALYSIS ||--o{ LENS_OUTPUT : produces
    ANALYSIS ||--o| ANALYSIS_RESULT : aggregates

    TENANT {
        uuid id PK
        string name
        string slug UK
        string system_prompt_path
        jsonb settings
        timestamp created_at
    }

    USER {
        uuid id PK
        uuid tenant_id FK
        string email UK
        string password_hash
        enum role "user | admin"
        boolean is_active
        timestamp created_at
    }

    PROJECT {
        uuid id PK
        uuid tenant_id FK
        uuid created_by FK
        string name
        string region
        string product_type
        jsonb passport
        boolean is_deleted
        timestamp created_at
        timestamp updated_at
    }

    DOCUMENT {
        uuid id PK
        uuid project_id FK
        uuid tenant_id FK
        string filename
        string storage_key
        string sha256
        string mime_type
        string doc_type
        jsonb parsed_data
        boolean redacted
        boolean confirmed
        timestamp uploaded_at
    }

    ANALYSIS {
        uuid id PK
        uuid project_id FK
        uuid tenant_id FK
        uuid user_id FK
        string codex_thread_id
        string command
        string description
        enum mode "express | standard | expert"
        enum state "queued | running | completed | completed_with_warnings | failed | cancelled"
        string config_hash
        integer tokens_used
        timestamp created_at
        timestamp completed_at
    }

    LENS_OUTPUT {
        uuid id PK
        uuid analysis_id FK
        string lens_code
        integer step_number
        text content
        jsonb markers
        jsonb tool_calls
        timestamp created_at
    }

    ANALYSIS_RESULT {
        uuid id PK
        uuid analysis_id FK
        string schema_version
        jsonb canonical_json
        string verdict
        string excel_path
        string word_path
        timestamp created_at
    }

    KNOWLEDGE_BASE {
        uuid id PK
        uuid tenant_id FK
        string name
        string version
        jsonb records
        integer record_count
        timestamp imported_at
    }
```

## 3. Дополнительные таблицы

### 3.1 jobs (очередь задач)

```sql
CREATE TABLE jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    job_type    TEXT NOT NULL,        -- 'analysis' | 'import' | 'export'
    payload     JSONB NOT NULL,
    state       TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
    attempts    INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_state ON jobs(state) WHERE state = 'pending';
CREATE INDEX idx_jobs_tenant ON jobs(tenant_id);
```

### 3.2 audit_events (журнал)

```sql
CREATE TABLE audit_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    user_id     UUID REFERENCES users(id),
    action      TEXT NOT NULL,       -- 'login' | 'upload' | 'analysis' | 'export' | 'import'
    resource    TEXT,                 -- 'project' | 'document' | 'analysis'
    resource_id UUID,
    details     JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_time ON audit_events(tenant_id, created_at DESC);
```

## 4. Row-Level Security (RLS)

Каждая таблица с `tenant_id` защищена RLS:

```sql
-- Включаем RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Политика: видишь только свой tenant
CREATE POLICY tenant_isolation ON projects
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Аналогично для documents, analyses, lens_outputs, etc.
```

**Установка tenant context в Gateway:**

```python
async def set_tenant_context(session: AsyncSession, tenant_id: UUID):
    await session.execute(
        text("SET LOCAL app.current_tenant_id = :tid"),
        {"tid": str(tenant_id)}
    )
```

## 5. Lens Codes

Допустимые значения `lens_code` в таблице `LENS_OUTPUT`:

| Code | Линза | Описание |
|------|-------|----------|
| `passport` | Паспорт | Шаг 0, домен-детектор |
| `denchik` | ГИП | Физика, объёмы |
| `lyudmila` | Смета | Сходимость, конъюнктура |
| `marina` | Снаб | Рынок, КП, лид-тайм |
| `khalil` | Подряд | Субподрядчики, скоринг |
| `vanych` | Эконом | Финмодель, маржа |
| `palych` | ПТО | ИД, КС, приказы |
| `viktor` | Договор | Red-flag, ГУ/БГ |
| `artemiy` | РП | Синтез, вердикт |
| `nastenka` | Админ | Реестр, сроки |
| `unknown` | — | Не распознана |

## 6. Analysis States

```mermaid
stateDiagram-v2
    [*] --> queued: POST /analyses
    queued --> running: worker picks up
    running --> completed: all lenses done, verdict
    running --> completed_with_warnings: done but ⚠ markers
    running --> failed: error
    running --> cancelled: user cancels
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

## 7. Migrations

Alembic для управления миграциями:

```
backend/alembic/
├── env.py
├── script.py.mako
└── versions/
    ├── 001_initial_schema.py
    ├── 002_add_lens_outputs.py
    └── ...
```

**Команды:**
```bash
alembic upgrade head        # Применить все миграции
alembic revision --autogenerate -m "description"  # Создать миграцию
alembic downgrade -1        # Откатить одну
```

## 8. Индексы

```sql
-- Performance-critical queries
CREATE INDEX idx_projects_tenant ON projects(tenant_id);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_analyses_project ON analyses(project_id);
CREATE INDEX idx_analyses_state ON analyses(state) WHERE state IN ('queued', 'running');
CREATE INDEX idx_lens_outputs_analysis ON lens_outputs(analysis_id);
CREATE INDEX idx_knowledge_tenant ON knowledge_bases(tenant_id);

-- Full-text search on knowledge
CREATE INDEX idx_knowledge_records_gin ON knowledge_bases USING gin(records);
```

## 9. Backup

```bash
# Ежедневный pg_dump
pg_dump -Fc -f /backups/stroyintellekt_$(date +%Y%m%d).dump $DATABASE_URL

# Хранение: 30 дней
find /backups -name "*.dump" -mtime +30 -delete
```
