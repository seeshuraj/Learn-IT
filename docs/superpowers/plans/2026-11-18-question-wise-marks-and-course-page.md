# Question-wise marks, course notice board, cross-role fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audit's cross-role breaks, add per-question Part A/B/C marks entry with mark conversion, and give every course a real page with a notice board.

**Architecture:** Pattern is JSONB on `unit_exams`, question marks JSONB on `unit_exam_results`; a pure `questionPattern.ts` validates and scores, and `computeResult` gains a question-marks path so every existing consumer (grades, publish, study plans) keeps reading `marks_obtained`. Course notices are a new tenant table behind `assertCanAccessCourse` / `assertManagesCourse`.

**Tech Stack:** Express + pg (server.ts, src/server/routes), React 19 + Tailwind v4, Supabase Postgres 17, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-11-18-question-wise-marks-and-course-page-design.md` — plus the user's addition on 2026-11-18: **mark conversion** ("written out of 50, counts as 20").

## Global Constraints

- Every query scoped to the caller's `institution_id`; new tables have RLS enabled with the same policy shape as existing tenant tables.
- Migrations only, additive (nullable columns, new tables). Existing total-only assessments behave exactly as today.
- No names/emails/marks in logs; audit metadata carries ids and counts.
- IST for "today/tomorrow" (`todayIst()` from `studyPlan.ts`).
- Totals have at most 2 decimals; question marks allow halves (0.5 steps) — matches paper marking.
- UI copy: sentence case, plain words, existing slate/teal card style.

## Review Focus

1. Pattern edited after marks exist → totals/grades recomputed in one transaction; a mark that no longer fits blocks the edit with student + question named. (Task B3 test)
2. "Any N of M" with unequal question marks → part max = sum of N largest; part score = sum of N best *obtained*. (Task B1 test)
3. Either/or cell typed as `12B`, ` 12 b`, `12`, `b12` → first three accepted (bare = a), last rejected. (Task B1 test)
4. Conversion with absent student → converted is null, not 0. (Task B2 test)
5. Student not enrolled / different college reading a course's notices → 403/404. (Task C1 test)

---

## PR A — Cross-role fixes (branch `fix/cross-role-audit`)

### Task A1: Notification bell uses the API client

**Files:** Modify `src/components/NotificationBell.tsx`; Modify `src/services/api.ts`

**Produces:** `api.getNotifications()`, `api.getUnreadCount(): Promise<{count:number}>`, `api.markNotificationRead(id)`, `api.markAllNotificationsRead()` (wrap existing `/api/notifications*` routes via `request`).

- [ ] Replace the local `apiFetch` with these functions; keep polling behaviour.
- [ ] Clicking a notification with `metadata.course_id` navigates to `/courses/:id`; with `unit_exam_id` (student) to `/marks`.
- [ ] Verify: `check-client.mjs` bundle builds; grep shows no `fetch("/api` left in `src/` outside api.ts.

### Task A2: `/api/courses` returns real, role-scoped data

**Files:** Modify `server.ts` (`GET /api/courses`); Test: `src/server/lib/__tests__/` not needed (SQL) — verified against local Postgres.

- [ ] SQL returns `c.*, u.name AS instructor_name, module_count, student_count` (active student members enrolled).
- [ ] Scope: admin → all college courses; instructor → `c.instructor_id = me`; student → enrolled courses.
- [ ] Verify on local Postgres (`/var/tmp/pgasm`, port 5499) with one course per role.

### Task A3: Courses page and course page show only real data

**Files:** Modify `src/pages/CoursesPage.tsx`, `src/pages/CourseDetailPage.tsx`; Delete `src/components/AnalyticsDashboard.tsx`, `src/components/AIGradingPanel.tsx` (unused — confirm with grep before delete).

- [ ] CoursesPage: both roles call `api.getCourses()`; cards show `module_count` modules and (staff only) `student_count` students; remove rating, filter button.
- [ ] CourseDetailPage: every call through `api` (`getCourses`, `getCourseModules`, module notes); remove fake progress card, Syllabus/Message buttons, `prompt()` assignment flow (assignment creation stays on the Assignments page). Replaced fully in PR C.
- [ ] Verify: preview harness screenshot of both pages; build passes.

### Task A4: Ship PR A

- [ ] Tests (135+) pass, both bundle checks pass, open PR, merge after approval rule (user approved "do it"), confirm Cloud Run + Vercel deploy.

## PR B — Question-wise marks (branch `feat/question-wise-marks`)

### Task B1: `questionPattern.ts` — pure pattern rules

**Files:** Create `src/server/lib/questionPattern.ts`; Test `src/server/lib/__tests__/questionPattern.test.ts`

**Produces:**
```ts
interface PatternQuestion { no: string; marks: number; either_or: boolean; module_id: number | null; module_id_b?: number | null }
interface PatternPart { key: string; label: string; answer_count: number | null; questions: PatternQuestion[] }
interface QuestionPattern { version: 1; parts: PatternPart[] }
type QuestionMark = number | { m: number; o: 'a' | 'b' }
validatePattern(raw: unknown): { pattern: QuestionPattern } | { error: string }
paperTotal(p: QuestionPattern): number
partMax(part: PatternPart): number
parseCell(v: unknown, eitherOr: boolean): { mark: QuestionMark | null } | { error: string }
scoreQuestions(p: QuestionPattern, marks: Record<string, QuestionMark>):
  { total: number; parts: { key: string; score: number; max: number }[] } | { error: string }
topicBreakdown(p: QuestionPattern, marks: Record<string, QuestionMark>, moduleNames: Map<number,string>): Record<string, number> | null
ANNA_UNIV_SEMESTER: QuestionPattern   // A 10×2, B 5×13 either/or (Q11–15), C 1×15 either/or (Q16) = 100
```

- [ ] Tests: `paperTotal(ANNA_UNIV_SEMESTER) === 100`; any-N part with marks [8,8,16] and N=2 → `partMax` 24, score of {8,6,10} → 18 (best two of obtained: 10+8); `parseCell('12B', true)` → `{m:12,o:'b'}`, `parseCell('12', true)` → `{m:12,o:'a'}`, `parseCell('b12', true)` → error; mark 2.5 on a 2-mark question → error; 1.5 ok, 1.25 → error (halves only); unknown question number → error; validatePattern rejects: no parts, >60 questions, duplicate numbers, marks ≤0 or >100, answer_count > question count; `topicBreakdown` returns module name → % (either/or uses `module_id_b` when option b and set).
- [ ] Implement; run `node --test` on the file; commit.

### Task B2: `computeResult` question path + conversion

**Files:** Modify `src/server/lib/examGrading.ts`; Test `src/server/lib/__tests__/examGrading.test.ts`

**Consumes:** B1. **Produces:** `ExamConfig` gains `question_pattern?: QuestionPattern | null`, `counted_out_of?: number | null`; `ResultInput` gains `questions?: Record<string, unknown> | null`; `ResultRow` gains `question_marks: Record<string, QuestionMark> | null`, `converted_marks: number | null`.

- [ ] With a pattern: `questions` all blank and not absent → clear; else each cell parsed via `parseCell`, total via `scoreQuestions`; non-split → `marks_obtained = total`; split → `external = total` (pattern max must equal `external_max`), internal still typed.
- [ ] Conversion: `converted_marks = round2(marks_obtained × counted_out_of / max_marks)` when `counted_out_of` set and not absent; null otherwise.
- [ ] Tests: pattern exam total from questions; split exam uses pattern for external; absent → converted null; 38/50 counted out of 20 → 15.2; existing tests unchanged.
- [ ] `readSheetRow` reads `q1…q60` (headers normalised to `q1`) into `input.questions`.

### Task B3: Migration + routes

**Files:** Create `supabase/migrations/20261118100000_question_wise_marks.sql`; Modify `src/server/routes/unitExams.ts`; Create `src/server/routes/examPatterns.ts`; Modify `server.ts` (mount `/api/exam-patterns`).

Migration: `unit_exams.question_pattern jsonb`, `unit_exams.counted_out_of numeric(6,2) check (>0)`, `unit_exam_results.question_marks jsonb`, `unit_exam_results.converted_marks numeric(6,2)`; table `exam_patterns(id bigserial, institution_id uuid not null, name text not null check (length 1–80), assessment_type text, pattern jsonb not null, created_by int, created_at, updated_at, unique(institution_id, lower(name)))` with RLS enabled + institution policy mirroring `departments`.

- [ ] `readExamFields`: accepts `question_pattern` (validated; sets `max_marks`, or `external_max` when split) and `counted_out_of`.
- [ ] `EXAM_COLUMNS`, `roster`, `writeResults`, insights select include the new columns; insights returns per-result `question_marks`, `question_pattern`, `converted_marks`, `counted_out_of`.
- [ ] PATCH re-scores stored `question_marks` against the new pattern; a misfit returns 422 listing `{student_id, error}`; pattern change on a published exam → 409 "Unpublish first".
- [ ] PUT/preview pass `questions` through; `topic_breakdown` written from `topicBreakdown` when questions are tagged.
- [ ] Analytics adds `questions: [{no, part, max, avg_pct, attempted_pct}]`, `parts: [{key, avg_pct}]`.
- [ ] `/api/exam-patterns`: GET list (college), POST {name, assessment_type, pattern}, DELETE /:id (creator or admin). Audited.
- [ ] Verify migration + routes on local Postgres with a seeded course; commit.

### Task B4: Frontend — pattern editor, grid, student view, analytics

**Files:** Create `src/components/assessments/PatternEditor.tsx`, `src/components/assessments/patternMath.ts` (client copy of `partMax`/`paperTotal`/`parseCell`/score for live totals); Modify `AssessmentForm.tsx`, `MarksGrid.tsx`, `AssessmentAnalytics.tsx`, `src/pages/MyMarksPage.tsx`, `src/services/api.ts`.

- [ ] Form: "Marks entry" choice — *Total only* / *Question-wise*; question-wise shows PatternEditor (parts with count × marks, either/or, answer any N, per-question marks + unit), template picker (built-in Anna University + saved), "Save as template"; "Counts as __ marks" field for non-split.
- [ ] Grid (pattern mode): Part header row, one input per question, Tab/Enter → next question then next student, ↑/↓ same column; live row total; cell over max → red; download/import uses `Q1…Qn` columns.
- [ ] MyMarks: expandable breakdown per part / question / unit; converted marks line.
- [ ] Analytics: per-question bar list (avg % of max), part averages.
- [ ] Verify with preview harness screenshots (form, grid, student view) at phone and desktop widths.

### Task B5: Ship PR B — apply migration to production, run tests, PR, merge, deploy.

## PR C — Course page and notice board (branch `feat/course-notices`)

### Task C1: Migration + routes

**Files:** Create `supabase/migrations/20261118110000_course_announcements.sql`; Create `src/server/routes/courses.ts`; Modify `server.ts` (mount).

Table `course_announcements(id bigserial, institution_id uuid not null, course_id int not null, author_id int, kind text check in ('notice','bring','exam_prep','reminder'), title text 1–200, body text ≤4000, due_date date, pinned bool default false, created_at, updated_at)`, composite FK `(course_id, institution_id)` → courses, index `(course_id, pinned desc, due_date)`, RLS.

- [ ] `GET /api/courses/:id/overview` → `{course (with instructor_name), modules:[{id,name,notes:[...]}], assignments, upcoming_exams, notices, my_marks? (student, published only), can_manage}`.
- [ ] `GET/POST /api/courses/:id/announcements`, `PATCH/DELETE /api/announcements/:id`; POST inserts notifications for active enrolled students (`type 'course_notice'`, metadata course_id), audited.
- [ ] `GET /api/announcements/upcoming` → caller's notices with `due_date` today..today+2 (IST), student: enrolled courses, instructor: own courses.
- [ ] Tests on local Postgres: student of another course → 403; other college → 404; instructor not teaching → 403 on POST.

### Task C2: Frontend course page + dashboard card

**Files:** Rewrite `src/pages/CourseDetailPage.tsx`; Create `src/components/course/NoticeBoard.tsx`, `src/components/course/NoticeForm.tsx`, `src/components/course/UpcomingNotices.tsx`; Modify `DashboardPage.tsx`, `InstructorDashboard.tsx` (link), `src/services/api.ts`.

- [ ] Layout: header (code, name, professor), notice board (pinned, upcoming by date, earlier collapsed), modules with notes (open in Notes viewer link), assignments, upcoming exams; student "My marks here" strip.
- [ ] Professor: post/edit/delete notice inline.
- [ ] Dashboard (student): "Coming up" notices card.
- [ ] Screenshots phone + desktop.

### Task C3: Ship PR C — migration to production, PR, merge, deploy.

## Final: live end-to-end check with the provided test logins

- [ ] Playwright against production (credentials via env vars only, never written to files in the repo):
  admin → departments/courses/timetables pages load without errors;
  instructor → create `[Test]` assessment with question-wise pattern, enter marks for Sarah, publish; post a `[Test]` notice;
  student (Sarah) → bell shows both notifications, course page shows the notice, My Marks shows question breakdown, Exams page loads.
- [ ] Capture console errors and failed requests for every page of each role.
- [ ] Remove the `[Test]` assessment and notice afterwards (data created by this test only).
