# LearnIT

AI learning platform for students, instructors, and academic institutions.

LearnIT is not a notes viewer with a chatbot attached. It is a full academic intelligence system that combines course content, note retrieval, assessment analysis, personalized study roadmaps, and operational reporting into one platform. The product must be built and maintained as a secure, scalable, production system for real users, real coursework, and sustained concurrent usage.

---

## Table of Contents

1. [Product Definition](#1-product-definition)
2. [User Roles](#2-user-roles)
3. [Product Pillars](#3-product-pillars)
4. [Feature Scope](#4-feature-scope)
5. [Production Architecture](#5-production-architecture)
6. [Domain Model](#6-domain-model)
7. [Security Model](#7-security-model)
8. [Scalability Requirements](#8-scalability-requirements)
9. [Reliability Requirements](#9-reliability-requirements)
10. [Observability Requirements](#10-observability-requirements)
11. [API Design Requirements](#11-api-design-requirements)
12. [AI System Requirements](#12-ai-system-requirements)
13. [Frontend Requirements](#13-frontend-requirements)
14. [Background Job Architecture](#14-background-job-architecture)
15. [Data Governance and Privacy](#15-data-governance-and-privacy)
16. [Development Workflow](#16-development-workflow)
17. [Deployment Requirements](#17-deployment-requirements)
18. [Database Requirements](#18-database-requirements)
19. [Testing Requirements](#19-testing-requirements)
20. [Acceptance Criteria](#20-acceptance-criteria)
21. [Build Roadmap](#21-build-roadmap)
22. [Immediate Implementation Rules](#22-immediate-implementation-rules)

---

## 1. Product Definition

### 1.1 Mission

Help students study with structure, precision, and continuous feedback by combining:
- course notes
- AI-assisted note exploration
- assessment analytics
- weakness detection
- personalized academic roadmaps

### 1.2 Core Promise

Each student should be able to:
- open notes
- chat with the AI in parallel using note-aware context
- see where they are weak
- understand why they are weak
- receive an actionable roadmap
- improve consistently before assessments

### 1.3 Product Position

This is a production SaaS-style educational platform, not a prototype. It must support many users, many institutions or cohorts, multiple modules per student, repeated note uploads, frequent AI queries, instructor workflows, and concurrent dashboard/report generation.

### 1.4 Non-Goals

The following are out of scope unless explicitly re-approved:
- generic social features
- unstructured forum/community features
- unrelated gamification
- broad LMS replacement
- AI features with no measurable academic outcome
- any feature that bypasses the core loop of study → assess → analyze → improve

---

## 2. User Roles

### 2.1 Student

Can:
- view enrolled modules
- open notes
- query AI over notes
- upload/submit assessments where applicable
- see analytics and reports
- receive personalized roadmaps
- track roadmap completion
- review past performance trends

### 2.2 Instructor

Can:
- create/manage modules
- upload notes
- create assignments/assessments
- review student submissions
- view class-wide analytics
- identify common weak areas
- review AI-generated summaries with human oversight

### 2.3 Admin

Can:
- manage users and institutions
- manage role assignments
- audit content and system activity
- manage platform-wide settings
- review incidents and operational metrics

### 2.4 System / AI Worker

Responsible for:
- chunking notes
- generating embeddings
- retrieval for chatbot
- generating assessment analyses
- generating student roadmaps
- running scheduled jobs
- producing derived analytics materializations

---

## 3. Product Pillars

### 3.1 Notes Intelligence

Students must be able to:
- access notes securely
- view notes and chat side-by-side
- ask module-specific and note-specific questions
- receive grounded answers only from available content when requested

### 3.2 Assessment Intelligence

The system must:
- analyze submissions
- identify strengths, weaknesses, missed concepts, and recurring issues
- generate performance summaries
- detect risk trends over time
- expose this through dashboards and downloadable reports

### 3.3 Personalized Roadmap Engine

The system must combine:
- notes metadata
- assessment history
- AI feedback
- weak-topic recurrence
- submission punctuality
- upcoming deadlines
- exam windows

to produce a structured study plan that is realistic, time-bounded, and trackable.

### 3.4 Instructor Visibility

Instructors need:
- cohort-level weak topic distributions
- late-submission patterns
- performance trends
- intervention candidates
- explainable AI summaries, not black-box outputs

### 3.5 Reliability and Trust

The platform must be:
- secure
- auditable
- observable
- resilient to failures
- transparent about AI limitations

---

## 4. Feature Scope

### 4.1 Current / Known Foundation

Existing or partially existing capabilities:
- note upload and chunking
- note embeddings / RAG foundations
- submission storage
- grading-related data
- AI chat endpoint
- analytics endpoint(s)
- dashboard-oriented summary generation

These existing capabilities should be refactored toward the production architecture below rather than extended ad hoc.

### 4.2 Required Product Features

#### A. Authentication and Authorization
- Secure login and session management
- Role-based access: student, instructor, admin
- Institution/cohort isolation if multi-tenant
- No direct access to unauthorized notes, submissions, reports, or dashboards
- Full audit trail for privileged actions

#### B. Notes Management
- Upload notes in PDF, DOCX, TXT initially
- Extract text reliably
- Store source file metadata
- Generate chunks and embeddings asynchronously
- Track processing status: uploaded → queued → processed → failed
- Support note versioning where practical
- Support soft delete and retention policies

#### C. Note Viewer + AI Copilot
- Split-screen note viewer and chatbot
- Chat scoped by module, note, optionally topic/selection
- Citations/snippets in AI responses where supported
- Follow-up question support
- Conversation memory scoped to session and resource access rights
- Clear "I don't know" / insufficient evidence behavior

#### D. Assessments and Submissions
- Assignment creation and scheduling
- Submission uploads
- Submission state tracking
- Grade entry / AI-assisted evaluation where allowed
- AI-generated strengths, weaknesses, feedback, and next steps
- Late submission tracking
- Reattempt support if product rules allow

#### E. Analytics Dashboard

Student dashboard must show:
- average performance
- recent assessments
- on-time vs late behavior
- weak areas / strong areas
- module-by-module progress
- trend over time
- AI summary of current standing

Instructor dashboard must show:
- class averages
- weak-topic distributions
- at-risk students
- submission compliance
- module-level performance heatmaps

#### F. Personalized Roadmap
- AI-generated weekly plan
- Goal breakdown by module/topic
- Resource references to notes and prior mistakes
- Daily or weekly tasks
- Progress tracking
- Regeneration after new assessment events
- Optional exam-mode strategy view

#### G. Reports
- Student performance report
- Instructor class insight report
- Dashboard-friendly summaries
- Exportable PDF/report generation
- Snapshot storage to preserve historical analysis

#### H. Notifications
- Note processing completed
- Upcoming deadlines
- Missed assignment reminders
- Roadmap refresh available
- Critical intervention signals for instructors/admins

#### I. Operational Features
- Admin dashboard
- Audit logs
- Background job visibility
- Failed task retries
- Health status page / internal health endpoints

---

## 5. Production Architecture

### 5.1 Recommended Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Vite (current), migrate to Next.js if SSR/auth complexity grows |
| Backend | Node.js + TypeScript, Express (short-term), modular service architecture long-term |
| Validation | Zod |
| Database | PostgreSQL via Supabase, pgvector for embeddings |
| Auth | Supabase Auth (server-side) |
| Storage | Supabase Storage with RLS-backed private access |
| AI/Retrieval | Embedding pipeline + RAG over note chunks, versioned prompt templates |
| Background Jobs | Queue-based workers (BullMQ / Supabase Edge Functions / dedicated worker process) |
| Deployment | Vercel (frontend + edge), Render or dedicated host for long-running backend |
| Observability | Structured JSON logs, correlation IDs, Supabase log drains, Vercel runtime logs |

### 5.2 High-Level System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Web App (React/TS)                   │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────────────┐
│              API Gateway / Backend (Node + Express/TS)      │
│  auth middleware → route handlers → service layer          │
└──┬──────────┬────────────┬──────────────┬───────────────────┘
   │          │            │              │
   ▼          ▼            ▼              ▼
Supabase   Supabase    AI/LLM         Job Queue
Postgres   Storage     Provider       + Workers
(Primary)  (Private)   (OpenAI/etc)   (Async tasks)
   │
   ▼
Read Replica
(Analytics reads)
```

### 5.3 Core Data Flow

1. Instructor uploads note
2. File stored securely in private storage bucket
3. Processing job extracts text
4. Chunking + embedding jobs run asynchronously
5. Chunks stored in database/vector store
6. Student opens note → access checked via RLS
7. Student asks question in side-by-side chat
8. Retrieval fetches authorized chunks only
9. LLM answers using only allowed context
10. Student completes assessment
11. Assessment analysis job updates derived metrics
12. Report + roadmap generation jobs run
13. Dashboard surfaces updated insights

### 5.4 Environment Topology

| Environment | Purpose |
|---|---|
| `local` | Developer machine, local Supabase instance |
| `development` | Shared dev branch, connected to dev Supabase project |
| `preview` | Per-PR Vercel preview deployment, isolated preview DB |
| `production` | Live, hardened, backed up, monitored |

---

## 6. Domain Model

### 6.1 Core Entities

```
users
roles
institutions
courses / modules
enrollments
notes
note_versions
note_chunks
assignments
submissions
grades
ai_assessment_feedback
analytics_snapshots
student_roadmaps
roadmap_progress
notifications
audit_logs
processing_jobs
```

### 6.2 Key Relationships

- One instructor manages many modules
- One student enrolls in many modules
- One module has many notes
- One note has many chunks
- One module has many assignments
- One student has many submissions
- One student has many roadmap snapshots over time

### 6.3 Data Design Principles

- Prefer append-only / audit-friendly derived records over destructive overwrites
- Store generated AI artifacts separately from raw facts
- Preserve source-of-truth facts independently from summaries
- All schema changes must go through versioned migrations — no manual dashboard edits in production
- Do not mix operational state with analytics aggregates without clear ownership

---

## 7. Security Model

### 7.1 Mandatory Security Requirements

- Every exposed table must have RLS enabled with explicit policies per operation (SELECT, INSERT, UPDATE, DELETE)
- Service role keys must **never** be exposed to the browser — backend/server-side only
- Privileged operations must run server-side only
- Secrets must come from environment config, never source code
- Principle of least privilege applies across API, DB, storage, and admin operations
- All auth session validation must happen server-side before data access

### 7.2 Multi-Tenant Readiness

Even if v1 serves one institution, design for tenant isolation:
- `institution_id` on major entities
- Role scoping by institution
- No cross-tenant analytics leakage
- No shared storage paths without explicit access rules

### 7.3 File Access Security

- Notes and submissions are private by default
- File URLs must not be guessable public links for protected content
- Use signed URLs or backend-proxied delivery
- Access authorization must happen before file delivery — never after

### 7.4 Input and Abuse Protection

- Validate all inputs with Zod on the server
- Rate limit: login, AI chat, uploads, report generation
- Enforce file size/type constraints
- Prevent prompt injection from being treated as system instructions
- Sanitize all rendered content
- CAPTCHA on auth flows to prevent bot abuse

---

## 8. Scalability Requirements

### 8.1 Baseline Assumption

The product must handle:
- simultaneous note viewing and AI chat across many students
- multiple instructors uploading large note sets
- high read volume on dashboards
- batch analytics/report generation after submission deadlines
- traffic spikes before exam periods

### 8.2 Performance Design Rules

- Never perform AI/report generation synchronously if it can be queued
- Keep user-facing endpoints fast and deterministic (target < 300ms for data reads)
- Use pagination for all list endpoints — no unbounded queries
- Cache derived read models where TTL is acceptable
- Add indexes on hot paths and all RLS policy columns
- Write paths stay on primary DB; heavy analytical reads go to read replica

### 8.3 Database Scaling

- Connection pooling required (Supavisor)
- Eliminate N+1 query patterns
- Precompute expensive dashboard aggregates where justified
- Partition or archive very large event/audit/job tables if necessary
- Add read replicas when production analytics volume justifies (Supabase Pro/Team plan)

### 8.4 Horizontal Scaling Targets

- Multiple stateless API instances
- Independent job workers
- Separate frontend and backend deploys
- Separate read and write data paths
- Independent scaling of AI-heavy components

---

## 9. Reliability Requirements

### 9.1 Availability Goals

| Surface | Target |
|---|---|
| App availability | ≥ 99.5% |
| API success rate | ≥ 99% |
| Note processing success | ≥ 98% |
| AI generation success | ≥ 95% (degraded gracefully) |

### 9.2 Failure Handling

- Every external call (AI, storage, DB) must have timeout + retry policy
- Retries must be idempotent
- Failed jobs must be visible and retryable from admin tooling
- Partial failures must not corrupt core data
- AI generation failures degrade gracefully (show cached result or "unavailable" — never crash)

### 9.3 Backup and Recovery

- Daily backups mandatory on all production environments (Supabase Pro+)
- PITR (Point-in-Time Recovery) enabled in production — worst-case RPO ~2 minutes
- Recovery procedure documented and tested quarterly
- Storage backup/retention strategy documented separately (DB backups do not restore deleted storage objects)
- Backup restoration drill: documented runbook + tested before go-live

### 9.4 Disaster Recovery

| Metric | Target |
|---|---|
| RPO | ≤ 5 minutes (with PITR enabled) |
| RTO | ≤ 2 hours |
| Secret rotation | Documented process, tested annually |
| Incident ownership | Named on-call owner defined before launch |

---

## 10. Observability Requirements

### 10.1 Logging

- Structured JSON logs everywhere
- Correlation/request IDs on every request
- Separate: application, database, worker, AI provider logs
- No sensitive data (tokens, secrets, PII) in logs

### 10.2 Metrics to Track

| Category | Metrics |
|---|---|
| API | Request latency p50/p95/p99, error rate, 5xx rate |
| AI | LLM latency, failure rate, token usage, queue depth |
| Jobs | Job success/failure/retry rate, processing time, DLQ depth |
| DB | Pool saturation, slow queries, replica lag |
| Storage | Delivery failures, upload success rate |
| Auth | Login failure rate, anomalous session patterns |

### 10.3 Alerting

Alert on:
- API error rate > 1% over 5 min
- Worker backlog > 50 items
- Failed roadmap/report jobs
- Replica lag > 30 seconds
- Auth anomaly spikes
- Storage delivery failures
- AI provider degraded availability

### 10.4 Auditability

- All admin/role changes logged with actor + timestamp
- Content deletion logged
- AI-generated artifacts timestamped, versioned, and attributable to source events

---

## 11. API Design Requirements

### 11.1 Principles

- Consistent response envelope: `{ data, error, meta }`
- Typed validation (Zod) on all request bodies and params
- Actionable error shapes: `{ code, message, field? }`
- Authorization enforced inside handlers, not just in UI
- Pagination required for all list endpoints: `{ data[], page, total, hasMore }`

### 11.2 API Domain Map

```
/api/auth          → login, logout, session, refresh
/api/me            → current user profile + roles
/api/modules       → CRUD, enrollment
/api/notes         → upload, list, get, delete, processing status
/api/notes/:id/content → secure file delivery (backend-proxied)
/api/ai/chat       → note-aware, scoped, rate-limited
/api/assignments   → CRUD
/api/submissions   → upload, status, grade
/api/analytics     → student + instructor analytics
/api/reports       → generation, download
/api/roadmaps      → generate, get, progress
/api/notifications → list, mark read
/api/admin         → user management, audit logs, job status
/api/health        → liveness + readiness probes
```

### 11.3 Chat Endpoint Rules

- Must accept: `{ module_id, note_id, student_id, message, history[] }`
- Enforce access control before any retrieval
- Log retrieval source metadata (which chunks, which note)
- Support conversation history with bounded token budgeting
- Must not use unauthorized notes or other students' data
- Hard rate limit per student per hour

---

## 12. AI System Requirements

### 12.1 AI Principles

- Grounded over flashy — cite source content where possible
- Explainable over opaque — instructors must understand why AI said X
- Safe fallback over hallucinated confidence — "I don't have enough context" is correct
- Deterministic schema-based output for reports and roadmaps (JSON with defined shape)

### 12.2 Note-Aware Chat

- Retrieval must be access-aware (only chunks the student can access)
- Answers should reference retrieved note content with snippet attribution
- Separate "study assistant" mode (grounded to notes) from "general tutor" mode
- Prompt template versioned in code, model version stored with each artifact

### 12.3 Assessment Analysis Output Shape

```json
{
  "strengths": ["..."],
  "weaknesses": ["..."],
  "recurring_errors": ["..."],
  "recommendations": ["..."],
  "risk_level": "low | medium | high",
  "generated_at": "ISO8601",
  "model": "gpt-4o",
  "prompt_version": "v2"
}
```

### 12.4 Roadmap Generation Inputs

- Module/course performance history
- Assessment trends and scores
- Repeated weak topics
- Note availability by topic
- Deadline proximity
- Completion history
- Time available per day (optional student input)

Output must be structured JSON, renderable by UI, stored for audit/history. Regeneration must not silently overwrite previous roadmap — create new snapshot.

### 12.5 AI Cost Controls

- Token budgets enforced per request type
- Max chat turns per student per interval
- Cached summaries where TTL is acceptable
- Heavy generation always queued, never synchronous
- Tiered models: cheap/fast for suggestions, powerful for deep analysis

---

## 13. Frontend Requirements

### 13.1 UX Principles

- Fast, clear, no clutter
- Data-dense but understandable
- Accessible: keyboard navigation, ARIA, sufficient color contrast
- Mobile-aware layout for student use cases

### 13.2 Core Student Surfaces

| Surface | Key Requirements |
|---|---|
| Dashboard | Performance overview, roadmap status, upcoming deadlines |
| Module page | Notes list, assignment list, progress summary |
| Note viewer | Split-screen with chat, note content rendered clearly |
| Assessments page | Submission history, AI feedback per submission |
| Reports page | Generated report with export option |
| Roadmap page | Weekly plan, daily tasks, progress tracking |

### 13.3 Core Instructor Surfaces

| Surface | Key Requirements |
|---|---|
| Module management | Create/edit module, upload notes, view processing status |
| Assignment management | Create/schedule/grade assignments |
| Cohort analytics | Class performance, weak topic distribution, at-risk list |
| Student detail | Drill into individual student performance |

### 13.4 UI State Rules

- Every async surface: loading, empty, success, error states — all required
- Every generated artifact: timestamp + freshness metadata visible
- Every destructive action: confirmation modal + logged

---

## 14. Background Job Architecture

### 14.1 Jobs That Must Be Asynchronous

| Job | Trigger |
|---|---|
| Text extraction | Note upload |
| Chunk generation | Text extraction complete |
| Embedding generation | Chunk generation complete |
| Assessment analysis | Submission graded |
| Report generation | User request or scheduled |
| Roadmap generation | Assessment event or user request |
| Weak-topic aggregation | Nightly scheduled |
| Deadline notifications | Daily scheduled |
| Stale roadmap refresh | Weekly scheduled |
| Storage cleanup | Scheduled |

### 14.2 Job Requirements

- Durable queue with persistence
- Retries with exponential backoff
- Dead-letter queue for permanently failed jobs
- Idempotency keys to prevent double-processing
- Job status visible in admin dashboard

### 14.3 Scheduled Job Security

All cron-triggered endpoints must verify `Authorization: Bearer $CRON_SECRET` before executing. Never expose cron endpoints without this check.

---

## 15. Data Governance and Privacy

### 15.1 Sensitive Data Categories

- Educational performance data (grades, scores, feedback)
- Note contents (intellectual property)
- Submission content
- User identifiers and contact info

### 15.2 Rules

- Collect minimum necessary data
- Define retention windows: logs (90 days), analytics snapshots (2 years), submissions (per institutional policy)
- Support export/deletion requests where required by law
- Keep AI provider data handling explicit — document what is sent to external LLM APIs
- Never log raw secrets, tokens, or PII
- Student performance data accessible only by: that student, their instructors, and admins

### 15.3 Report Integrity

All reports must clearly distinguish:
- Raw facts (grades, timestamps, submission counts)
- AI-generated interpretations (risk commentary, recommendations)

Both must be timestamped and traceable to source events.

---

## 16. Development Workflow

### 16.1 Branch Strategy

```
main          → production (protected, requires PR + review)
feature/*     → individual feature branches → preview deployments
fix/*         → bug fixes
migrations/*  → schema-only changes requiring extra review
```

### 16.2 PR Requirements

Before merge to main:
- [ ] TypeScript compiles with no errors
- [ ] Lint passes
- [ ] Tests pass (unit + integration)
- [ ] Migration reviewed if schema changed
- [ ] Preview deployment validated
- [ ] Security review if auth/storage/access logic changed
- [ ] README updated if architecture or feature scope changed

### 16.3 Migration Rules

- All schema changes through numbered migration files only
- No manual Supabase dashboard edits in staging or production
- Seed data separate from production migrations
- Migrations must be backward-compatible where possible
- Test migration up + down before merging

### 16.4 Release Process

1. Merge PR to main
2. Run migrations against production DB
3. Deploy application
4. Run smoke tests against production
5. Monitor error rate + latency for 15 min
6. Roll back immediately if thresholds breached

---

## 17. Deployment Requirements

### 17.1 Current Deployment

- Frontend + API: Vercel (`vercel.json` present)
- Backend: Render (`render.yaml` present)
- DB: Supabase
- File storage: to be migrated to Supabase Storage (replacing current fragile approach)

### 17.2 Vercel Configuration Rules

- Separate env vars per environment (local, preview, production)
- Cache-control headers set explicitly — use `s-maxage` + `stale-while-revalidate` for safe public content
- No production secrets in preview env vars
- Preview deployments enabled and required for all PRs
- Build + runtime logs reviewed on every production release

### 17.3 Backend (Render / Dedicated)

- Long-running AI/report generation must not run in Vercel serverless functions
- Background workers deployed as separate services
- Health check endpoint required for load balancer configuration
- Zero-downtime deployments targeted

### 17.4 Secrets Management

- All secrets in environment variable store (Vercel env, Render env, Supabase vault)
- Rotate secrets on any suspected exposure
- No `.env` files committed — `.env.example` only
- Separate secret values per environment — never share production credentials with preview/local

---

## 18. Database Requirements

### 18.1 RLS Policy Rules

- Every table in exposed schemas must have RLS enabled
- Default: deny all unless explicit policy grants access
- Policies must be scoped: `TO authenticated`, `TO anon` — never overly broad
- Index every column used in RLS policy conditions
- Wrap `auth.uid()` in `(select auth.uid())` to prevent per-row re-evaluation
- Avoid joins inside RLS policies — precompute or index instead
- Add filters to all queries — never rely on RLS alone as the only performance control

### 18.2 Required Indexes

```sql
-- RLS policy columns
CREATE INDEX ON notes (module_id);
CREATE INDEX ON submissions (student_id);
CREATE INDEX ON submissions (assignment_id);
CREATE INDEX ON note_chunks (note_id);
CREATE INDEX ON enrollments (student_id, module_id);
CREATE INDEX ON audit_logs (user_id, created_at);

-- Analytics hot paths
CREATE INDEX ON grades (student_id, assignment_id);
CREATE INDEX ON analytics_snapshots (student_id, created_at DESC);
```

### 18.3 Connection Management

- Use Supavisor connection pooler — never connect directly from API at scale
- Keep transactions short — release connections immediately
- Monitor pool saturation via Supabase dashboard metrics
- Avoid long-running blocking operations during peak traffic

### 18.4 Read Replica Strategy

Route to read replica when:
- Instructor cohort analytics queries
- Dashboard aggregations
- Report generation data reads
- Any query that does not require read-your-own-writes consistency

Never route to replica:
- Immediately after a write that the same request must confirm
- Auth-related queries (always primary)

---

## 19. Testing Requirements

### 19.1 Required Test Layers

| Layer | Coverage Target |
|---|---|
| Unit tests | Core business logic, AI output parsing, validation |
| Integration tests | API endpoints with DB, auth middleware |
| RLS/policy tests | Verify each role can/cannot access each resource |
| Job workflow tests | End-to-end job chains (upload → chunk → embed) |
| E2E tests | Critical student + instructor journeys |

### 19.2 Critical User Journeys to Test

- Student login and role-scoped access only
- Note upload, processing completion, chunk availability
- Note viewer + chatbot retrieval returning only authorized content
- Assignment submission and state transitions
- Analytics generation after submission
- Roadmap generation with structured output
- Report rendering and export
- Instructor cohort analytics accuracy

### 19.3 Non-Functional Testing

- Load test chat and dashboard endpoints before launch
- Concurrency test for note uploads and embedding jobs
- Failure injection: AI down, storage down, DB slow
- Backup restore drill: restore from PITR before go-live

---

## 20. Acceptance Criteria

### 20.1 The Product Is Not Done Unless

- [ ] Auth and authorization are real and tested
- [ ] File access is private and access-controlled
- [ ] Note-aware chatbot works with correct access scoping
- [ ] Assessment analytics are visible, reliable, and timestamped
- [ ] Roadmap generation is structured, stored, and versioned
- [ ] Dashboards load within acceptable latency (< 2s p95)
- [ ] All failures are observable (logged, alerted)
- [ ] Backups are configured and restore process is documented
- [ ] Preview-to-production workflow is stable
- [ ] No fragile workarounds in any critical path

### 20.2 Red Flags That Block Release

- Public or guessable URLs for private files
- No RLS on exposed tables
- Service role key exposed client-side
- Synchronous heavy AI generation in user-facing requests
- No retry or timeout handling on external calls
- No monitoring for failures
- No rollback plan
- Schema changes without migrations
- Unclear ownership of derived analytics data

---

## 21. Build Roadmap

### Phase 1: Foundation Hardening (current)

- [ ] Normalize architecture (monorepo structure, clean server/client split)
- [ ] Implement real auth: Supabase Auth, server-side session validation, role model
- [ ] Enable RLS on all exposed tables with correct policies per role
- [ ] Replace fragile file access with Supabase Storage + private signed URLs
- [ ] Migrate schema to strict migration files only
- [ ] Add Zod validation on all API inputs
- [ ] Add structured logging with request IDs
- [ ] Add `/api/health` and `/api/ready` endpoints
- [ ] Define and configure environments: local → dev → preview → production
- [ ] Lock secrets to environment config, audit `.env.example`

### Phase 2: Notes Copilot

- [ ] Secure note storage and delivery pipeline
- [ ] Note processing pipeline: extract → chunk → embed (async)
- [ ] Processing status tracking and UI
- [ ] Note viewer + side-by-side AI chat (scoped retrieval)
- [ ] Retrieval guardrails and source attribution

### Phase 3: Assessment Intelligence

- [ ] Strengthen submission data model
- [ ] AI analysis pipeline (async job)
- [ ] Student report endpoint with structured output
- [ ] Instructor cohort analytics endpoint
- [ ] Weak-topic aggregation job

### Phase 4: Roadmap Engine

- [ ] Roadmap tables and migration
- [ ] Roadmap generation endpoint (async job)
- [ ] Progress tracking
- [ ] Dashboard integration
- [ ] Export/share flow

### Phase 5: Production Operations

- [ ] PITR enabled on production Supabase project
- [ ] Read replicas configured for analytics reads
- [ ] Alerting configured (error rate, job backlog, replica lag)
- [ ] Admin audit tools
- [ ] Load testing completed
- [ ] Incident runbooks documented
- [ ] Backup restore drill completed

---

## 22. Immediate Implementation Rules

From this point onward:

1. **No new feature is built unless it maps to this README.**
2. **No shortcut that compromises auth or security is accepted, even temporarily.**
3. **No schema change without a migration file.**
4. **No file access workaround becomes permanent architecture.**
5. **No AI output is trusted without clear source/version separation.**
6. **No production deployment without observability in place.**
7. **This file is the product memory and architectural contract for LearnIT. Any change in direction must be reflected here first.**

---

*Last updated: 2026-05-13 — Phase 1 in progress.*
