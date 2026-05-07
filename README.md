# LearnIT — AI-Powered University LMS

> **YC-track project** — An LMS that uses LLMs to automate grading, let students chat with their own notes, and surface personalised performance analytics.

## Live AI Features

| Feature | Surface | Model |
|---|---|---|
| AI Grading Suggestions | Instructor Dashboard → Submissions | Gemini 2.0 Flash |
| Notes-Aware Module Chatbot | Notes & AI Chat page | Gemini 2.0 Flash (RAG) |
| Personalised Analytics Summary | My Analytics page | Gemini 2.0 Flash |
| Floating Course Assistant | All student/instructor pages | Gemini 2.0 Flash |

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| Student | student@learnit.com | password |
| Instructor | instructor@learnit.com | password |
| Admin | admin@learnit.com | password |

## Setup

```bash
npm install
cp .env.example .env   # Add your Gemini API key
npm run dev
```

### Environment Variables

```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

Get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).

> **No API key?** The app runs in demo mode with realistic mock AI responses — every AI feature is fully functional for demos without a key.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Framer Motion
- **AI**: Google Gemini 2.0 Flash (REST API)
- **Routing**: React Router v6
- **Notifications**: Sonner
- **Icons**: Lucide React

## Architecture

```
src/
  services/
    aiService.ts        # All Gemini API calls (grading, chat, analytics)
  pages/
    InstructorDashboard # AI grading with accept/override tracking
    NotesPage           # Per-module notes + RAG chatbot
    AnalyticsPage       # Grade trends + AI summary + sparkline
  components/
    ChatBot             # Floating assistant on all pages
```

## YC Traction Metrics to Track

- [ ] Number of instructors using AI grading suggestions
- [ ] Accept rate vs override rate on AI grades
- [ ] Number of chatbot questions answered per week
- [ ] Students reporting improvement from analytics page

## Roadmap

- [ ] Backend API (Node/Express + PostgreSQL)
- [ ] Real file upload → text extraction for notes RAG
- [ ] Vector embeddings for note retrieval
- [ ] Email alerts for at-risk students
- [ ] Pilot with 1 real university department
