---
title: "Индекс спецификаций и продуктовый scope"
date_created: 2026-08-05
type: spec
status: superseded
layer: product
scope: index-product-scope
project: stroyintellekt
source: docs/architecture_optimal2.md
supersedes: [docs/specs/00-product-scope-and-source-policy.md]
superseded_by: docs/architecture_v3.md
owner: govard
---

# Индекс спецификаций и продуктовый scope

## 1. Назначение

Этот документ — корневой индекс спецификаций MVP «СтройИнтеллект» по архитектуре `docs/architecture_optimal2.md` (Codex App-Server, one-agent per tenant).

Спецификации в папке `docs/specs-v2/` **замещают** `docs/specs/` и отражают упрощённую архитектуру: один агент per tenant, один Codex thread per analysis, 9 линз внутри одного промпта.

## 2. Архитектурные принципы

| # | Принцип | Обоснование |
|---|---------|-------------|
| P-1 | **Один агент per tenant** | Reference-system доказал: один промпт (627–712 строк) с 9 линзами справляется. Multi-agent — опциональный режим |
| P-2 | **Портирование, не переписывание** | .txt → .md, 100% логики сохраняется. Не «улучшаем» формулировки |
| P-3 | **Codex = агентный движок** | Не пишем agent loop, threads, streaming. Готовый продукт |
| P-4 | **Gateway = тонкий слой** | CRUD + tenant routing + SSE proxy. Не дублирует Codex |
| P-5 | **Calc Engine = Codex Tools** | Детерминированные расчёты на Decimal, агент вызывает через tool_call |
| P-6 | **PostgreSQL-only** | Данные + очередь + RLS. Без Redis/Kafka/Celery |
| P-7 | **Lens-parser, не structured output** | Агент уже маркирует линзы — парсим regex |
| P-8 | **Минималистичный frontend** | 5 экранов, dark theme, live lens progress |

## 3. Три слоя архитектуры

```
Frontend (React SPA)  →  REST + SSE  →  Gateway (FastAPI)  →  JSON-RPC / SDK  →  Codex App-Server
```

| Слой | Что делает | Чего НЕ делает |
|------|-----------|----------------|
| **Frontend** | 5 экранов, SSE streaming, lens progress, export | Прямые вызовы Codex, бизнес-логика |
| **Gateway** | Auth, CRUD, tenant → prompt, context assembly, SSE proxy, lens parsing, export | Agent loop, thread persistence, model routing |
| **Codex** | Thread execution, tool calls, streaming, model selection | Хранение данных, auth, export |

## 4. Продуктовый scope MVP

### 4.1 Что входит

- **Tenants:** АПРИ (pilot), МОДЦ, Унихим — каждый со своим промптом и опорной базой
- **Роли:** пользователь, администратор (2 роли per tenant)
- **Объекты:** создание, карточка, паспорт
- **Документы:** загрузка xlsx/xml/docx/pdf, парсинг, сверка сходимости, подтверждение
- **Анализ:** 1 thread per analysis, 3 режима (экспресс/стандарт/эксперт), ~20 команд (/оценка, /смета, /финмодель, /тендер…)
- **Линзы:** live-progress по 9 линзам (ГИП, Смета, Снаб, Подряд, Эконом, ПТО, Договор, РП, Админ)
- **Calc Engine:** ~10 детерминированных расчётов (сходимость, ₽/м², финмодель, ГУ vs БГ…)
- **Knowledge:** импорт опорной базы (13 листов), search tool
- **Export:** Excel, Word, реестр отклонений
- **Журнал:** аудит операций (admin)
- **Deploy:** Docker Compose, VPS в РФ

### 4.2 Что НЕ входит

- Multi-agent DAG orchestration (опциональный, в `agents/multi_agent/`)
- OCR PDF-сканов
- Построчный контроль КС-2/КС-3 с проектной документацией (зона Napoleon IT)
- Визуальный контроль стройплощадки
- 1С, BIM и другие внешние интеграции
- Портфельный режим
- Права по объектам (сверх 2 ролей)
- Автоматические управленческие/юридические решения
- RAG (ready-архитектурно, но не в MVP scope)

### 4.3 Ограничения

Система **не**:
- заменяет проектную документацию, экспертизу, юриста, главбуха
- изменяет марку/класс материала
- публикует число без источника
- отправляет необработанный документ внешнему provider
- меняет исторический результат после обновления данных

## 5. Карта спецификаций

| # | Файл | Область | Ключевые компоненты |
|---|------|---------|---------------------|
| 00 | `00-index-and-product-scope.md` | Индекс, scope, принципы | Этот документ |
| 01 | `01-agent-and-prompts.md` | Агенты и промпты | Tenant model, портирование .txt→.md, 9 линз, режимы, команды |
| 02 | `02-codex-integration.md` | Codex App-Server | Threads, tools registration, streaming protocol, model config |
| 03 | `03-gateway-api.md` | Gateway (FastAPI) | REST API, orchestrator, SSE broadcast, routes |
| 04 | `04-calc-engine.md` | Calc Engine | 10 формул, Decimal, Codex Tool schema, unit tests |
| 05 | `05-knowledge-and-documents.md` | Knowledge & Documents | Опорная база import, document parsers, search tool |
| 06 | `06-data-model.md` | Data Model & Storage | PostgreSQL schema, 8 таблиц, RLS, migrations |
| 07 | `07-frontend.md` | Frontend | 5 экранов, SSE, lens progress, design system |
| 08 | `08-security-and-tenancy.md` | Security & Tenancy | Auth, JWT, RLS, redaction, audit |
| 09 | `09-deploy-and-infra.md` | Deploy & Infra | Docker Compose, Caddy, backup, monitoring |

## 6. Иерархия источников

| Приоритет | Источник | Роль |
|---:|---|---|
| 1 | `03.08.26_ТЗ_СтройИнтеллект_Приложение№1_к_КП_АПРИ.docx` | Договорный MVP, критерии приёмки |
| 2 | Явное решение владельца продукта | Разрешение неоднозначности |
| 3 | `docs/architecture_optimal2.md` | **Архитектурный baseline** (one-agent, Codex) |
| 4 | `reference-system/apri/*.txt` + `reference-system/*.skill` | Рабочая legacy-система, regression baseline |
| 5 | `docs/specs-v2/*.md` | Детальные спецификации компонентов |
| 6 | `reference-system/artifacts/`, `*.html` | UX reference, терминология |

## 7. Запрещённые решения

1. Переписывание логики промптов при портировании
2. Разбивка одного промпта на 9 отдельных файлов
3. Redis, Kafka, Celery
4. Kubernetes для одного VPS
5. Arithmetic через LLM
6. Цифра без источника
7. Raw documents к LLM без redaction
8. Hardcoded промпты/ставки в коде
9. DAG orchestration для одного thread
10. Отправка одного документа в 9 отдельных threads
