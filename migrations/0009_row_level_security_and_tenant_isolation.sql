-- 0009_row_level_security_and_tenant_isolation.sql
-- Comprehensive Row-Level Security (RLS) and Multi-Tenant Isolation for Study DZ
-- Enforces tenant separation across institutions, roles, academic units, exams, and contracts.

-- ============================================================================
-- 1. Enable Row-Level Security on All Sensitive Tables
-- ============================================================================
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

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
USING (public.is_platform_admin());

DROP POLICY IF EXISTS licenses_read ON public.licenses;
CREATE POLICY licenses_read ON public.licenses FOR SELECT
USING (
  public.is_platform_admin() 
  OR public.manages_institution(institution_id)
);

-- ============================================================================
-- 3. User Profiles & Roles Policies
-- ============================================================================
DROP POLICY IF EXISTS profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT
USING (
  public.is_platform_admin()
  OR id = auth.uid()
  OR (institution_id = public.current_institution() AND institution_id IS NOT NULL)
);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE
USING (id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS user_roles_read ON public.user_roles;
CREATE POLICY user_roles_read ON public.user_roles FOR SELECT
USING (
  public.is_platform_admin()
  OR user_id = auth.uid()
  OR public.manages_institution(institution_id)
);

DROP POLICY IF EXISTS user_roles_manage ON public.user_roles;
CREATE POLICY user_roles_manage ON public.user_roles FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
);

-- ============================================================================
-- 4. Academic Structure Policies (Levels, Groups, Modules)
-- ============================================================================
DROP POLICY IF EXISTS academic_levels_tenant_isolation ON public.academic_levels;
CREATE POLICY academic_levels_tenant_isolation ON public.academic_levels FOR ALL
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
  OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND public.manages_institution(g.institution_id))
  OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND public.teaches_group(g.id))
);

DROP POLICY IF EXISTS modules_tenant_isolation ON public.modules;
CREATE POLICY modules_tenant_isolation ON public.modules FOR ALL
USING (
  public.is_platform_admin()
  OR institution_id = public.current_institution()
)
WITH CHECK (public.is_platform_admin() OR public.manages_institution(institution_id));

-- ============================================================================
-- 5. Learning, Lessons & Assessments Policies
-- ============================================================================
DROP POLICY IF EXISTS lessons_read ON public.lessons;
CREATE POLICY lessons_read ON public.lessons FOR SELECT
USING (
  public.is_platform_admin()
  OR public.teaches_module(module_id)
  OR (published = true AND public.student_has_module(module_id))
  OR public.manages_institution((SELECT institution_id FROM public.modules WHERE id = module_id))
);

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
);

DROP POLICY IF EXISTS results_read ON public.results;
CREATE POLICY results_read ON public.results FOR SELECT
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR student_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.assessments a 
    WHERE a.id = assessment_id AND (a.teacher_id = auth.uid() OR public.teaches_module(a.module_id))
  )
);

DROP POLICY IF EXISTS results_manage ON public.results;
CREATE POLICY results_manage ON public.results FOR ALL
USING (
  public.is_platform_admin()
  OR public.manages_institution(institution_id)
  OR EXISTS (
    SELECT 1 FROM public.assessments a 
    WHERE a.id = assessment_id AND (a.teacher_id = auth.uid() OR public.teaches_module(a.module_id))
  )
);

-- ============================================================================
-- 6. Student Attempts & Answers (Automated Quizzes)
-- ============================================================================
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

-- ============================================================================
-- 7. Official Legal Contracts and Immutable Artifacts Policies
-- ============================================================================
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
-- 8. Notifications and Audit Logging Policies
-- ============================================================================
DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT
USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE
USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS audit_logs_read ON public.audit_logs;
CREATE POLICY audit_logs_read ON public.audit_logs FOR SELECT
USING (
  public.is_platform_admin() 
  OR (institution_id IS NOT NULL AND public.manages_institution(institution_id))
);
