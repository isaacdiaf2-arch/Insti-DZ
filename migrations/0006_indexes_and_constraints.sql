-- 0006_indexes_and_constraints.sql
-- Functional Indexes, Partial Unique Indexes, Check Constraints, and Performance Indexes

-- 1. Functional & Partial Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique ON public.profiles (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique ON public.profiles (phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS rooms_unique_name ON public.rooms (institution_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS official_contract_open_unique ON public.official_contracts (institution_id) WHERE state IN ('draft', 'awaiting_platform');

-- 2. Anti-Conflict Schedule Indexes
CREATE UNIQUE INDEX IF NOT EXISTS schedules_no_class_conflict ON public.schedules (institution_id, class_id, day_of_week, start_time) WHERE archived = false;
CREATE UNIQUE INDEX IF NOT EXISTS schedules_no_teacher_conflict ON public.schedules (institution_id, teacher_id, day_of_week, start_time) WHERE archived = false AND teacher_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS schedules_no_room_conflict ON public.schedules (institution_id, room_id, day_of_week, start_time) WHERE archived = false AND room_id IS NOT NULL;

-- 3. Check Constraints (Applied safely with IF NOT EXISTS checks)
DO $$ BEGIN
  ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_status_check
    CHECK (status IN ('present', 'absent', 'late', 'excused'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_minutes_late_check
    CHECK (minutes_late >= 0 AND minutes_late <= 600);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.assessments ADD CONSTRAINT assessments_kind_check
    CHECK (kind IN ('quiz','test','exam','continuous','homework','activity','participation','project','oral','practical'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.schedules ADD CONSTRAINT schedules_day_of_week_check
    CHECK (day_of_week BETWEEN 0 AND 6);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.personal_schedule_entries ADD CONSTRAINT personal_schedule_day_check
    CHECK (day_of_week BETWEEN 0 AND 6);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.personal_schedule_entries ADD CONSTRAINT personal_schedule_title_check
    CHECK (char_length(title) BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.personal_schedule_entries ADD CONSTRAINT personal_schedule_note_check
    CHECK (note IS NULL OR char_length(note) <= 300);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Performance B-Tree Indexes
CREATE INDEX IF NOT EXISTS login_attempts_identifier_idx ON public.login_attempts (identifier, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS assessments_group_idx ON public.assessments (group_id);
CREATE INDEX IF NOT EXISTS assessments_module_idx ON public.assessments (module_id);
CREATE INDEX IF NOT EXISTS assessments_teacher_idx ON public.assessments (teacher_id);
CREATE INDEX IF NOT EXISTS results_student_idx ON public.results (student_id);
CREATE INDEX IF NOT EXISTS gm_student_idx ON public.group_memberships (student_id);
CREATE INDEX IF NOT EXISTS gm_group_idx ON public.group_memberships (group_id);
CREATE INDEX IF NOT EXISTS modules_teacher_idx ON public.modules (teacher_id);
CREATE INDEX IF NOT EXISTS modules_level_idx ON public.modules (level_id);
CREATE INDEX IF NOT EXISTS groups_level_idx ON public.groups (level_id);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON public.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON public.user_sessions (expires_at);
