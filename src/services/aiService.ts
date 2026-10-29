// aiService.ts — client-side AI helpers for LearnIT.
//
// Every AI call goes through the Express backend. The browser never talks to
// the model provider and never holds a provider API key; prompts, keys,
// rate limits and validation all live server-side.

import { api } from './api';

// ─── 1. AI GRADING SUGGESTION ─────────────────────────────────────────────────
// Proxies through the server-side /api/submissions/:id/ai-grade endpoint.

export interface GradingSuggestion {
  score:        number;
  feedback:     string;
  strengths:    string[];
  improvements: string[];
}

/**
 * getGradingSuggestion — delegates to the Express grading route.
 *
 * @param submissionId  The DB id of the submission being graded
 * @param rubric        Full rubric string built by the caller
 *
 * The server handles the auth check, the model call and persistence.
 */
export async function getGradingSuggestion(
  submissionId: number | string,
  rubric: string,
): Promise<GradingSuggestion> {
  const res = await (api as any).post(
    `/submissions/${submissionId}/ai-grade`,
    { rubric }
  );
  return res as GradingSuggestion;
}

// ─── 2. NOTES-AWARE MODULE CHATBOT (routes through backend — key stays server-side) ──

export interface ConversationTurn {
  role:    "user" | "assistant";
  content: string;
}

/**
 * askModuleChatbot — sends the user question to the Express /api/ai/chat
 * endpoint which performs vector RAG retrieval from note_chunks using the
 * moduleId, then calls NVIDIA NIM server-side.
 */
export async function askModuleChatbot(
  question:     string,
  moduleTitle:  string,
  moduleId:     number | null,
  notesContext: string,
  history:      ConversationTurn[] = []
): Promise<string> {
  try {
    const res = await api.aiChat(question, moduleTitle, moduleId, history);
    return (res as any)?.answer ?? (res as any)?.reply ?? String(res);
  } catch (backendErr: any) {
    console.warn('[aiService] backend chat failed, using client fallback:', backendErr.message);
    if (!notesContext) {
      return "I don't have any notes loaded for this module yet. Ask your instructor to upload lecture materials.";
    }
    const lower    = question.toLowerCase();
    const sentences = notesContext.split(/[.!?\n]+/).filter(s => s.trim().length > 20);
    const relevant  = sentences.filter(s => {
      const words = lower.split(' ').filter(w => w.length > 3);
      return words.some(w => s.toLowerCase().includes(w));
    });
    if (relevant.length > 0) {
      return `Based on your notes:\n\n${relevant.slice(0, 3).join('. ')}.`;
    }
    return `I found notes for this module but couldn't locate specific content matching your question. Try rephrasing or ask about a key term from the notes.`;
  }
}

// ─── 3. STUDENT ANALYTICS AI SUMMARY ──────────────────────────────────────────

export interface StudentAnalyticsData {
  studentName: string;
  courses: Array<{
    name:        string;
    average:     number;
    assignments: number;
    late:        number;
  }>;
  overallAverage:  number;
  submissionRate:  number;
}

export async function getAnalyticsSummary(
  data: StudentAnalyticsData
): Promise<string> {
  const res = await api.aiAnalyticsSummary(data);
  return (res as { summary?: string })?.summary ?? "";
}

// ─── 4. INSTRUCTOR CLASS OVERVIEW SUMMARY ──────────────────────────────────────

export interface ClassOverviewData {
  courseName:   string;
  classAverage: number;
  students: Array<{
    name:    string;
    average: number;
    missed:  number;
    status:  string;
  }>;
}

export async function getClassOverviewSummary(
  data: ClassOverviewData
): Promise<string> {
  const res = await api.aiClassOverviewSummary(data);
  return (res as { summary?: string })?.summary ?? "";
}
