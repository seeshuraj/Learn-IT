// aiService.ts — NVIDIA NIM integration for LearnIT AI features
// OpenAI-compatible API: https://integrate.api.nvidia.com/v1
// Models: mistral-large-3 (grading/analytics), llama-3.2-nemoretriever (embeddings)
// Set VITE_NVIDIA_API_KEY in .env — falls back to realistic mock if not set

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const CHAT_MODEL = "mistral-nemo-12b-instruct"; // free, fast, capable
const EMBED_MODEL = "nvidia/llama-3.2-nemoretriever-300m-embed-v1";

function getApiKey(): string {
  return (import.meta as any).env?.VITE_NVIDIA_API_KEY ?? "";
}

const isMock = () => !getApiKey();

// ─── Core chat call (OpenAI-compatible) ───────────────────────────────────────
async function callNvidia(
  messages: Array<{ role: string; content: string }>,
  temperature = 0.4,
  maxTokens = 1024
): Promise<string> {
  if (isMock()) return "";
  const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`NVIDIA NIM error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Embedding call for RAG ────────────────────────────────────────────────────
export async function embedText(text: string): Promise<number[]> {
  if (isMock()) return Array.from({ length: 300 }, () => Math.random());
  const res = await fetch(`${NVIDIA_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text.slice(0, 2048),
      encoding_format: "float",
    }),
  });
  if (!res.ok) throw new Error(`Embed error ${res.status}`);
  const data = await res.json();
  return data.data?.[0]?.embedding ?? [];
}

// ─── Cosine similarity for RAG retrieval ──────────────────────────────────────
export function cosineSim(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

// ─── 1. AI GRADING SUGGESTION ─────────────────────────────────────────────────

export interface GradingSuggestion {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

const MOCK_GRADING: GradingSuggestion = {
  score: 82,
  feedback:
    "Good understanding of core concepts. The argument in section 2 is well-structured. " +
    "However, the conclusion lacks specific examples. " +
    "Consider expanding on practical implications in your next submission.",
  strengths: ["Clear structure", "Good use of terminology", "Logical flow"],
  improvements: [
    "Add concrete examples to strengthen arguments",
    "Strengthen the conclusion with a summary of key points",
    "Cite additional academic sources",
  ],
};

export async function getGradingSuggestion(
  submissionContent: string,
  rubric: string,
  assignmentTitle = "Assignment"
): Promise<GradingSuggestion> {
  if (isMock()) {
    await new Promise((r) => setTimeout(r, 1200));
    return MOCK_GRADING;
  }

  const messages = [
    {
      role: "system",
      content:
        "You are an expert university grading assistant. " +
        "You provide fair, constructive, and specific feedback. " +
        "Always respond with a valid JSON object only — no markdown fences, no extra text.",
    },
    {
      role: "user",
      content: `Grade the following submission for '${assignmentTitle}'.

RUBRIC:
${rubric}

STUDENT SUBMISSION:
${submissionContent}

Respond with ONLY this JSON (no markdown):
{
  "score": <integer 0-100>,
  "feedback": "<2-3 sentence constructive feedback paragraph>",
  "strengths": ["<specific strength 1>", "<specific strength 2>", "<specific strength 3>"],
  "improvements": ["<specific improvement 1>", "<specific improvement 2>"]
}`,
    },
  ];

  const raw = await callNvidia(messages, 0.3, 512);
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

// ─── 2. NOTES-AWARE MODULE CHATBOT (RAG) ──────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MOCK_CHAT_RESPONSES = [
  "Based on your notes, the key concept here is the relationship between time complexity and space complexity. Your notes mention that O(n log n) is the sweet spot for most sorting algorithms — QuickSort achieves this on average. Would you like me to explain the worst-case scenario?",
  "According to the notes you uploaded, this topic is covered in section 3. The main takeaway is that normalization reduces data redundancy. Your notes specifically mention Boyce-Codd Normal Form as the stricter version of 3NF. Is there a specific normal form you're struggling with?",
  "Your notes explain this well — the difference between processes and threads is that threads share memory space while processes are isolated. The key implication for your assignment is the race condition risk in multi-threaded programs. Your notes have a good example with the bank account problem.",
];
let mockChatIdx = 0;

export async function askModuleChatbot(
  question: string,
  moduleTitle: string,
  notesContext: string,
  history: ChatMessage[] = []
): Promise<string> {
  if (isMock()) {
    await new Promise((r) => setTimeout(r, 900));
    return MOCK_CHAT_RESPONSES[mockChatIdx++ % MOCK_CHAT_RESPONSES.length];
  }

  const systemPrompt = `You are a course assistant for the module "${moduleTitle}".
You only answer questions using the student's uploaded notes below.
If the notes don't contain the answer, say so clearly and suggest what section to review.
Be concise, specific, and cite the relevant part of the notes when possible.

--- STUDENT NOTES ---
${notesContext.slice(0, 4000)}
--- END NOTES ---`;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  return callNvidia(messages, 0.5, 768);
}

// ─── 3. STUDENT ANALYTICS AI SUMMARY ──────────────────────────────────────────

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

const MOCK_ANALYTICS =
  "**Overall Performance: Strong with one area to watch.**\n\n" +
  "This student is performing well above class average in Data Structures (92%) and " +
  "Algorithms (88%), showing strong analytical thinking. " +
  "However, there is a notable dip in Database Systems (67%) — particularly in the last two assignments, " +
  "which may indicate difficulty with SQL optimization topics. " +
  "**Recommended action:** Schedule a 15-minute check-in focused on query optimization and indexing strategies.";

export async function getAnalyticsSummary(
  data: StudentAnalyticsData
): Promise<string> {
  if (isMock()) {
    await new Promise((r) => setTimeout(r, 800));
    return MOCK_ANALYTICS;
  }

  const courseBreakdown = data.courses
    .map(
      (c) =>
        `- ${c.name}: avg ${c.average}%, ${c.assignments} assignments completed, ${c.late} late`
    )
    .join("\n");

  const messages = [
    {
      role: "system",
      content:
        "You are an academic analytics assistant for a university LMS. " +
        "Generate concise, actionable, empathetic performance summaries. " +
        "Use bold for key insights. Keep it to 3-4 sentences.",
    },
    {
      role: "user",
      content: `Generate a performance summary for this student:

Student: ${data.studentName}
Overall Average: ${data.overallAverage}%
Submission Rate: ${data.submissionRate}%

Course Breakdown:
${courseBreakdown}

Focus on: strongest subject, weakest subject, late submission pattern, one concrete recommendation.`,
    },
  ];

  return callNvidia(messages, 0.6, 256);
}

// ─── 4. INSTRUCTOR CLASS OVERVIEW SUMMARY ─────────────────────────────────────

export interface ClassOverviewData {
  courseName: string;
  totalStudents: number;
  averageGrade: number;
  submissionRate: number;
  lateRate: number;
  topPerformers: string[];
  atRiskStudents: string[];
}

const MOCK_CLASS_OVERVIEW =
  "**Class performing above expectations overall.** " +
  "Submission rate is healthy at 91%, and the class average of 79% is strong. " +
  "3 students are at risk — all showing a pattern of late submissions combined with below-70% scores in the last two modules. " +
  "**Recommended:** Reach out to at-risk students before the next assignment deadline and consider a revision session on the most-missed topics.";

export async function getClassOverviewSummary(
  data: ClassOverviewData
): Promise<string> {
  if (isMock()) {
    await new Promise((r) => setTimeout(r, 700));
    return MOCK_CLASS_OVERVIEW;
  }

  const messages = [
    {
      role: "system",
      content:
        "You are an academic analytics assistant. " +
        "Generate a concise class overview for the instructor. " +
        "Be direct, data-driven, and actionable. 3-4 sentences max. Use bold for key numbers.",
    },
    {
      role: "user",
      content: `Course: ${data.courseName}
Total Students: ${data.totalStudents}
Class Average: ${data.averageGrade}%
Submission Rate: ${data.submissionRate}%
Late Submission Rate: ${data.lateRate}%
Top Performers: ${data.topPerformers.join(", ")}
At-Risk Students: ${data.atRiskStudents.join(", ")}

Generate a class overview summary with specific recommendations.`,
    },
  ];

  return callNvidia(messages, 0.5, 256);
}
