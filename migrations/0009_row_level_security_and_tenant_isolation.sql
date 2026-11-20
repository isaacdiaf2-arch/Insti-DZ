-- 0009_row_level_security_and_tenant_isolation.sql
-- Comprehensive Row-Level Security (RLS) and Multi-Tenant Isolation for Study DZ
-- Enforces tenant separation across institutions, roles, academic units, exams, and contracts.
-- NOTE: Requires 0007_functions_and_triggers.sql and 0008_neon_roles_and_privileges.sql.
-- REVIEW ONLY: Do NOT execute DDL on live Neon without DBA approval.

-- Ensure password_hash column exists idempotently before auth_lookup_by_email (canonically managed in 0010_profiles_password_hash.sql)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash text;

-- ============================================================================
-- 0. Authentication Lookup Helper (SECURITY DEFINER for pre-session login under NOBYPASSRLS)
-- ============================================================================
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
GRANT EXECUTE ON FUNCTION public.auth_lookup_by_email(text) TO sdz_app_user;

-- ============================================================================
-- 1. Enable Row-Level Security on All Tenant & Sensitive Tables
-- ============================================================================
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_schedule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Institutions & Licensing Policies
-- ============================================================================
DROP POLICY IF EXISTS institutions_read ON public.institutions;
CREATE POLICY institutions_read ON public.institutions FOR SELECT
USING (
  public.is_platform_admin()
  OR id = public.current_institution()
  OR status = 'active'
);

DROP POLICY IF EXISTS institutions_manage ON public.institutions;
CREATE POLICY institutions_manage ON public.institutions FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(id)
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(id)
);

DROP POLICY IF EXISTS licenses_read ON public.licenses;
CREATE POLICY licenses_read ON public.licenses FOR SELECT
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
);

DROP POLICY IF EXISTS licenses_manage ON public.licenses;
CREATE POLICY licenses_manage ON public.licenses FOR ALL
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

-- ============================================================================
-- 3. User Profiles, Sessions & Roles Policies (Prevent Role/Tenant Escalation)
-- ============================================================================
DROP POLICY IF EXISTS profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT
USING (
  public.is_platform_admin()
  OR id = auth.uid()
  OR (institution_id = public.current_institution() AND institution_id IS NOT NULL)
);

DROP POLICY IF EXISTS profiles_insert_manage ON public.profiles;
CREATE POLICY profiles_insert_manage ON public.profiles FOR INSERT
WITH CHECK (
  public.is_platform_admin()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id))
);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE
USING (id = auth.uid() OR public.is_platform_admin())
WITH CHECK (
  public.is_platform_admin()
  OR (
    id = auth.uid()
    AND institution_id IS NOT DISTINCT FROM public.current_institution()
  )
);

DROP POLICY IF EXISTS profiles_delete_manage ON public.profiles;
CREATE POLICY profiles_delete_manage ON public.profiles FOR DELETE
USING (
  public.is_platform_admin()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id) AND id <> auth.uid())
);

DROP POLICY IF EXISTS user_roles_read ON public.user_roles;
CREATE POLICY user_roles_read ON public.user_roles FOR SELECT
USING (
  public.is_platform_admin()
  OR user_id = auth.uid()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id))
);

-- Institution admins can only assign teacher/student within their own institution, never platform_admin
DROP POLICY IF EXISTS user_roles_manage ON public.user_roles;
CREATE POLICY user_roles_manage ON public.user_roles FOR ALL
USING (
  public.is_platform_admin()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id) AND role IN ('teacher', 'student'))
)
WITH CHECK (
  public.is_platform_admin()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id) AND role IN ('teacher', 'student'))
);

DROP POLICY IF EXISTS user_sessions_own ON public.user_sessions;
CREATE POLICY user_sessions_own ON public.user_sessions FOR ALL
USING (public.is_platform_admin() OR user_id = auth.uid())
WITH CHECK (public.is_platform_admin() OR user_id = auth.uid());

-- ============================================================================
-- 4. Academic Structure Policies
-- ============================================================================
DROP POLICY IF EXISTS programs_tenant_isolation ON public.programs;
CREATE POLICY programs_tenant_isolation ON public.programs FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS specializations_tenant_isolation ON public.specializations;
CREATE POLICY specializations_tenant_isolation ON public.specializations FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS academic_levels_tenant_isolation ON public.academic_levels;
CREATE POLICY academic_levels_tenant_isolation ON public.academic_levels FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS classes_tenant_isolation ON public.classes;
CREATE POLICY classes_tenant_isolation ON public.classes FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS subjects_tenant_isolation ON public.subjects;
CREATE POLICY subjects_tenant_isolation ON public.subjects FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS groups_tenant_isolation ON public.groups;
CREATE POLICY groups_tenant_isolation ON public.groups FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS group_memberships_read ON public.group_memberships;
CREATE POLICY group_memberships_read ON public.group_memberships FOR SELECT
USING (
  public.is_platform_admin()
  OR student_id = auth.uid()
  OR public.manages_institution(institution_id)
  OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND public.teaches_group(g.id))
);

DROP POLICY IF EXISTS group_memberships_manage ON public.group_memberships;
CREATE POLICY group_memberships_manage ON public.group_memberships FOR ALL
USING (public.is_platform_admin() OR public.manages_institution(institution_id))
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS enrollments_tenant_isolation ON public.enrollments;
CREATE POLICY enrollments_tenant_isolation ON public.enrollments FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR student_id = auth.uid()
  OR institution_id = public.current_institution()
)
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS modules_tenant_isolation ON public.modules;
CREATE POLICY modules_tenant_isolation ON public.modules FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS skills_tenant_isolation ON public.skills;
CREATE POLICY skills_tenant_isolation ON public.skills FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS rooms_tenant_isolation ON public.rooms;
CREATE POLICY rooms_tenant_isolation ON public.rooms FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS schedules_tenant_isolation ON public.schedules;
CREATE POLICY schedules_tenant_isolation ON public.schedules FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS personal_schedule_own ON public.personal_schedule_entries;
CREATE POLICY personal_schedule_own ON public.personal_schedule_entries FOR ALL
USING (public.is_platform_admin() OR owner_id = auth.uid())
WITH CHECK (public.is_platform_admin() OR owner_id = auth.uid());

DROP POLICY IF EXISTS announcements_tenant_isolation ON public.announcements;
CREATE POLICY announcements_tenant_isolation ON public.announcements FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (
  public.is_platform_admin()
  OR (institution_id = public.current_institution() AND (public.manages_institution(institution_id) OR author_id = auth.uid()))
);

-- ============================================================================
-- 5. Learning, Lessons, Files, Attendance & Homework Policies
-- ============================================================================
DROP POLICY IF EXISTS lessons_read ON public.lessons;
CREATE POLICY lessons_read ON public.lessons FOR SELECT
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR teacher_id = auth.uid()
  OR public.teaches_module(module_id)
  OR (published = true AND institution_id = public.current_institution())
);

DROP POLICY IF EXISTS lessons_manage ON public.lessons;
CREATE POLICY lessons_manage ON public.lessons FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (teacher_id = auth.uid() AND institution_id = public.current_institution())
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (teacher_id = auth.uid() AND institution_id = public.current_institution())
);

DROP POLICY IF EXISTS lesson_completions_isolation ON public.lesson_completions;
CREATE POLICY lesson_completions_isolation ON public.lesson_completions FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (student_id = auth.uid() AND institution_id = public.current_institution())
)
WITH CHECK (
  public.is_platform_admin()
  OR (student_id = auth.uid() AND institution_id = public.current_institution())
);

DROP POLICY IF EXISTS files_tenant_isolation ON public.files;
CREATE POLICY files_tenant_isolation ON public.files FOR ALL
USING (public.is_platform_admin() OR institution_id = public.current_institution())
WITH CHECK (
  public.is_platform_admin()
  OR (institution_id = public.current_institution() AND (public.manages_institution(institution_id) OR owner_id = auth.uid()))
);

DROP POLICY IF EXISTS attendance_tenant_isolation ON public.attendance_records;
CREATE POLICY attendance_tenant_isolation ON public.attendance_records FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR student_id = auth.uid()
  OR (institution_id = public.current_institution() AND (public.teaches_group(group_id) OR recorded_by = auth.uid()::text))
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (institution_id = public.current_institution() AND recorded_by = auth.uid()::text)
);

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

-- ============================================================================
-- 6. Assessments, Results & Question Bank (Exams / Questions / Options / Attempts)
-- ============================================================================
DROP POLICY IF EXISTS assessments_read ON public.assessments;
CREATE POLICY assessments_read ON public.assessments FOR SELECT
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR teacher_id = auth.uid()
  OR public.teaches_module(module_id)
  OR (published = true AND public.is_group_member(group_id))
);

DROP POLICY IF EXISTS assessments_manage ON public.assessments;
CREATE POLICY assessments_manage ON public.assessments FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR teacher_id = auth.uid()
  OR public.teaches_module(module_id)
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (institution_id = public.current_institution() AND (teacher_id = auth.uid() OR public.teaches_module(module_id)))
);

DROP POLICY IF EXISTS exams_tenant_isolation ON public.exams;
CREATE POLICY exams_tenant_isolation ON public.exams FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (teacher_id = auth.uid() AND institution_id = public.current_institution())
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR (teacher_id = auth.uid() AND institution_id = public.current_institution())
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

DROP POLICY IF EXISTS attempts_read ON public.attempts;
CREATE POLICY attempts_read ON public.attempts FOR SELECT
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR student_id = auth.uid()
);

DROP POLICY IF EXISTS attempts_insert_own ON public.attempts;
CREATE POLICY attempts_insert_own ON public.attempts FOR INSERT
WITH CHECK (
  student_id = auth.uid()
  AND institution_id = public.current_institution()
);

DROP POLICY IF EXISTS attempt_answers_read ON public.attempt_answers;
CREATE POLICY attempt_answers_read ON public.attempt_answers FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.attempts a
    WHERE a.id = attempt_id AND (
      a.student_id = auth.uid()
      OR public.is_platform_admin()
      OR public.manages_institution(a.institution_id)
    )
  )
);

DROP POLICY IF EXISTS attempt_answers_insert_own ON public.attempt_answers;
CREATE POLICY attempt_answers_insert_own ON public.attempt_answers FOR INSERT
WITH CHECK (
  institution_id = public.current_institution()
  AND EXISTS (
    SELECT 1 FROM public.attempts a
    WHERE a.id = attempt_id AND a.student_id = auth.uid()
  )
);

-- ============================================================================
-- 7. Billing, Payments, Invoices, Contracts & Official Legal Artifacts
-- ============================================================================
DROP POLICY IF EXISTS payments_tenant_isolation ON public.payments;
CREATE POLICY payments_tenant_isolation ON public.payments FOR SELECT
USING (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS payments_insert_institution ON public.payments;
CREATE POLICY payments_insert_institution ON public.payments FOR INSERT
WITH CHECK (
  public.is_platform_admin()
  OR (public.manages_institution(institution_id) AND status::text = 'pending')
);

DROP POLICY IF EXISTS payments_update_platform ON public.payments;
CREATE POLICY payments_update_platform ON public.payments FOR UPDATE
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS payments_delete_platform ON public.payments;
CREATE POLICY payments_delete_platform ON public.payments FOR DELETE
USING (public.is_platform_admin());

DROP POLICY IF EXISTS invoices_tenant_isolation ON public.invoices;
CREATE POLICY invoices_tenant_isolation ON public.invoices FOR ALL
USING (public.is_platform_admin() OR public.manages_institution(institution_id))
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS contracts_tenant_isolation ON public.contracts;
CREATE POLICY contracts_tenant_isolation ON public.contracts FOR ALL
USING (public.is_platform_admin() OR public.manages_institution(institution_id))
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS contract_events_tenant_isolation ON public.contract_events;
CREATE POLICY contract_events_tenant_isolation ON public.contract_events FOR ALL
USING (public.is_platform_admin() OR public.manages_institution(institution_id))
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

DROP POLICY IF EXISTS contract_provider_settings_read ON public.contract_provider_settings;
CREATE POLICY contract_provider_settings_read ON public.contract_provider_settings FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS contract_provider_settings_manage ON public.contract_provider_settings;
CREATE POLICY contract_provider_settings_manage ON public.contract_provider_settings FOR ALL
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS official_contracts_read ON public.official_contracts;
CREATE POLICY official_contracts_read ON public.official_contracts FOR SELECT
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
);

DROP POLICY IF EXISTS official_contracts_insert_draft ON public.official_contracts;
CREATE POLICY official_contracts_insert_draft ON public.official_contracts FOR INSERT
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
);

DROP POLICY IF EXISTS official_contracts_update_draft ON public.official_contracts;
CREATE POLICY official_contracts_update_draft ON public.official_contracts FOR UPDATE
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
)
WITH CHECK (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
);

DROP POLICY IF EXISTS contract_artifacts_read ON public.contract_artifacts;
CREATE POLICY contract_artifacts_read ON public.contract_artifacts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.official_contracts c
    WHERE c.id = contract_id AND (
      public.is_platform_admin()
      OR public.manages_institution(c.institution_id)
    )
  )
);

-- ============================================================================
-- 8. Notifications, Reset Requests, Change Requests & Audit Logs
-- ============================================================================
DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT
USING (recipient_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE
USING (recipient_id = auth.uid() OR public.is_platform_admin())
WITH CHECK (recipient_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS password_reset_requests_isolation ON public.password_reset_requests;
CREATE POLICY password_reset_requests_isolation ON public.password_reset_requests FOR ALL
USING (
  public.is_platform_admin()
  OR (target = 'institution_admin' AND institution_id IS NOT NULL AND public.manages_institution(institution_id))
)
WITH CHECK (
  public.is_platform_admin()
  OR (target = 'institution_admin' AND institution_id IS NOT NULL AND public.manages_institution(institution_id))
);

DROP POLICY IF EXISTS change_requests_isolation ON public.change_requests;
CREATE POLICY change_requests_isolation ON public.change_requests FOR ALL
USING (
  public.is_platform_admin()
  OR requester_id = auth.uid()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id))
)
WITH CHECK (
  public.is_platform_admin()
  OR requester_id = auth.uid()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id))
);

DROP POLICY IF EXISTS audit_logs_read ON public.audit_logs;
CREATE POLICY audit_logs_read ON public.audit_logs FOR SELECT
USING (
  public.is_platform_admin()
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id))
);

DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT
WITH CHECK (
  public.is_platform_admin()
  OR actor_id = auth.uid()
  OR auth.uid() IS NULL
);

-- ============================================================================
-- 9. Public Inbound Forms & Rate-Limiting Tables + Security Definer Counters
-- ============================================================================
DROP POLICY IF EXISTS trial_requests_read_platform ON public.trial_requests;
CREATE POLICY trial_requests_read_platform ON public.trial_requests FOR SELECT
USING (public.is_platform_admin());

DROP POLICY IF EXISTS trial_requests_insert_public ON public.trial_requests;
CREATE POLICY trial_requests_insert_public ON public.trial_requests FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS trial_requests_manage_platform ON public.trial_requests;
CREATE POLICY trial_requests_manage_platform ON public.trial_requests FOR UPDATE
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS support_messages_read_platform ON public.support_messages;
CREATE POLICY support_messages_read_platform ON public.support_messages FOR SELECT
USING (public.is_platform_admin());

DROP POLICY IF EXISTS support_messages_insert_public ON public.support_messages;
CREATE POLICY support_messages_insert_public ON public.support_messages FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS login_attempts_read_platform ON public.login_attempts;
CREATE POLICY login_attempts_read_platform ON public.login_attempts FOR SELECT
USING (public.is_platform_admin());

DROP POLICY IF EXISTS login_attempts_insert_public ON public.login_attempts;
CREATE POLICY login_attempts_insert_public ON public.login_attempts FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS login_attempts_delete_platform ON public.login_attempts;
CREATE POLICY login_attempts_delete_platform ON public.login_attempts FOR DELETE
USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.count_recent_trial_requests(_email text, _since timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*)::integer FROM public.trial_requests WHERE lower(email) = lower(trim(_email)) AND created_at >= _since;
$$;
ALTER FUNCTION public.count_recent_trial_requests(text, timestamptz) OWNER TO sdz_schema_owner;
GRANT EXECUTE ON FUNCTION public.count_recent_trial_requests(text, timestamptz) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.count_recent_support_messages(_email text, _since timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*)::integer FROM public.support_messages WHERE lower(email) = lower(trim(_email)) AND created_at >= _since;
$$;
ALTER FUNCTION public.count_recent_support_messages(text, timestamptz) OWNER TO sdz_schema_owner;
GRANT EXECUTE ON FUNCTION public.count_recent_support_messages(text, timestamptz) TO sdz_app_user;

CREATE OR REPLACE FUNCTION public.count_recent_failed_logins(_identifier text, _since timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*)::integer FROM public.login_attempts WHERE identifier = _identifier AND success = false AND created_at >= _since;
$$;
ALTER FUNCTION public.count_recent_failed_logins(text, timestamptz) OWNER TO sdz_schema_owner;
GRANT EXECUTE ON FUNCTION public.count_recent_failed_logins(text, timestamptz) TO sdz_app_user;

-- DOWN (Rollback Reference):
-- Disable RLS or drop added policies cleanly per table if reverting isolation layer.
