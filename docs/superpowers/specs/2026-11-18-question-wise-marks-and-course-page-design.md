# Question-wise marks, course notice board, and cross-role fixes

Date: 2026-11-18 · Status: awaiting approval

## Why

Indian engineering exams are written as Part A / Part B / Part C papers, and
professors mark them question by question. Generic ERPs only take a total,
which forces professors to add up on paper and throws away the detail that
shows *where* a student lost marks. Entering marks per question makes entry
match the paper in hand, and it lets LearnIT trace weak topics to the exact
questions (and units) a student struggled with, which feeds the exam-dated
study plans already built.

Separately, an audit found that the course page never loads, the
notification bell has never worked in production, and several pages show
invented numbers. These break the admin → professor → student chain the
product is meant to provide, so they are fixed first.

## Goals

1. Fix the cross-role breaks found in the audit (section A).
2. Every assessment can carry its own question-paper pattern; professors
   enter marks per question and totals are computed (section B).
3. Each course has a real page with a notice board the course professor
   posts to, and students are notified (section C).

## Non-goals

- Mark conversion/scaling (e.g. a 50-mark paper counted as 20 internal
  marks). Totals equal the paper total; conversion can come later.
- Sub-question marks (11(a)(i), 11(a)(ii)): one mark per question number.
- Direct messaging between students and professors.
- Attachments on course notices (text only in this round).

## Anti-goals

- Entry that is slower than typing a total today.
- Totals that can disagree with question marks anywhere (grid, import,
  student view, analytics, study plans).
- Breaking assessments that already have total-only marks.

## A. Fixes from the audit

| Problem | Fix |
|---|---|
| Course page calls the API without the login token → never loads | Rewrite on the shared `api` client |
| Notification bell calls the website's own origin → never works in prod | Use the shared `api` client (API base URL + token) |
| Course cards show fake "12 Lessons / 45 Enrolled / 4.8★"; course page fake 65%, 12/18 | Real counts from the server, or nothing |
| Professors see every college course; opening someone else's is refused | Professors list the courses they teach; admins see all |
| `/api/courses` has no professor name | Join it in |
| Dead buttons (Syllabus, Message Instructor, Filter, career buttons) and unused components (`AnalyticsDashboard`, `AIGradingPanel`) | Remove |
| Assignment creation via `prompt()` dialogs | Inline form |
| Legacy "materials" list (rows without files) | Replace with the module's notes, which are the real course materials |

## B. Question-wise marks

### Approaches considered

1. **Pattern stored with the exam, question marks stored with each result
   (chosen).** Smallest migration; a save stays one all-or-nothing upsert;
   the computed total fills the existing `marks_obtained` / `external_marks`,
   so grades, publishing, student views and study plans keep working.
   Per-question analytics is computed in the app (≤ 2,000 rows per exam).
2. Normalised tables (one row per question, one per student per question).
   Most flexible for raw SQL reporting, but ~32k rows per exam at 2,000
   students, slower and more complex saves, bigger migration. Rejected for
   now.
3. Part totals only. Fast to type but loses question detail, which is the
   point. Rejected.

### The pattern (per assessment)

Every assessment has its own pattern, so Unit Test 1 and Unit Test 2 can
differ in question count, marks per question, and choices, even at the same
50-mark total. The professor builds it in the assessment form:

```
Part A   [10] questions × [2] marks           answer [all ▾]
Part B   [ 5] questions × [13] marks  [✓] either (a) or (b)   answer [all ▾]
Part C   [ 1] question  × [15] marks  [✓] either (a) or (b)   answer [all ▾]
                                               Paper total: 100
```

- A part is defined by count × marks; individual questions can then have
  their marks changed (e.g. Q12 = 16 when the rest are 13).
- Parts can be added or removed (A/B/C by default; some papers have only A
  and B).
- "Either (a) or (b)": one mark per question number, plus which option was
  written.
- "Answer any N of M": only the best N questions in that part count.
- Each question (or each option of an either/or question) can be tagged with
  a unit/module of the course. Optional; untagged questions still count.
- Question numbering runs continuously across parts (1–10, 11–15, 16), as on
  Anna University papers; it can be edited.
- **Paper total** is computed: per part, the sum of the counted questions'
  marks (for "any N", the N highest). It sets the assessment's max marks
  (or `external_max` for split end-semester assessments, where the pattern
  describes the external paper and internal marks are entered separately).
- **Templates:** the professor can save a pattern under a name ("CSE unit
  test 50", "Semester R2021") for the college and reuse it in one click.
  A built-in "Anna University semester (100)" preset is always offered.
- Assessments without a pattern keep total-only entry exactly as today.

### Changing a pattern after marks exist

- Allowed while the assessment is unpublished, if every entered mark still
  fits (question exists and mark ≤ its new maximum). All totals, grades and
  bands are recomputed in the same transaction.
- Otherwise refused, listing which students and questions no longer fit.
- Published assessments: unpublish first (existing rule).

### Entering marks

The grid gets one column per question, grouped under Part headers, with a
live row total:

```
            │ Part A (2 each)          │ Part B (13 each, a/b)   │ C (15) │
Roll  Name  │ 1  2  3  4  5  6  7  8 9 10 │ 11  12  13  14  15     │ 16     │ Total
──────────────────────────────────────────────────────────────────────────────────
21CS01 Asha │ 2  2  1  2  0  2  2  1 2  2 │ 10a 12b 9a  —   11a   │ 13b    │ 83
```

- Enter/Tab move to the next cell in the row; arrow keys move around.
- Either/or cells take "10a" / "12b" (or a/b toggle); a bare number defaults
  to (a).
- Blank = not attempted (0). Values above the question's max are flagged
  red and block saving.
- Absent toggle per row, as today. Row total, percentage and grade update
  live; the server recomputes and is the authority.
- Large classes: the grid stays scrollable with a sticky name column.

### Excel import/export

- "Download template" produces a sheet with Roll/Email/Name and one column
  per question (`Q1 … Q16`, either/or as `Q11` = `10a`).
- Import reads those columns when the assessment has a pattern; otherwise
  the current total-column import applies. Preview before save, as today.

### What students see (after publish)

- My Marks shows the total as now, plus a breakdown: per part, per question
  (max, obtained, option written), and per unit where tagged.

### Analytics and study plans

- Per-question class average (% of max) and attempt rate, per-part
  averages, per-unit averages.
- `topic_breakdown` for each student is filled from tagged questions
  (module name → % scored). This is the field the study-plan weak-topic
  ranking already reads, so weak topics come from actual question marks.

### Data changes (one migration)

- `unit_exams.question_pattern jsonb null` — the pattern (versioned shape,
  validated by the server).
- `unit_exam_results.question_marks jsonb null` — e.g.
  `{"1": 2, "11": {"m": 10, "o": "a"}}`.
- `exam_patterns` (id, institution_id, name, assessment_type, pattern,
  created_by, timestamps), unique (institution_id, name), RLS by college like
  other tenant tables.

## C. Course page and notice board

### Course page

One server call returns the course overview for the caller: course, professor
name, modules with their notes, assignments, upcoming published exams for the
course, and notices. Students also see their published marks for the course.
Professors of the course get add/edit controls; admins can view.

### Notice board

- The course professor (or an admin) posts a notice: kind (notice / bring
  this / exam prep / reminder), title, optional details, optional "by" date,
  optional pin.
- Students enrolled in the course are notified on posting (in-app bell).
- Sorting: pinned first, then upcoming "by" dates, then newest. Notices whose
  "by" date has passed are moved under "Earlier".
- The student dashboard shows notices due in the next two days across all
  their courses ("Tomorrow: bring drawing kit — EG101").
- Edit and delete by the author or an admin. Audited.

### Data changes

- `course_announcements` (id, institution_id, course_id, author_id, kind,
  title, body, due_date, pinned, timestamps), composite FK to the course
  within the college, RLS by college.

## Constraints

- Multi-tenant: every query scoped to the caller's college; RLS on new
  tables; access checks via existing `assertCanAccessCourse` /
  `assertManagesCourse`.
- Migrations only; backward-compatible (new nullable columns, new tables).
- No student PII in logs; audit entries carry ids, not names.
- India time (IST) for "tomorrow" and due dates.

## Left to the builder

- Exact JSON shape and validation messages of the pattern.
- Grid keyboard details beyond those listed.
- Visual details, within the existing slate/indigo card style.

## Rollout

Three PRs, each deployable on its own: (A) fixes, (B) question-wise marks,
(C) course page and notices. Migrations for B and C are applied after
approval, before their PRs merge.
