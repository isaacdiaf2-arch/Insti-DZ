-- ==============================================================================
-- Migration: 0006_5_type_alignments.sql
-- Description: Align column data types before applying functions and triggers (0007).
--
-- Target Changes:
-- 1. institutions.subscription_end: text -> date
--    - Enforces strict validation of all non-null / non-empty values before conversion.
--    - Rejects any malformed or invalid calendar dates with explicit exception (no silent NULL).
--    - Converts explicit empty whitespace strings to NULL.
-- 2. licenses.installation_id: uuid -> text
--    - Preserves all existing UUID values without data loss.
--    - Allows application hardware license identifiers starting with 'SDZ-...'.
--
-- Transaction Safety:
-- Wrapped entirely in a single transaction (BEGIN ... COMMIT).
-- Any validation or conversion failure causes an immediate rollback.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. PRE-VALIDATION: Check institutions.subscription_end for invalid values
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  invalid_count integer := 0;
  first_invalid_detail text := NULL;
  parsed_date date;
BEGIN
  FOR r IN 
    SELECT id, name, subscription_end 
    FROM public.institutions 
    WHERE subscription_end IS NOT NULL AND trim(subscription_end) <> ''
  LOOP
    BEGIN
      -- Validate regex pattern: strictly YYYY-MM-DD
      IF trim(r.subscription_end) !~ '^\d{4}-\d{2}-\d{2}$' THEN
        invalid_count := invalid_count + 1;
        IF first_invalid_detail IS NULL THEN
          first_invalid_detail := 'Value: "' || r.subscription_end || '" at institution ID: ' || r.id::text;
        END IF;
      ELSE
        -- Validate calendar correctness (e.g. reject non-existent calendar days like 2025-02-30)
        parsed_date := trim(r.subscription_end)::date;
      END IF;
    EXCEPTION WHEN others THEN
      invalid_count := invalid_count + 1;
      IF first_invalid_detail IS NULL THEN
        first_invalid_detail := 'Value: "' || r.subscription_end || '" at institution ID: ' || r.id::text || ' (Error: ' || SQLERRM || ')';
      END IF;
    END;
  END LOOP;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION HALTED: Found % invalid subscription_end value(s) in public.institutions. First invalid entry: %. Migration rolled back with zero data loss. Please rectify data before re-running.',
      invalid_count, first_invalid_detail;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. ALTER TABLE: institutions.subscription_end to DATE
-- ------------------------------------------------------------------------------
ALTER TABLE public.institutions
  ALTER COLUMN subscription_end TYPE date
  USING (
    CASE 
      WHEN subscription_end IS NULL OR trim(subscription_end) = '' THEN NULL
      ELSE trim(subscription_end)::date
    END
  );

-- ------------------------------------------------------------------------------
-- 3. ALTER TABLE: licenses.installation_id to TEXT
-- ------------------------------------------------------------------------------
ALTER TABLE public.licenses
  ALTER COLUMN installation_id TYPE text
  USING installation_id::text;

COMMIT;
