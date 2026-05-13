# Required Changes for Learn-IT

Last reviewed: 2026-05-13  
Status: Phase 1 in progress — P1-2 ✅ completed, P1-3 ✅ mostly completed

---

## Table of Contents

1. [Current Security State](#1-current-security-state)
2. [Completed Work — P1-2 and P1-3](#2-completed-work--p1-2-and-p1-3)
3. [Applied Migrations](#3-applied-migrations)
4. [Remaining Work](#4-remaining-work)
5. [Storage and File Security](#5-storage-and-file-security)
6. [Schema and Migration Discipline](#6-schema-and-migration-discipline)
7. [Backend Changes](#7-backend-changes)
8. [Auth Changes](#8-auth-changes)
9. [Query and Performance Fixes](#9-query-and-performance-fixes)
10. [Next Execution Order](#10-next-execution-order)

---

## 1. Current Security State

### Before P1-2 (original state)

| Issue | Severity |
|---|---|
| RLS disabled on all 11 public tables | 🔴 CRITICAL |
| `public.users.password` exposed via anon key | 🔴 CRITICAL |
| No auth bridge between legacy integer IDs and Supabase Auth | 🔴 CRITICAL |
| Helper functions had mutable `search_path` | 🟡 WARN |
| Leaked password protection disabled in Auth | 🟡 WARN |

### After P1-2 + P1-3 (current state)

| Issue | Status |
|---|---|
| RLS disabled on public tables | ✅ Resolved — RLS enabled, policies applied |
| `public.users.password` exposed | ✅ Resolved — column dropped |
| No auth bridge | ✅ Resolved — `user_identity_map` created and backfilled |
| Mutable `search_path` on helper functions | ✅ Resolved — recreated with `SET search_path = ''` |
| Leaked password protection disabled | 🟡 Open — manual Auth dashboard action required |

**Supabase security advisor currently reports: 1 warning (leaked password protection).**

---

## 2. Completed Work — P1-2 and P1-3

### 2.1 Auth bridge (`user_identity_map`)

- Created `public.user_identity_map` mapping legacy integer `users.id` to Supabase Auth UUIDs.
- Pre-populated from `public.users` on migration.
- All 4 existing users backfilled with Auth UUIDs.

| legacy_user_id | Email | Role | Auth UUID |
|---|---|---|---|
| 1 | admin@learnit.edu | admin | `a1000001-0000-0000-0000-000000000001` |
| 2 | sarah@learnit.edu | student | `a1000001-0000-0000-0000-000000000002` |
| 3 | michael@learnit.edu | student | `a1000001-0000-0000-0000-000000000003` |
| 4 | instructor@learnit.edu | instructor | `a1000001-0000-0000-0000-000000000004` |

> ⚠️ Temporary password for all created Auth users: `ChangeMe123!`  
> Force-reset these before any real usage.

### 2.2 Helper functions (hardened)

All functions recreated with `SET search_path = ''` and fully-qualified schema references:

- `public.current_legacy_user_id()` — resolves caller's legacy integer user ID from `auth.uid()`
- `public.current_user_role()` — resolves caller's role string
- `public.is_admin()` — returns boolean
- `public.is_instructor_for_course(p_course_id)` — returns boolean
- `public.is_enrolled_in_course(p_course_id)` — returns boolean
- `public.can_access_module(p_module_id)` — returns boolean (admin OR instructor OR enrolled)
- `public.set_updated_at()` — trigger function

### 2.3 Indexes added

```sql
idx_uim_auth_user_id               user_identity_map(auth_user_id)
idx_uim_role                       user_identity_map(role)
idx_courses_instructor_id          courses(instructor_id)
idx_enrollments_student            enrollments(student_id)
idx_enrollments_course             enrollments(course_id)
idx_enrollments_student_course     enrollments(student_id, course_id)
idx_modules_course_id              modules(course_id)
idx_materials_module_id            materials(module_id)
idx_assignments_module_id          assignments(module_id)
idx_submissions_student_id         submissions(student_id)
idx_submissions_assignment_id      submissions(assignment_id)
idx_sub_files_submission_id        submission_files(submission_id)
idx_notes_student_id               notes(student_id)
idx_notes_module_id                notes(module_id)
idx_note_chunks_note_id            note_chunks(note_id)
```

### 2.4 RLS enabled and policies applied

RLS is now active on all 12 tables with role-scoped policies:

| Table | Student | Instructor | Admin |
|---|---|---|---|
| `user_identity_map` | SELECT own row | — | Full |
| `users` | SELECT/UPDATE own row | — | Full |
| `courses` | SELECT if enrolled | SELECT/INSERT/UPDATE own | Full |
| `enrollments` | SELECT own | SELECT/INSERT/DELETE for own courses | Full |
| `modules` | SELECT if enrolled | Full manage own courses | Full |
| `materials` | SELECT if enrolled | Full manage own courses | Full |
| `assignments` | SELECT if enrolled | Full manage own courses | Full |
| `submissions` | Own SELECT/INSERT/UPDATE | SELECT/UPDATE (grading) | Full |
| `submission_files` | Own SELECT/INSERT/DELETE | SELECT for own course | Full |
| `notes` | SELECT if enrolled | Full manage own courses | Full |
| `note_chunks` | SELECT if enrolled | Full manage own courses | Full |
| `settings` | ❌ None | ❌ None | Full |

### 2.5 Sensitive column removed

- `public.users.password` column dropped — Supabase Auth is now the sole credential store.

---

## 3. Applied Migrations

| Version | Name |
|---|---|
| 20260510172005 | initial_schema_and_seed |
| 20260510182455 | drop_student_id_fk_on_notes_and_submissions |
| 20260510184530 | 003_notes_nullable_student_id |
| 20260510223938 | add_cloudinary_url_columns |
| 20260513143812 | add_user_identity_map_and_indexes |
| 20260513144008 | create_auth_users_and_backfill_identity_map |
| 20260513144343 | enable_rls_and_add_policies |
| 20260513144545 | drop_password_column_and_fix_function_search_paths |

---

## 4. Remaining Work

### 4.1 🟡 Enable leaked password protection (manual Auth setting)

**Action required in Supabase dashboard — cannot be done via SQL migration.**

- Go to: Authentication → Settings → Password Security
- Enable: "Check passwords against HaveIBeenPwned"
- Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

This will clear the only remaining Supabase security advisor warning.

### 4.2 Audit backend for legacy auth assumptions

- [ ] Identify any routes still reading `req.body.userId` or `req.body.role`
- [ ] Replace with server-side `supabase.auth.getUser()` + `user_identity_map` lookup
- [ ] Remove any remaining `public.users`-based password-check logic

### 4.3 Force-reset temporary Auth passwords

- All 4 Auth users were created with `ChangeMe123!`
- Must be rotated before any real user testing or staging promotion

---

## 5. Storage and File Security

### 5.1 Replace Cloudinary with Supabase Storage for protected content

The schema currently stores `cloudinary_url` columns in `notes` and `submission_files`. This is not appropriate for protected academic content.

Problems:
- Cloudinary public URLs are guessable or directly accessible
- No authorization check happens at delivery time
- Notes and submissions are private intellectual property

Required:
- [ ] Create private Supabase Storage buckets: `notes`, `submissions`, `materials`
- [ ] Store only path/key references in the database, not public delivery URLs
- [ ] Generate signed URLs server-side only after verifying access rights
- [ ] Or proxy file delivery through a backend endpoint that checks access before streaming
- [ ] Drop or deprecate `cloudinary_url` columns once migrated

### 5.2 Separate metadata from delivery logic

- File metadata (name, size, type, uploaded_at, uploader_id) stays in the database
- File bytes live in private storage
- No route returns file bytes without an access check preceding it
- Signed URLs must be short-lived (e.g. 60 seconds) for download flows

---

## 6. Schema and Migration Discipline

### 6.1 All schema changes must go through migration files only

No manual Supabase dashboard edits in staging or production.  
Standardise all future migrations as `YYYYMMDDHHMMSS_descriptive_name`.

### 6.2 Next required migrations

In order:

- [ ] `..._replace_cloudinary_with_storage_paths` — migrate file ref columns
- [ ] `..._add_audit_logs_table` — audit trail for privileged actions
- [ ] `..._add_processing_jobs_table` — async job tracking
- [ ] `..._add_analytics_snapshots_table` — derived performance materialisations
- [ ] `..._add_student_roadmaps_table` — roadmap storage

### 6.3 Missing access-model entities (to confirm/add)

- [ ] `audit_logs` — actor, action, target, timestamp, metadata
- [ ] `processing_jobs` — note/submission/report/roadmap async job state
- [ ] `analytics_snapshots` — precomputed per-student per-module stats
- [ ] `student_roadmaps` — versioned roadmap snapshots
- [ ] `roadmap_progress` — per-item completion tracking

---

## 7. Backend Changes

### 7.1 Break up monolithic server.ts

The current `server.ts` mixes routing, business logic, auth, AI, and storage concerns.

Target structure:

```
src/server/
  index.ts
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
    supabase.ts         — server-side Supabase client (service role only)
    openai.ts
    queue.ts
    env.ts              — Zod-validated env config
```

### 7.2 Add Zod validation on all inputs

- [ ] Every route handler validates params, query, and body with a Zod schema
- [ ] Environment config validated with Zod at boot
- [ ] File uploads validated: type allowlist, max size

### 7.3 Add health and readiness endpoints

```
GET /api/health   — liveness: returns 200 if process is alive
GET /api/ready    — readiness: checks DB, storage, queue connectivity
```

### 7.4 Add structured JSON logging

Every log entry must include: `requestId`, `method`, `path`, `statusCode`, `durationMs`, `userId`.  
No secrets, tokens, passwords, or PII in logs.

---

## 8. Auth Changes

### 8.1 Server-side Supabase Auth validation

- [ ] All API routes that access user data must call `supabase.auth.getUser()` server-side
- [ ] Role resolved from `user_identity_map`, not from JWT metadata
- [ ] Service role key must only exist in server environment — never in browser
- [ ] No route trusts `role` or `user_id` from request body/query

### 8.2 Abuse protection

- [ ] Rate limit: 10 login attempts per IP per 15 minutes
- [ ] Rate limit: 30 AI chat messages per student per hour
- [ ] Rate limit: 20 file uploads per user per day
- [ ] Rate limit: 5 report/roadmap generations per user per hour
- [ ] CAPTCHA on sign-up and password reset flows

---

## 9. Query and Performance Fixes

### 9.1 Always filter queries explicitly

Do not rely on RLS alone for query scoping. All backend and client queries must include natural equality filters (e.g. `.eq('student_id', userId)`) so Postgres builds efficient plans.

### 9.2 Prepare for analytics read separation

- Derived aggregates must be written to `analytics_snapshots` by background jobs
- Dashboard reads should query snapshots, not raw tables
- Heavy report queries should run on a read replica at scale

---

## 10. Next Execution Order

| Step | Task | Status |
|---|---|---|
| P1-1 | Audit server.ts, map all routes and auth checks | ✅ Done |
| P1-2 | Auth bridge, RLS, policies, indexes | ✅ Done |
| P1-3 | Drop password column, fix search_path, leaked password protection | ✅ DB done / 🟡 Auth setting pending |
| P1-4 | Audit and refactor backend auth middleware | 🔲 Next |
| P1-5 | Migrate file delivery to Supabase Storage + signed URLs | 🔲 Pending |
| P1-6 | Add Zod validation + request ID middleware | 🔲 Pending |
| P1-7 | Add health endpoints | 🔲 Pending |
| P1-8 | Refactor server.ts into service modules | 🔲 Pending |
| P1-9 | Add structured logging | 🔲 Pending |
| P1-10 | Environment audit: verify no secrets leak between envs | 🔲 Pending |

---

*This file is a living document. Update it after each completed migration or verified architecture change.*  
*Do not close a step as done until the corresponding migration or code change is merged and tested.*
