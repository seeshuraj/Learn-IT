# Required Changes for Learn-IT

Last reviewed: 2026-05-13  
Status: Phase 1 — Foundation Hardening

---

## Table of Contents

1. [Critical Blockers](#1-critical-blockers)
2. [Storage and File Security](#2-storage-and-file-security)
3. [Schema and Migration Discipline](#3-schema-and-migration-discipline)
4. [Backend Changes](#4-backend-changes)
5. [Auth Changes](#5-auth-changes)
6. [Query and Performance Fixes](#6-query-and-performance-fixes)
7. [Product-Architecture Alignment](#7-product-architecture-alignment)
8. [Immediate Next Actions](#8-immediate-next-actions)

---

## 1. Critical Blockers

### 1.1 🔴 Enable RLS on all exposed public tables

**Severity: CRITICAL — must be resolved before any production traffic**

The live Supabase project currently has RLS **disabled** on all 11 public tables:

| Table | RLS Enabled | Risk |
|---|---|---|
| public.users | ❌ No | Any anon key holder can read/modify all users |
| public.courses | ❌ No | Fully exposed |
| public.enrollments | ❌ No | Fully exposed |
| public.modules | ❌ No | Fully exposed |
| public.materials | ❌ No | Fully exposed |
| public.assignments | ❌ No | Fully exposed |
| public.submissions | ❌ No | Student work exposed to all |
| public.submission_files | ❌ No | File references exposed |
| public.notes | ❌ No | Course content exposed |
| public.note_chunks | ❌ No | 65 embedded chunks exposed |
| public.settings | ❌ No | Platform config exposed |

**⚠️ Important — do not enable RLS without policies in place first.**  
Enabling RLS with no policies will block all access and break the app.  
Policies must be written and reviewed before enabling RLS on each table.

**Remediation SQL (run only after policies are ready):**

```sql
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
```

Reference: https://supabase.com/docs/guides/database/postgres/row-level-security

---

### 1.2 Add explicit policies per role per table

We need policies covering four actors: `student`, `instructor`, `admin`, and the `backend service role`.

Minimum required policy groups per table:

- **users** — own row SELECT/UPDATE only; admin full access
- **courses** — enrolled students SELECT; instructor SELECT/UPDATE for own courses; admin full
- **enrollments** — student sees own enrollments; instructor sees enrollments for own modules; admin full
- **modules** — enrolled students SELECT; instructor SELECT/INSERT/UPDATE for own modules; admin full
- **materials** — enrolled students SELECT; instructor manages own; admin full
- **assignments** — enrolled students SELECT; instructor manages for own modules; admin full
- **submissions** — student SELECT/INSERT own; instructor SELECT for relevant module; admin full
- **submission_files** — same scoping as submissions
- **notes** — enrolled students SELECT; instructor manages own; admin full
- **note_chunks** — enrolled students SELECT (scoped through notes); backend service role full
- **settings** — admin only; no direct anon/authenticated access

All policies must:
- Use `TO authenticated` to prevent anon evaluation overhead
- Wrap `auth.uid()` as `(select auth.uid())` for per-statement caching
- Use `IN` or set-based subqueries instead of joins on source tables
- Be delivered through numbered migration files, not the dashboard

---

### 1.3 Move authorization to server + database

Authorization must not rely on frontend logic or ad hoc route checks alone.

Required:
- [ ] Server-side Supabase session validation on every protected API route
- [ ] Role resolved from database on the server, not from client-supplied claims
- [ ] RLS enforced at the database layer as backstop
- [ ] No route that returns sensitive data without an authenticated session check

---

## 2. Storage and File Security

### 2.1 Replace Cloudinary with Supabase Storage for protected content

The current migration history includes `add_cloudinary_url_columns`, meaning file delivery relies on Cloudinary URLs stored in the database. This is not appropriate for protected academic content (notes, submissions).

Problems:
- Cloudinary public URLs are guessable or directly accessible
- No authorization check happens at delivery time
- Notes and submissions are student/instructor intellectual property and must be private by default

Required:
- [ ] Create private Supabase Storage buckets: `notes`, `submissions`, `materials`
- [ ] Store only path/key references in the database, not public delivery URLs
- [ ] Generate signed URLs server-side only after verifying access rights
- [ ] Or proxy file delivery through a backend endpoint that checks access before streaming

### 2.2 Separate metadata from delivery logic

- File metadata (name, size, type, uploaded_at, uploader_id) stays in the database
- File bytes live in private storage
- No route returns file bytes without an access check preceding it
- Signed URLs must be short-lived (e.g. 60 seconds) for download flows

---

## 3. Schema and Migration Discipline

### 3.1 All schema changes must go through migration files only

No manual Supabase dashboard edits in staging or production.

Current migration history:

| Version | Name |
|---|---|
| 20260510172005 | initial_schema_and_seed |
| 20260510182455 | drop_student_id_fk_on_notes_and_submissions |
| 20260510184530 | 003_notes_nullable_student_id |
| 20260510223938 | add_cloudinary_url_columns |

The naming is inconsistent (`003_` prefix only on the third migration). Standardise all future migrations as `YYYYMMDDHHMMSS_descriptive_name`.

### 3.2 Required next migrations

In order:

- [ ] `..._add_roles_and_user_roles_tables` — role model for student/instructor/admin
- [ ] `..._enable_rls_and_add_policies` — RLS + policies per table
- [ ] `..._add_policy_column_indexes` — index all policy columns
- [ ] `..._replace_cloudinary_with_storage_paths` — migrate file ref columns
- [ ] `..._add_audit_logs_table` — audit trail for privileged actions
- [ ] `..._add_processing_jobs_table` — async job tracking
- [ ] `..._add_analytics_snapshots_table` — derived performance materialisations
- [ ] `..._add_student_roadmaps_table` — roadmap storage

### 3.3 Missing access-model entities (to confirm/add)

- [ ] `roles` table — student, instructor, admin definitions
- [ ] `user_roles` table — user ↔ role mapping (with optional scope: institution/module)
- [ ] `audit_logs` table — actor, action, target, timestamp, metadata
- [ ] `processing_jobs` table — note/submission/report/roadmap async job state
- [ ] `analytics_snapshots` table — precomputed per-student per-module stats
- [ ] `student_roadmaps` table — versioned roadmap snapshots
- [ ] `roadmap_progress` table — per-item completion tracking

---

## 4. Backend Changes

### 4.1 Break up monolithic server.ts

The current `server.ts` is ~50 KB and mixes routing, business logic, auth, AI, and storage concerns. This must be refactored.

Target structure:

```
src/server/
  index.ts              — entry point, mounts middleware + routes
  middleware/
    auth.ts             — session validation, role extraction
    validate.ts         — Zod request validation wrapper
    logger.ts           — request ID injection, structured logging
    rateLimit.ts        — per-route rate limiters
  routes/
    auth.ts
    modules.ts
    notes.ts
    assignments.ts
    submissions.ts
    analytics.ts
    reports.ts
    roadmaps.ts
    admin.ts
    health.ts
  services/
    auth.service.ts
    notes.service.ts
    storage.service.ts
    ai.service.ts
    analytics.service.ts
    roadmap.service.ts
  jobs/
    noteProcessor.ts
    assessmentAnalyser.ts
    reportGenerator.ts
    roadmapGenerator.ts
  lib/
    supabase.ts         — server-side Supabase client (service role, never exposed)
    openai.ts           — LLM client wrapper
    queue.ts            — job queue client
    env.ts              — Zod-validated env config
```

### 4.2 Add Zod validation on all inputs

- [ ] Every route handler validates params, query, and body with a Zod schema
- [ ] Environment config validated with Zod at boot — app must not start with missing/invalid env
- [ ] File uploads validated: type allowlist, max size, virus scan if required

### 4.3 Add health and readiness endpoints

```
GET /api/health   — liveness: returns 200 if process is alive
GET /api/ready    — readiness: checks DB, storage, queue connectivity
```

Response shape:

```json
{
  "status": "ok | degraded | down",
  "checks": {
    "database": "ok | error",
    "storage": "ok | error",
    "queue": "ok | error"
  },
  "timestamp": "ISO8601"
}
```

### 4.4 Add structured JSON logging

Every log entry must include:
- `requestId` — UUID generated per request
- `method`, `path`, `statusCode`, `durationMs`
- `userId` (if authenticated)
- `error` object with `code` + `message` (no stack traces in production logs)
- No secrets, tokens, passwords, or PII

Log levels: `debug` (local only), `info`, `warn`, `error`

---

## 5. Auth Changes

### 5.1 Server-side Supabase Auth validation

Required changes:
- [ ] All API routes that access user data must call `supabase.auth.getUser()` server-side
- [ ] Role resolved from `user_roles` table, not from JWT user metadata
- [ ] Service role key must only exist in server environment — never in browser
- [ ] No route trusts a role or user_id from the request body/query — always resolved from session

### 5.2 Abuse protection

- [ ] Rate limit: 10 login attempts per IP per 15 minutes
- [ ] Rate limit: 30 AI chat messages per student per hour
- [ ] Rate limit: 20 file uploads per user per day
- [ ] Rate limit: 5 report/roadmap generations per user per hour
- [ ] CAPTCHA on sign-up and password reset flows (hCaptcha or Cloudflare Turnstile)
- [ ] Secure cron endpoints with `Authorization: Bearer $CRON_SECRET` header check

---

## 6. Query and Performance Fixes

### 6.1 Index policy columns

Add B-tree indexes for all columns used in RLS policies and hot query filters:

```sql
CREATE INDEX ON public.users (id);
CREATE INDEX ON public.enrollments (user_id, module_id);
CREATE INDEX ON public.notes (module_id);
CREATE INDEX ON public.note_chunks (note_id);
CREATE INDEX ON public.submissions (user_id);
CREATE INDEX ON public.submissions (assignment_id);
CREATE INDEX ON public.submission_files (submission_id);
CREATE INDEX ON public.assignments (module_id);
CREATE INDEX ON public.materials (module_id);
CREATE INDEX ON public.audit_logs (user_id, created_at DESC);
CREATE INDEX ON public.analytics_snapshots (user_id, created_at DESC);
```

### 6.2 Always filter queries explicitly

Do not rely on RLS alone for query scoping. All queries from backend and client must include natural equality filters (e.g. `.eq('user_id', userId)`) to allow Postgres to build efficient query plans.

### 6.3 Prepare for analytics read separation

- Derived aggregates must be written to `analytics_snapshots` by background jobs
- Dashboard reads should query snapshots, not raw tables
- Heavy report generation queries must run on a read replica (Supabase Pro+) once scale justifies

---

## 7. Product-Architecture Alignment

### 7.1 README is the architecture contract

The `README.md` now defines the full production architecture. All implementation must align to it.  
No new feature should bypass:
- Auth and authorization requirements
- Storage security requirements
- Migration discipline
- Observability requirements
- Queued async pattern for heavy AI/report work

### 7.2 Phase 1 execution order

| Step | Task | Depends on |
|---|---|---|
| 1 | Audit server.ts: map all routes, auth checks, storage calls | — |
| 2 | Design role model: roles, user_roles, access matrix | Step 1 |
| 3 | Write policy migration SQL for all 11 tables | Step 2 |
| 4 | Enable RLS + apply policies via migration | Step 3 |
| 5 | Migrate file delivery to Supabase Storage + signed URLs | Step 3 |
| 6 | Add Zod validation + request ID middleware | — |
| 7 | Add health endpoints | — |
| 8 | Refactor server.ts into service modules | Steps 1–7 |
| 9 | Add structured logging | Step 8 |
| 10 | Environment audit: verify no secrets leak between envs | — |

---

## 8. Immediate Next Actions

### Code audit required (read these files next)

- [ ] `package.json` — runtime, scripts, dependencies
- [ ] `.env.example` — env contract, check for missing/leaked vars
- [ ] `vercel.json` — routing, caching, env separation
- [ ] `render.yaml` — backend service config
- [ ] `server.ts` — route map, auth checks, storage calls, AI calls
- [ ] `src/` — auth context, storage access, API client patterns
- [ ] `migrations/` — full SQL content of each migration

### Artefacts to produce after audit

- [ ] Table-by-table access matrix (who can do what)
- [ ] Full policy migration SQL for all 11 tables
- [ ] Backend refactor plan with file-by-file breakdown
- [ ] Storage migration plan (Cloudinary → Supabase Storage)
- [ ] `.env.example` update with required vars documented
- [ ] Deployment environment contract document

---

*This file is a living document. Update it as changes are implemented and verified.*  
*Do not close a section as done until the corresponding migration or code change is merged and tested.*
