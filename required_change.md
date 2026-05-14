# Required Changes for Learn-IT

Last reviewed: 2026-05-14  
Status: **Phase 1 + Phase 2 + P3-1 + P3-3 fully complete. P3-2 pending.**

---

## Table of Contents

1. [Current Security State](#1-current-security-state)
2. [Completed Work](#2-completed-work)
3. [Applied Migrations](#3-applied-migrations)
4. [Deployment Checklist](#4-deployment-checklist)
5. [Remaining Work](#5-remaining-work)
6. [Next Execution Order](#6-next-execution-order)

---

## 1. Current Security State

| Issue | Status |
|---|---|
| RLS disabled on all 11 public tables | ✅ Resolved |
| `public.users.password` exposed | ✅ Resolved |
| No auth bridge between legacy IDs and Supabase Auth | ✅ Resolved |
| Mutable `search_path` on helper functions | ✅ Resolved |
| Leaked password protection disabled | 🟡 Manual Auth dashboard action required |
| Raw `fetch()` calls with hardcoded URLs in frontend | ✅ Resolved |
| `student_id` sent from client in submissions | ✅ Resolved |
| Hardcoded mock data in InstructorDashboard | ✅ Resolved |
| Cloudinary public URLs for protected files | ✅ Resolved |
| No Zod validation on route inputs | ✅ Resolved |
| No request ID / structured logging | ✅ Resolved |
| No env validation at boot | ✅ Resolved |
| No auth middleware | ✅ Resolved |
| Role / userId trusted from request body | ✅ Resolved |
| Missing `GET /api/admin/courses` | ✅ Resolved (P2-1) |
| `storage_path` leaked to client | ✅ Resolved (P2-6) |
| No readiness probe endpoint | ✅ Resolved (P2-9) |
| Instructor analytics missing per-student breakdown | ✅ Resolved (P2-8) |
| Bulk-enroll silent Auth failure | ✅ Resolved (P2-2) |
| Static AI insight on DashboardPage | ✅ Resolved (P2-7) |
| No bot protection on login | ✅ Resolved (P2-10) |
| No audit trail on key admin/instructor actions | ✅ Resolved (P3-1) |
| Seed users on shared temp password `ChangeMe123!` | ⏳ **Run at deployment** — `scripts/rotate-seed-passwords.ts` |
| Orphaned `cloudinary_url` columns in DB | ⏳ **Run at deployment** — `scripts/run-migration.ts migrations/004_drop_cloudinary_url_columns.sql` |

**Supabase security advisor currently reports: 1 warning (leaked password protection — manual Auth dashboard step).**

---

## 2. Completed Work

### Phase 1 (P1-1 → P1-9) ✅
- RLS + policies on all 11 tables
- `user_identity_map` created and backfilled
- `requireAuth` / `requireRole` / `requireSelfOrAdmin` middleware
- Supabase Storage migration (notes + submission files)
- Zod `validateBody` / `validateParams` on all write routes
- Structured logging + `X-Request-ID` on every request
- Zod env validation at boot (`validateEnv()`)
- `GET /api/health` endpoint
- `public.users.password` column dropped
- Helper functions hardened with `SET search_path = ''`
- 15 performance indexes added

### Phase 2 (P2-1 → P2-10) ✅

| # | What |
|---|---|
| P2-1 | `GET /api/admin/courses` — returns `{ id, code, name, instructor_id, instructor_name, enrollment_count, module_count }` |
| P2-2 | Bulk-enroll hard-fails entire transaction on Auth creation error; returns `tempPassword` per new user in response |
| P2-3 | `rateLimit.ts` — all 6 limiters: `loginLimiter`, `aiLimiter`, `aiGradeLimiter`, `uploadLimiter`, `reportLimiter`, `generalApiLimiter` |
| P2-4 | `scripts/rotate-seed-passwords.ts` — rotates `ChangeMe123!` for all seeded Auth accounts; **run at deployment** |
| P2-5 | `migrations/004_drop_cloudinary_url_columns.sql` + `scripts/run-migration.ts` — drops dead `cloudinary_url` columns; **run at deployment** |
| P2-6 | `storage_path` stripped from all note/submission API responses; only `proxy_url` + `signed_url` returned |
| P2-7 | `DashboardPage.tsx` — live AI insight via `api.getStudentAnalytics()` → `api.aiAnalyticsSummary()`; loading spinner + graceful fallback |
| P2-8 | `GET /api/instructor/courses/:id/analytics` — extended with `students[]` array `{ student_id, name, avg_grade, submission_count, late, missed }` |
| P2-9 | `GET /api/ready` — probes DB + Supabase Storage; returns 200 `{ status: "ready" }` or 503 `{ status: "unavailable", checks }` |
| P2-10 | hCaptcha on login — `useCaptcha.ts` hook dynamically loads widget; `supabaseSignIn()` forwards `captchaToken`; disabled automatically when `VITE_HCAPTCHA_SITE_KEY` is not set |

### Phase 3 (P3-1 + P3-3) ✅

| # | What |
|---|---|
| P3-1 | `audit_logs` table (`migrations/005_create_audit_logs.sql`) — append-only, indexed by `created_at`, `actor_user_id`, `(resource_type, resource_id)` |
| P3-1 | `src/server/middleware/audit.ts` — `writeAudit()` fire-and-forget writer; `setAuditPool()` called at startup |
| P3-1 | `writeAudit` wired on: `login.success`, `login.denied`, `grade.submit`, `note.delete`, `assignment.archive`, `user.create`, `user.update`, `enrollment.bulk`, `course.create`, `course.delete`, `enrollment.create`, `enrollment.delete` |
| P3-1 | `GET /api/admin/audit-logs` — admin-only, paginated (limit/offset), filterable by `action`, `actor_user_id`, `resource_type`, `since`, `until` |
| P3-3 | Student `RoadmapPage.tsx` — course picker, AI generate/regenerate, milestone stepper with status cycling (pending → in_progress → completed), progress bar |
| P3-3 | `InstructorRoadmapView.tsx` — slide-over panel on Students tab, read-only view of any student's roadmap per course, progress bar, milestone list |
| P3-3 | `InstructorDashboard.tsx` — "Roadmap" button per student row; `StudentStat` extended with `course_id` / `course_name` |
| P3-3 | `api.ts` — `getRoadmap`, `generateRoadmap`, `updateMilestoneStatus`, `deleteRoadmap` methods |
| P3-3 | `AdminCourseManagement.tsx` — bulk-enroll now shows temp-password table with per-row + copy-all clipboard buttons |

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
| local | 005_create_audit_logs.sql — **run against prod DB** |

---

## 4. Deployment Checklist

Run these **once** against the production database immediately after deployment:

```bash
# 1. Drop orphaned cloudinary_url columns (P2-5)
npx tsx scripts/run-migration.ts migrations/004_drop_cloudinary_url_columns.sql

# 2. Create audit_logs table (P3-1)
npx tsx scripts/run-migration.ts migrations/005_create_audit_logs.sql

# 3. Rotate ChangeMe123! seed passwords (P2-4)
npx tsx scripts/rotate-seed-passwords.ts
```

Do these **once** in the Supabase Auth dashboard:
- Authentication → Settings → Password Security → Enable **"Check passwords against HaveIBeenPwned"**
- Authentication → Settings → Bot and Abuse Protection → Enable **hCaptcha** → paste in your **hCaptcha Secret Key**

Add to **Vercel environment variables** (Production + Preview):
- `VITE_HCAPTCHA_SITE_KEY` — from [https://dashboard.hcaptcha.com](https://dashboard.hcaptcha.com) → Settings → Sites → your site → **Site Key**

---

## 5. Remaining Work

### P3-2 — Analytics snapshots + cron 🟢

Add `analytics_snapshots` table + background cron job so dashboards read pre-aggregated data instead of hitting raw tables on every load.

---

## 6. Next Execution Order

| Priority | Task | Est. effort |
|---|---|
| 🟢 1 | P3-2: `analytics_snapshots` + cron aggregation job | 60 min |
