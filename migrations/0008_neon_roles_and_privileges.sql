-- 0008_neon_roles_and_privileges.sql
-- PostgreSQL 3-Tier Security Architecture & Role-Based Privilege Separation for Neon
-- Tier 1: neondb_owner (Administrative DDL Role, runs migrations, never used by app runtime)
-- Tier 2: sdz_schema_owner (Trusted NOLOGIN schema and function owner)
-- Tier 3: sdz_app_user (Restricted LOGIN NOBYPASSRLS application runtime connection role)
--
-- REVIEW ONLY: Do NOT execute DDL on live Neon without DBA approval.
-- Set runtime password interactively or via Neon Console after provisioning:
--   ALTER ROLE sdz_app_user WITH ENCRYPTED PASSWORD '<strong_secret_from_vault>';

-- ============================================================================
-- 1. Idempotent Role Provisioning
-- ============================================================================
DO $$
BEGIN
  -- 1.1 Provision the Trusted Schema Owner (NOLOGIN: cannot authenticate via network)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sdz_schema_owner') THEN
    CREATE ROLE sdz_schema_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    COMMENT ON ROLE sdz_schema_owner IS 'Trusted administrative owner of sensitive tables and SECURITY DEFINER functions';
  END IF;

  -- 1.2 Provision the Application Runtime Connection Role (LOGIN + NOBYPASSRLS)
  -- Password is intentionally NOT embedded in SQL; operator sets it via Neon Console/Vault.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sdz_app_user') THEN
    CREATE ROLE sdz_app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    COMMENT ON ROLE sdz_app_user IS 'Restricted runtime role for backend connection pooling; least privilege DML + NOBYPASSRLS';
  ELSE
    ALTER ROLE sdz_app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- ============================================================================
-- 2. Schema Usage & Default Privilege Hardening
-- ============================================================================
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO sdz_app_user, sdz_schema_owner;
GRANT USAGE ON SCHEMA auth TO sdz_app_user, sdz_schema_owner;

-- Ensure sdz_schema_owner can read user/tenant tables inside SECURITY DEFINER helpers
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sdz_schema_owner;
GRANT INSERT, UPDATE ON public.official_contracts, public.notifications, public.audit_logs TO sdz_schema_owner;
GRANT INSERT ON public.contract_artifacts TO sdz_schema_owner;

-- ============================================================================
-- 3. Transfer Ownership of Sensitive Tables & Functions to sdz_schema_owner
-- ============================================================================
ALTER TABLE IF EXISTS public.official_contracts OWNER TO sdz_schema_owner;
ALTER TABLE IF EXISTS public.contract_artifacts OWNER TO sdz_schema_owner;
ALTER TABLE IF EXISTS public.audit_logs OWNER TO sdz_schema_owner;
ALTER TABLE IF EXISTS public.notifications OWNER TO sdz_schema_owner;

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

-- 4.1 General operational tables: Standard DML grants (governed further by RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sdz_app_user;

-- 4.2 Append-Only Audit Logs Hardening:
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM sdz_app_user;
GRANT SELECT, INSERT ON public.audit_logs TO sdz_app_user;

-- 4.3 Legal Tables Strict Hardening:
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.official_contracts FROM sdz_app_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_artifacts FROM sdz_app_user;

GRANT SELECT ON public.official_contracts TO sdz_app_user;
GRANT SELECT ON public.contract_artifacts TO sdz_app_user;

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

GRANT UPDATE (fields, content_hash, updated_at) ON public.official_contracts TO sdz_app_user;

-- 4.4 Profiles Column-Level Hardening (Never expose password_hash, totp_secret, totp_backup_codes to runtime role)
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

-- 4.5 Sequence Grants for Auto-Incrementing / Default IDs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sdz_app_user;

-- ============================================================================
-- 5. Explicit Function Execution Grants
-- ============================================================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

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

-- DOWN (Rollback Reference):
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sdz_app_user;
-- ALTER TABLE IF EXISTS public.official_contracts OWNER TO neondb_owner;
-- ALTER TABLE IF EXISTS public.contract_artifacts OWNER TO neondb_owner;
-- ALTER TABLE IF EXISTS public.audit_logs OWNER TO neondb_owner;
-- ALTER TABLE IF EXISTS public.notifications OWNER TO neondb_owner;
