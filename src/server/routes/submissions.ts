import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, requireRole, AuthenticatedRequest } from "../middleware/auth.js";
import { validateParams, validateBody } from "../middleware/validate.js";
import { routeParamId, submissionCreateSchema, gradeSchema } from "../validation/schemas.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { uploadToStorage, getSignedUrl, downloadFromStorage, SUBMISSIONS_BUCKET } from "../lib/storage.js";
import { notify } from "../lib/notify.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const multer  = require("multer");

const ALLOWED_SUBMISSION_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "image/jpeg", "image/png", "application/zip",
]);

const uploadSubmission = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    ALLOWED_SUBMISSION_MIMES.has(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});

export function createSubmissionsRouter(pool: Pool): Router {
  const router = Router();

  async function queryOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }
  async function query(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }

  // POST /api/submissions
  router.post("/", requireAuth, validateBody(submissionCreateSchema), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { assignment_id, content } = req.body;
      const sub = await queryOne(
        "INSERT INTO submissions (assignment_id,student_id,content,submitted_at) VALUES ($1,$2,$3,NOW()) RETURNING *",
        [assignment_id, authReq.auth.legacyUserId, content]
      );
      await notify(pool, { userId: authReq.auth.legacyUserId, type: "submission_received", message: "Your submission was received." });
      res.status(201).json(sub);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/submissions/upload
  router.post("/upload", requireAuth, uploadLimiter, uploadSubmission.array("files", 5), async (req, res) => {
    try {
      const authReq      = req as AuthenticatedRequest;
      const files        = (req as any).files as Express.Multer.File[];
      const assignmentId = Number(req.body.assignment_id);
      const content      = req.body.content ?? "";
      if (!assignmentId) return res.status(400).json({ error: "assignment_id required" });
      const sub = await queryOne(
        "INSERT INTO submissions (assignment_id,student_id,content,submitted_at) VALUES ($1,$2,$3,NOW()) RETURNING *",
        [assignmentId, authReq.auth.legacyUserId, content]
      );
      const fileRecords = [];
      for (const file of files ?? []) {
        const objectPath = `submissions/${authReq.auth.legacyUserId}/${assignmentId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await uploadToStorage(SUBMISSIONS_BUCKET, objectPath, file.buffer, file.mimetype);
        const fileRecord = await queryOne(
          `INSERT INTO submission_files (submission_id, original_name, file_type, file_size, storage_path)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [sub.id, file.originalname, file.mimetype, file.size, objectPath]
        );
        fileRecords.push(fileRecord);
      }
      res.status(201).json({ ...sub, files: fileRecords });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/submissions/:id/files
  router.get("/:id/files", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const files = await query("SELECT * FROM submission_files WHERE submission_id=$1", [req.params.id]);
      const withUrls = await Promise.all(
        files.map(async (f: any) => ({ ...f, signedUrl: await getSignedUrl(SUBMISSIONS_BUCKET, f.storage_path) }))
      );
      res.json(withUrls);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/submissions/:id/grade
  router.post(
    "/:id/grade",
    requireAuth, requireRole("instructor", "admin"),
    validateParams(routeParamId), validateBody(gradeSchema),
    async (req, res) => {
      try {
        const { grade, feedback } = req.body;
        const sub = await queryOne(
          "UPDATE submissions SET grade=$1,feedback=$2,graded_at=NOW() WHERE id=$3 RETURNING *",
          [grade, feedback, req.params.id]
        );
        if (!sub) return res.status(404).json({ error: "Submission not found" });
        if (sub.student_id) {
          await notify(pool, {
            userId: sub.student_id, type: "grade_posted",
            message: `Your submission has been graded: ${grade}`,
            metadata: { submission_id: sub.id, grade },
          });
        }
        res.json(sub);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  return router;
}
