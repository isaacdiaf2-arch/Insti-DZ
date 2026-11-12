-- 0008_neon_roles_and_privileges.sql
-- PostgreSQL 3-Tier Security Architecture & Role-Based Privilege Separation for Neon
-- Tier 1: neondb_owner (Administrative DDL Role, runs migrations, never used by app)
-- Tier 2: sdz_schema_owner (Trusted NOLOGIN schema and function owner)
-- Tier 3: sdz_app_user (Restricted LOGIN application runtime connection role)

-- ============================================================================
-- 1. Idempotent Role Provisioning
-- ============================================================================
DO $$
BEGIN
  -- 1.1 Provision the Trusted Schema Owner (NOLOGIN: cannot authenticate via network)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sdz_schema_owner') THEN
    CREATE ROLE sdz_schema_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    COMMENT ON ROLE sdz_schema_owner IS 'Trusted administrative owner of sensitive tables and SECURITY DEFINER functions';
  END IF;

  -- 1.2 Provision the Application Runtime Connection Role (LOGIN)
  -- In Neon production, replace placeholder password with secret credential from vault/env.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sdz_app_user') THEN
    CREATE ROLE sdz_app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'replace_with_neon_app_password_at_runtime';
    COMMENT ON ROLE sdz_app_user IS 'Restricted runtime role for backend connection pooling; least privilege DML only';
  END IF;
END $$;

-- ============================================================================
-- 2. Schema Usage & Default Privilege Hardening
-- ============================================================================
-- Strip default public creation access to prevent search_path hijacking
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;

-- Grant schema usage to the application runtime role and schema owner
GRANT USAGE ON SCHEMA public TO sdz_app_user, sdz_schema_owner;
GRANT USAGE ON SCHEMA auth TO sdz_app_user, sdz_schema_owner;

-- ============================================================================
-- 3. Transfer Ownership of Sensitive Tables & Functions to sdz_schema_owner
-- ============================================================================
ALTER TABLE IF EXISTS public.official_contracts OWNER TO sdz_schema_owner;
ALTER TABLE IF EXISTS public.contract_artifacts OWNER TO sdz_schema_owner;
ALTER TABLE IF EXISTS public.audit_logs OWNER TO sdz_schema_owner;
ALTER TABLE IF EXISTS public.notifications OWNER TO sdz_schema_owner;

-- Transfer ownership of security functions
ALTER FUNCTION public.transition_official_contract(uuid, uuid, text, text, jsonb, text, text, text) OWNER TO sdz_schema_owner;
ALTER FUNCTION public.guard_official_contract() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.guard_contract_artifact() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.audit_official_contract_draft() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.has_role(uuid, public.app_role) OWNER TO sdz_schema_owner;
ALTER FUNCTION public.is_platform_admin() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.current_institution() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.is_institution_admin() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.manages_institution(uuid) OWNER TO sdz_schema_owner;
ALTER FUNCTION public.institution_access_valid(uuid) OWNER TO sdz_schema_owner;
ALTER FUNCTION public.expire_subscriptions() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.verify_license(uuid, text, text) OWNER TO sdz_schema_owner;
ALTER FUNCTION public.generate_installation_id() OWNER TO sdz_schema_owner;
ALTER FUNCTION public.can_access_assessment(uuid) OWNER TO sdz_schema_owner;
ALTER FUNCTION public.manages_assessment(uuid) OWNER TO sdz_schema_owner;

-- ============================================================================
-- 4. Apply Least-Privilege DML Grants to sdz_app_user
-- ============================================================================

-- 4.1 General operational tables: Standard CRUD grants for business operations
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sdz_app_user;

-- 4.2 Legal Tables Strict Hardening:
-- Strip full write privileges on legal tables so application role cannot bypass state machines
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.official_contracts FROM sdz_app_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_artifacts FROM sdz_app_user;

-- Grant read-only access to official contracts and contract artifacts
GRANT SELECT ON public.official_contracts TO sdz_app_user;
GRANT SELECT ON public.contract_artifacts TO sdz_app_user;

-- Grant INSERT only on initial draft contract attributes (withholding state, evidences, correction_note)
GRANT INSERT (
  id,
  institution_id,
  number,
  version,
  fields,
  legal_text,
  provider,
  created_by,
  created_at,
  updated_at,
  replaces_id,
  content_hash
) ON public.official_contracts TO sdz_app_user;

-- Grant UPDATE strictly on draft fields and content_hash
-- (official_contract_guard trigger irrevocably blocks updates once institution_evidence is signed)
GRANT UPDATE (fields, content_hash, updated_at) ON public.official_contracts TO sdz_app_user;

-- Note: contract_artifacts has ZERO write grants for sdz_app_user.
-- Insertion is executed exclusively by transition_official_contract() running as sdz_schema_owner.

-- 4.3 Sequence Grants for Auto-Incrementing IDs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sdz_app_user;

-- ============================================================================
-- 5. Explicit Function Execution Grants
-- ============================================================================
-- Revoke PUBLIC execution on all functions in public schema by default
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Grant EXECUTE to sdz_app_user on application RPCs and helpers
GRANT EXECUTE ON FUNCTION auth.uid() TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.current_institution() TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.is_institution_admin() TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.manages_institution(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.institution_access_valid(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.teaches_group(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.student_has_module(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.teaches_module(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.can_access_assessment(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.manages_assessment(uuid) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.verify_license(uuid, text, text) TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.generate_installation_id() TO sdz_app_user;
GRANT EXECUTE ON FUNCTION public.transition_official_contract(uuid, uuid, text, text, jsonb, text, text, text) TO sdz_app_user;
