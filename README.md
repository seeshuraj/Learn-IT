# LearnIT — AI-Powered LMS

An AI-enhanced Learning Management System for universities. Supports student, instructor, and admin roles with AI-assisted grading, notes-based chatbot, and analytics summaries.

---

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in values (NVIDIA_API_KEY optional — mock AI works without it)
cp .env.example .env

# 3. Start the dev server (Express + Vite on the same port)
npm run dev

# Open: http://localhost:3000
```

> **How it works in dev:** `server.ts` starts Express on port 3000 and embeds Vite as middleware. This means API routes (`/api/*`) and the React frontend (with HMR) are both served from a single port — no proxy needed, no separate terminals.

---

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@learnit.edu | *(any — auth is email-only in demo)* |
| Instructor | instructor@learnit.edu | *(any)* |
| Student | sarah@learnit.edu | *(any)* |
| Student | michael@learnit.edu | *(any)* |

---

## Project Structure

```
Learn-IT/
├── server.ts          # Express API + Vite middleware (single entrypoint)
├── src/
│   ├── App.tsx        # React router + auth context
│   ├── pages/         # Role-based page components
│   ├── components/    # Shared UI components
│   ├── services/
│   │   ├── api.ts     # Typed API client
│   │   └── aiService.ts
│   ├── constants.ts   # Nav items
│   └── types.ts       # Shared TypeScript types
├── vite.config.ts
├── package.json
└── .env.example
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Tailwind CSS v4, Recharts |
| Backend | Express, better-sqlite3, tsx |
| AI | NVIDIA NIM (Mistral Large) via server-side proxy |
| Dev server | Vite embedded as Express middleware |
| Deployment | Vercel (frontend) + Render (API) |

---

## Deployment

### Backend (Render)

1. Set environment: `NODE_ENV=production`, `PORT=3000`, `NVIDIA_API_KEY`, `CORS_ORIGIN`
2. Build command: `npm install`
3. Start command: `npm start`

### Frontend (Vercel)

1. Set `VITE_API_BASE_URL=https://your-render-url.onrender.com`
2. Build command: `npm run build`
3. Output directory: `dist`

---

## Common Issues

### `POST /api/login` → 405

This means you have a **standalone Vite dev server** (e.g. ran `vite` directly or an old `npm run dev` that only started Vite). The fix:

```bash
# Always use this — starts Express+Vite together:
npm run dev
```

Do **not** run `vite` or `npx vite` directly. The Vite proxy has been removed from `vite.config.ts` because Vite runs inside Express, not alongside it.

### AI returns mock responses

Add your `NVIDIA_API_KEY` to `.env`. Get a free key at [build.nvidia.com](https://build.nvidia.com). Without a key the server returns hardcoded mock data so the UI still works.
