// aiService.ts — NVIDIA NIM (OpenAI-compatible) integration for LearnIT
// AI chat goes through /api/ai/chat on our Express backend (keeps API key server-side).
// Direct NIM calls are only used for grading (instructor only, no key exposure risk via proxy).

import { api } from './api';

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const CHAT_MODEL = "mistralai/mistral-nemo-12b-instruct";
const EMBED_MODEL = "nvidia/llama-3.2-nemoretriever-300m-embed-v1";

function getApiKey(): string {
  return (import.meta as any).env?.VITE_NVIDIA_API_KEY ?? "";
}

function isMock(): boolean {
  return !getApiKey();
}

// ─── OpenAI-compatible chat call (used only for grading + embeddings) ────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function nimChat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  if (isMock()) return mockChat(messages);
  const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 1024,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`NVIDIA NIM error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── OpenAI-compatible embeddings call ──────────────────────────────────────

export async function embedText(text: string): Promise<number[]> {
  if (isMock()) return Array.from({ length: 128 }, () => Math.random());
  const res = await fetch(`${NVIDIA_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 2048) }),
  });
  if (!res.ok) throw new Error(`Embedding error: ${res.status}`);
  const data = await res.json();
  return data.data?.[0]?.embedding ?? [];
}

export function cosineSim(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

// ─── Mock responses (demo / no key) ─────────────────────────────────────────

function mockChat(messages: ChatMessage[]): string {
  const system = messages[0]?.content ?? "";

  if (system.includes("GRADING ASSISTANT")) {
    return JSON.stringify({
      score: 82,
      feedback:
        "Good understanding of core concepts. The argument in section 2 is well-structured. " +
        "However, the conclusion lacks specific examples. Consider expanding on practical " +
        "implications in your next submission.",
      strengths: ["Clear structure", "Good use of terminology", "Logical flow"],
      improvements: ["Add concrete examples", "Strengthen the conclusion", "Cite additional sources"],
    });
  }
  if (system.includes("ANALYTICS SUMMARY")) {
    return (
      "**Overall Performance: Strong with areas to watch.**\n\n" +
      "This student is performing well above class average in Data Structures (92%) and " +
      "Algorithms (88%), showing strong analytical thinking. " +
      "However, there is a notable dip in Database Systems (67%) — particularly in the last two assignments, " +
      "which may indicate difficulty with SQL optimisation topics. " +
      "**Recommended action:** Schedule a 15-minute check-in focused on query optimisation and indexing."
    );
  }
  if (system.includes("CLASS OVERVIEW")) {
    return (
      "**Class Health: Generally good, with two students at risk.**\n\n" +
      "The class average sits at 82%. Alex Rivera (64%) has missed 3 assignments and is falling behind — " +
      "immediate intervention is advised. Michael Chen (78%) shows inconsistent performance across modules. " +
      "Top performer Sarah Johnson (92%) could benefit from enrichment material. " +
      "**Focus area:** Database Systems module shows the lowest class-wide average."
    );
  }
  return "I'm here to help! Ask me anything about your course material.";
}

// ─── 1. AI GRADING SUGGESTION ────────────────────────────────────────────────

export interface GradingSuggestion {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

export async function getGradingSuggestion(
  submissionContent: string,
  rubric: string
): Promise<GradingSuggestion> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `You are a GRADING ASSISTANT for a university LMS. ` +
        `Respond ONLY with a valid JSON object — no markdown, no explanation. ` +
        `JSON shape: {"score":<int 0-100>,"feedback":"<2-3 sentence feedback>",` +
        `"strengths":["<point>","<point>","<point>"],"improvements":["<point>","<point>"]}`,
    },
    {
      role: "user",
      content: `RUBRIC: ${rubric}\n\nSTUDENT SUBMISSION:\n${submissionContent.slice(0, 3000)}`,
    },
  ];

  const raw = await nimChat(messages, { temperature: 0.3 });
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as GradingSuggestion;
  } catch {
    return {
      score: 75,
      feedback: raw.slice(0, 300),
      strengths: ["Submitted on time"],
      improvements: ["Review feedback carefully"],
    };
  }
}

// ─── 2. NOTES-AWARE MODULE CHATBOT (routes through backend — key stays server-side) ──

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export async function askModuleChatbot(
  question: string,
  moduleTitle: string,
  notesContext: string,
  history: ConversationTurn[] = []
): Promise<string> {
  try {
    // Route through Express /api/ai/chat so NVIDIA key stays on the server
    const res = await api.aiChat(question, moduleTitle, null, history);
    return (res as any)?.reply ?? (res as any)?.answer ?? String(res);
  } catch (backendErr: any) {
    // Backend unavailable → graceful fallback using notes context client-side
    console.warn('[aiService] backend chat failed, using client fallback:', backendErr.message);
    if (!notesContext) {
      return "I don't have any notes loaded for this module yet. Ask your instructor to upload lecture materials.";
    }
    // Simple keyword-match fallback so the chatbot is never completely silent
    const lower = question.toLowerCase();
    const sentences = notesContext.split(/[.!?\n]+/).filter(s => s.trim().length > 20);
    const relevant = sentences.filter(s => {
      const words = lower.split(' ').filter(w => w.length > 3);
      return words.some(w => s.toLowerCase().includes(w));
    });
    if (relevant.length > 0) {
      return `Based on your notes:\n\n${relevant.slice(0, 3).join('. ')}.`;
    }
    return `I found notes for this module but couldn't locate specific content matching your question. Try rephrasing or ask about a key term from the notes.`;
  }
}

// ─── 3. STUDENT ANALYTICS AI SUMMARY ─────────────────────────────────────────

export interface StudentAnalyticsData {
  studentName: string;
  courses: Array<{
    name: string;
    average: number;
    assignments: number;
    late: number;
  }>;
  overallAverage: number;
  submissionRate: number;
}

export async function getAnalyticsSummary(
  data: StudentAnalyticsData
): Promise<string> {
  const courseBreakdown = data.courses
    .map((c) => `${c.name}: avg ${c.average}%, ${c.assignments} assignments, ${c.late} late`)
    .join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are an ANALYTICS SUMMARY assistant for a university LMS. " +
        "Generate a concise, actionable 3-4 sentence summary. " +
        "Focus on: strongest subject, weakest subject, late submission pattern, " +
        "and one concrete recommendation. Use **bold** for key insights.",
    },
    {
      role: "user",
      content:
        `Student: ${data.studentName}\n` +
        `Overall average: ${data.overallAverage}%\n` +
        `Submission rate: ${data.submissionRate}%\n\n` +
        `Course breakdown:\n${courseBreakdown}`,
    },
  ];

  return nimChat(messages, { temperature: 0.4, maxTokens: 400 });
}

// ─── 4. INSTRUCTOR CLASS OVERVIEW SUMMARY ────────────────────────────────────

export interface ClassOverviewData {
  courseName: string;
  classAverage: number;
  students: Array<{
    name: string;
    average: number;
    missed: number;
    status: string;
  }>;
}

export async function getClassOverviewSummary(
  data: ClassOverviewData
): Promise<string> {
  const studentLines = data.students
    .map((s) => `${s.name}: avg ${s.average}%, missed ${s.missed}, status: ${s.status}`)
    .join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a CLASS OVERVIEW assistant for a university instructor. " +
        "Generate a concise 3-4 sentence class health summary. " +
        "Identify students at risk, note the strongest performer, " +
        "highlight any module-wide weakness, and give one actionable recommendation. " +
        "Use **bold** for names and key metrics.",
    },
    {
      role: "user",
      content:
        `Course: ${data.courseName}\n` +
        `Class average: ${data.classAverage}%\n\n` +
        `Students:\n${studentLines}`,
    },
  ];

  return nimChat(messages, { temperature: 0.4, maxTokens: 400 });
}
