---
title: "Deploy & Infrastructure"
date_created: 2026-08-05
type: spec
status: superseded
superseded_by: docs/architecture_v3.md
layer: infra
scope: deploy-infra
project: stroyintellekt
source: docs/architecture_optimal2.md §10
---

# 09. Deploy & Infrastructure

## 1. Назначение

Docker Compose на VPS в РФ. 6 сервисов. Минимум для production.

## 2. Архитектура деплоя

```
Internet → Caddy (TLS, reverse proxy) → Frontend (static)
                                       → Gateway (API)
                                       → Gateway /stream (SSE)
           Gateway → Codex App-Server (localhost:3000)
           Gateway → PostgreSQL (localhost:5432)
```

## 3. Docker Compose

```yaml
# infra/compose/compose.prod.yaml
version: "3.9"

services:
  # --- Reverse Proxy ---
  proxy:
    image: caddy:2-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - frontend
      - gateway
    restart: unless-stopped

  # --- Frontend ---
  frontend:
    build:
      context: ../../frontend
      dockerfile: Dockerfile
    # Caddy serves static files from built frontend
    restart: unless-stopped

  # --- Gateway API ---
  gateway:
    build:
      context: ../../backend
      dockerfile: Dockerfile
    command: >
      uvicorn app.main:app
      --host 0.0.0.0
      --port 8000
      --workers 2
      --timeout-keep-alive 120
    environment:
      DATABASE_URL: postgresql+asyncpg://si:${DB_PASSWORD}@postgres:5432/stroyintellekt
      CODEX_APP_SERVER_URL: http://codex:3000
      JWT_SECRET: ${JWT_SECRET}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    volumes:
      - ../../agents:/app/agents:ro
      - documents_data:/data/documents
    depends_on:
      postgres:
        condition: service_healthy
      codex:
        condition: service_started
    deploy:
      replicas: 2
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # --- Codex App-Server ---
  codex:
    image: node:22-slim
    command: npx @openai/codex app-server --port 3000
    environment:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    volumes:
      - ../../agents:/workspace/agents:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # --- PostgreSQL ---
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: stroyintellekt
      POSTGRES_USER: si
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U si -d stroyintellekt"]
      interval: 10s
      timeout: 5s
      retries: 5

  # --- Backup ---
  backup:
    image: postgres:16-alpine
    command: /scripts/backup.sh
    environment:
      PGHOST: postgres
      PGUSER: si
      PGPASSWORD: ${DB_PASSWORD}
      PGDATABASE: stroyintellekt
    volumes:
      - ./scripts/backup.sh:/scripts/backup.sh:ro
      - backup_data:/backups
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
  caddy_data:
  caddy_config:
  documents_data:
  backup_data:
```

## 4. Caddy Config

```caddyfile
# infra/compose/Caddyfile

app.stroyintellekt.ru {
    # Frontend (static)
    handle / {
        reverse_proxy frontend:80
    }
    handle /assets/* {
        reverse_proxy frontend:80
    }
    
    # API
    handle /api/* {
        reverse_proxy gateway:8000
    }
    
    # SSE (long-lived connections)
    handle /api/analyses/*/stream {
        reverse_proxy gateway:8000 {
            flush_interval -1
            transport http {
                read_timeout 600s
            }
        }
    }
    
    # Health
    handle /health {
        reverse_proxy gateway:8000
    }
    
    # TLS automatic via Let's Encrypt
    tls {
        email admin@7rl.ru
    }
}
```

## 5. Dockerfiles

### 5.1 Backend

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App
COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini .

# Non-root user
RUN useradd -m appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 5.2 Frontend

```dockerfile
# frontend/Dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

## 6. Environment Variables

```bash
# infra/compose/.env.example

# Database
DB_PASSWORD=generate-strong-password

# Auth
JWT_SECRET=generate-256-bit-secret

# LLM
OPENAI_API_KEY=sk-...

# Optional
ANTHROPIC_API_KEY=
YANDEX_API_KEY=
```

## 7. Backup Strategy

```bash
#!/bin/bash
# infra/compose/scripts/backup.sh

BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M)

# Daily dump
pg_dump -Fc -f "$BACKUP_DIR/stroyintellekt_$DATE.dump"

# Cleanup: keep 30 days
find "$BACKUP_DIR" -name "*.dump" -mtime +30 -delete

echo "Backup completed: stroyintellekt_$DATE.dump"
```

**Schedule:** daily at 03:00 MSK via cron in backup container.

## 8. Monitoring

### 8.1 Health Checks

| Service | Endpoint | Interval |
|---------|----------|----------|
| Gateway | `GET /health` | 30s |
| Codex | `GET /health` | 30s |
| PostgreSQL | `pg_isready` | 10s |

### 8.2 Gateway /health Response

```json
{
  "status": "ok",
  "version": "0.1.0",
  "services": {
    "database": "ok",
    "codex": "ok"
  },
  "uptime_seconds": 86400
}
```

### 8.3 Logs

Structured JSON logging:

```python
import structlog
logger = structlog.get_logger()

# Example
logger.info("analysis_started",
    analysis_id=str(analysis.id),
    tenant_id=str(tenant.id),
    mode=analysis.mode,
)
```

All logs → stdout → `docker logs` → optional: Loki/Grafana (post-MVP).

## 9. Minimum VPS Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disk | 100 GB SSD | 200 GB SSD |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| Location | РФ (Москва/СПб) | РФ |
| Network | 100 Mbps | 1 Gbps |

## 10. Deploy Commands

```bash
# First deploy
git clone ...
cd infra/compose
cp .env.example .env
# Edit .env with production values

docker compose -f compose.prod.yaml up -d

# Run migrations
docker compose -f compose.prod.yaml exec gateway alembic upgrade head

# Check status
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs -f gateway

# Update
git pull
docker compose -f compose.prod.yaml build
docker compose -f compose.prod.yaml up -d --force-recreate
```
