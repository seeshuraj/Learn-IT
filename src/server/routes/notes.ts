import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth } from "../middleware/auth.js";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { validateParams } from "../middleware/validate.js";
import { routeParamId } from "../validation/schemas.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import {
  uploadToStorage, getSignedUrl, downloadFromStorage,
  deleteFromStorage, NOTES_BUCKET,
} from "../lib/storage.js";
import { extractTextFromBuffer } from "../lib/textExtract.js";
import { nimEmbed } from "../lib/ai.js";
import { chunkText } from "../lib/textExtract.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const multer  = require("multer");

const ALLOWED_NOTE_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain", "image/jpeg", "image/png", "image/gif", "image/webp",
]);

const uploadNote = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    ALLOWED_NOTE_MIMES.has(file.mimetype) ? cb(null, true) : cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});

export function createNotesRouter(pool: Pool): Router {
  const router = Router();

  async function query(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function queryOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }
  async function run(sql: string, params: any[] = []) {
    const { rows, rowCount } = await pool.query(sql, params);
    return { lastInsertId: rows[0]?.id ?? null, changes: rowCount ?? 0 };
  }

  // GET /api/modules/:id/notes
  router.get("/modules/:id/notes", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      let notes;
      if (authReq.auth.role === "student") {
        notes = await query(
          `SELECT n.*, u.name AS uploader_name FROM notes n
           LEFT JOIN users u ON n.uploaded_by = u.id
           WHERE n.module_id=$1 AND n.uploaded_by=$2 ORDER BY n.created_at DESC`,
          [req.params.id, authReq.auth.legacyUserId]
        );
      } else {
        notes = await query(
          `SELECT n.*, u.name AS uploader_name FROM notes n
           LEFT JOIN users u ON n.uploaded_by = u.id
           WHERE n.module_id=$1 ORDER BY n.created_at DESC`,
          [req.params.id]
        );
      }
      res.json(notes);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/modules/:id/notes
  router.post("/modules/:id/notes", requireAuth, uploadLimiter, validateParams(routeParamId), uploadNote.single("file"), async (req, res) => {
    try {
      const authReq   = req as AuthenticatedRequest;
      const file      = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const moduleId   = Number(req.params.id);
      const userId     = authReq.auth.legacyUserId;
      const objectPath = `notes/${userId}/${moduleId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await uploadToStorage(NOTES_BUCKET, objectPath, file.buffer, file.mimetype);
      const extractedText = await extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);
      const note = await queryOne(
        `INSERT INTO notes (module_id, uploaded_by, title, file_type, file_size, storage_path, original_name, content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [moduleId, userId, file.originalname, file.mimetype, file.size, objectPath, file.originalname, extractedText.slice(0, 5000)]
      );
      if (extractedText.trim().length > 50) {
        const chunks = chunkText(extractedText);
        if (chunks.length > 0) {
          try {
            const embeddings = await nimEmbed(chunks, "passage");
            for (let i = 0; i < chunks.length; i++) {
              await run(
                `INSERT INTO note_chunks (note_id, chunk_index, chunk_text, embedding) VALUES ($1,$2,$3,$4)`,
                [note.id, i, chunks[i], JSON.stringify(embeddings[i])]
              );
            }
          } catch (embErr) { console.error("[Notes] embedding failed (non-fatal):", embErr); }
        }
      }
      res.status(201).json(note);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/notes/:id
  router.delete("/notes/:id", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const note = await queryOne("SELECT id, storage_path, uploaded_by FROM notes WHERE id=$1", [req.params.id]);
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (authReq.auth.role === "student" && note.uploaded_by !== authReq.auth.legacyUserId)
        return res.status(403).json({ error: "Access denied" });
      if (note.storage_path) await deleteFromStorage(NOTES_BUCKET, note.storage_path);
      await run("DELETE FROM note_chunks WHERE note_id=$1", [note.id]);
      await run("DELETE FROM notes WHERE id=$1", [note.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/notes/:id/proxy
  router.get("/notes/:id/proxy", requireAuth, async (req, res) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const note = await queryOne(
        "SELECT id, storage_path, file_type, original_name, uploaded_by FROM notes WHERE id=$1",
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (auth.role === "student" && note.uploaded_by !== auth.legacyUserId)
        return res.status(403).json({ error: "Access denied: not your note" });
      if (!note.storage_path) return res.status(404).json({ error: "File not stored" });
      const result = await downloadFromStorage(NOTES_BUCKET, note.storage_path);
      if (!result) return res.status(404).json({ error: "File not found in storage" });
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(note.original_name ?? "file")}"`);
      res.send(result.buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/notes/:id/signed-url
  router.get("/notes/:id/signed-url", requireAuth, async (req, res) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const note = await queryOne("SELECT id, storage_path, uploaded_by FROM notes WHERE id=$1", [req.params.id]);
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (auth.role === "student" && note.uploaded_by !== auth.legacyUserId)
        return res.status(403).json({ error: "Access denied" });
      const url = await getSignedUrl(NOTES_BUCKET, note.storage_path);
      if (!url) return res.status(404).json({ error: "Could not generate signed URL" });
      res.json({ url });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
