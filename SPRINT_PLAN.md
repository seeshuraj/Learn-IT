# Learn-IT — Sprint Plan & Microservices Roadmap

> **Planning horizon:** ~15 weeks (8 sprints × ~2 weeks)  
> **Goal:** Ship all remaining product gaps **and** evolve the monolith into a distributed, load-ready microservices architecture.

---

## Strategy at a Glance

| Phase | Sprints | Theme |
|---|---|---|
| **Stabilise** | 0 | Fix production blockers (auth, captcha, logging) |
| **Modularise** | 1 | Break monolithic `server.ts` into domain modules |
| **Extract** | 2–4 | Pull out independent microservices one-by-one |
| **Harden** | 5–6 | Async queues, Redis, observability, load tests |
| **Close** | 7 | Ship remaining product & security gaps |

**Key principle:** Modular monolith first → then service extraction. Splitting before internal cleanup creates distributed chaos.

---

## Sprint 0 — Production Stabilisation (Week 1–2)

**Goal:** Zero open production fires before any new work starts.

### Tasks

| # | Task | Owner | Priority |
|---|---|---|---|
| S0-1 | Fix hCaptcha `sitekey-secret-mismatch` — ensure site key (Vercel env) and secret key (Supabase dashboard) come from the **same** hCaptcha site | Dev | 🔴 CRITICAL |
| S0-2 | Fix duplicate `GoTrueClient` — create single `src/lib/supabase.ts` singleton, import everywhere | Dev | 🔴 CRITICAL |
| S0-3 | Add structured request logging middleware (Morgan / Pino) to `server.ts` | Dev | 🟠 HIGH |
| S0-4 | Set up Sentry (or equivalent) error tracking on both client and server | Dev | 🟠 HIGH |
| S0-5 | Write a `RUNBOOK.md` — how to deploy, rollback, check logs on Render | Dev | 🟡 MEDIUM |
| S0-6 | Add health-check endpoint `GET /health` returning `{ status, uptime, version }` | Dev | 🟡 MEDIUM |

### Definition of Done
- [ ] Login works in production with no 400 errors
- [ ] No `Multiple GoTrueClient instances` warnings in browser console
- [ ] Sentry captures at least one test error end-to-end
- [ ] `/health` returns 200

---

## Sprint 1 — Modular Monolith (Week 3–4)

**Goal:** Refactor `server.ts` into clean domain modules without changing any external behaviour.

### New file structure

```
server/
├── index.ts              ← entry point (starts Express, registers routers)
├── middleware/
│   ├── auth.ts           ← JWT verification, role guards
│   ├── error.ts          ← global error handler
│   └── logger.ts         ← request logger
├── modules/
│   ├── auth/             ← login, register, password reset routes
│   ├── courses/          ← course CRUD, enrolment
│   ├── assignments/      ← assignment creation, submissions
│   ├── exams/            ← exam engine, results
│   ├── storage/          ← file upload/download (Supabase Storage)
│   ├── analytics/        ← snapshots, reporting
│   └── ai/               ← AI assistant, grading
├── jobs/
│   ├── analyticsSnapshot.ts
│   └── index.ts          ← cron registration
└── lib/
    ├── supabase.ts       ← single client instance
    ├── redis.ts          ← Redis client (prepared for Sprint 3)
    └── config.ts         ← env var validation with zod
```

### Tasks

| # | Task | Priority |
|---|---|---|
| S1-1 | Create `server/` directory structure above | 🔴 HIGH |
| S1-2 | Extract auth middleware to `middleware/auth.ts` | 🔴 HIGH |
| S1-3 | Move each domain into its `modules/` folder with an Express `Router` | 🔴 HIGH |
| S1-4 | Move cron jobs to `jobs/` | 🟠 MEDIUM |
| S1-5 | Add `zod` env validation in `lib/config.ts` — fail fast on startup if env vars missing | 🟠 MEDIUM |
| S1-6 | Update `build-server.mjs` to point at `server/index.ts` | 🟠 MEDIUM |
| S1-7 | All existing API tests pass (or write integration smoke tests if none exist) | 🟡 MEDIUM |

### Definition of Done
- [ ] `server.ts` deleted or reduced to 10 lines
- [ ] Each module is independently importable
- [ ] No regression in existing API behaviour

---

## Sprint 2 — API Gateway + Auth Service (Week 5–6)

**Goal:** Extract the first true microservice — authentication. Everything else still runs in the monolith.

### Architecture

```
Client
  │
  ▼
[API Gateway]  ← new: Express + http-proxy-middleware
  ├── /api/auth/*   → Auth Service  (port 3001)
  └── /api/*        → Core Monolith (port 3000)
```

### Tasks

| # | Task | Priority |
|---|---|---|
| S2-1 | Create `services/auth-service/` — standalone Express app with auth module from Sprint 1 | 🔴 HIGH |
| S2-2 | Create `services/gateway/` — thin proxy layer using `http-proxy-middleware` | 🔴 HIGH |
| S2-3 | Centralise JWT signing/verification inside auth-service only | 🔴 HIGH |
| S2-4 | Monolith routes verify tokens by calling auth-service `/verify` endpoint (or shared Redis cache) | 🟠 HIGH |
| S2-5 | Update `render.yaml` to deploy gateway + auth-service as separate Render services | 🟠 HIGH |
| S2-6 | Implement rate limiting on gateway (express-rate-limit or Upstash) | 🟡 MEDIUM |
| S2-7 | Document inter-service auth contract in `docs/auth-contract.md` | 🟡 MEDIUM |

### Definition of Done
- [ ] Auth service deployed and reachable independently
- [ ] Login/signup/password-reset all flow through gateway → auth-service
- [ ] Monolith routes remain protected via token verification

---

## Sprint 3 — Learning Core Services (Week 7–8)

**Goal:** Extract course and assignment domains — the highest-traffic API paths.

### Services extracted this sprint

| Service | Port | Handles |
|---|---|---|
| `course-service` | 3002 | Course CRUD, enrolment, progress tracking |
| `assignment-service` | 3003 | Assignments, submissions, grading |

### Tasks

| # | Task | Priority |
|---|---|---|
| S3-1 | Extract `modules/courses/` → `services/course-service/` | 🔴 HIGH |
| S3-2 | Extract `modules/assignments/` → `services/assignment-service/` | 🔴 HIGH |
| S3-3 | Add Redis (Upstash or self-hosted) — cache course lists, enrolment state | 🔴 HIGH |
| S3-4 | Register new services in gateway routing table | 🟠 HIGH |
| S3-5 | Add `services/shared/` package — shared types, auth middleware, error classes | 🟠 HIGH |
| S3-6 | Update `render.yaml` for new services | 🟠 MEDIUM |
| S3-7 | Load test course list endpoint — target 200 req/s with <200ms p95 | 🟡 MEDIUM |

### Definition of Done
- [ ] Course and assignment APIs run in isolated processes
- [ ] Redis caching live and measurably reducing DB load
- [ ] Load test passes at target

---

## Sprint 4 — Storage & Exam Services (Week 9–10)

**Goal:** Isolate the two I/O-heavy domains — file storage and exam engine.

### Services extracted this sprint

| Service | Port | Handles |
|---|---|---|
| `storage-service` | 3004 | File upload/download, Supabase Storage proxy, signed URLs |
| `exam-service` | 3005 | Exam sessions, timer management, result processing |

### Tasks

| # | Task | Priority |
|---|---|---|
| S4-1 | Extract `modules/storage/` → `services/storage-service/` | 🔴 HIGH |
| S4-2 | Extract `modules/exams/` → `services/exam-service/` | 🔴 HIGH |
| S4-3 | Stream large file uploads through storage-service (avoid buffering in gateway) | 🟠 HIGH |
| S4-4 | Store exam session state in Redis (TTL-based) | 🟠 HIGH |
| S4-5 | Add BullMQ worker for async result processing (submit → queue → grade) | 🟠 HIGH |
| S4-6 | Register in gateway | 🟠 MEDIUM |

### Definition of Done
- [ ] File uploads bypass the monolith entirely
- [ ] Exam sessions survive a service restart (Redis-backed)
- [ ] Grading is async and never blocks the HTTP response

---

## Sprint 5 — AI & Analytics Services (Week 11–12)

**Goal:** Isolate the two compute-heavy domains that can spike CPU/memory independently.

### Services extracted this sprint

| Service | Port | Handles |
|---|---|---|
| `ai-service` | 3006 | AI assistant, AI grading, recommendation engine |
| `analytics-service` | 3007 | Snapshot jobs, reporting queries, dashboards |

### Tasks

| # | Task | Priority |
|---|---|---|
| S5-1 | Extract `modules/ai/` → `services/ai-service/` | 🔴 HIGH |
| S5-2 | Extract `modules/analytics/` → `services/analytics-service/` | 🔴 HIGH |
| S5-3 | Move cron jobs to analytics-service (not gateway or monolith) | 🟠 HIGH |
| S5-4 | All AI calls go through BullMQ queue — never block an HTTP request | 🟠 HIGH |
| S5-5 | Add streaming SSE response for AI answers (progressive display) | 🟠 HIGH |
| S5-6 | Scale ai-service independently (more RAM/CPU on Render) | 🟡 MEDIUM |

### Definition of Done
- [ ] AI requests are queued and responses streamed
- [ ] Analytics snapshots run in analytics-service only
- [ ] AI and analytics can be scaled/restarted without affecting auth or courses

---

## Sprint 6 — Resilience & Observability (Week 13–14)

**Goal:** Make the distributed system production-grade — monitoring, circuit breakers, load tests.

### Tasks

| # | Task | Priority |
|---|---|---|
| S6-1 | Add OpenTelemetry tracing across all services (trace IDs propagated via headers) | 🔴 HIGH |
| S6-2 | Set up Grafana + Prometheus dashboards (or use Render/Upstash native metrics) | 🔴 HIGH |
| S6-3 | Implement circuit breaker on gateway for each downstream service (opossum) | 🟠 HIGH |
| S6-4 | Add retry logic with exponential backoff on inter-service HTTP calls | 🟠 HIGH |
| S6-5 | Full system load test — 500 concurrent users, measure p95 across all services | 🟠 HIGH |
| S6-6 | Set up alerts: error rate >1%, p95 >500ms, queue depth >1000 | 🟠 HIGH |
| S6-7 | Document runbook for each service (start, stop, scale, rollback) | 🟡 MEDIUM |
| S6-8 | Add distributed rate limiting via Redis (shared across all gateway instances) | 🟡 MEDIUM |

### Definition of Done
- [ ] Every request has a trace ID visible in logs
- [ ] Dashboard shows real-time RPS, error rate, queue depth per service
- [ ] Circuit breakers tested — one service down does not cascade
- [ ] Load test passes at 500 concurrent users

---

## Sprint 7 — Product & Security Closure (Week 15)

**Goal:** Ship all remaining product features and security gaps identified in the backlog.

### Tasks

| # | Task | Priority |
|---|---|---|
| S7-1 | Backend modularisation complete (cleanup any leftover monolith code) | 🔴 HIGH |
| S7-2 | Email notifications (enrollment confirmed, assignment due, grade released) | 🟠 HIGH |
| S7-3 | Payment integration (Stripe) for course purchases | 🟠 HIGH |
| S7-4 | Mobile-responsive UI audit — fix any layout regressions from new API structure | 🟠 HIGH |
| S7-5 | Row-Level Security (RLS) audit on all Supabase tables | 🟠 HIGH |
| S7-6 | Two-factor authentication (TOTP) for instructor/admin accounts | 🟡 MEDIUM |
| S7-7 | Real-time collaboration features (Supabase Realtime) | 🟡 MEDIUM |
| S7-8 | Accessibility audit (WCAG AA) on core student flows | 🟡 MEDIUM |
| S7-9 | Final security penetration test checklist | 🟡 MEDIUM |

### Definition of Done
- [ ] All 44 tracked features marked ✅ Done
- [ ] Security audit signed off
- [ ] App passes accessibility audit on core flows

---

## Target Service Topology

```
                     ┌─────────────────────┐
                     │    Client (React)    │
                     └────────┬────────────┘
                              │ HTTPS
                     ┌────────▼────────────┐
                     │    API Gateway       │  ← rate limiting, auth header forwarding
                     └──┬──┬──┬──┬──┬──┬──┘
                        │  │  │  │  │  │
          ┌─────────────┘  │  │  │  │  └──────────────┐
          │           ┌────┘  │  │  └────────┐         │
          ▼           ▼       ▼  ▼           ▼         ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  auth-   │ │ course-  │ │assignment│ │ storage- │ │  exam-   │
    │ service  │ │ service  │ │ service  │ │ service  │ │ service  │
    └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
          │           │           │                            │
          │      ┌────▼──┐   ┌───▼────┐                  ┌───▼────┐
          │      │  ai-  │   │analyt- │                  │ worker │
          │      │service│   │ics-svc │                  │(BullMQ)│
          │      └───────┘   └────────┘                  └────────┘
          │
   ┌──────▼──────────────────────────────────────────────────┐
   │              Shared Infrastructure                       │
   │  Supabase (Postgres + Auth + Storage)  Redis (Upstash)  │
   └──────────────────────────────────────────────────────────┘
```

---

## Tech Stack Decisions

| Concern | Choice | Rationale |
|---|---|---|
| **Service framework** | Express + TypeScript | Already in use, minimal migration |
| **Inter-service transport** | HTTP/REST (short term), consider gRPC later | Simple to debug, works with Render |
| **Queue / async** | BullMQ + Redis | Battle-tested, excellent TypeScript support |
| **Cache** | Upstash Redis | Serverless-friendly, free tier available |
| **Observability** | OpenTelemetry + Pino | Vendor-neutral traces, structured logs |
| **API Gateway** | Custom Express proxy | Lightweight; upgrade to Kong/Traefik if needed |
| **Deployment** | Render (existing) | One service per Render web service |
| **Secret management** | Render env groups | Shared secrets across services |

---

## Migration Guardrails

> Follow these rules to avoid common microservices mistakes.

1. **Never share a database directly between services.** Each service owns its data. Cross-service reads go through an API call, not a direct DB query.
2. **Shared code goes in `services/shared/`**, not copy-pasted. Types, error classes, auth middleware.
3. **Every service must have a `/health` endpoint** before it is registered in the gateway.
4. **No service goes to production without a circuit breaker** on the gateway route.
5. **Always add a trace ID header** (`X-Trace-Id`) at the gateway and log it in every downstream service.
6. **Do not extract a service until the module is clean** (Sprint 1 complete for that domain).

---

*Generated: 2026-06-06 | Author: Perplexity AI for seeshuraj/Learn-IT*
