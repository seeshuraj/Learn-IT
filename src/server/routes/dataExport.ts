/**
 * GET /api/admin/export/:dataset — the caller's college only, as CSV.
 *
 * Datasets: users, enrollments, grades, exam-results. Rows are read in
 * keyset batches and streamed, so a college of any size exports with
 * constant memory. Every export is recorded in the audit log (it contains
 * student personal data).
 */
import { Router, Request, Response } from 'express';
import pkg from 'pg';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { reportLimiter } from '../middleware/rateLimit.js';
import { writeAudit } from '../middleware/audit.js';
import { sendServerError } from '../lib/httpErrors.js';
import { log, errorFields } from '../lib/log.js';
import { CSV_BOM, csvRow } from '../lib/csv.js';
import { DATASETS, EXPORT_BATCH as BATCH } from '../lib/exportDatasets.js';

export function createDataExportRouter(pool: pkg.Pool): Router {
  const router = Router();

  router.get('/:dataset', requireAuth, requireRole('admin'), reportLimiter, async (req: Request, res: Response) => {
    const name = String(req.params.dataset).replace(/\.csv$/, '');
    const ds = DATASETS[name];
    if (!ds) return res.status(404).json({ error: `Unknown export. Choose one of: ${Object.keys(DATASETS).join(', ')}` });

    const { institutionId, legacyUserId, role } = (req as AuthenticatedRequest).auth;
    let closed = false;
    req.on('close', () => { closed = true; });
    let rows = 0;
    try {
      // First batch before any bytes are sent, so a query error is still a clean JSON 500.
      let batch = (await pool.query(ds.sql, [institutionId, 0, BATCH])).rows;
      const date = new Date().toISOString().slice(0, 10);
      res.status(200);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="learnit-${name}-${date}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      res.write(CSV_BOM + csvRow(ds.header));

      while (batch.length && !closed) {
        const chunk = batch.map(r => csvRow(ds.row(r))).join('');
        rows += batch.length;
        if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve));
        if (batch.length < BATCH) break;
        batch = (await pool.query(ds.sql, [institutionId, batch[batch.length - 1].k, BATCH])).rows;
      }
      res.end();
      writeAudit({
        action: 'data.export', resourceType: 'export', resourceId: name,
        actorUserId: legacyUserId, actorRole: role, metadata: { rows, completed: !closed }, req,
      });
    } catch (e) {
      log.error('data export failed', { dataset: name, rows, ...errorFields(e) });
      if (!res.headersSent) return sendServerError(res, e);
      res.destroy(e as Error);   // a truncated file must not look complete
    }
  });

  return router;
}
