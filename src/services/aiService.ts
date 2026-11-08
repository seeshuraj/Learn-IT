// aiService.ts — client-side AI helpers for LearnIT.
//
// Every AI call goes through the Express backend. The browser never talks to
// the model provider and never holds a provider API key; prompts, keys,
// rate limits and validation all live server-side.

import { api, aiChatStream } from './api';

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
 * askModuleChatbot — sends the question to the Express /api/ai/chat endpoint,
 * which retrieves relevant note chunks for the module and calls the model
 * server-side.
 *
 * There is deliberately no client-side fallback: a keyword match over the
 * notes looks like a real answer and hides outages. Failures surface as
 * errors, and an answer the server could not ground in the notes says so.
 */
export async function askModuleChatbot(
  question:    string,
  moduleTitle: string,
  moduleId:    number | null,
  history:     ConversationTurn[] = []
): Promise<string> {
  let res: { answer?: string; retrieval?: "none" | "ok" | "unavailable" };
  try {
    res = await api.aiChat(question, moduleTitle, moduleId, history) as typeof res;
  } catch (err: any) {
    const message: string = err?.message ?? "";
    throw new Error(
      message.startsWith("Too many requests")
        ? message
        : "The AI assistant is temporarily unavailable. Please try again in a minute."
    );
  }
  const answer = res?.answer?.trim();
  if (!answer) throw new Error("The AI assistant returned an empty answer. Please try again.");
  return res.retrieval === "unavailable"
    ? `${answer}${UNGROUNDED_NOTE}`
    : answer;
}

const UNAVAILABLE = "The AI assistant is temporarily unavailable. Please try again in a minute.";
const UNGROUNDED_NOTE =
  "\n\n_Note: your course notes couldn't be searched just now, so this answer isn't based on them._";

/**
 * Streaming variant of askModuleChatbot: `onText` receives the answer so far
 * after every chunk. Resolves with the final text.
 */
export async function streamModuleChatbot(
  question:    string,
  moduleTitle: string,
  moduleId:    number | null,
  history:     ConversationTurn[],
  onText:      (textSoFar: string) => void,
  signal?:     AbortSignal,
  onMeta?:     (meta: { personalized: boolean }) => void,
): Promise<string> {
  let text = "";
  let ungrounded = false;
  let sources: string[] = [];
  try {
    await aiChatStream({ question, moduleTitle, moduleId, history }, {
      signal,
      onMeta: (m) => {
        ungrounded = m.retrieval === "unavailable";
        sources = Array.isArray(m.sources) ? m.sources.slice(0, 4) : [];
        onMeta?.({ personalized: Boolean(m.personalized) });
      },
      onDelta: (d) => { text += d; onText(text); },
    });
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    const message: string = err?.message ?? "";
    if (text) {
      // Keep what arrived and say it is incomplete.
      text += "\n\n_The answer was interrupted. Please ask again._";
      onText(text);
      return text;
    }
    throw new Error(message.startsWith("Too many requests") ? message : UNAVAILABLE);
  }
  if (!text.trim()) throw new Error("The AI assistant returned an empty answer. Please try again.");
  if (ungrounded) { text += UNGROUNDED_NOTE; onText(text); }
  else if (sources.length) {
    text += `\n\n_From your notes: ${sources.map(escapeMarkdown).join(", ")}_`;
    onText(text);
  }
  return text;
}

/** Note file names are user content; strip characters Markdown would interpret. */
function escapeMarkdown(s: string): string {
  return s.replace(/[\\`*_[\]()#>|~<]/g, " ").replace(/\s+/g, " ").trim();
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

/** Shape returned by GET /api/students/:id/analytics. Grades are percentages. */
export interface StudentCourseStats {
  course_code:           string;
  course_name:           string;
  assignments_total:     number;
  assignments_submitted: number;
  avg_grade:             number | null;
  late:                  number;
  grades: { title: string; grade: number; submitted_at: string }[];
}

export interface StudentAnalyticsResponse {
  student_name:    string;
  overall_avg:     number | null;
  total_submitted: number;
  total_pending:   number;
  courses:         StudentCourseStats[];
}

export function submissionRateOf(data: StudentAnalyticsResponse): number {
  const total = data.total_submitted + data.total_pending;
  return total > 0 ? Math.round((data.total_submitted / total) * 100) : 0;
}

export function toAISummaryData(data: StudentAnalyticsResponse): StudentAnalyticsData {
  return {
    studentName:    data.student_name,
    overallAverage: data.overall_avg ?? 0,
    submissionRate: submissionRateOf(data),
    courses: data.courses.map(c => ({
      name:        c.course_name,
      average:     c.avg_grade ?? 0,
      assignments: c.assignments_submitted,
      late:        c.late,
    })),
  };
}

/** A summary needs at least one graded course; otherwise skip the model call. */
export function hasGradedWork(data: StudentAnalyticsResponse): boolean {
  return data.courses.some(c => c.avg_grade != null);
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
