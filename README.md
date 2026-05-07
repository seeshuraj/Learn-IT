# LearnIT — AI-Powered University LMS

> An intelligent Learning Management System that uses LLMs to help universities automatically grade assignments, surface where students are falling behind, and let students chat with their own course notes.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![NVIDIA NIM](https://img.shields.io/badge/AI-NVIDIA%20NIM-76b900.svg)](https://build.nvidia.com)
[![React](https://img.shields.io/badge/frontend-React%2018-61dafb.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6.svg)](https://typescriptlang.org)

---

## What is LearnIT?

Existing LMSs (Moodle, Canvas, Blackboard) track grades and deadlines — they don't tell students *why* they're struggling or give instructors scalable, high-quality feedback tools.

LearnIT adds three AI superpowers on top of a full-featured LMS:

| Feature | Who benefits | How it works |
|---|---|---|
| **AI Grading Assistant** | Instructors | LLM analyses submission vs rubric → suggests score + structured feedback. Instructor accepts or overrides in one click. |
| **Notes-Aware Chatbot** | Students | Students upload their module notes → RAG-powered chatbot answers questions grounded in *their own* notes, not generic internet answers. |
| **AI Analytics Summary** | Students + Instructors | Computes per-course averages, submission rates, late patterns → LLM generates a 3-sentence actionable summary with specific recommendations. |

---

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript + SQLite (via `better-sqlite3`)
- **AI:** [NVIDIA NIM](https://build.nvidia.com) — free endpoints, OpenAI-compatible API
  - Chat/Grading/Analytics: `mistral-nemo-12b-instruct`
  - Embeddings (RAG): `nvidia/llama-3.2-nemoretriever-300m-embed-v1`
- **Auth:** Session-based, role-aware (student / instructor / admin)

---

## Quick Start

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

Get a free NVIDIA NIM API key at **[build.nvidia.com](https://build.nvidia.com)** — sign up, open any free model endpoint, copy your key:

```env
VITE_NVIDIA_API_KEY=nvapi-your-key-here
```

> **No key?** The app runs in mock mode with realistic stub responses — perfect for demos.

### 3. Run

```bash
# Terminal 1 — backend
npm run server

# Terminal 2 — frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Demo Accounts

| Role | Email | Password |
|---|---|---|
| Student | student@learnit.ie | student123 |
| Instructor | instructor@learnit.ie | instructor123 |
| Admin | admin@learnit.ie | admin123 |

---

## Features

### Student Dashboard
- Enrolled courses with progress tracking
- Assignment list with due dates and submission status
- Module notes upload + AI-powered chatbot (RAG over your own notes)
- Analytics page: per-course grade trends + AI performance summary

### Instructor Dashboard
- Class overview with submission rates and grade distributions
- AI Grading Panel on every submission — one-click grade suggestion with structured feedback
- At-risk student identification
- Module and assignment management

### Admin Panel
- User management (create/deactivate students and instructors)
- Course management (create courses, assign instructors)
- System settings

---

## AI Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      NVIDIA NIM                         │
│  mistral-nemo-12b-instruct  (chat / grading / summary)  │
│  llama-3.2-nemoretriever-300m  (embeddings for RAG)     │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
┌────────▼──────┐  ┌──────────▼──────┐  ┌────────▼──────────┐
│  AI Grading   │  │  Notes RAG Chat │  │  Analytics LLM    │
│  Panel        │  │  (Student)      │  │  Summary          │
│  (Instructor) │  │                 │  │  (Both)           │
└───────────────┘  └─────────────────┘  └───────────────────┘
```

**Mock mode:** When `VITE_NVIDIA_API_KEY` is not set, all AI calls return realistic hardcoded responses. This means you can develop, test, and demo without an API key.

---

## Project Structure

```
src/
├── components/
│   ├── AIGradingPanel.tsx     # Instructor: AI grade suggestion UI
│   ├── AIAnalyticsSummary.tsx # Typewriter-reveal AI summary card
│   ├── ChatBot.tsx            # Floating RAG chatbot (all roles)
│   ├── Header.tsx
│   └── Sidebar.tsx
├── pages/
│   ├── DashboardPage.tsx      # Student dashboard
│   ├── InstructorDashboard.tsx
│   ├── AdminDashboard.tsx
│   ├── CoursesPage.tsx
│   ├── AssignmentsPage.tsx
│   ├── NotesPage.tsx          # Notes upload + chatbot
│   └── AnalyticsPage.tsx      # Grade trends + AI summary
├── services/
│   └── aiService.ts           # NVIDIA NIM integration
├── types.ts
└── constants.ts
```

---

## Roadmap

- [ ] Real-time collaboration on notes
- [ ] Voice input for the chatbot (NVIDIA Nemotron Voicechat)
- [ ] Institutional SSO (SAML/OAuth)
- [ ] Mobile app (React Native)
- [ ] Plagiarism detection (content safety models)
- [ ] Multi-language support (NVIDIA Riva Translate)

---

## Contributing

PRs welcome. Please open an issue first to discuss major changes.

---

## License

MIT © 2026 LearnIT
