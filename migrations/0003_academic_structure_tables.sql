-- 0003_academic_structure_tables.sql
-- Academic Architecture, Facilities, and Cohorts

-- programs
CREATE TABLE IF NOT EXISTS public.programs (
  archived boolean NOT NULL,
  code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  description text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- specializations
CREATE TABLE IF NOT EXISTS public.specializations (
  archived boolean NOT NULL,
  code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  description text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  program_id uuid REFERENCES public.programs(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL,
  UNIQUE (institution_id, program_id, name)
);

-- academic_levels
CREATE TABLE IF NOT EXISTS public.academic_levels (
  archived boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  duration_months integer,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  order_index integer NOT NULL,
  program_id uuid REFERENCES public.programs(id) ON DELETE CASCADE,
  specialization_id uuid REFERENCES public.specializations(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL
);

-- classes
CREATE TABLE IF NOT EXISTS public.classes (
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  specialty text,
  stage text,
  stream text
);

-- groups
CREATE TABLE IF NOT EXISTS public.groups (
  archived boolean NOT NULL,
  capacity integer,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  level_id uuid REFERENCES public.academic_levels(id) ON DELETE CASCADE,
  name text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- modules
CREATE TABLE IF NOT EXISTS public.modules (
  archived boolean NOT NULL,
  code text,
  coefficient numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hours numeric,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  level_id uuid REFERENCES public.academic_levels(id) ON DELETE CASCADE,
  name text NOT NULL,
  specialization_id uuid REFERENCES public.specializations(id) ON DELETE CASCADE,
  teacher_id uuid,
  updated_at timestamptz NOT NULL
);

-- skills
CREATE TABLE IF NOT EXISTS public.skills (
  created_at timestamptz NOT NULL DEFAULT now(),
  description text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  module_id uuid REFERENCES public.modules(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  weight numeric NOT NULL
);

-- subjects
CREATE TABLE IF NOT EXISTS public.subjects (
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  teacher_id uuid
);

-- rooms
CREATE TABLE IF NOT EXISTS public.rooms (
  capacity integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- schedules
CREATE TABLE IF NOT EXISTS public.schedules (
  archived boolean NOT NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  day_of_week numeric NOT NULL,
  end_time text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  label text,
  period_index integer NOT NULL,
  room_id uuid,
  start_time text NOT NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  teacher_id uuid,
  updated_at timestamptz NOT NULL
);

-- personal_schedule_entries
CREATE TABLE IF NOT EXISTS public.personal_schedule_entries (
  created_at timestamptz NOT NULL DEFAULT now(),
  day_of_week numeric NOT NULL,
  end_time text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  note text,
  owner_id uuid NOT NULL,
  start_time text NOT NULL,
  title text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- enrollments
CREATE TABLE IF NOT EXISTS public.enrollments (
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  student_id uuid NOT NULL,
  UNIQUE (student_id, class_id)
);

-- group_memberships
CREATE TABLE IF NOT EXISTS public.group_memberships (
  created_at timestamptz NOT NULL DEFAULT now(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  student_id uuid NOT NULL,
  UNIQUE (group_id, student_id)
);

-- licenses
CREATE TABLE IF NOT EXISTS public.licenses (
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deployment text NOT NULL,
  expires_on date,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  issued_at timestamptz NOT NULL,
  license_key text NOT NULL,
  note text,
  revoked_at timestamptz,
  starts_on date,
  status text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- attendance_records
CREATE TABLE IF NOT EXISTS public.attendance_records (
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  minutes_late numeric NOT NULL,
  module_id uuid REFERENCES public.modules(id) ON DELETE SET NULL,
  period_index integer NOT NULL,
  reason text,
  recorded_by text,
  session_date date NOT NULL,
  status text NOT NULL,
  student_id uuid NOT NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (institution_id, student_id, session_date, period_index)
);

