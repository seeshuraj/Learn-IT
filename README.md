# LearnIT — AI-Powered Learning Management System

> An LMS that actually helps students understand *why* they're struggling — not just *that* they failed.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.x-000)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57)](https://github.com/WiseLibs/better-sqlite3)

---

## What is LearnIT?

Universities use LMSs that only track grades and deadlines. They don't tell students *why* they're struggling or give instructors scalable, high-quality feedback tools.

**LearnIT fixes this with three AI-powered surfaces:**

1. **AI Grading Assistant** — Instructors see LLM-suggested scores + feedback for each submission, accept or edit, saving hours per week.
2. **Module Chatbot** — Students ask questions and get answers grounded in *their own course notes* (RAG pipeline, not generic ChatGPT).
3. **Student Analytics** — Per-course grade breakdowns, trend lines, pending assignment tracking, and an AI summary that tells each student exactly where to focus.

---

## Roles

| Role | Access |
|---|---|
| **Admin** | Manage users, courses, system settings |
| **Instructor** | Create modules & assignments, view submissions, AI-assisted grading |
| **Student** | Enroll in courses, submit assignments, chat with course notes, view analytics |

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Express 4 + TypeScript |
| Database | SQLite via `better-sqlite3` |
| AI | NVIDIA NIM (OpenAI-compatible) — `mistral-large` |
| Build | Vite |

---

## Local Setup

### Prerequisites
- Node.js 20+
- npm 10+

### Install & run

```bash
git clone https://github.com/seeshuraj/Learn-IT.git
cd Learn-IT
npm install
```

Create a `.env` file in the project root:

```env
NVIDIA_API_KEY=your_nvidia_nim_api_key   # optional — falls back to mock responses
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

Run both dev servers:

```bash
# Terminal 1 — API (port 3001)
npm run server

# Terminal 2 — Frontend (port 5173)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and log in with any seeded email:

| Email | Role |
|---|---|
| `admin@learnit.edu` | Admin |
| `instructor@learnit.edu` | Instructor |
| `sarah@learnit.edu` | Student |
| `michael@learnit.edu` | Student |

> Password field is not enforced in dev — just enter the email.

---

## Project Structure

```
Learn-IT/
├── server.ts                 # Express API + SQLite + NVIDIA NIM routes
├── src/
│   ├── App.tsx               # Root layout, auth guard, role-based routing
│   ├── pages/
│   │   ├── AdminDashboard.tsx
│   │   ├── InstructorDashboard.tsx
│   │   ├── StudentDashboard.tsx
│   │   ├── CoursesPage.tsx
│   │   ├── ModulesPage.tsx
│   │   ├── AssignmentsPage.tsx
│   │   ├── GradingPage.tsx
│   │   ├── AnalyticsPage.tsx  # ← Student analytics + AI summary
│   │   └── SettingsPage.tsx
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   └── LoginPage.tsx
│   └── services/
│       └── api.ts             # Typed API client
└── learnit.db                 # Auto-created SQLite DB on first run
```

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| POST | `/api/login` | Auth by email |
| GET | `/api/courses` | List active courses |
| GET | `/api/courses/:id/modules` | Modules in a course |
| POST | `/api/courses/:id/modules` | Create module |
| GET | `/api/modules/:id/assignments` | Assignments in a module |
| POST | `/api/modules/:id/assignments` | Create assignment |
| GET | `/api/instructor/submissions` | Ungraded submissions |
| POST | `/api/submissions` | Submit assignment |
| POST | `/api/submissions/:id/grade` | Save grade + feedback |
| POST | `/api/ai/grade` | AI grading suggestion |
| POST | `/api/ai/chat` | Module chatbot (RAG) |
| GET | `/api/students/:id/analytics` | Per-student grade analytics |
| POST | `/api/ai/analytics-summary` | AI-generated progress summary |
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/users` | Create user |
| GET | `/api/settings` | System settings |
| PUT | `/api/settings` | Update settings |

---

## Roadmap (YC Sprint)

### Week 1–2 (Foundation)
- [x] Auth + role-based dashboards
- [x] Admin: user & course management
- [x] Instructor: modules, assignments, submissions
- [x] Student: enroll, submit, view grades
- [x] AI grading assistant (NIM)
- [x] Student analytics page

### Week 3–4 (Traction)
- [ ] Notes upload + per-module RAG chatbot
- [ ] Pilot with 1 real class (target: 20+ students)
- [ ] Collect: # AI-assisted grades, # chatbot questions, student NPS

### Week 5–6 (YC Application)
- [ ] Instructor class-level analytics (avg grades, late rate, weak spots)
- [ ] Email notifications for new submissions / grades
- [ ] 1-minute demo video
- [ ] YC application submitted

---

## Traction Metrics (Target)

| Metric | Target at YC submission |
|---|---|
| Active instructors | 3–5 |
| Active students | 30–50 |
| AI-assisted grades | 50+ |
| Chatbot questions asked | 100+ |
| Instructor time saved (self-reported) | ≥30% |
| Student "clarity" NPS | ≥8/10 |

---

## Why LearnIT?

- **Existing LMSs** (Moodle, Canvas, Blackboard) are workflow tools, not learning tools. They track *that* you submitted — not *whether you understood*.
- **LLMs** finally make personalised, per-student academic feedback feasible at scale.
- **Instructors** are overwhelmed. A class of 200 with weekly assignments means 200 pieces of feedback — this is where AI earns its place.
- **Students** want to know *why* they got 64%, not just that they did.

---

## Contributing

Open an issue or PR. The codebase is intentionally simple — no ORM, no auth library, no microservices — so it's fast to move.

---

## License

MIT
