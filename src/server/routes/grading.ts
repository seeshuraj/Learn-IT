/**
 * Grading Router
 * POST /api/submissions/:id/ai-grade
 *
 * Runs entirely server-side using NVIDIA_API_KEY (no VITE_ prefix).
 * Persists ai_feedback to the submissions table immediately after grading.
 *
 * Guards:
 *   - requireAuth
 *   - requireRole('instructor', 'admin')
 *   - aiGradeLimiter
 */

import { Router, Request, Response } from 'express';
import pkg from 'pg';
import {
  requireAuth,
  requireRole,
  AuthenticatedRequest,
} from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { aiGradeLimiter } from '../middleware/rateLimit.js';

const NVIDIA_BASE  = 'https://integrate.api.nvidia.com/v1';
const CHAT_MODEL   = 'mistralai/mistral-nemo-12b-instruct';

function getApiKey(): string {
  return process.env.NVIDIA_API_KEY ?? '';
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function nimChat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens:  opts.maxTokens  ?? 1536,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`NVIDIA NIM error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function mockGrade(maxPoints: number) {
  const score = Math.round(0.82 * maxPoints);
  return {
    score,
    feedback:
      'Good understanding of core concepts. The argument in section 2 is well-structured. ' +
      'However, the conclusion lacks specific examples. Consider expanding on practical ' +
      'implications in your next submission.',
    strengths:    ['Clear structure', 'Good use of terminology', 'Logical flow'],
    improvements: ['Add concrete examples', 'Strengthen the conclusion', 'Cite additional sources'],
  };
}

export function createGradingRouter(pool: pkg.Pool): Router {
  const router = Router();

  // POST /api/submissions/:id/ai-grade
  router.post(
    '/:id/ai-grade',
    requireAuth,
    requireRole('instructor', 'admin'),
    aiGradeLimiter,
    async (req: Request, res: Response) => {
      const submissionId = req.params.id;
      const auth = (req as AuthenticatedRequest).auth;

      try {
        const { rubric } = req.body as { rubric?: string };
        if (!rubric) return res.status(400).json({ error: 'rubric is required' });

        // Fetch the submission
        const { rows } = await pool.query(
          `SELECT s.*, a.max_points
           FROM submissions s
           JOIN assignments a ON a.id = s.assignment_id
           WHERE s.id = $1`,
          [submissionId]
        );
        const submission = rows[0];
        if (!submission) return res.status(404).json({ error: 'Submission not found' });

        const maxPoints = parseInt(submission.max_points ?? '100', 10);
        const content   = submission.content ?? '';

        let result;

        if (!getApiKey()) {
          // No key — return mock for local dev
          result = mockGrade(maxPoints);
        } else {
          const messages: ChatMessage[] = [
            {
              role: 'system',
              content:
                `You are a GRADING ASSISTANT for a university LMS. ` +
                `Grade the student submission strictly against the provided rubric. ` +
                `The assignment is scored out of ${maxPoints} points. ` +
                `Your "score" field MUST be an integer between 0 and ${maxPoints} — never exceed ${maxPoints}. ` +
                `Respond ONLY with a valid JSON object — no markdown fences, no prose outside JSON. ` +
                `JSON shape exactly: ` +
                `{"score":<int 0-${maxPoints}>,"feedback":"<2-3 sentences>",` +
                `"strengths":["<point>","<point>","<point>"],"improvements":["<point>","<point>"]}`,
            },
            {
              role: 'user',
              content: `RUBRIC:\n${rubric}\n\nSTUDENT SUBMISSION:\n${content.slice(0, 3000)}`,
            },
          ];

          const raw     = await nimChat(messages, { temperature: 0.2, maxTokens: 1536 });
          const cleaned = raw.replace(/```json|```/g, '').trim();
          const parsed  = JSON.parse(cleaned);
          parsed.score  = Math.max(0, Math.min(Math.round(parsed.score), maxPoints));
          result        = parsed;
        }

        // Persist ai_feedback immediately
        await pool.query(
          `UPDATE submissions
           SET ai_feedback = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(result), submissionId]
        );

        writeAudit({
          action:       'submission.ai_grade',
          resourceType: 'submission',
          resourceId:   String(submissionId),
          actorUserId:  auth.legacyUserId,
          actorEmail:   auth.email,
          actorRole:    auth.role,
          metadata:     { score: result.score, maxPoints },
          req,
        });

        res.json(result);
      } catch (e: any) {
        console.error('[grading/ai-grade]', e.message);
        res.status(500).json({ error: e.message });
      }
    }
  );

  return router;
}
