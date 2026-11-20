-- Migration 0014: Add nullable password_hash column to public.profiles
-- Non-destructive & reversible. Preserves all existing profile rows.
--
-- UP:
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash text;

-- DOWN (Rollback):
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS password_hash;
