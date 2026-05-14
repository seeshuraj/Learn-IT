/**
 * audit.ts — fire-and-forget audit log writer (P3-1)
 *
 * Usage:
 *   import { writeAudit } from './audit.js';
 *
 *   writeAudit(pool, {
 *     action:        'grade.submit',
 *     resourceType:  'submission',
 *     resourceId:    String(submissionId),
 *     actorUserId:   auth.legacyUserId,
 *     actorEmail:    auth.email,
 *     actorRole:     auth.role,
 *     metadata:      { grade, submissionId },
 *     req,
 *   });
 *
 * writeAudit NEVER throws — any DB error is logged to stderr and swallowed
 * so a logging failure can never break the actual request handler.
 */

import { Request } from 'express';
import pkg from 'pg';
const { Pool } = pkg;

export interface AuditEntry {
  action:        string;
  resourceType?: string;
  resourceId?:   string;
  actorUserId?:  number | null;
  actorEmail?:   string | null;
  actorRole?:    string | null;
  metadata?:     Record<string, unknown>;
  req?:          Request;
}

let _pool: InstanceType<typeof Pool> | null = null;

export function setAuditPool(pool: InstanceType<typeof Pool>): void {
  _pool = pool;
}

export function writeAudit(entry: AuditEntry): void {
  if (!_pool) {
    console.warn('[audit] pool not initialised — call setAuditPool() at startup');
    return;
  }

  const ipAddress = entry.req
    ? ((entry.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
        ?? entry.req.socket?.remoteAddress
        ?? null)
    : null;

  const requestId = entry.req
    ? (entry.req as any).id ?? null
    : null;

  _pool
    .query(
      `INSERT INTO audit_logs
         (action, resource_type, resource_id,
          actor_user_id, actor_email, actor_role,
          metadata, ip_address, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entry.action,
        entry.resourceType ?? null,
        entry.resourceId   ?? null,
        entry.actorUserId  ?? null,
        entry.actorEmail   ?? null,
        entry.actorRole    ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        ipAddress,
        requestId,
      ]
    )
    .catch((err: Error) => {
      console.error('[audit] write failed (non-fatal):', err.message);
    });
}
