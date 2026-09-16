---
title: "Security & Tenancy"
date_created: 2026-08-05
type: spec
status: superseded
superseded_by: docs/architecture_v3.md
layer: security
scope: security-tenancy
project: stroyintellekt
source: docs/architecture_optimal2.md §8, §12
---

# 08. Security & Tenancy

## 1. Назначение

Безопасность, аутентификация, tenant isolation, redaction, аудит.

## 2. Authentication

### 2.1 JWT

```
POST /auth/login
  Body: {"email": "user@apri.ru", "password": "..."}
  Response: {"access_token": "jwt...", "refresh_token": "jwt...", "expires_in": 3600}
```

**JWT Payload:**
```json
{
  "sub": "user-uuid",
  "tenant_id": "apri-uuid",
  "role": "user",
  "exp": 1722870000,
  "iat": 1722866400
}
```

### 2.2 Токены

| Тип | TTL | Хранение |
|-----|-----|----------|
| Access token | 1 час | Frontend: memory (не localStorage) |
| Refresh token | 7 дней | httpOnly cookie |

### 2.3 Password Hashing

bcrypt, cost factor 12.

## 3. Authorization

### 3.1 Роли

| Роль | Права |
|------|-------|
| `user` | CRUD проектов, документов, анализов. Просмотр knowledge. Export |
| `admin` | Всё что user + журнал + импорт knowledge + управление пользователями |

### 3.2 Middleware

```python
async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    payload = decode_jwt(token)
    user = await db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(401)
    return user

def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user
```

## 4. Tenant Isolation

### 4.1 Три уровня защиты

1. **JWT:** каждый запрос содержит `tenant_id` в токене
2. **Application layer:** все queries фильтруются по `tenant_id` из JWT
3. **PostgreSQL RLS:** страховка от programming errors

### 4.2 RLS Setup

```sql
-- Каждая таблица с tenant_id
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lens_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Единая политика
CREATE POLICY tenant_isolation ON projects
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
-- Повторить для каждой таблицы

-- Gateway устанавливает контекст в каждой транзакции
SET LOCAL app.current_tenant_id = '{tenant_uuid}';
```

### 4.3 Cross-tenant проверка

Ни один endpoint не принимает `tenant_id` как параметр. Tenant определяется **только** из JWT.

## 5. Redaction

### 5.1 Когда

Перед отправкой parsed document в Codex thread.

### 5.2 Что редактируем

| Категория | Паттерн | Замена |
|-----------|---------|--------|
| ФИО физлиц | NER + regex | `[ФИО_УДАЛЕНО]` |
| ИНН физлиц | 12-значный ИНН | `[ИНН_УДАЛЕНО]` |
| Телефоны | `+7`/`8` + 10 цифр | `[ТЕЛЕФОН_УДАЛЕНО]` |
| Email | RFC 5322 | `[EMAIL_УДАЛЕНО]` |
| Паспортные данные | серия/номер | `[ПАСПОРТ_УДАЛЕНО]` |
| Банк. реквизиты физлиц | р/с 20 цифр | `[СЧЁТ_УДАЛЕНО]` |

### 5.3 Что НЕ редактируем

- Наименования юрлиц (ПАО «АПРИ», АО «МОДЦ»)
- ИНН юрлиц (публичные)
- Адреса объектов строительства
- Технические данные (объёмы, расценки)
- Нормативные ссылки

### 5.4 Redaction Log

Каждый redacted документ сохраняет log:
```json
{
  "redacted": true,
  "redaction_count": 3,
  "categories": ["phone", "email"],
  "timestamp": "2026-08-05T12:00:00Z"
}
```

## 6. Audit

### 6.1 Что логируем

| Событие | Данные |
|---------|--------|
| Login | user, IP, success/fail |
| Document upload | user, filename, doc_type |
| Document confirm | user, document_id |
| Analysis start | user, project, mode, command |
| Analysis complete | analysis_id, tokens, duration |
| Export download | user, analysis_id, format |
| Knowledge import | admin, version, record_count |

### 6.2 Retention

- Аудит-события: **1 год**
- Анализы и результаты: **бессрочно** (immutable)
- Документы: пока проект не удалён

## 7. API Security

### 7.1 CORS

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.stroyintellekt.ru"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=True,
)
```

### 7.2 Rate Limiting

| Endpoint | Limit |
|----------|-------|
| POST /auth/login | 10/мин per IP |
| POST /analyses | 10/час per tenant |
| POST /documents | 50/час per tenant |
| POST /knowledge/import | 5/день per tenant |

### 7.3 File Upload

- Max file size: **50 MB**
- Allowed types: xlsx, xml, docx, pdf
- Virus scan: ClamAV (если доступен)
- Storage: isolated by tenant_id

### 7.4 Secrets Management

| Секрет | Хранение |
|--------|----------|
| `OPENAI_API_KEY` | Environment variable |
| `DATABASE_URL` | Environment variable |
| `JWT_SECRET` | Environment variable (256-bit) |
| Пароли пользователей | bcrypt hash в PostgreSQL |
