-- 0011_security_rls_and_schema_hardening.sql
-- Post-Audit Security, RLS Policy, Enum & Column-Level Privilege Hardening for Insti DZ
-- REVIEW ONLY: Do NOT execute DDL on live Neon without DBA approval.
-- Contains:
--   1. Idempotent type alignments for institutions.subscription_end (date) & licenses.installation_id (text)
--   2. Dedicated public.invoice_status enum & safe migration of public.invoices.status
--   3. Re-creation of corrected RLS policies eliminating unqualified institution_id self-tautologies
--   4. Column-level REVOKE/GRANT hardening on public.profiles + SECURITY DEFINER helpers for secret columns

-- ============================================================================
-- 1. Idempotent Pre-Flight Type Alignments (institutions.subscription_end & licenses.installation_id)
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  invalid_count integer := 0;
  first_invalid_detail text := NULL;
  parsed_date date;
  sub_end_type text;
  inst_id_type text;
BEGIN
  SELECT data_type INTO sub_end_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'subscription_end';

  IF sub_end_type IS NOT NULL AND sub_end_type <> 'date' THEN
    FOR r IN
      SELECT id, subscription_end
      FROM public.institutions
      WHERE subscription_end IS NOT NULL AND trim(subscription_end::text) <> ''
    LOOP
      BEGIN
        IF trim(r.subscription_end::text) !~ '^\d{4}-\d{2}-\d{2}$' THEN
          invalid_count := invalid_count + 1;
          IF first_invalid_detail IS NULL THEN
            first_invalid_detail := 'Value: "' || r.subscription_end::text || '" at institution ID: ' || r.id::text;
          END IF;
        ELSE
          parsed_date := trim(r.subscription_end::text)::date;
        END IF;
      EXCEPTION WHEN others THEN
        invalid_count := invalid_count + 1;
        IF first_invalid_detail IS NULL THEN
          first_invalid_detail := 'Value: "' || r.subscription_end::text || '" at institution ID: ' || r.id::text || ' (Error: ' || SQLERRM || ')';
        END IF;
      END;
    END LOOP;

    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'MIGRATION HALTED: Found % invalid subscription_end value(s) in public.institutions. First invalid entry: %. Please rectify data before re-running.',
        invalid_count, first_invalid_detail;
    END IF;

    ALTER TABLE public.institutions
      ALTER COLUMN subscription_end TYPE date
      USING (
        CASE
          WHEN subscription_end IS NULL OR trim(subscription_end::text) = '' THEN NULL
          ELSE trim(subscription_end::text)::date
        END
      );
  END IF;

  SELECT data_type INTO inst_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'licenses' AND column_name = 'installation_id';

  IF inst_id_type IS NOT NULL AND inst_id_type <> 'text' THEN
    ALTER TABLE public.licenses
      ALTER COLUMN installation_id TYPE text
      USING installation_id::text;
  END IF;
END $$;

-- ============================================================================
-- 2. Dedicated Invoice Status Enum ('pending', 'issued', 'paid', 'void')
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM (
    'pending',
    'issued',
    'paid',
    'void'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE
  inv_udt text;
BEGIN
  SELECT udt_name INTO inv_udt
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'status';

  IF inv_udt IS NOT NULL AND inv_udt <> 'invoice_status' THEN
    ALTER TABLE public.invoices
      ALTER COLUMN status TYPE public.invoice_status
      USING (
        CASE status::text
          WHEN 'verified' THEN 'paid'::public.invoice_status
          WHEN 'rejected' THEN 'void'::public.invoice_status
          WHEN 'paid' THEN 'paid'::public.invoice_status
          WHEN 'issued' THEN 'issued'::public.invoice_status
          WHEN 'void' THEN 'void'::public.invoice_status
          ELSE 'pending'::public.invoice_status
        END
      );
  END IF;
END $$;

-- ============================================================================
-- 3. Fix Unqualified Self-Tautology Institution Joins in RLS Policies
-- ============================================================================
DROP POLICY IF EXISTS homework_submissions_isolation ON public.homework_submissions;
CREATE POLICY homework_submissions_isolation ON public.homework_submissions FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR student_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id AND a.institution_id = homework_submissions.institution_id AND (a.teacher_id = auth.uid() OR public.teaches_module(a.module_id))
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (student_id = auth.uid() AND institution_id = public.current_institution())
  OR EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id AND a.institution_id = homework_submissions.institution_id AND (a.teacher_id = auth.uid() OR public.teaches_module(a.module_id))
  )
);

DROP POLICY IF EXISTS questions_tenant_isolation ON public.questions;
CREATE POLICY questions_tenant_isolation ON public.questions FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.teacher_id = auth.uid() AND e.institution_id = questions.institution_id)
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.teacher_id = auth.uid() AND e.institution_id = questions.institution_id)
);

DROP POLICY IF EXISTS options_tenant_isolation ON public.options;
CREATE POLICY options_tenant_isolation ON public.options FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR EXISTS (
    SELECT 1 FROM public.questions q
    JOIN public.exams e ON e.id = q.exam_id
    WHERE q.id = question_id AND e.teacher_id = auth.uid() AND e.institution_id = options.institution_id
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR EXISTS (
    SELECT 1 FROM public.questions q
    JOIN public.exams e ON e.id = q.exam_id
    WHERE q.id = question_id AND e.teacher_id = auth.uid() AND e.institution_id = options.institution_id
  )
);

DROP POLICY IF EXISTS results_read ON public.results;
CREATE POLICY results_read ON public.results FOR SELECT
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR student_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id AND a.institution_id = results.institution_id AND (a.teacher_id = auth.uid() OR public.teaches_module(a.module_id))
  )
);

DROP POLICY IF EXISTS results_manage ON public.results;
CREATE POLICY results_manage ON public.results FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id AND a.institution_id = results.institution_id AND (a.teacher_id = auth.uid() OR public.teaches_module(a.module_id))
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_id AND a.institution_id = results.institution_id AND (a.teacher_id = auth.uid() OR public.teaches_module(a.module_id))
  )
);

-- ============================================================================
-- 4. Profiles Column-Level Hardening & SECURITY DEFINER Secret Accessors
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON public.profiles TO sdz_schema_owner;

REVOKE SELECT, INSERT, UPDATE ON public.profiles FROM sdz_app_user;
GRANT SELECT (
  id,
  email,
  first_name,
  last_name,
  phone,
  avatar_url,
  institution_id,
  totp_enabled,
  created_at
) ON public.profiles TO sdz_app_user;
GRANT INSERT (
  id,
  email,
  first_name,
  last_name,
  phone,
  avatar_url,
  institution_id,
  totp_enabled,
  created_at
) ON public.profiles TO sdz_app_user;
GRANT UPDATE (
  email,
  first_name,
  last_name,
  phone,
  avatar_url,
  institution_id
) ON public.profiles TO sdz_app_user;

-- Ensure password_hash column exists idempotently before creating auth_lookup_by_* helpers
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash text;

CREATE OR REPLACE FUNCTION public.auth_lookup_by_email(_email text)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  institution_id uuid,
  password_hash text,
  totp_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.id, p.email, p.first_name, p.last_name, p.institution_id, p.password_hash, p.totp_enabled
  FROM public.profiles p
  WHERE lower(p.email) = lower(trim(_email))
  LIMIT 1;
$$;
ALTER FUNCTION public.auth_lookup_by_email(text) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_lookup_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_lookup_by_email(text) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.auth_lookup_by_id(_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  institution_id uuid,
  password_hash text,
  totp_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.id, p.email, p.first_name, p.last_name, p.institution_id, p.password_hash, p.totp_enabled
  FROM public.profiles p
  WHERE p.id = _user_id
  LIMIT 1;
$$;
ALTER FUNCTION public.auth_lookup_by_id(uuid) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_lookup_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_lookup_by_id(uuid) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.auth_update_password_hash(_user_id uuid, _password_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.profiles
  SET password_hash = _password_hash
  WHERE id = _user_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
ALTER FUNCTION public.auth_update_password_hash(uuid, text) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_update_password_hash(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_update_password_hash(uuid, text) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.auth_get_totp_record(_user_id uuid)
RETURNS TABLE (
  totp_secret text,
  totp_enabled boolean,
  totp_backup_codes text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.totp_secret, p.totp_enabled, p.totp_backup_codes
  FROM public.profiles p
  WHERE p.id = _user_id
  LIMIT 1;
$$;
ALTER FUNCTION public.auth_get_totp_record(uuid) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_get_totp_record(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_get_totp_record(uuid) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.auth_set_totp_secret(_user_id uuid, _totp_secret text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.profiles
  SET totp_secret = _totp_secret, totp_enabled = false
  WHERE id = _user_id;
$$;
ALTER FUNCTION public.auth_set_totp_secret(uuid, text) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_set_totp_secret(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_set_totp_secret(uuid, text) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.auth_enable_totp(_user_id uuid, _backup_codes text[])
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.profiles
  SET totp_enabled = true, totp_backup_codes = _backup_codes
  WHERE id = _user_id;
$$;
ALTER FUNCTION public.auth_enable_totp(uuid, text[]) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_enable_totp(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_enable_totp(uuid, text[]) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.auth_update_totp_backup_codes(_user_id uuid, _backup_codes text[])
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.profiles
  SET totp_backup_codes = _backup_codes
  WHERE id = _user_id;
$$;
ALTER FUNCTION public.auth_update_totp_backup_codes(uuid, text[]) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_update_totp_backup_codes(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_update_totp_backup_codes(uuid, text[]) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.auth_disable_totp(_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.profiles
  SET totp_secret = NULL, totp_enabled = false, totp_backup_codes = '{}'::text[]
  WHERE id = _user_id;
$$;
ALTER FUNCTION public.auth_disable_totp(uuid) OWNER TO sdz_schema_owner;
REVOKE ALL ON FUNCTION public.auth_disable_totp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_disable_totp(uuid) TO sdz_app_user;

-- ============================================================================
-- DOWN (Rollback Reference — Execute Only If Reverting 0011):
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.auth_disable_totp(uuid);
-- DROP FUNCTION IF EXISTS public.auth_update_totp_backup_codes(uuid, text[]);
-- DROP FUNCTION IF EXISTS public.auth_enable_totp(uuid, text[]);
-- DROP FUNCTION IF EXISTS public.auth_set_totp_secret(uuid, text);
-- DROP FUNCTION IF EXISTS public.auth_get_totp_record(uuid);
-- DROP FUNCTION IF EXISTS public.auth_update_password_hash(uuid, text);
-- DROP FUNCTION IF EXISTS public.auth_lookup_by_id(uuid);
-- GRANT SELECT, INSERT, UPDATE ON public.profiles TO sdz_app_user;
-- ALTER TABLE public.invoices ALTER COLUMN status TYPE public.payment_status
--   USING (CASE status::text WHEN 'paid' THEN 'verified'::public.payment_status WHEN 'void' THEN 'rejected'::public.payment_status ELSE 'pending'::public.payment_status END);
-- DROP TYPE IF EXISTS public.invoice_status;
