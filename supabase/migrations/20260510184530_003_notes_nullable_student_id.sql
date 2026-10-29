-- 1. Drop NOT NULL constraint on student_id
ALTER TABLE notes ALTER COLUMN student_id DROP NOT NULL;

-- 2. Backfill legacy instructor notes with non-existent user IDs
UPDATE notes
SET student_id = NULL
WHERE student_id IS NOT NULL
  AND student_id NOT IN (SELECT id FROM users);

-- 3. Null-out explicit 0 sentinel values
UPDATE notes SET student_id = NULL WHERE student_id = 0;