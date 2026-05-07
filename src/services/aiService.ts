// aiService.ts — Gemini 2.0 Flash integration for LearnIT AI features
// Three AI surfaces: grading suggestions, notes RAG chat, analytics summary

const GEMINI_MODEL = "gemini-2.0-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getApiKey(): string {
  return (import.meta as any).env?.VITE_GEMINI_API_KEY ?? "";
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) return mockResponse(prompt);
  const res = await fetch(
    `${API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

function mockResponse(prompt: string): string {
  if (prompt.includes("GRADING ASSISTANT")) {
    return JSON.stringify({
      score: 82,
      feedback:
        "Good understanding of core concepts. The argument in section 2 is well-structured. " +
        "However, the conclusion lacks specific examples. " +
        "Consider expanding on practical implications in your next submission.",
      strengths: ["Clear structure", "Good use of terminology", "Logical flow"],
      improvements: ["Add concrete examples", "Strengthen the conclusion", "Cite additional sources"],
    });
  }
  if (prompt.includes("NOTES ASSISTANT")) {
    return (
      "Based on your course notes, here's what I found:\n\n" +
      "The key concept here relates to what was covered in the notes above. " +
      "The main points to remember are: (1) the definition and scope, " +
      "(2) how it applies in practice, and (3) common edge cases. " +
      "Would you like me to elaborate on any of these?"
    );
  }
  if (prompt.includes("ANALYTICS SUMMARY")) {
    return (
      "**Overall Performance: Strong with areas to watch.**\n\n" +
      "This student is performing well above class average in Data Structures (92%) and " +
      "Algorithms (88%), showing strong analytical thinking. " +
      "However, there is a notable dip in Database Systems (67%) — particularly in the last two assignments, " +
      "which may indicate difficulty with SQL optimization topics. " +
      "**Recommended action:** Schedule a 15-minute check-in focused on query optimization and indexing."
    );
  }
  return "I'm here to help! Please ask me anything about your course material.";
}

// ─── 1. AI GRADING SUGGESTION ─────────────────────────────────────────────────

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
  const prompt = `You are a GRADING ASSISTANT for a university LMS.

RUBRIC: ${rubric}

STUDENT SUBMISSION:
${submissionContent}

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "score": <integer 0-100>,
  "feedback": "<2-3 sentence constructive feedback>",
  "strengths": ["<point 1>", "<point 2>", "<point 3>"],
  "improvements": ["<point 1>", "<point 2>"]
}`;

  const raw = await callGemini(prompt);
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

// ─── 2. NOTES-AWARE MODULE CHATBOT ─────────────────────────────────────────────

export async function askModuleChatbot(
  question: string,
  moduleTitle: string,
  notesContext: string
): Promise<string> {
  const prompt = `You are a NOTES ASSISTANT for a university course module titled "${moduleTitle}".

The student has uploaded the following notes for this module:
--- NOTES START ---
${notesContext.slice(0, 3000)}
--- NOTES END ---

Answer the student's question using ONLY information from their notes above.
If the notes do not contain relevant information, say so clearly and suggest what section to review.
Be concise, cite specific parts of the notes when possible, and use plain English.

STUDENT QUESTION: ${question}`;

  return callGemini(prompt);
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

export async function getAnalyticsSummary(
  data: StudentAnalyticsData
): Promise<string> {
  const courseBreakdown = data.courses
    .map(
      (c) =>
        `${c.name}: avg ${c.average}%, ${c.assignments} assignments, ${c.late} late`
    )
    .join("\n");

  const prompt = `You are an ANALYTICS SUMMARY assistant for a university LMS.

Generate a concise, actionable 3-4 sentence summary for the instructor or student.
Focus on: strongest subject, weakest subject, late submission pattern, and one concrete recommendation.

STUDENT: ${data.studentName}
OVERALL AVERAGE: ${data.overallAverage}%
SUBMISSION RATE: ${data.submissionRate}%

COURSE BREAKDOWN:
${courseBreakdown}`;

  return callGemini(prompt);
}
