-- Migration: 004_drop_cloudinary_url_columns
-- Phase 2 / P2-5
--
-- All file delivery now goes through Supabase Storage (signed URLs + proxy).
-- The cloudinary_url columns in notes and submission_files are orphaned;
-- no application code reads or writes them.
-- Dropping them removes dead data, shrinks row size, and eliminates any
-- risk of accidentally serving a stale Cloudinary URL to a client.
--
-- Safe to run on a live database: ALTER TABLE ... DROP COLUMN IF EXISTS
-- takes an ACCESS EXCLUSIVE lock briefly but is instantaneous on empty columns.
-- There is no data to migrate — Cloudinary was decommissioned in P1-5.

BEGIN;

ALTER TABLE public.notes
  DROP COLUMN IF EXISTS cloudinary_url;

ALTER TABLE public.submission_files
  DROP COLUMN IF EXISTS cloudinary_url;

COMMIT;
