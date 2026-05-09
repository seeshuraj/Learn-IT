# LearnIT — AI-Powered Learning Management System

> An LMS that tells students **why** they're struggling — not just *that* they failed.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.x-000)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57)](https://github.com/WiseLibs/better-sqlite3)
[![NVIDIA NIM](https://img.shields.io/badge/AI-NVIDIA%20NIM-76B900)](https://build.nvidia.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is LearnIT?

Universities use LMSs that only track grades and deadlines. They don't tell students *why* they're struggling or give instructors scalable, high-quality feedback tools.

**LearnIT fixes this with three AI-powered surfaces:**

| Surface | Who it helps | What it does |
|---|---|---|
| 🎯 **AI Grading Assistant** | Instructors | LLM-suggested score + structured feedback per submission; instructor accepts or edits |
| 💬 **Module Chatbot** | Students | RAG-powered Q&A grounded in the student's own uploaded course notes |
| 📊 **Student Analytics** | Students + Instructors | Per-course grade trends, late tracking, AI-written personalised progress summary |

---

## Roles

| Role | Dashboard | Key actions |
|---|---|---|
| **Student** | `/` | Enroll, submit assignments, upload notes, chat with notes, view analytics |
| **Instructor** | `/` | Create modules/assignments, view & AI-grade submissions, class analytics |
| **Admin** | `/` | Manage users, courses, enrollments, system settings |

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS v4 + Vite |
| Backend | Express 4 + TypeScript (tsx) |
| Database | SQLite via `better-sqlite3` |
| AI | NVIDIA NIM (Mistral Large / nv-embedqa-e5-v5) |
| File parsing | `multer` + `pdf-parse` + `mammoth` |
| Charts | Recharts |
| Deploy | Vercel (frontend) + Render (backend) |

---

## Local Setup

### Prerequisites
- Node.js 20+
- npm 10+
- (Optional) NVIDIA NIM API key — free at [build.nvidia.com](https://build.nvidia.com)

### 1. Clone & install

```bash
git clone https://github.com/seeshuraj/Learn-IT.git
cd Learn-IT
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
NVIDIA_API_KEY=nvapi-xxxx   # optional — mock AI used if blank
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

### 3. Run (both servers, single command)

```bash
npm run dev
```

This starts:
- **API** on `http://localhost:3000` (Express + SQLite)
- **Frontend** on `http://localhost:5173` (Vite, proxies `/api/*` to `:3000`)

### 4. Open and log in

Go to `http://localhost:5173` → you'll see the landing page.

Click **Try the Demo** or **Sign in**, then use any seeded account:

| Email | Role | Password |
|---|---|---|
| `admin@learnit.edu` | Admin | *(any — not enforced in dev)* |
| `instructor@learnit.edu` | Instructor | *(any)* |
| `sarah@learnit.edu` | Student | *(any)* |
| `michael@learnit.edu` | Student | *(any)* |

---

## Project Structure

```
Learn-IT/
├── server.ts                      # Express API + SQLite + NVIDIA NIM
├── src/
│   ├── App.tsx                    # Root layout, auth guard, role-based routing
│   ├── types.ts                   # Shared TypeScript interfaces
│   ├── pages/
│   │   ├── LandingPage.tsx        # Public marketing page
│   │   ├── LoginPage.tsx          # Auth + demo credentials panel
│   │   ├── DashboardPage.tsx      # Student dashboard
│   │   ├── InstructorDashboard.tsx
│   │   ├── AdminDashboard.tsx
│   │   ├── AdminUserManagement.tsx
│   │   ├── AdminCourseManagement.tsx
│   │   ├── AdminSettings.tsx
│   │   ├── CoursesPage.tsx
│   │   ├── CourseDetailPage.tsx
│   │   ├── AssignmentsPage.tsx
│   │   ├── NotesPage.tsx
│   │   └── AnalyticsPage.tsx      # Student analytics + AI summary
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── ChatBot.tsx            # RAG-powered module chatbot
│   │   └── AnalyticsDashboard.tsx
│   └── services/
│       ├── api.ts                 # Typed API client (all endpoints)
│       └── aiService.ts           # AI helpers (grading, chat, analytics)
├── .env.example                   # Environment variable template
├── vite.config.ts                 # Vite config with /api proxy
├── render.yaml                    # Render deployment config
└── vercel.json                    # Vercel deployment config
```

---

## API Reference

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/login` | Auth by email |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/courses` | All active courses |
| `GET` | `/api/courses/:id/modules` | Modules in a course |
| `POST` | `/api/courses/:id/modules` | Create module |
| `GET` | `/api/modules/:id/assignments` | Assignments in module |
| `POST` | `/api/modules/:id/assignments` | Create assignment |
| `POST` | `/api/submissions` | Submit assignment (text) |
| `POST` | `/api/submissions/upload` | Submit assignment (files) |
| `POST` | `/api/submissions/:id/grade` | Save instructor grade |
| `GET` | `/api/instructor/submissions` | Ungraded submissions queue |
| `POST` | `/api/modules/:id/notes` | Upload note file (triggers RAG embed) |
| `GET` | `/api/students/:id/notes` | All notes for a student |
| `DELETE` | `/api/notes/:id` | Delete note + file |
| `GET` | `/api/student/:id/assignments` | Student assignment list |
| `GET` | `/api/students/:id/analytics` | Full analytics payload |
| `GET` | `/api/admin/users` | All users |
| `POST` | `/api/admin/users` | Create user |
| `POST` | `/api/admin/bulk-enroll` | Bulk enroll by email list |
| `GET` | `/api/admin/stats` | Platform-wide stats |
| `POST` | `/api/ai/grade` | AI grading (text submission) |
| `POST` | `/api/ai/grade-pdf` | AI grading (file submission + RAG notes) |
| `POST` | `/api/ai/chat` | Module chatbot (RAG) |
| `POST` | `/api/ai/analytics-summary` | AI progress summary |

---

## Deployment

### Frontend → Vercel

```bash
npx vercel --prod
```

Set env var in Vercel dashboard:
```
VITE_API_BASE_URL=https://your-render-app.onrender.com
```

### Backend → Render

The `render.yaml` is pre-configured. Connect repo → Render auto-deploys on push.

Set env vars in Render dashboard:
```
NVIDIA_API_KEY=nvapi-xxxx
CORS_ORIGIN=https://your-vercel-app.vercel.app
NODE_ENV=production
```

---

## Roadmap

### ✅ Done
- Auth + role-based dashboards (Student / Instructor / Admin)
- Course, module, assignment CRUD
- Assignment submission (text + file upload)
- AI grading assistant (text + PDF, NVIDIA NIM)
- RAG pipeline: notes upload → chunk → embed → retrieve
- Module chatbot (grounded in student notes)
- Student analytics (grade trends, late tracking)
- AI analytics summary
- Public landing page
- Admin: user management, course management, bulk enrollment, settings

### 🔜 Next
- [ ] Pilot with real class (target: 20+ students, 3+ instructors)
- [ ] Collect traction metrics: AI-assisted grades, chatbot questions, instructor time saved
- [ ] Email notifications (new grade, new submission)
- [ ] Instructor class-level analytics with AI class health summary
- [ ] YC application submitted

---

## Why LearnIT?

- **Canvas / Moodle / Blackboard** are workflow tools — they track *that* you submitted, not *whether you understood*.
- **LLMs** make per-student academic feedback at scale feasible for the first time.
- **Instructors** are overwhelmed — a class of 200 with weekly assignments means 200 pieces of feedback.
- **Students** want to know *why* they got 64%, not just that they did.

---

## Contributing

Open an issue or PR. The codebase is intentionally simple — no ORM, no auth library, no microservices — so it's fast to move.

---

## License

MIT
