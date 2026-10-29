/**
 * notify.ts — P3-4
 *
 * Fire-and-forget helper. Call it anywhere in server.ts/routes without
 * awaiting — errors are swallowed so a notification failure never breaks
 * the primary operation.
 *
 * Usage:
 *   notify(pool, studentId, 'grade_posted', `Your submission for "${title}" was graded: ${grade}%`, { courseId, assignmentId });
 *   notify(pool, studentId, 'roadmap_ready', `Your learning roadmap for ${courseName} is ready!`, { courseId });
 */

import pkg from 'pg';
import { log, errorFields } from './log.js';
const { Pool } = pkg;
type PgPool = InstanceType<typeof Pool>;

export type NotificationType =
  | 'grade_posted'
  | 'new_assignment'
  | 'roadmap_ready'
  | 'enrollment_confirmed'
  | 'submission_received'
  | 'assignment_due_soon'
  | 'general';

export function notify(
  pool: PgPool,
  userId: number,
  type: NotificationType,
  message: string,
  metadata?: Record<string, unknown>
): void {
  pool.query(
    `INSERT INTO notifications (user_id, type, message, metadata)
     VALUES ($1, $2, $3, $4)`,
    [userId, type, message, metadata ? JSON.stringify(metadata) : null]
  ).catch((err: Error) => {
    log.error('notification insert failed', { userId, type, ...errorFields(err) });
  });
}
