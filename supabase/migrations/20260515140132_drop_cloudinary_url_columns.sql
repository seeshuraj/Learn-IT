-- Migration: 004_drop_cloudinary_url_columns
-- Phase 2 / P2-5
-- Drops orphaned cloudinary_url columns from notes and submission_files.
-- All file delivery now goes through Supabase Storage signed URLs.

BEGIN;

ALTER TABLE public.notes
  DROP COLUMN IF EXISTS cloudinary_url;

ALTER TABLE public.submission_files
  DROP COLUMN IF EXISTS cloudinary_url;

COMMIT;