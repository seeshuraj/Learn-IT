-- Migration: make notes.student_id nullable so instructor notes can be stored without a user FK
-- Also backfills any legacy notes with student_id = 0 or a non-existent user to NULL

-- 1. Drop NOT NULL constraint if it exists
ALTER TABLE notes ALTER COLUMN student_id DROP NOT NULL;

-- 2. Backfill legacy instructor notes (stored with student_id = 0 or with no matching user)
UPDATE notes
SET student_id = NULL
WHERE student_id IS NOT NULL
  AND student_id NOT IN (SELECT id FROM users);

-- 3. Also null-out explicit 0 sentinel values if any were stored that way
UPDATE notes SET student_id = NULL WHERE student_id = 0;
