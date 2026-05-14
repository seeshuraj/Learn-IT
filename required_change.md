# Required Changes for Learn-IT

Last reviewed: 2026-05-14  
Status: Phase 1 complete. P2-1, P2-6, P2-8, P2-9 ✅ completed. P2-2 through P2-5, P2-7, P2-10, P2-11, P3-x pending.

---

## Table of Contents

1. [Current Security State](#1-current-security-state)
2. [Completed Work](#2-completed-work)
3. [Applied Migrations](#3-applied-migrations)
4. [Remaining Work](#4-remaining-work)
5. [Storage and File Security](#5-storage-and-file-security)
6. [Schema and Migration Discipline](#6-schema-and-migration-discipline)
7. [Backend Changes](#7-backend-changes)
8. [Auth Changes](#8-auth-changes)
9. [Query and Performance Fixes](#9-query-and-performance-fixes)
10. [Frontend Audit Results](#10-frontend-audit-results)
11. [Next Execution Order](#11-next-execution-order)

---

## 1. Current Security State

### After P1-1 → P1-7 + P2-1, P2-6, P2-8, P2-9 (current state)

| Issue | Status |
|---|---|
| RLS disabled on all 11 public tables | ✅ Resolved — RLS enabled, policies applied |
| `public.users.password` exposed | ✅ Resolved — column dropped |
| No auth bridge between legacy integer IDs and Supabase Auth | ✅ Resolved — `user_identity_map` created and backfilled |
| Mutable `search_path` on helper functions | ✅ Resolved — recreated with `SET search_path = ''` |
| Leaked password protection disabled | 🟡 Open — manual Auth dashboard action required |
| Raw `fetch()` calls with hardcoded URLs in frontend | ✅ Resolved — all calls go through `api.ts` |
| `student_id` sent from client in submissions | ✅ Resolved — resolved server-side from JWT |
| Hardcoded mock data in InstructorDashboard | ✅ Resolved — replaced with real API calls |
| Cloudinary public URLs for protected files | ✅ Resolved — migrated to Supabase Storage signed URLs |
| No Zod validation on route inputs | ✅ Resolved — `validateBody` / `validateParams` middleware applied to all write routes |
| No request ID / structured logging | ✅ Resolved — `attachRequestId` + `requestLogger` middleware in place |
| No env validation at boot | ✅ Resolved — `validateEnv()` with Zod runs at startup |
| No auth middleware | ✅ Resolved — `requireAuth`, `requireRole`, `requireSelfOrAdmin` applied to all routes |
| Role / userId trusted from request body | ✅ Resolved — all routes use `req.auth.legacyUserId` from JWT |
| Missing `GET /api/admin/courses` | ✅ Resolved — route added (P2-1) |
| `storage_path` leaked to client in notes/submission responses | ✅ Resolved — stripped server-side (P2-6) |
| No readiness probe endpoint | ✅ Resolved — `GET /api/ready` added (P2-9) |
| Instructor analytics missing per-student breakdown | ✅ Resolved — `students[]` array added to analytics response (P2-8) |

**Supabase security advisor currently reports: 1 warning (leaked password protection — manual dashboard step).**

---

## 2. Completed Work

### 2.1 Auth bridge (`user_identity_map`) ✅
- Created `public.user_identity_map` mapping legacy integer `users.id` to Supabase Auth UUIDs.
- All 4 existing users backfilled with Auth UUIDs.

| legacy_user_id | Email | Role | Auth UUID |
|---|---|---|---|
| 1 | admin@learnit.edu | admin | `a1000001-0000-0000-0000-000000000001` |
| 2 | sarah@learnit.edu | student | `a1000001-0000-0000-0000-000000000002` |
| 3 | michael@learnit.edu | student | `a1000001-0000-0000-0000-000000000003` |
| 4 | instructor@learnit.edu | instructor | `a1000001-0000-0000-0000-000000000004` |

> ⚠️ Temporary password for all created Auth users: `ChangeMe123!`  
> Force-reset these before any real usage.

### 2.2 Helper functions (hardened) ✅

All functions recreated with `SET search_path = ''` and fully-qualified schema references:

- `public.current_legacy_user_id()` — resolves caller's legacy integer user ID from `auth.uid()`
- `public.current_user_role()` — resolves caller's role string
- `public.is_admin()` — returns boolean
- `public.is_instructor_for_course(p_course_id)` — returns boolean
- `public.is_enrolled_in_course(p_course_id)` — returns boolean
- `public.can_access_module(p_module_id)` — returns boolean (admin OR instructor OR enrolled)
- `public.set_updated_at()` — trigger function

### 2.3 Indexes added ✅

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

### 2.4 RLS + policies ✅

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

### 2.5 Sensitive column removed ✅
- `public.users.password` column dropped.

### 2.6 Auth middleware ✅ (P1-4)

`src/server/middleware/auth.ts` is in place and imported by `server.ts`:
- `requireAuth` — validates Supabase JWT server-side, resolves `legacyUserId` + `role` from `user_identity_map`
- `requireRole(...roles)` — enforces role-based access
- `requireSelfOrAdmin(param)` — enforces self-access or admin for user-scoped routes
- `setPool(pool)` — injects PG pool reference

All routes that access user data use these guards. No route trusts `role` or `userId` from request body.

### 2.7 Supabase Storage migration ✅ (P1-5)

- Private buckets: `learnit-notes`, `learnit-submissions`
- Notes uploaded to `learnit-notes` bucket via `uploadToStorage()`
- Submission files uploaded to `learnit-submissions` bucket
- All file delivery goes through:
  - `GET /api/notes/:id/proxy` — streams file buffer after auth check
  - `GET /api/notes/:id/signed-url` — returns a 15-minute signed URL
  - `GET /api/submissions/:id/files` — returns per-file signed URLs (1hr TTL)
- `cloudinary_url` columns are now unused; files are stored as `storage_path` only
- `checkStorageConnectivity()` runs at boot and fails loudly if misconfigured

### 2.8 Zod validation middleware ✅ (P1-6)

`src/server/middleware/validate.ts` exports `validateBody` and `validateParams`.  
`src/server/validation/schemas.ts` defines Zod schemas for all write routes.

### 2.9 Structured logging + Request ID ✅ (P1-6 / P1-9)

- `src/server/middleware/requestId.ts` — injects `X-Request-ID` on every request
- `src/server/middleware/logger.ts` — logs `{ requestId, method, path, statusCode, durationMs }` as JSON

### 2.10 Env validation ✅ (P1-6)

`src/server/config/env.ts` — Zod-validated env config runs at boot via `validateEnv()`.

### 2.11 Health + Readiness endpoints ✅ (P1-7 / P2-9)

- `GET /api/health` — returns `{ status, db, storage, env, ts }`
- `GET /api/ready` — returns 200 `{ status: "ready" }` or 503 `{ status: "unavailable", checks }` after probing DB + Storage

### 2.12 Frontend API centralisation ✅

`src/services/api.ts` is fully centralised. All pages use it exclusively.

### 2.13 GET /api/admin/courses ✅ (P2-1)

Route added to `server.ts`. Returns `{ id, code, name, archived, created_at, instructor_id, instructor_name, enrollment_count, module_count }` per course. Used by `AdminCourseManagement.tsx`.

### 2.14 storage_path stripped from API responses ✅ (P2-6)

All note and submission file responses destructure out `storage_path` before sending to client.

### 2.15 Instructor analytics extended ✅ (P2-8)

`GET /api/instructor/courses/:id/analytics` now returns a `students[]` array with `{ student_id, name, avg_grade, submission_count, late, missed }` per enrolled student.

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

> Pending migration: `drop_cloudinary_url_columns` (see §4.3)

---

## 4. Remaining Work

### 4.1 🟡 Enable leaked password protection (manual Auth setting)

**Action required in Supabase dashboard — cannot be done via SQL migration.**

- Go to: Authentication → Settings → Password Security
- Enable: "Check passwords against HaveIBeenPwned"
- Reference: https://supabase.com/docs/guides/auth/password-security

### 4.2 Force-reset temporary Auth passwords (P2-4) 🔴

- All 4 seeded Auth users were created with `ChangeMe123!`
- Must be rotated before any real user testing or staging promotion
- Do via Supabase Auth dashboard or `supabaseAdmin.auth.admin.updateUserById()`

### 4.3 Drop deprecated `cloudinary_url` columns (P2-5) 🟡

Now that all file delivery is via Supabase Storage, the old `cloudinary_url` columns should be removed.

```sql
-- Migration: ..._drop_cloudinary_url_columns
ALTER TABLE notes            DROP COLUMN IF EXISTS cloudinary_url;
ALTER TABLE submission_files DROP COLUMN IF EXISTS cloudinary_url;
```

### 4.4 Rate limiting middleware (P2-3) 🔴

`src/server/middleware/rateLimit.ts` is imported in `server.ts` — **verify file exists and limiters are correctly configured**.

Expected limiters:
- `loginLimiter` — 10 attempts per IP per 15 min
- `aiLimiter` — 30 messages per user per hour  
- `aiGradeLimiter` — 5 per user per hour
- `uploadLimiter` — 20 uploads per user per day
- `reportLimiter` — 5 per user per hour
- `generalApiLimiter` — 200 req per IP per 15 min

### 4.5 Admin bulk-enrol must create Auth users (P2-2) 🔴

When admin bulk-enrolls a **brand-new** email, the code calls `createAuthUserAndIdentityMapRow()` but catches and only warns on failure. This means new users may exist in the `users` table without a corresponding Supabase Auth account, making them unable to log in.

- [ ] Change bulk-enroll to hard-fail the transaction if Auth user creation fails (not just warn)
- [ ] Return `tempPassword` per user in the bulk-enroll response so admin can distribute credentials
- [ ] Test end-to-end: new email → bulk-enroll → can log in

### 4.6 DashboardPage static AI insight (P2-7) 🟡

`DashboardPage.tsx` currently displays a hardcoded placeholder AI insight string.

- [ ] Replace with a live call to `api.aiAnalyticsSummary(analytics)` after analytics data loads
- [ ] Show loading spinner while summary is fetching
- [ ] Gracefully handle API errors (show fallback text, not crash)

### 4.7 hCaptcha on sign-up and password reset (P2-10) 🟢

- [ ] Enable hCaptcha in Supabase Auth dashboard
- [ ] Add `options.captchaToken` to `supabase.auth.signInWithPassword()` and `resetPasswordForEmail()` calls
- [ ] Reference: https://supabase.com/docs/guides/auth/auth-captcha

### 4.8 Audit logs table (P3-1) 🟢

```sql
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INT REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INT,
  payload     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.9 Analytics snapshots (P3-2) 🟢

Add `analytics_snapshots` table + background cron job so dashboards read pre-aggregated data instead of hitting raw tables on every load.

### 4.10 Student roadmaps (P3-3) 🟢

Add `student_roadmaps` + `roadmap_progress` tables for AI-generated learning path tracking.

---

## 5. Next Execution Order

| Priority | Task | Est. effort |
|---|---|---|
| 🔴 1 | P2-2: Fix bulk-enroll hard-fail + return tempPassword | 30 min |
| 🔴 2 | P2-3: Verify/complete `rateLimit.ts` middleware | 20 min |
| 🟡 3 | P2-4: Force-reset `ChangeMe123!` passwords | 10 min |
| 🟡 4 | P2-5: Migration to drop `cloudinary_url` columns | 10 min |
| 🟡 5 | P2-7: Live AI insight on DashboardPage | 20 min |
| 🟢 6 | P2-10: hCaptcha integration | 30 min |
| 🟢 7 | P3-1: audit_logs table | 20 min |
| 🟢 8 | P3-2: analytics_snapshots + cron | 60 min |
| 🟢 9 | P3-3: roadmap tables | 30 min |
