---
title: "Frontend"
date_created: 2026-08-05
type: spec
status: superseded
superseded_by: docs/architecture_v3.md
layer: frontend
scope: frontend-ui
project: stroyintellekt
source: docs/architecture_optimal2.md §7
---

# 07. Frontend

## 1. Назначение

Минималистичный React SPA: 5 экранов, dark theme, live lens progress через SSE, export. Фокус на workflow, не на дашбордах.

## 2. Стек

| Технология | Назначение |
|-----------|-----------|
| React 18+ | SPA |
| TypeScript | Типизация |
| Vite | Сборка |
| React Router v6 | Маршрутизация |
| CSS Modules | Стили (без TailwindCSS) |
| Inter (Google Fonts) | Типографика |
| EventSource | SSE streaming |

## 3. Дизайн-система

### 3.1 Цвета

```css
:root {
  /* Background */
  --bg-primary: #0F1923;
  --bg-secondary: #16283C;
  --bg-card: #1C3247;
  --bg-hover: #234058;
  
  /* Text */
  --text-primary: #E8ECF0;
  --text-secondary: #8FA4B8;
  --text-muted: #5A7A94;
  
  /* Accent */
  --accent-primary: #E53935;   /* СИ красный */
  --accent-gradient: linear-gradient(135deg, #E53935, #FF6B35);
  
  /* Status */
  --status-green: #4CAF50;     /* 🟢 проходит */
  --status-yellow: #FFC107;    /* 🟡 с условиями */
  --status-red: #E53935;       /* 🔴 не брать */
  
  /* Markers */
  --marker-fact: #4CAF50;      /* ✅ ФАКТ */
  --marker-assumption: #FFC107; /* ⚠ ПРЕДПОЛОЖЕНИЕ */
  --marker-unknown: #E53935;    /* ❌ НЕИЗВЕСТНОЕ */
  
  /* Lens progress */
  --lens-active: #2196F3;
  --lens-completed: #4CAF50;
  --lens-pending: #5A7A94;
}
```

### 3.2 Типографика

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--bg-primary);
}

h1 { font-size: 24px; font-weight: 600; }
h2 { font-size: 20px; font-weight: 600; }
h3 { font-size: 16px; font-weight: 500; }

.mono { font-family: 'JetBrains Mono', monospace; }
```

### 3.3 Компоненты

| Компонент | Описание |
|-----------|----------|
| `Card` | Карточка с glassmorphism эффектом |
| `Badge` | Статус-бейдж (✅/⚠/❌, 🟢/🟡/🔴) |
| `LensProgress` | Прогресс по линзам (live) |
| `LensOutput` | Блок вывода линзы |
| `SourceMarker` | Маркер источника с tooltip |
| `DropZone` | Зона загрузки файлов |
| `ExportButton` | Кнопка выгрузки (Excel/Word) |
| `ModeSelector` | Переключатель режимов |
| `CommandSelector` | Выбор команды (/оценка, /смета, ...) |

## 4. Пять экранов

### 4.1 Реестр объектов (`/projects`)

Список карточек проектов с фильтрами.

```
┌─────────────────────────────────────────────────────────┐
│  СтройИнтеллект                              👤 user   │
│─────────────────────────────────────────────────────────│
│  Мои объекты                        [+ Новый объект]   │
│                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ Зауралье    │ │ Школа №19   │ │ ОСК ЙошОла  │       │
│  │ Чел. обл.   │ │ Чел. обл.   │ │ Йошкар-Ола  │       │
│  │ 🟢 05.08    │ │ 🟡 04.08    │ │ 🔴 01.08    │       │
│  │ 2 проверки  │ │ 1 проверка  │ │ 3 проверки  │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Карточка объекта (`/projects/:id`)

Паспорт + документы + история проверок.

```
┌─────────────────────────────────────────────────────────┐
│  ← Зауралье, корпус 3                                  │
│─────────────────────────────────────────────────────────│
│  Челябинская обл. │ МКД бизнес │ 214-ФЗ │ ПФ: Сбер    │
│  25 эт. │ 18 500 м²                                    │
│                                                         │
│  📎 Документы                                [+Загрузить]│
│  ┌────────────────────────────────────────────────────┐ │
│  │ ЛСР_корпус3.xlsx     │ Смета │ ✅ подтв. │ 05.08 │ │
│  │ КП_генподрядчик.xlsx  │ КП    │ ✅ подтв. │ 04.08 │ │
│  │ Договор.docx          │ Дог.  │ ⏳ не подтв.      │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  📊 Проверки                          [Новая проверка]  │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 05.08 │ /оценка │ стандарт │ 🟢 │ 142с │ [↗]     │ │
│  │ 04.08 │ /смета  │ экспресс │ 🟡 │ 48с  │ [↗]     │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 4.3 Загрузка и разбор (`/projects/:id/upload`)

Drag & drop + parsed preview + convergence check + confirm.

Детали — см. `architecture_optimal2.md` §7.2 экран 3.

### 4.4 Рабочий экран (`/analyses/:id`)

Главный экран. Два блока: **lens progress** (слева/сверху) + **live output** (справа/снизу).

```
┌─────────────────────────────────────────────────────────┐
│  ← Зауралье │ /оценка стандарт                         │
│─────────────────────────────────────────────────────────│
│                                                         │
│  ┌─ Линзы ──────────┐  ┌─ Вывод ──────────────────┐   │
│  │ 📋 Паспорт   ✅   │  │ ЛЮДМИЛА (Сметчик):       │   │
│  │ 🔧 ГИП       ✅   │  │                          │   │
│  │ 📊 Смета     🔄   │  │ Позиция 14 «Монолит»:   │   │
│  │ 🏪 Снаб      ⏳   │  │ Подрядчик: 18 500 ₽/м³  │   │
│  │ 🔨 Подряд    ⏳   │  │ Опорная:   15 200 ₽/м³  │   │
│  │ 💰 Эконом    ⏳   │  │ ✅ ФАКТ                  │   │
│  │ 📋 ПТО       ⏳   │  │                          │   │
│  │ ⚖️ Договор   ⏳   │  │ Δ: +3 300 ₽/м³ (+21.7%) │   │
│  │ 🎯 Синтез    ⏳   │  │ ⚠ На объём: +2.64 млн ₽ │   │
│  └──────────────────┘  └──────────────────────────┘   │
│                                                         │
│  [📊 Excel]  [📝 Word]  [📋 Реестр]                    │
└─────────────────────────────────────────────────────────┘
```

**SSE Integration:**

```typescript
// frontend/src/services/sse.ts

export function connectAnalysisStream(
  analysisId: string,
  handlers: {
    onLensActive: (lens: string, step: number) => void;
    onLensOutput: (lens: string, content: string, markers: string[]) => void;
    onToolCall: (tool: string) => void;
    onVerdict: (verdict: string, data: VerdictData) => void;
    onCompleted: () => void;
    onError: (error: string) => void;
  }
) {
  const source = new EventSource(`/api/analyses/${analysisId}/stream`);
  
  source.addEventListener("lens_active", (e) => {
    const data = JSON.parse(e.data);
    handlers.onLensActive(data.lens, data.step);
  });
  
  source.addEventListener("lens_output", (e) => {
    const data = JSON.parse(e.data);
    handlers.onLensOutput(data.lens, data.content, data.markers);
  });
  
  source.addEventListener("verdict", (e) => {
    const data = JSON.parse(e.data);
    handlers.onVerdict(data.verdict, data);
  });
  
  source.addEventListener("analysis_completed", () => {
    handlers.onCompleted();
    source.close();
  });
  
  source.onerror = () => handlers.onError("Connection lost");
  
  return () => source.close();
}
```

### 4.5 Журнал (`/journal`, admin only)

Таблица аудит-событий с фильтрами по дате, пользователю, действию.

## 5. Responsive

| Breakpoint | Поведение |
|-----------|-----------|
| ≥1200px | Двухколоночный layout на рабочем экране |
| 768–1199px | Одноколоночный, tabs для переключения линзы/вывод |
| <768px | Мобильный, только просмотр результатов (не запуск) |

## 6. Routing

```typescript
// frontend/src/App.tsx

<Routes>
  <Route path="/login" element={<Login />} />
  <Route element={<ProtectedLayout />}>
    <Route path="/" element={<Navigate to="/projects" />} />
    <Route path="/projects" element={<ProjectList />} />
    <Route path="/projects/:id" element={<ProjectCard />} />
    <Route path="/projects/:id/upload" element={<DocumentUpload />} />
    <Route path="/analyses/:id" element={<Workspace />} />
    <Route path="/journal" element={<Journal />} />  {/* admin only */}
  </Route>
</Routes>
```
