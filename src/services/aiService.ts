import { GoogleGenAI, Type } from "@google/genai";

const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey });
};

export const getChatResponse = async (moduleId: number, moduleContent: string, message: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Context from module notes: ${moduleContent}\n\nUser Question: ${message}`,
    config: {
      systemInstruction: "You are LearnIT AI, a helpful teaching assistant. Answer questions ONLY based on the provided context. If the answer is not in the context, say you don't know based on these notes. Use Markdown for formatting.",
    }
  });
  return response.text;
};

export const getGradingSuggestion = async (assignmentTitle: string, submissionContent: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Assignment: ${assignmentTitle}\nSubmission: ${submissionContent}`,
    config: {
      systemInstruction: "You are an expert instructor. Suggest a grade (0-100) and provide constructive feedback. Return as JSON with keys 'grade' and 'feedback'.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          grade: { type: Type.NUMBER },
          feedback: { type: Type.STRING }
        },
        required: ["grade", "feedback"]
      }
    }
  });
  return JSON.parse(response.text || "{}");
};

export const getLongitudinalInsight = async (studentName: string, gpa: number, major: string, recentSubmissions: any[]) => {
  const ai = getAI();
  const submissionsText = recentSubmissions.map(s => `${s.assignment_title}: ${s.grade}/100`).join(", ");
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Student: ${studentName}, GPA: ${gpa}, Major: ${major}. Recent Grades: ${submissionsText}`,
    config: {
      systemInstruction: "You are an academic advisor. Provide a one-sentence insight about the student's performance and a one-sentence recommendation for improvement. Be encouraging and specific.",
    }
  });
  return response.text;
};

export const getAnalyticsSummary = async (data: any, role: 'student' | 'instructor' | 'admin') => {
  const ai = getAI();
  const prompt = `Analyze the following ${role} performance data and provide a concise, actionable summary in markdown.
  Data: ${JSON.stringify(data)}
  Focus on: ${role === 'student' ? 'strengths, weaknesses, and career advice' : 'class trends, at-risk students, and module effectiveness'}.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are a senior academic analyst. Provide high-level insights based on data. Use professional tone and Markdown.",
    }
  });

  return response.text;
};
