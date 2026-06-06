# Learn-IT — Microservices Architecture Reference

This document is the living technical reference for the Learn-IT distributed architecture. Update it as services are extracted and the system evolves.

---

## Service Inventory

| Service | Directory | Port (local) | Responsibility |
|---|---|---|---|
| API Gateway | `services/gateway/` | 3000 | Routing, rate limiting, auth-header forwarding |
| Auth Service | `services/auth-service/` | 3001 | Login, register, JWT issue/verify, password reset |
| Course Service | `services/course-service/` | 3002 | Course CRUD, enrolment, progress |
| Assignment Service | `services/assignment-service/` | 3003 | Assignments, submissions, sync grading |
| Storage Service | `services/storage-service/` | 3004 | File upload/download, signed URL generation |
| Exam Service | `services/exam-service/` | 3005 | Exam sessions (Redis-backed), result dispatch |
| AI Service | `services/ai-service/` | 3006 | AI assistant, AI grading (async via queue) |
| Analytics Service | `services/analytics-service/` | 3007 | Snapshots, reporting, cron jobs |
| Worker | `services/worker/` | — | BullMQ consumer — grading, AI jobs, emails |

---

## Shared Infrastructure

### Supabase
- **Postgres** — primary datastore for all services
- **Auth** — JWT generation (auth-service is a thin wrapper; Supabase Auth is the source of truth)
- **Storage** — binary file storage (proxied through storage-service)
- **Realtime** — used by course-service and exam-service for live updates

### Redis (Upstash recommended)
- Session/exam state with TTL
- BullMQ job queues (AI grading, email, analytics)
- Distributed rate limiting (shared across gateway instances)
- Course list cache (TTL 60s)

---

## Inter-Service Communication

### Synchronous (HTTP)
Used for: real-time user-facing requests where a response is needed immediately.

```
Gateway → Auth Service        /api/auth/*
Gateway → Course Service      /api/courses/*
Gateway → Assignment Service  /api/assignments/*
Gateway → Storage Service     /api/storage/*
Gateway → Exam Service        /api/exams/*
```

All service-to-service HTTP calls must:
- Forward `X-Trace-Id` header
- Include a 5-second timeout
- Retry once on 503 with 500ms backoff

### Asynchronous (BullMQ)
Used for: workloads that are too slow or compute-intensive to block an HTTP response.

| Queue | Producer | Consumer | Job |
|---|---|---|---|
| `grading` | Assignment Service | Worker | Auto-grade submission |
| `ai-jobs` | AI Service | Worker | LLM inference, AI grading |
| `emails` | Any service | Worker | Send transactional email |
| `analytics` | Analytics Service | Worker | Run heavy reporting queries |

---

## Request Lifecycle (Example: Submit Assignment)

```
1. Client POST /api/assignments/123/submit
2. Gateway verifies JWT (calls auth-service /verify or Redis cache)
3. Gateway proxies to assignment-service
4. assignment-service saves submission to Postgres
5. assignment-service enqueues job on `grading` queue
6. assignment-service returns 202 Accepted to gateway → client
7. Worker picks up grading job
8. Worker calls ai-service if AI grading enabled
9. Worker writes grade to Postgres
10. Worker enqueues email notification on `emails` queue
11. Worker sends email
12. Client polls GET /api/assignments/123/result or receives Realtime update
```

---

## Observability

### Logging (Pino)
Every service uses structured JSON logging with these mandatory fields:

```json
{
  "level": "info",
  "time": "2026-06-06T12:00:00.000Z",
  "traceId": "abc-123-def",
  "service": "course-service",
  "method": "GET",
  "path": "/courses",
  "statusCode": 200,
  "durationMs": 45
}
```

### Tracing (OpenTelemetry)
- Gateway stamps every request with `X-Trace-Id` (UUID v4)
- All downstream services read and forward this header
- Trace ID logged in every log line
- Export to Jaeger / Grafana Tempo

### Metrics
- Each service exposes `GET /metrics` (Prometheus format)
- Key metrics per service: `http_request_duration_ms`, `http_requests_total`, `queue_depth`, `error_rate`

### Alerts (configure in Render / UptimeRobot / Grafana)
- Error rate > 1% on any service → PagerDuty / Slack
- p95 response time > 500ms → warning
- Queue depth > 1000 on any queue → critical
- Health check fails → immediate alert

---

## Resilience Patterns

### Circuit Breaker (gateway)
Using `opossum`:

```typescript
import CircuitBreaker from 'opossum';

const courseBreaker = new CircuitBreaker(proxyCourseService, {
  timeout: 5000,         // 5s per request
  errorThresholdPercentage: 50,  // open after 50% errors
  resetTimeout: 10000,   // try again after 10s
});

courseBreaker.fallback(() => ({ error: 'Course service temporarily unavailable' }));
```

### Retry (inter-service calls)

```typescript
async function callWithRetry(url: string, options: RequestInit, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    if (res.ok || i === retries) return res;
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
}
```

### Health Checks
Every service **must** implement:

```typescript
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: process.env.SERVICE_NAME,
    version: process.env.npm_package_version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
```

---

## Local Development

### Run all services

```bash
# Install dependencies in each service
npm run install:all

# Start all services (uses concurrently)
npm run dev:services

# Or start individually
cd services/auth-service && npm run dev
cd services/course-service && npm run dev
# etc.
```

### Environment variables

Each service reads from its own `.env`. Shared vars (Supabase URL, Redis URL, JWT secret) are in `services/shared/.env.shared` and symlinked.

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
REDIS_URL=
JWT_SECRET=
SERVICE_NAME=auth-service
PORT=3001
```

---

## Deployment (Render)

Each service is a separate Render **Web Service**.

```yaml
# render.yaml (excerpt)
services:
  - type: web
    name: learnit-gateway
    buildCommand: npm run build:gateway
    startCommand: node services/gateway/dist/index.js
    envVars:
      - fromGroup: learnit-shared

  - type: web
    name: learnit-auth
    buildCommand: npm run build:auth
    startCommand: node services/auth-service/dist/index.js
    envVars:
      - fromGroup: learnit-shared

  - type: worker
    name: learnit-worker
    buildCommand: npm run build:worker
    startCommand: node services/worker/dist/index.js
    envVars:
      - fromGroup: learnit-shared
```

---

## Migration Guardrails

1. **Database ownership** — no direct cross-service DB queries. Service A calls Service B's API.
2. **Shared code** → `services/shared/` (types, error classes, auth middleware, logger config).
3. **Health check required** before any service is registered in the gateway.
4. **Circuit breaker required** on every gateway route before production.
5. **Trace ID header** (`X-Trace-Id`) forwarded by gateway, logged by all services.
6. **Module must be clean** before extraction — complete Sprint 1 for that domain first.
7. **No secrets in code** — all secrets via Render env groups.

---

*Generated: 2026-06-06 | Author: Perplexity AI for seeshuraj/Learn-IT*
