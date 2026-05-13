/**
 * schemas.ts — Zod schemas for every mutating route (P1-6)
 */
import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────
export const positiveId = z.coerce.number().int().positive();

export const routeParamId = z.object({
  id: positiveId,
});

// ── Assignments ──────────────────────────────────────────────────────────
export const assignmentCreateSchema = z.object({
  title:       z.string().min(1, 'title required').max(255),
  description: z.string().max(5000).optional().default(''),
  due_date:    z.string().min(1, 'due_date required'),
  max_points:  z.coerce.number().int().min(1).max(10000).optional().default(100),
  rubric:      z.string().max(10000).optional().default(''),
  status:      z.enum(['active', 'archived']).optional().default('active'),
});

export const instructorAssignmentCreateSchema = assignmentCreateSchema.extend({
  module_id: positiveId,
});

export const assignmentUpdateSchema = z.object({
  title:       z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  due_date:    z.string().optional(),
  max_points:  z.coerce.number().int().min(1).max(10000).optional(),
  rubric:      z.string().max(10000).optional(),
  status:      z.enum(['active', 'archived']).optional(),
});

// ── Submissions ──────────────────────────────────────────────────────────
export const submissionCreateSchema = z.object({
  assignment_id: positiveId,
  content:       z.string().max(100000).optional().default(''),
});

export const gradeSchema = z.object({
  grade:    z.coerce.number().min(0).max(100),
  feedback: z.string().max(10000).optional().default(''),
});

// ── Admin — users ────────────────────────────────────────────────────────
export const adminUserCreateSchema = z.object({
  name:  z.string().min(1).max(255),
  email: z.string().email(),
  role:  z.enum(['student', 'instructor', 'admin']),
  major: z.string().max(255).optional().nullable(),
  year:  z.coerce.number().int().min(1).max(10).optional().nullable(),
});

export const adminUserUpdateSchema = adminUserCreateSchema.extend({
  active: z.coerce.number().int().min(0).max(1).optional(),
}).partial();

// ── Admin — courses ───────────────────────────────────────────────────────
export const courseCreateSchema = z.object({
  code:          z.string().min(1).max(50),
  name:          z.string().min(1).max(255),
  instructor_id: positiveId,
});

// ── Admin — enrollments ───────────────────────────────────────────────────
export const enrollmentCreateSchema = z.object({
  course_id:  positiveId,
  student_id: positiveId,
});

export const bulkEnrollSchema = z.object({
  course_id: positiveId,
  emails:    z.array(z.string().email()).min(1).max(500),
});

// ── Admin — settings ──────────────────────────────────────────────────────
export const settingsSchema = z.object({
  key:   z.string().min(1).max(255),
  value: z.string().max(10000),
});

// ── Modules ───────────────────────────────────────────────────────────────
export const moduleCreateSchema = z.object({
  name:    z.string().min(1).max(255),
  content: z.string().max(50000).optional().default(''),
});

// ── AI ────────────────────────────────────────────────────────────────────
export const gradePdfSchema = z.object({
  submission_id: positiveId,
  rubric:        z.string().max(10000).optional(),
  module_id:     positiveId.optional(),
});
