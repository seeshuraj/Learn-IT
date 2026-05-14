# Required Changes for Learn-IT

Last reviewed: 2026-05-14  
Status: Phase 1 — P1-1 through P1-7 ✅ completed. P1-8 through P1-10 + Phase 2 pending.

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

### After P1-1 → P1-7 (current state)

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
`src/server/validation/schemas.ts` defines Zod schemas for all write routes:

- `assignmentCreateSchema`, `assignmentUpdateSchema`
- `instructorAssignmentCreateSchema`
- `submissionCreateSchema`, `gradeSchema`, `gradePdfSchema`
- `adminUserCreateSchema`, `adminUserUpdateSchema`
- `courseCreateSchema`, `enrollmentCreateSchema`, `bulkEnrollSchema`
- `settingsSchema`, `moduleCreateSchema`, `routeParamId`

All POST/PUT routes use `validateBody(schema)` middleware.

### 2.9 Structured logging + Request ID ✅ (P1-6 / P1-9)

- `src/server/middleware/requestId.ts` — injects `X-Request-ID` on every request
- `src/server/middleware/logger.ts` — logs `{ requestId, method, path, statusCode, durationMs }` as JSON
- No secrets/tokens logged

### 2.10 Env validation ✅ (P1-6)

`src/server/config/env.ts` — Zod-validated env config runs at boot via `validateEnv()`.  
Server fails fast with clear error if required env vars are missing.

### 2.11 Health endpoint ✅ (P1-7)

`GET /api/health` — returns `{ status, db, storage, env, ts }`. DB connectivity checked via `SELECT 1`.

### 2.12 Frontend API centralisation ✅

`src/services/api.ts` is fully centralised. All pages use it exclusively:
- `AnalyticsPage.tsx` — uses `api.getStudentAnalytics(user.id)`
- `AssignmentsPage.tsx` — uses `api.getStudentAssignments()`, `api.submitAssignment()`, `api.uploadSubmission()`
- `InstructorDashboard.tsx` — uses `api.*` for all data; no raw fetch; no hardcoded mock data
- `DashboardPage.tsx` — uses `api.getStudentCourses()`, `api.getStudentAssignments()`
- `NotesPage.tsx`, `CourseDetailPage.tsx`, `CoursesPage.tsx` — use `api.*`
- `AdminDashboard.tsx`, `AdminUserManagement.tsx`, `AdminCourseManagement.tsx`, `AdminSettings.tsx` — use `api.*`

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
- Reference: https://supabase.com/docs/guides/auth/password-security

### 4.2 Force-reset temporary Auth passwords

- All 4 Auth users were created with `ChangeMe123!`
- Must be rotated before any real user testing or staging promotion

### 4.3 Drop deprecated `cloudinary_url` columns

Now that all file delivery is via Supabase Storage, the old `cloudinary_url` columns in `notes` and `submission_files` should be removed.

```sql
-- Migration: ..._drop_cloudinary_url_columns
ALTER TABLE notes            DROP COLUMN IF EXISTS cloudinary_url;
ALTER TABLE submission_files DROP COLUMN IF EXISTS cloudinary_url;
```

### 4.4 Rate limiting middleware (missing) 🔴

`src/server/middleware/rateLimit.ts` is referenced in the planned architecture but **does not exist**.

- [ ] Add `express-rate-limit` package
- [ ] Create `src/server/middleware/rateLimit.ts`
- [ ] Apply per-route limits:
  - Login: 10 attempts per IP per 15 min
  - AI chat: 30 messages per student per hour
  - File upload: 20 uploads per user per day
  - Report/roadmap generation: 5 per user per hour

### 4.5 `/api/ready` readiness endpoint (missing)

`GET /api/health` exists but `/api/ready` (checks DB + storage + queue) does not.

- [ ] Add `GET /api/ready` that pings DB + verifies Storage bucket is accessible + returns 503 if either is down

### 4.6 Admin user creation does not create Supabase Auth user

`POST /api/admin/users` inserts into `public.users` and `enrollments` but never calls `supabase.auth.admin.createUser()`. These users will exist in the DB but **cannot log in** until an Auth user is created for them.

- [ ] Add `supabaseAdmin.auth.admin.createUser({ email, password: randomTempPassword })` in `POST /api/admin/users`
- [ ] Insert matching row into `user_identity_map`
- [ ] Return `tempPassword` in response so admin can communicate it to the new user

### 4.7 Bulk enrol does not create Supabase Auth users

Same issue as 4.6 — `POST /api/admin/bulk-enroll` creates users in `public.users` only.

- [ ] Auto-create Auth users for new emails during bulk enrol
- [ ] Insert into `user_identity_map`

### 4.8 `GET /api/admin/courses` route is missing

`api.getAdminCourses()` calls `GET /api/admin/courses` but **no such route exists** in `server.ts`.  
Only `POST /api/admin/courses` and `DELETE /api/admin/courses/:id` exist.

- [ ] Add `GET /api/admin/courses` — returns all non-archived courses with instructor name and enrolment count (same shape as `GET /api/courses`)

### 4.9 No `/api/ready` endpoint

Already noted in 4.5.

### 4.10 DashboardPage AI insight is static

`DashboardPage.tsx` renders a hardcoded AI insight paragraph — it never calls `api.aiAnalyticsSummary()` or any real AI endpoint.

- [ ] Call `api.getStudentAnalytics(user.id)` on mount
- [ ] Pipe result to `api.aiAnalyticsSummary(analytics)` for a personalised insight
- [ ] Replace the static string with the live summary

### 4.11 `NotesPage.tsx` uses `api.getNoteProxyUrl()` — verify it handles signed URLs too

Proxy streaming is correct but large files (>6 MB) may timeout on Render free tier. The signed-URL endpoint (`GET /api/notes/:id/signed-url`) exists for lightweight delivery but the frontend does not use it.

- [ ] In `NotesPage.tsx` when opening/viewing a note, prefer `api.getSignedNoteUrl(noteId)` then redirect rather than streaming through the proxy
- [ ] Add `getSignedNoteUrl: (noteId: number) => request('/api/notes/${noteId}/signed-url')` to `api.ts`

### 4.12 Instructor analytics only returns `enrollments` + `averageGrade`

`GET /api/instructor/courses/:id/analytics` returns only 2 fields. `InstructorDashboard.tsx` needs per-student data to show the Students tab.

- [ ] Extend the endpoint to return per-student grade array, submission count, late count
- [ ] Or add `GET /api/instructor/courses/:id/students` as a dedicated endpoint

---

## 5. Storage and File Security

### Status: ✅ Core migration done — cleanup pending

- Private Supabase Storage buckets in use: `learnit-notes`, `learnit-submissions`
- Signed URLs generated server-side with TTL (15 min for view, 1 hr for download)
- File delivery proxied through authenticated backend route
- `cloudinary_url` columns still exist in schema — migration to drop them is pending (see 4.3)

### 5.1 Remaining: Separate metadata from delivery

- [ ] No route should return `storage_path` directly to the client — only signed URLs or proxy paths
- [ ] Audit: `GET /api/modules/:id/notes` returns `storage_path` in the response — strip it, expose `signed_url` only
- [ ] Audit: `GET /api/submissions/:id/files` returns `storage_path` — same fix

---

## 6. Schema and Migration Discipline

### 6.1 Rules

- All schema changes via migration files only — no manual Supabase dashboard edits in staging/production
- Naming convention: `YYYYMMDDHHMMSS_descriptive_name`

### 6.2 Pending migrations

| Priority | Migration | Status |
|---|---|---|
| 🔴 High | `..._drop_cloudinary_url_columns` | 🔲 Pending |
| 🟡 Medium | `..._add_audit_logs_table` | 🔲 Pending |
| 🟡 Medium | `..._add_processing_jobs_table` | 🔲 Pending |
| 🟡 Medium | `..._add_analytics_snapshots_table` | 🔲 Pending |
| 🟢 Low | `..._add_student_roadmaps_table` | 🔲 Pending |
| 🟢 Low | `..._add_roadmap_progress_table` | 🔲 Pending |

### 6.3 Missing access-model entities

- [ ] `audit_logs` — actor, action, target, timestamp, metadata
- [ ] `processing_jobs` — async job state (notes/submissions/reports/roadmaps)
- [ ] `analytics_snapshots` — precomputed per-student per-module stats
- [ ] `student_roadmaps` — versioned roadmap snapshots
- [ ] `roadmap_progress` — per-item completion tracking

---

## 7. Backend Changes

### 7.1 Break up monolithic `server.ts` (P1-8) 🔲

`server.ts` is ~53 KB and mixes routing, business logic, auth, AI, and storage concerns in one file. Middleware layer already exists (`src/server/middleware/`). Routes need to be extracted.

Target structure (not yet created):

```
src/server/
  index.ts                   ← slim entry point, just mounts router
  routes/
    auth.ts
    courses.ts
    modules.ts
    notes.ts
    assignments.ts
    submissions.ts
    analytics.ts
    instructor.ts
    admin.ts
    ai.ts
    health.ts
  services/
    storage.service.ts        ← uploadToStorage, getSignedUrl, deleteFromStorage
    ai.service.ts             ← nimChat, nimEmbed, retrieveChunks
    analytics.service.ts
  jobs/
    noteProcessor.ts
    assessmentAnalyser.ts
  lib/
    db.ts                     ← query, queryOne, run helpers
    supabase.ts               ← supabaseAdmin client
```

### 7.2 Add rate limiting (P1-4.4 above) 🔲

See section 4.4.

### 7.3 Add `/api/ready` readiness endpoint (P1-7 extension) 🔲

See section 4.5.

### 7.4 Extend instructor analytics endpoint 🔲

See section 4.12.

---

## 8. Auth Changes

### 8.1 Server-side Supabase Auth validation ✅

- `requireAuth` calls `supabase.auth.getUser()` server-side on every request
- Role resolved from `user_identity_map`, not from JWT custom claims
- Service role key only in server environment

### 8.2 Admin user creation must also create Auth users 🔲

See sections 4.6 and 4.7.

### 8.3 Abuse protection (rate limiting) 🔲

See section 4.4.

### 8.4 CAPTCHA on sign-up and password reset 🔲

- [ ] Add hCaptcha or Supabase built-in CAPTCHA on sign-up flow
- [ ] Enable CAPTCHA on password reset in Supabase Auth settings

---

## 9. Query and Performance Fixes

### 9.1 Always filter queries explicitly ✅

All backend queries include explicit equality filters alongside RLS. Postgres builds efficient plans.

### 9.2 `storage_path` still returned to client 🔲

Some endpoints (`GET /api/modules/:id/notes`, `GET /api/submissions/:id/files`) include `storage_path` in the JSON response. This leaks internal bucket paths to the client — only signed URLs should be returned.

- [ ] Remove `storage_path` from select list in those two routes (or explicitly omit it in the response map)

### 9.3 Prepare for analytics read separation 🔲

- Derived aggregates should be written to `analytics_snapshots` by background jobs
- Dashboard reads should query snapshots, not raw tables
- Heavy report queries should run on a read replica at scale

---

## 10. Frontend Audit Results

### Pages — audit status

| File | Raw fetch? | Hardcoded data? | Status |
|---|---|---|---|
| `DashboardPage.tsx` | ❌ | 🟡 Static AI insight string | Needs 4.10 fix |
| `AnalyticsPage.tsx` | ❌ | ❌ | ✅ Clean |
| `AssignmentsPage.tsx` | ❌ | ❌ | ✅ Clean |
| `InstructorDashboard.tsx` | ❌ | ❌ | ✅ Clean |
| `NotesPage.tsx` | ❌ | ❌ | ✅ Clean (signed URL improvement pending — 4.11) |
| `CourseDetailPage.tsx` | ❌ | ❌ | ✅ Clean |
| `CoursesPage.tsx` | ❌ | ❌ | ✅ Clean |
| `LoginPage.tsx` | ❌ | ❌ | ✅ Clean |
| `AdminDashboard.tsx` | ❌ | ❌ | ✅ Clean |
| `AdminUserManagement.tsx` | ❌ | ❌ | ✅ Clean |
| `AdminCourseManagement.tsx` | ❌ | 🔴 Calls `getAdminCourses` — route missing (4.8) | Needs backend fix |
| `AdminSettings.tsx` | ❌ | ❌ | ✅ Clean |
| `LandingPage.tsx` | ❌ | ❌ | ✅ Clean |

### Components — audit status

| File | Raw fetch? | Status |
|---|---|---|
| `AIAnalyticsSummary.tsx` | ❌ | ✅ Clean |
| `AIGradingPanel.tsx` | ❌ | ✅ Clean |
| `AnalyticsDashboard.tsx` | ❌ | ✅ Clean |
| `ChatBot.tsx` | ❌ | ✅ Clean |
| `Header.tsx` | ❌ | ✅ Clean |
| `Sidebar.tsx` | ❌ | ✅ Clean |

### `api.ts` — method coverage

All methods required by the 5 recently rewritten pages exist. One gap:

- ❌ `getSignedNoteUrl(noteId)` — not in `api.ts`; notes proxy is used instead (see 4.11)
- ❌ `getAdminCourses` calls `GET /api/admin/courses` — backend route is missing (see 4.8)

---

## 11. Next Execution Order

| Step | Task | Status |
|---|---|---|
| P1-1 | Audit server.ts, map all routes and auth checks | ✅ Done |
| P1-2 | Auth bridge, RLS, policies, indexes | ✅ Done |
| P1-3 | Drop password column, fix search_path | ✅ DB done / 🟡 Auth leaked-pw setting pending |
| P1-4 | Audit and refactor backend auth middleware | ✅ Done — `auth.ts`, `requireAuth`, `requireRole`, `requireSelfOrAdmin` |
| P1-5 | Migrate file delivery to Supabase Storage + signed URLs | ✅ Done |
| P1-6 | Add Zod validation + request ID middleware + env validation | ✅ Done |
| P1-7 | Add health endpoint | ✅ Done — `GET /api/health` |
| P1-8 | Refactor server.ts into service modules | 🔲 Next |
| P1-9 | Add structured logging (requestId already done; JSON log format in place) | ✅ Mostly done — `logger.ts` active |
| P1-10 | Environment audit: verify no secrets leak between envs | 🔲 Pending |
| P2-1 | Add `GET /api/admin/courses` route | 🔲 Next (blockes AdminCourseManagement) |
| P2-2 | Admin/bulk-enrol create Supabase Auth users + `user_identity_map` rows | 🔲 Next |
| P2-3 | Add rate limiting middleware (`rateLimit.ts`) | 🔲 Pending |
| P2-4 | Force-reset `ChangeMe123!` Auth passwords | 🔲 Pending |
| P2-5 | Drop `cloudinary_url` columns via migration | 🔲 Pending |
| P2-6 | Strip `storage_path` from API responses (return signed URLs only) | 🔲 Pending |
| P2-7 | DashboardPage: replace static AI insight with live `aiAnalyticsSummary` call | 🔲 Pending |
| P2-8 | Extend instructor analytics endpoint to return per-student data | 🔲 Pending |
| P2-9 | Add `GET /api/ready` readiness endpoint | 🔲 Pending |
| P2-10 | Add CAPTCHA on sign-up + password reset | 🔲 Pending |
| P3-1 | Add `audit_logs` table + migration | 🔲 Pending |
| P3-2 | Add `analytics_snapshots` + background job | 🔲 Pending |
| P3-3 | Add `student_roadmaps` + `roadmap_progress` tables | 🔲 Pending |

---

*This file is a living document. Update it after each completed migration or verified architecture change.*  
*Do not close a step as done until the corresponding migration or code change is merged and tested.*
