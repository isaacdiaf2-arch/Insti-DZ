-- 0007_functions_and_triggers.sql
-- Standalone Functions, Integrity Guards, Legal Workflow Triggers, and Audit Logging

-- 0. Authentication Fallback for Standard PostgreSQL
-- CRITICAL SECURITY ARCHITECTURE FOR BACKEND INTEGRATION:
-- auth.uid() alone does NOT authenticate the user or prove session validity;
-- it merely parses 'app.current_user_id' from the current database transaction.
-- The Backend application server is SOLELY responsible for authenticating the client request
-- (e.g., verifying session tokens, validating JWTs, checking TOTP 2FA, verifying account active status)
-- BEFORE setting user context strictly scoped to the transaction:
--   SET LOCAL app.current_user_id = '<authenticated_user_uuid>';
--   OR SELECT set_config('app.current_user_id', '<authenticated_user_uuid>', true);
-- The third parameter (true) marks it is_local, ensuring the setting is automatically
-- discarded at COMMIT or ROLLBACK to prevent user identity leakage across pooled connections.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE 
    WHEN current_setting('app.current_user_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
    THEN current_setting('app.current_user_id', true)::uuid 
    WHEN nullif(current_setting('request.jwt.claim.sub', true), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('request.jwt.claim.sub', true)::uuid
    ELSE NULL 
  END;
$$;

-- 1. Timestamp Updater Helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. Role & Tenant Security Helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.has_role(auth.uid(), 'platform_admin');
$$;

CREATE OR REPLACE FUNCTION public.current_institution()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT institution_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_institution_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = auth.uid()
      AND r.role = 'institution_admin'
      AND r.institution_id = p.institution_id
  );
$$;

CREATE OR REPLACE FUNCTION public.manages_institution(_institution_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT _institution_id IS NOT NULL AND (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'institution_admin'
        AND institution_id = _institution_id
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.institution_access_valid(_institution_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  inst_status text;
  sub_end date;
BEGIN
  IF _institution_id IS NULL THEN RETURN false; END IF;
  SELECT status, subscription_end INTO inst_status, sub_end
  FROM public.institutions WHERE id = _institution_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF inst_status IN ('suspended', 'expired', 'archived') THEN RETURN false; END IF;
  IF sub_end IS NOT NULL AND sub_end < CURRENT_DATE THEN RETURN false; END IF;
  RETURN true;
END;
$$;

-- 3. Licensing and Subscriptions
CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS TABLE (institution_id uuid, name text, subscription_end date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY UPDATE public.institutions i SET status = 'expired'
  WHERE i.status = 'active' AND i.subscription_end IS NOT NULL AND i.subscription_end < CURRENT_DATE
  RETURNING i.id, i.name, i.subscription_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_license(_institution_id uuid, _license_key text, _installation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_license public.licenses%ROWTYPE;
BEGIN
  SELECT * INTO v_license FROM public.licenses
  WHERE institution_id = _institution_id AND license_key = _license_key
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'reason', 'not_found'); END IF;
  IF v_license.status IN ('revoked','suspended') THEN RETURN jsonb_build_object('valid', false, 'reason', v_license.status); END IF;
  IF v_license.expires_on IS NOT NULL AND v_license.expires_on < CURRENT_DATE THEN RETURN jsonb_build_object('valid', false, 'reason', 'expired'); END IF;
  IF _installation_id IS NOT NULL AND v_license.installation_id IS NOT NULL AND v_license.installation_id <> _installation_id THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'installation_mismatch'); END IF;
  RETURN jsonb_build_object('valid', true, 'deployment', v_license.deployment, 'expires_on', v_license.expires_on);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_installation_id()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT 'SDZ-' || upper(replace(gen_random_uuid()::text, '-', ''));
$$;

-- 4. Academic Isolation Helpers
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT _group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.group_memberships WHERE group_id = _group_id AND student_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.teaches_group(_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT _group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.modules m ON m.level_id = g.level_id AND m.institution_id = g.institution_id
    WHERE g.id = _group_id AND m.teacher_id = auth.uid() AND m.archived = false
  );
$$;

CREATE OR REPLACE FUNCTION public.student_has_module(_module_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT _module_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.group_memberships gm
    JOIN public.groups g ON g.id = gm.group_id
    JOIN public.modules m ON m.level_id = g.level_id AND m.institution_id = g.institution_id
    WHERE m.id = _module_id AND gm.student_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.teaches_module(_module_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT _module_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.modules WHERE id = _module_id AND teacher_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_assessment(_assessment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assessments a WHERE a.id = _assessment_id AND (
      public.is_platform_admin() OR public.manages_institution(a.institution_id)
      OR a.teacher_id = auth.uid() OR public.teaches_module(a.module_id)
      OR (a.published AND public.is_group_member(a.group_id))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.manages_assessment(_assessment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assessments a WHERE a.id = _assessment_id AND (
      public.is_platform_admin() OR public.manages_institution(a.institution_id)
      OR a.teacher_id = auth.uid() OR public.teaches_module(a.module_id)
    )
  );
$$;

-- 5. Official Contract Guards & Atomic Transition RPC
CREATE OR REPLACE FUNCTION public.guard_official_contract()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN 
    RAISE EXCEPTION 'Official contract records cannot be deleted'; 
  END IF;
  
  IF OLD.state IN ('final','returned') THEN 
    RAISE EXCEPTION 'Contract revision is immutable'; 
  END IF;

  -- Guard fixed metadata and legal text against direct modification
  IF NEW.institution_id IS DISTINCT FROM OLD.institution_id 
     OR NEW.number IS DISTINCT FROM OLD.number 
     OR NEW.version IS DISTINCT FROM OLD.version 
     OR NEW.legal_text IS DISTINCT FROM OLD.legal_text 
     OR NEW.provider IS DISTINCT FROM OLD.provider 
     OR NEW.created_by IS DISTINCT FROM OLD.created_by 
     OR NEW.created_at IS DISTINCT FROM OLD.created_at 
     OR NEW.replaces_id IS DISTINCT FROM OLD.replaces_id THEN
    RAISE EXCEPTION 'Fixed contract content cannot change';
  END IF;

  -- First signature irrevocably freezes contract fields, hash, and institution evidence
  IF OLD.institution_evidence IS NOT NULL AND (
    NEW.fields IS DISTINCT FROM OLD.fields 
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash 
    OR NEW.institution_evidence IS DISTINCT FROM OLD.institution_evidence
  ) THEN
    RAISE EXCEPTION 'First signature freezes all contract data and institution evidence';
  END IF;

  -- Platform signature evidence is immutable once recorded
  IF OLD.platform_evidence IS NOT NULL AND (NEW.platform_evidence IS DISTINCT FROM OLD.platform_evidence) THEN
    RAISE EXCEPTION 'Platform signature evidence is immutable';
  END IF;

  -- Valid state machine transitions
  IF NOT (
    (OLD.state = 'draft' AND NEW.state IN ('draft','awaiting_platform')) 
    OR (OLD.state = 'awaiting_platform' AND NEW.state IN ('final','returned'))
  ) THEN
    RAISE EXCEPTION 'Invalid contract transition from % to %', OLD.state, NEW.state;
  END IF;

  IF NEW.state = 'awaiting_platform' AND NEW.institution_evidence IS NULL THEN 
    RAISE EXCEPTION 'Missing first signature'; 
  END IF;

  IF NEW.state = 'returned' AND length(trim(coalesce(NEW.correction_note, ''))) < 5 THEN
    RAISE EXCEPTION 'Correction note is required when returning a contract for revisions';
  END IF;

  -- Finalization strictly requires both signatures AND an authoritative artifact
  IF NEW.state = 'final' THEN
    IF NEW.institution_evidence IS NULL OR NEW.platform_evidence IS NULL THEN 
      RAISE EXCEPTION 'Both signatures required for contract finalization'; 
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.contract_artifacts a WHERE a.contract_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Official contract cannot transition to final without an authoritative stored artifact in contract_artifacts';
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_contract_artifact()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_computed_hash text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Truncating contract artifacts is strictly forbidden';
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Official artifact is append-only and immutable';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 1. Validate SHA-256 format (must be exactly 64 lowercase hexadecimal characters)
    IF NEW.sha256 IS NULL OR NEW.sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Invalid SHA-256 format: sha256 must be 64 lowercase hexadecimal characters';
    END IF;

    -- 2. Validate binary payload presence and cryptographic digest match
    IF NEW.pdf_base64 IS NULL OR length(trim(NEW.pdf_base64)) = 0 THEN
      RAISE EXCEPTION 'Invalid artifact content: pdf_base64 cannot be empty';
    END IF;

    BEGIN
      v_computed_hash := pg_catalog.encode(public.digest(pg_catalog.decode(NEW.pdf_base64, 'base64'), 'sha256'), 'hex');
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid base64 payload in pdf_base64: %', SQLERRM;
    END;

    IF v_computed_hash <> lower(NEW.sha256) THEN
      RAISE EXCEPTION 'Artifact checksum mismatch: computed digest (%) does not match declared sha256 (%)', v_computed_hash, NEW.sha256;
    END IF;

    -- 3. Contract lifecycle state validation
    IF NOT EXISTS (
      SELECT 1 FROM public.official_contracts 
      WHERE id = NEW.contract_id AND state = 'awaiting_platform'
    ) THEN
      RAISE EXCEPTION 'Artifact can only be attached to an official contract awaiting platform signature';
    END IF;

    -- 4. Prevent duplicate artifact attachment (one immutable artifact per contract)
    IF EXISTS (
      SELECT 1 FROM public.contract_artifacts
      WHERE contract_id = NEW.contract_id
    ) THEN
      RAISE EXCEPTION 'Authoritative artifact already exists for contract %', NEW.contract_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- CRITICAL SECURITY ARCHITECTURE FOR BACKEND INTEGRATION:
-- auth.uid() alone does NOT authenticate the user or prove session validity; it simply reads 'app.current_user_id'.
-- The Backend application server is SOLELY responsible for authenticating the client request
-- (e.g., verifying session tokens, validating JWTs, checking TOTP 2FA, verifying account active status)
-- BEFORE issuing: SET LOCAL app.current_user_id = '<authenticated_user_uuid>';
-- If the Backend fails to authenticate or sets an unverified ID, auth.uid() will trust it.
CREATE OR REPLACE FUNCTION public.transition_official_contract(
  _id uuid,
  _actor uuid,
  _action text,
  _hash text,
  _evidence jsonb DEFAULT NULL,
  _pdf text DEFAULT NULL,
  _pdf_hash text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_caller uuid := auth.uid();
  c public.official_contracts%ROWTYPE;
BEGIN
  -- 1. Strictly bind actor to authenticated session caller
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller is not authenticated';
  END IF;

  IF _actor IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Identity mismatch: actor (%) does not match authenticated caller (%)', _actor, v_caller;
  END IF;

  SELECT * INTO c FROM public.official_contracts WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR c.content_hash <> _hash THEN 
    RAISE EXCEPTION 'Contract changed or unavailable'; 
  END IF;

  IF _action = 'institution_sign' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles r
      JOIN public.profiles p ON p.id = r.user_id
      WHERE r.user_id = v_caller AND r.role = 'institution_admin' AND r.institution_id = c.institution_id AND p.institution_id = c.institution_id
    ) THEN 
      RAISE EXCEPTION 'Forbidden: caller is not an institution admin for this contract'; 
    END IF;

    IF c.state <> 'draft' OR c.institution_evidence IS NOT NULL THEN 
      RAISE EXCEPTION 'Invalid first signature: contract is not in draft or already signed'; 
    END IF;

    IF (_evidence->>'actor_id') IS DISTINCT FROM v_caller::text 
       OR (_evidence->>'consent') IS DISTINCT FROM 'true' 
       OR (_evidence->>'content_hash') IS DISTINCT FROM c.content_hash 
       OR coalesce(_evidence->>'signature','') NOT LIKE 'data:image/png;base64,%' 
       OR (_evidence->>'signed_at') IS NULL THEN
      RAISE EXCEPTION 'Invalid identity or consent evidence';
    END IF;

    UPDATE public.official_contracts SET institution_evidence = _evidence, state = 'awaiting_platform' WHERE id = _id;

    INSERT INTO public.notifications(recipient_id,institution_id,type,title,body,link)
    SELECT DISTINCT user_id, c.institution_id, 'contract', 'عقد بانتظار التوقيع', c.number, '/admin' 
    FROM public.user_roles WHERE role = 'platform_admin';

  ELSIF _action IN ('platform_sign','return') THEN
    IF NOT public.has_role(v_caller, 'platform_admin') THEN 
      RAISE EXCEPTION 'Forbidden: caller is not a platform admin'; 
    END IF;

    IF c.state <> 'awaiting_platform' OR c.platform_evidence IS NOT NULL THEN 
      RAISE EXCEPTION 'Invalid second signature: contract is not awaiting platform signature'; 
    END IF;

    IF _action = 'return' THEN
      IF length(trim(coalesce(_note,''))) < 5 THEN 
        RAISE EXCEPTION 'Correction reason required'; 
      END IF;
      UPDATE public.official_contracts SET state = 'returned', correction_note = _note WHERE id = _id;
    ELSE
      IF (_evidence->>'actor_id') IS DISTINCT FROM v_caller::text 
         OR (_evidence->>'consent') IS DISTINCT FROM 'true' 
         OR (_evidence->>'content_hash') IS DISTINCT FROM c.content_hash 
         OR coalesce(_evidence->>'signature','') NOT LIKE 'data:image/png;base64,%' 
         OR (_evidence->>'signed_at') IS NULL THEN
        RAISE EXCEPTION 'Invalid identity or consent evidence';
      END IF;

      -- Cryptographic binary integrity check: verify base64 payload matches sha256 checksum
      IF _pdf IS NULL OR _pdf_hash IS NULL OR pg_catalog.encode(public.digest(pg_catalog.decode(_pdf,'base64'),'sha256'),'hex') <> lower(_pdf_hash) THEN
        RAISE EXCEPTION 'Invalid artifact digest: PDF content does not match sha256 checksum';
      END IF;

      -- Store immutable binary artifact first, satisfying foreign key and final state guard
      INSERT INTO public.contract_artifacts(contract_id,pdf_base64,sha256) VALUES (_id,_pdf,_pdf_hash);
      UPDATE public.official_contracts SET platform_evidence = _evidence, state = 'final' WHERE id = _id;
    END IF;

    INSERT INTO public.notifications(recipient_id,institution_id,type,title,body,link)
    SELECT DISTINCT user_id, c.institution_id, 'contract', CASE WHEN _action = 'return' THEN 'أعيد العقد للتصحيح' ELSE 'اكتمل توقيع العقد' END, c.number, '/institution'
    FROM public.user_roles WHERE role = 'institution_admin' AND institution_id = c.institution_id;

  ELSE 
    RAISE EXCEPTION 'Invalid action: %', _action; 
  END IF;

  INSERT INTO public.audit_logs(actor_id,actor_role,institution_id,action,resource,resource_id,result,metadata)
  VALUES (v_caller, CASE WHEN _action='institution_sign' THEN 'institution_admin' ELSE 'platform_admin' END, c.institution_id, _action, 'official_contract', _id, 'success', jsonb_build_object('content_hash',c.content_hash,'pdf_hash',_pdf_hash,'note',_note));
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_official_contract_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.institution_evidence IS NOT NULL OR NEW.platform_evidence IS NOT NULL THEN 
      RAISE EXCEPTION 'Contract must start unsigned'; 
    END IF;
    IF NEW.replaces_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.official_contracts c WHERE c.id=NEW.replaces_id AND c.institution_id=NEW.institution_id AND c.state='returned'
    ) THEN 
      RAISE EXCEPTION 'Invalid correction revision'; 
    END IF;
    INSERT INTO public.audit_logs(actor_id,actor_role,institution_id,action,resource,resource_id,result,metadata)
    VALUES (
      CASE WHEN NEW.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW.created_by::uuid ELSE NULL END,
      'institution_admin',
      NEW.institution_id,
      'contract_created',
      'official_contract',
      NEW.id,
      'success',
      jsonb_build_object('content_hash',NEW.content_hash,'replaces_id',NEW.replaces_id)
    );
  ELSIF OLD.state='draft' AND NEW.state='draft' AND NEW.fields IS DISTINCT FROM OLD.fields THEN
    INSERT INTO public.audit_logs(actor_id,actor_role,institution_id,action,resource,resource_id,result,metadata)
    VALUES (
      CASE WHEN NEW.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW.created_by::uuid ELSE NULL END,
      'institution_admin',
      NEW.institution_id,
      'contract_fields_updated',
      'official_contract',
      NEW.id,
      'success',
      jsonb_build_object('content_hash',NEW.content_hash)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Attach Triggers Safely
DROP TRIGGER IF EXISTS official_contract_guard ON public.official_contracts;
CREATE TRIGGER official_contract_guard BEFORE UPDATE OR DELETE ON public.official_contracts FOR EACH ROW EXECUTE FUNCTION public.guard_official_contract();

DROP TRIGGER IF EXISTS artifact_immutable ON public.contract_artifacts;
CREATE TRIGGER artifact_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.contract_artifacts FOR EACH ROW EXECUTE FUNCTION public.guard_contract_artifact();

DROP TRIGGER IF EXISTS artifact_no_truncate ON public.contract_artifacts;
CREATE TRIGGER artifact_no_truncate BEFORE TRUNCATE ON public.contract_artifacts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_contract_artifact();

DROP TRIGGER IF EXISTS official_contract_draft_audit ON public.official_contracts;
CREATE TRIGGER official_contract_draft_audit AFTER INSERT OR UPDATE ON public.official_contracts FOR EACH ROW EXECUTE FUNCTION public.audit_official_contract_draft();

-- Timestamp triggers
DROP TRIGGER IF EXISTS contracts_set_updated_at ON public.contracts;
CREATE TRIGGER contracts_set_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS reset_requests_set_updated_at ON public.password_reset_requests;
CREATE TRIGGER reset_requests_set_updated_at BEFORE UPDATE ON public.password_reset_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS rooms_set_updated_at ON public.rooms;
CREATE TRIGGER rooms_set_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS schedules_set_updated_at ON public.schedules;
CREATE TRIGGER schedules_set_updated_at BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_trial_requests_updated_at ON public.trial_requests;
CREATE TRIGGER trg_trial_requests_updated_at BEFORE UPDATE ON public.trial_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS programs_set_updated_at ON public.programs;
CREATE TRIGGER programs_set_updated_at BEFORE UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS specializations_set_updated_at ON public.specializations;
CREATE TRIGGER specializations_set_updated_at BEFORE UPDATE ON public.specializations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS academic_levels_set_updated_at ON public.academic_levels;
CREATE TRIGGER academic_levels_set_updated_at BEFORE UPDATE ON public.academic_levels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS groups_set_updated_at ON public.groups;
CREATE TRIGGER groups_set_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS modules_set_updated_at ON public.modules;
CREATE TRIGGER modules_set_updated_at BEFORE UPDATE ON public.modules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS assessments_set_updated_at ON public.assessments;
CREATE TRIGGER assessments_set_updated_at BEFORE UPDATE ON public.assessments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS results_set_updated_at ON public.results;
CREATE TRIGGER results_set_updated_at BEFORE UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS licenses_set_updated_at ON public.licenses;
CREATE TRIGGER licenses_set_updated_at BEFORE UPDATE ON public.licenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS attendance_set_updated_at ON public.attendance_records;
CREATE TRIGGER attendance_set_updated_at BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS homework_submissions_set_updated_at ON public.homework_submissions;
CREATE TRIGGER homework_submissions_set_updated_at BEFORE UPDATE ON public.homework_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS personal_schedule_updated_at ON public.personal_schedule_entries;
CREATE TRIGGER personal_schedule_updated_at BEFORE UPDATE ON public.personal_schedule_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Explicit Function & Table Security (Least Privilege Hardening)
-- Revoke public execution of sensitive functions
REVOKE ALL ON FUNCTION public.transition_official_contract(uuid, uuid, text, text, jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_official_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_contract_artifact() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_official_contract_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_license(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_installation_id() FROM PUBLIC;

-- Restrict direct table manipulation on legal records
REVOKE DELETE, TRUNCATE ON public.official_contracts FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_artifacts FROM PUBLIC;

-- ARCHITECTURAL SECURITY DIRECTIVE FOR NEON & POSTGRESQL PRIVILEGE SEPARATION:
-- 1. Limitation of REVOKE FROM PUBLIC:
--    REVOKE FROM PUBLIC only strips default privileges granted to all database users.
--    In PostgreSQL, the table owner (object creator / neondb_owner) retains full DML rights
--    regardless of REVOKE FROM PUBLIC. If the Backend connects as the table owner/superuser,
--    PostgreSQL table-level privilege checks are completely bypassed.
-- 2. Multi-Layer Defense Architecture:
--    a) Trigger & Integrity Layer (Immediate & Active):
--       - official_contracts records cannot be deleted (guard_official_contract).
--       - Revisions in 'final' or 'returned' state are strictly immutable.
--       - Fixed legal terms and contract numbers/versions cannot change.
--       - First signature irreversibly freezes fields, content_hash, and institution evidence.
--       - Platform signature evidence is immutable once recorded.
--       - Transition to 'final' strictly requires an existing verified artifact in contract_artifacts.
--       - contract_artifacts is append-only: TRUNCATE, UPDATE, and DELETE are strictly forbidden.
--       - contract_artifacts enforces 64-hex SHA-256 format and cryptographically validates that
--         the SHA-256 matches the actual decoded binary bytes of the PDF.
--    b) PostgreSQL Role Separation Layer (Required in Neon Production):
--       To prevent direct UPDATE on official_contracts.state or direct INSERT into contract_artifacts,
--       the production environment MUST establish clear privilege separation:
--       1. Trusted Function Owner (NOLOGIN):
--          Provision a dedicated administrative schema owner role (e.g., sdz_schema_owner WITH NOLOGIN)
--          that owns the legal tables and SECURITY DEFINER functions.
--       2. Restricted Application Runtime Role (LOGIN):
--          Provision an application connection role (e.g., <app_role> WITH LOGIN) for Backend connection pooling.
--          CRITICAL: Do NOT use neondb_owner or any superuser role as the application runtime connection!
--          Configure strictly scoped DML privileges on the legal tables:
--            -- Deny destructive operations:
--            REVOKE DELETE, TRUNCATE ON public.official_contracts FROM <app_role>;
--            REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_artifacts FROM <app_role>;
--            -- Grant read-only access to artifacts and controlled draft fields editing:
--            GRANT SELECT ON public.official_contracts, public.contract_artifacts TO <app_role>;
--            GRANT INSERT (institution_id, number, version, fields, legal_text, provider, created_by, replaces_id, content_hash) ON public.official_contracts TO <app_role>;
--            GRANT UPDATE (fields, content_hash) ON public.official_contracts TO <app_role>;
--            -- Delegate state transitions and artifact insertion exclusively to the trusted RPC:
--            GRANT EXECUTE ON FUNCTION public.transition_official_contract(uuid, uuid, text, text, jsonb, text, text, text) TO <app_role>;
--       By withholding UPDATE on official_contracts.state and INSERT on contract_artifacts from <app_role>,
--       PostgreSQL's native permission engine aborts direct modifications, ensuring that all state changes
--       flow exclusively through the audited transition_official_contract() RPC.
--    c) Backend Authentication & Isolation Layer:
--       The Backend API is responsible for verifying user authentication, active tenant status,
--       and session claims before executing database transactions with SET LOCAL app.current_user_id.
