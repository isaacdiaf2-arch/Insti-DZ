-- 0010_profiles_password_hash.sql
-- Adds secure bcrypt password storage column to public.profiles.
-- Non-destructive and fully reversible; preserves all existing rows.
--
-- UP:
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash text;

-- Restrict direct sdz_app_user exposure if needed in future split-table design;
-- auth queries run inside authRepository / SECURITY DEFINER lookups.

-- DOWN (Rollback):
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS password_hash;
