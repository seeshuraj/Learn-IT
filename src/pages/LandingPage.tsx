import React from 'react';
import { useNavigate } from 'react-router-dom';

const FEATURES = [
  {
    icon: '🎯',
    title: 'AI Grading Assistant',
    desc: 'LLM-powered score + structured feedback for every submission. Instructors accept or edit — saving hours per week.',
  },
  {
    icon: '💬',
    title: 'Notes-Aware Chatbot',
    desc: 'Students chat with their own uploaded course notes via RAG. Answers are grounded in lecture content, not generic LLM knowledge.',
  },
  {
    icon: '📊',
    title: 'Student Analytics',
    desc: 'Per-course grade trends, late submission tracking, and an AI-written personalised progress summary — so students know exactly where to focus.',
  },
  {
    icon: '🏫',
    title: 'Full LMS Backbone',
    desc: 'Courses, modules, assignments, file uploads, enrollment management, instructor and admin dashboards — all in one place.',
  },
  {
    icon: '🔒',
    title: 'Role-Based Access',
    desc: 'Separate, purpose-built dashboards for students, instructors, and admins. Clean, fast, and mobile-friendly.',
  },
  {
    icon: '⚡',
    title: 'Built to Ship',
    desc: 'React + Express + SQLite + NVIDIA NIM. No over-engineering. Deploy on Vercel + Render in under 5 minutes.',
  },
];

const STATS = [
  { value: '3', label: 'User Roles' },
  { value: '4', label: 'AI Endpoints' },
  { value: 'RAG', label: 'Chatbot Pipeline' },
  { value: '0', label: 'Vendor Lock-in' },
];

const DEMO_ROLES = [
  { role: 'Student', email: 'sarah@learnit.edu', color: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100', desc: 'View courses, submit assignments, chat with notes, track analytics' },
  { role: 'Instructor', email: 'instructor@learnit.edu', color: 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100', desc: 'Manage modules, grade with AI assistance, view class analytics' },
  { role: 'Admin', email: 'admin@learnit.edu', color: 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100', desc: 'Manage users, courses, enrollments, system settings' },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 40 40" className="w-8 h-8" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="40" height="40" rx="9" fill="#01696f"/>
              <text x="7" y="29" fontFamily="Georgia,serif" fontSize="24" fontWeight="bold" fill="white">L</text>
              <circle cx="29" cy="12" r="5" fill="#4f98a3" opacity="0.9"/>
            </svg>
            <span className="text-lg font-bold text-slate-800 tracking-tight">LearnIT</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/seeshuraj/Learn-IT"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-500 hover:text-slate-800 transition"
            >
              GitHub
            </a>
            <button
              onClick={() => navigate('/login')}
              className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Sign in
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 bg-gradient-to-br from-teal-50 via-white to-slate-50">
        <div className="max-w-4xl mx-auto text-center">
          <span className="inline-block bg-teal-100 text-teal-800 text-xs font-semibold px-3 py-1 rounded-full mb-6 tracking-wide uppercase">
            AI-Powered Learning Management
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-slate-900 leading-tight mb-6">
            The LMS that tells students{' '}
            <span className="text-teal-700">why</span>{' '}they're struggling
          </h1>
          <p className="text-xl text-slate-500 max-w-2xl mx-auto mb-10">
            Universities use LMSs that only track grades. LearnIT uses AI to explain them —
            grounding every grade, every chatbot answer, and every progress summary in real course material.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/login')}
              className="bg-teal-700 hover:bg-teal-800 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition shadow-md"
            >
              Try the Demo →
            </button>
            <a
              href="https://github.com/seeshuraj/Learn-IT"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-slate-300 hover:border-slate-400 text-slate-700 font-semibold px-8 py-3.5 rounded-xl text-base transition"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 bg-teal-700">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 sm:grid-cols-4 gap-8">
          {STATS.map(s => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-extrabold text-white mb-1">{s.value}</div>
              <div className="text-teal-200 text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">Everything a modern LMS needs — plus AI</h2>
            <p className="text-slate-500 max-w-xl mx-auto">Three high-value AI surfaces layered on a solid LMS foundation.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-md transition">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-slate-800 mb-2">{f.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo CTA */}
      <section className="py-20 px-6 bg-slate-50 border-t border-slate-100">
        <div className="max-w-3xl mx-auto text-center mb-10">
          <h2 className="text-3xl font-bold text-slate-900 mb-3">Try it right now</h2>
          <p className="text-slate-500">No sign-up. Use a demo account to explore any role.</p>
        </div>
        <div className="max-w-2xl mx-auto grid sm:grid-cols-3 gap-4">
          {DEMO_ROLES.map(r => (
            <button
              key={r.role}
              onClick={() => navigate('/login')}
              className={`border rounded-2xl p-5 text-left transition ${r.color}`}
            >
              <div className="font-bold text-lg mb-1">{r.role}</div>
              <div className="text-xs font-mono mb-3 opacity-70">{r.email}</div>
              <div className="text-xs leading-relaxed">{r.desc}</div>
            </button>
          ))}
        </div>
        <div className="text-center mt-8">
          <button
            onClick={() => navigate('/login')}
            className="bg-teal-700 hover:bg-teal-800 text-white font-semibold px-10 py-3.5 rounded-xl text-base transition shadow-md"
          >
            Open Demo App →
          </button>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">How the AI works</h2>
            <p className="text-slate-500">No black-box magic. Every AI surface is explainable and instructor-controlled.</p>
          </div>
          <div className="space-y-6">
            {[
              { step: '01', title: 'Instructor sets a rubric', detail: 'When creating an assignment, the instructor writes a rubric (e.g. "Correctness 40%, Code quality 30%, Explanation 30%").' },
              { step: '02', title: 'Student submits (text or file)', detail: 'Students submit assignments as typed text or uploaded PDF/DOCX. Files are parsed server-side for full text extraction.' },
              { step: '03', title: 'AI suggests score + feedback', detail: 'NVIDIA NIM (Mistral Large) analyses the submission against the rubric and returns a suggested score, 3 strengths, and 2 improvements.' },
              { step: '04', title: 'Instructor accepts or edits', detail: 'The instructor sees the AI suggestion alongside the original submission. One click to accept, or edit before saving. Every acceptance is logged for traction metrics.' },
              { step: '05', title: 'Student sees personalised feedback', detail: 'The graded submission, feedback, and AI analytics summary appear on the student\'s dashboard — with context about exactly what to improve.' },
            ].map(s => (
              <div key={s.step} className="flex gap-5 bg-white border border-slate-200 rounded-2xl p-6">
                <div className="text-2xl font-extrabold text-teal-200 w-12 shrink-0">{s.step}</div>
                <div>
                  <div className="font-semibold text-slate-800 mb-1">{s.title}</div>
                  <div className="text-slate-500 text-sm">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="py-16 px-6 bg-slate-900">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-bold text-white mb-8 text-center">Tech Stack</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { name: 'React 18', sub: 'TypeScript + Vite' },
              { name: 'Express 4', sub: 'Node.js backend' },
              { name: 'SQLite', sub: 'better-sqlite3' },
              { name: 'NVIDIA NIM', sub: 'Mistral Large / RAG' },
              { name: 'Tailwind CSS', sub: 'v4' },
              { name: 'Recharts', sub: 'Analytics charts' },
              { name: 'Multer + pdf-parse', sub: 'File uploads + OCR' },
              { name: 'Vercel + Render', sub: 'Deploy in 5 min' },
            ].map(t => (
              <div key={t.name} className="bg-slate-800 rounded-xl px-4 py-3">
                <div className="text-white font-semibold text-sm">{t.name}</div>
                <div className="text-slate-400 text-xs mt-0.5">{t.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 40 40" className="w-6 h-6" fill="none">
              <rect width="40" height="40" rx="9" fill="#01696f"/>
              <text x="7" y="29" fontFamily="Georgia,serif" fontSize="24" fontWeight="bold" fill="white">L</text>
            </svg>
            <span className="font-bold text-slate-700">LearnIT</span>
          </div>
          <p className="text-slate-400 text-xs text-center">
            Built with NVIDIA NIM · React · Express · SQLite<br/>
            <a href="https://github.com/seeshuraj/Learn-IT" className="underline hover:text-slate-600" target="_blank" rel="noopener noreferrer">github.com/seeshuraj/Learn-IT</a>
          </p>
          <p className="text-slate-400 text-xs">MIT License</p>
        </div>
      </footer>
    </div>
  );
}
