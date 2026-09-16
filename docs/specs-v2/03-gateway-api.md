---
title: "Gateway API"
date_created: 2026-08-05
type: spec
status: superseded
superseded_by: docs/architecture_v3.md
layer: backend
scope: gateway-api
project: stroyintellekt
source: docs/architecture_optimal2.md §2-4
---

# 03. Gateway API

## 1. Назначение

Gateway — тонкий слой между Frontend и Codex. Он:
- Управляет проектами, документами, знаниями (CRUD, PostgreSQL)
- Маршрутизирует анализ: tenant → prompt → thread
- Проксирует Codex streaming → SSE для Frontend
- Парсит линзы и маркеры из streaming
- Генерирует Excel/Word отчёты
- Обеспечивает auth и tenant isolation

Gateway **не дублирует** Codex. Он не управляет agent loop, не хранит thread state.

## 2. Стек

| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Python | 3.12+ | Runtime |
| FastAPI | 0.115+ | HTTP framework |
| Pydantic | v2 | Validation, schemas |
| SQLAlchemy | 2.0+ | ORM |
| Alembic | 1.13+ | Migrations |
| uvicorn | 0.30+ | ASGI server |
| openpyxl | 3.1+ | Excel parsing + generation |
| python-docx | 1.1+ | Word generation |
| lxml | 5.0+ | XML parsing |
| pdfplumber | 0.11+ | PDF extraction |

## 3. REST API

### 3.1 Auth

```
POST /auth/login        → JWT token
POST /auth/refresh       → New JWT
GET  /auth/me            → Current user
```

### 3.2 Projects

```
GET    /projects                        → List projects (tenant-scoped)
POST   /projects                        → Create project
GET    /projects/{id}                   → Get project with passport
PATCH  /projects/{id}                   → Update project
DELETE /projects/{id}                   → Soft-delete
```

**Request (POST /projects):**
```json
{
  "name": "ЖК Зауралье, корпус 3",
  "region": "Челябинская область",
  "product_type": "5.2",
  "passport": {
    "address": "г. Челябинск, ул. Кирова",
    "floors": 25,
    "total_sqm": 18500,
    "contract_type": "214-ФЗ",
    "pf_bank": "Сбербанк"
  }
}
```

### 3.3 Documents

```
POST   /projects/{id}/documents         → Upload + parse
GET    /projects/{id}/documents         → List documents
GET    /documents/{id}                  → Get parsed document
POST   /documents/{id}/confirm          → Confirm parsed data
DELETE /documents/{id}                  → Remove document
```

**Upload flow:**
1. Frontend отправляет файл (multipart/form-data)
2. Gateway: sha256 → deduplicate → save to storage
3. Gateway: detect mime → call parser (xlsx/xml/docx/pdf)
4. Gateway: redaction pass → remove ПД
5. Gateway: return parsed_data preview
6. Frontend: user confirms → `POST /documents/{id}/confirm`

**Response (parsed preview):**
```json
{
  "id": "uuid",
  "filename": "ЛСР_корпус3.xlsx",
  "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "sha256": "abc123...",
  "parsed_data": {
    "type": "estimate",
    "sections": [
      {"number": "01", "name": "Земляные работы", "total": "2250000.00"},
      {"number": "02", "name": "Фундаменты", "total": "4800000.00"}
    ],
    "grand_total": "48350000.00",
    "convergence": {
      "sections_sum": "48350000.00",
      "document_total": "48350000.00",
      "delta": "0.00",
      "status": "ok"
    }
  },
  "confirmed": false
}
```

### 3.4 Analyses

```
POST   /projects/{id}/analyses          → Start analysis
GET    /projects/{id}/analyses          → List analyses
GET    /analyses/{id}                   → Get analysis with results
GET    /analyses/{id}/stream            → SSE stream (live progress)
POST   /analyses/{id}/cancel            → Cancel running analysis
```

**Request (POST /projects/{id}/analyses):**
```json
{
  "command": "оценка",
  "mode": "standard",
  "description": "МКД бизнес-класса, 25 этажей, монолит, 18500 м²"
}
```

**SSE Stream Events:**
```
event: analysis_started
data: {"analysis_id": "uuid", "mode": "standard", "command": "оценка"}

event: lens_active
data: {"lens": "denchik", "step": 1, "label": "ГИП: объёмы и физика"}

event: lens_output
data: {"lens": "denchik", "content": "Объём монолита по осям: 4200 м³...", "markers": ["fact"]}

event: tool_call
data: {"tool": "calc_convergence", "status": "executing"}

event: tool_result
data: {"tool": "calc_convergence", "summary": "Δ = 0₽, сходимость ✅"}

event: lens_completed
data: {"lens": "denchik", "status": "completed", "findings_count": 3}

event: lens_active
data: {"lens": "lyudmila", "step": 2, "label": "Смета: сходимость и конъюнктура"}

... (линзы последовательно)

event: verdict
data: {"verdict": "🟡", "margin": "12.4%", "top_risks": [...], "top_levers": [...]}

event: analysis_completed
data: {"analysis_id": "uuid", "duration_seconds": 142, "tokens_used": 28500}
```

### 3.5 Knowledge

```
POST   /knowledge/import                → Import Excel опорная база
GET    /knowledge/search                → Search knowledge base
GET    /knowledge/sheets                → List available sheets
```

### 3.6 Exports

```
GET    /analyses/{id}/export/excel      → Download Excel report
GET    /analyses/{id}/export/word       → Download Word report
GET    /analyses/{id}/export/registry   → Download deviation registry
```

### 3.7 Journal (Admin)

```
GET    /journal                         → Audit events (admin only)
GET    /journal/stats                   → Usage statistics
```

## 4. Orchestrator

```python
# backend/app/services/orchestrator.py

class AnalysisOrchestrator:
    """Один анализ = один Codex thread."""

    def __init__(self, codex: CodexClient, db: AsyncSession):
        self.codex = codex
        self.db = db

    async def run_analysis(
        self,
        analysis: Analysis,
        project: Project,
        documents: list[Document],
        knowledge_base: KnowledgeBase,
    ) -> AsyncIterator[SSEEvent]:
        
        tenant = await self.db.get(Tenant, project.tenant_id)
        
        # 1. Load tenant prompt
        system_prompt = load_tenant_prompt(tenant.system_prompt_path)
        
        # 2. Build context
        context = build_context(documents, knowledge_base, analysis.mode)
        
        # 3. Create Codex thread
        thread_id = await self.codex.create_thread(
            system_prompt=system_prompt,
            tools=get_all_tools(),
            files=context.files,
        )
        analysis.codex_thread_id = thread_id
        await self.db.commit()
        
        # 4. Build user message
        user_message = f"/{analysis.command} {analysis.mode} — {project.name}. {analysis.description}"
        
        # 5. Run and stream
        async for event in self.codex.run_streamed(thread_id, user_message):
            
            # Handle tool calls
            if event.type == "tool_call":
                result = await execute_tool(event.name, event.args)
                await self.codex.send_tool_result(thread_id, event.call_id, result)
                yield SSEEvent("tool_result", {"tool": event.name, "summary": str(result)})
                continue
            
            # Parse lens outputs
            if event.type == "text_delta":
                lens = detect_lens(event.content)
                markers = extract_markers(event.content)
                
                # Save to DB
                await save_lens_output(analysis.id, lens, event.content, markers)
                
                yield SSEEvent("lens_output", {
                    "lens": lens,
                    "content": event.content,
                    "markers": markers,
                })
            
            # Handle completion
            if event.type == "turn_completed":
                await finalize_analysis(analysis, event.final_response)
                yield SSEEvent("analysis_completed", {"analysis_id": str(analysis.id)})
```

## 5. SSE Broadcast

```python
# backend/app/sse.py

from sse_starlette.sse import EventSourceResponse

@router.get("/analyses/{analysis_id}/stream")
async def stream_analysis(
    analysis_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
):
    analysis = await get_analysis(analysis_id, user.tenant_id)
    
    if analysis.state == "completed":
        # Return cached result as single event
        return EventSourceResponse(
            cached_result_generator(analysis)
        )
    
    if analysis.state != "running":
        raise HTTPException(404, "Analysis not running")
    
    return EventSourceResponse(
        orchestrator.run_analysis(analysis, ...),
        media_type="text/event-stream",
    )
```

## 6. Error Responses

| HTTP Code | Когда | Body |
|-----------|-------|------|
| 400 | Невалидные параметры | `{"detail": "Invalid mode: xxx"}` |
| 401 | Нет/невалидный JWT | `{"detail": "Not authenticated"}` |
| 403 | Чужой tenant | `{"detail": "Forbidden"}` |
| 404 | Объект не найден | `{"detail": "Project not found"}` |
| 409 | Анализ уже запущен | `{"detail": "Analysis already running"}` |
| 422 | Документы не подтверждены | `{"detail": "Documents must be confirmed"}` |
| 500 | Internal | `{"detail": "Internal server error"}` |
| 503 | Codex недоступен | `{"detail": "Agent engine unavailable"}` |

## 7. Rate Limits

| Endpoint | Limit | Per |
|----------|-------|-----|
| POST /analyses | 10 | час / tenant |
| POST /documents | 50 | час / tenant |
| GET /analyses/stream | 20 connections | tenant |
| POST /knowledge/import | 5 | день / tenant |
