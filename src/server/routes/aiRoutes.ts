import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { aiLimiter, aiGradeLimiter } from "../middleware/rateLimit.js";
import { gradePdfSchema } from "../validation/schemas.js";
import { nimChat, nimEmbed, retrieveChunks } from "../lib/ai.js";
import { downloadFromStorage, SUBMISSIONS_BUCKET } from "../lib/storage.js";
import { extractTextFromBuffer } from "../lib/textExtract.js";
import { notify } from "../lib/notify.js";

export function createAiRouter(pool: Pool): Router {
  const router = Router();

  async function queryOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }
  async function query(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function run(sql: string, params: any[] = []) {
    const { rowCount } = await pool.query(sql, params);
    return { changes: rowCount ?? 0 };
  }

  // POST /api/ai/grade
  router.post("/grade", requireAuth, requireRole("instructor", "admin"), aiLimiter, async (req, res) => {
    try {
      const { submissionContent, rubric } = req.body;
      const prompt = `You are a university grading assistant. Grade the following student submission based on the rubric provided.\n\nRubric:\n${rubric}\n\nSubmission:\n${submissionContent}\n\nProvide:\n1. A numerical grade (0-100)\n2. Detailed feedback\n3. Strengths\n4. Areas for improvement\n\nRespond in JSON format: {"grade": number, "feedback": string, "strengths": string[], "improvements": string[]}`;
      const response = await nimChat([{ role: "user", content: prompt }], { temperature: 0.3, maxTokens: 1024 });
      let result;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch?.[0] ?? response);
      } catch { result = { grade: 75, feedback: response, strengths: [], improvements: [] }; }
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/ai/grade-pdf
  router.post("/grade-pdf", requireAuth, requireRole("instructor", "admin"), aiGradeLimiter, validateBody(gradePdfSchema), async (req, res) => {
    try {
      const { submission_id, rubric, module_id } = req.body;
      const sub = await queryOne("SELECT * FROM submissions WHERE id=$1", [submission_id]);
      if (!sub) return res.status(404).json({ error: "Submission not found" });
      const files = await query("SELECT * FROM submission_files WHERE submission_id=$1", [submission_id]);
      let content = sub.content ?? "";
      for (const file of files) {
        const result = await downloadFromStorage(SUBMISSIONS_BUCKET, file.storage_path);
        if (result) {
          const extracted = await extractTextFromBuffer(result.buffer, file.content_type ?? file.file_type, file.original_name);
          if (extracted) content += "\n" + extracted;
        }
      }
      let context = "";
      if (module_id) {
        const chunks = await retrieveChunks(pool, module_id, content.slice(0, 500));
        if (chunks.length) context = "\n\nRelevant course material:\n" + chunks.join("\n---\n");
      }
      const prompt = `You are a university grading assistant.${context}\n\nRubric:\n${rubric}\n\nStudent submission:\n${content.slice(0, 4000)}\n\nProvide JSON: {"grade": number, "feedback": string, "strengths": string[], "improvements": string[]}`;
      const response = await nimChat([{ role: "user", content: prompt }], { temperature: 0.3, maxTokens: 1024 });
      let result;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch?.[0] ?? response);
      } catch { result = { grade: 75, feedback: response, strengths: [], improvements: [] }; }
      await run("UPDATE submissions SET grade=$1,feedback=$2,graded_at=NOW() WHERE id=$3", [result.grade, result.feedback, submission_id]);
      if (sub.student_id) {
        await queryOne(
          `INSERT INTO ai_feedback (submission_id, student_id, grade, feedback, strengths, improvements)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (submission_id) DO UPDATE
             SET grade=EXCLUDED.grade, feedback=EXCLUDED.feedback,
                 strengths=EXCLUDED.strengths, improvements=EXCLUDED.improvements, created_at=NOW()`,
          [submission_id, sub.student_id, result.grade, result.feedback, JSON.stringify(result.strengths ?? []), JSON.stringify(result.improvements ?? [])]
        );
        await notify(pool, { userId: sub.student_id, type: "grade_posted", message: `Your submission has been graded: ${result.grade}`, metadata: { submission_id, grade: result.grade } });
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/ai/chat
  router.post("/chat", requireAuth, aiLimiter, async (req, res) => {
    try {
      const { question, moduleTitle, moduleId, history } = req.body;
      if (!question) return res.status(400).json({ error: "question required" });
      const contextChunks = moduleId ? await retrieveChunks(pool, moduleId, question) : [];
      const contextBlock  = contextChunks.length ? `\n\nRelevant course material:\n${contextChunks.join("\n---\n")}` : "";
      const systemPrompt  =
        `You are a helpful university teaching assistant for the module "${moduleTitle ?? "this course"}".${contextBlock}\n` +
        `Answer concisely and accurately. If a question is outside the course scope, say so politely.`;
      const messages = [
        { role: "system", content: systemPrompt },
        ...(history ?? []).map((m: any) => ({ role: m.role, content: m.content })),
        { role: "user", content: question },
      ];
      const answer = await nimChat(messages, { temperature: 0.5, maxTokens: 512 });
      res.json({ answer });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/ai/analytics-summary
  router.post("/analytics-summary", requireAuth, aiLimiter, async (req, res) => {
    try {
      const { analytics } = req.body;
      const summary = await nimChat(
        [{ role: "user", content: `Summarise these student analytics in 2–3 sentences: ${JSON.stringify(analytics)}` }],
        { temperature: 0.4, maxTokens: 256 }
      );
      res.json({ summary });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
