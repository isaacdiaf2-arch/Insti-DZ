-- 0004_learning_and_assessment_tables.sql
-- Lessons, Question Banks, Quizzes, and Homework

-- lessons
CREATE TABLE IF NOT EXISTS public.lessons (
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  description text,
  group_id uuid,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  module_id uuid,
  pdf_url text,
  published boolean NOT NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL,
  title text NOT NULL,
  video_url text
);

-- lesson_completions
CREATE TABLE IF NOT EXISTS public.lesson_completions (
  completed_at timestamptz NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE CASCADE NOT NULL,
  student_id uuid NOT NULL,
  UNIQUE (lesson_id, student_id)
);

-- files
CREATE TABLE IF NOT EXISTS public.files (
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  group_id uuid,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  mime_type text,
  module_id uuid,
  name text NOT NULL,
  owner_id uuid NOT NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE,
  url text NOT NULL
);

-- exams
CREATE TABLE IF NOT EXISTS public.exams (
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  description text,
  duration_minutes integer NOT NULL,
  group_id uuid,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  module_id uuid,
  published boolean NOT NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  teacher_id uuid NOT NULL,
  title text NOT NULL
);

-- questions
CREATE TABLE IF NOT EXISTS public.questions (
  created_at timestamptz NOT NULL DEFAULT now(),
  exam_id uuid REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  order_index integer NOT NULL,
  points numeric NOT NULL,
  text text NOT NULL,
  type public.question_type NOT NULL
);

-- options
CREATE TABLE IF NOT EXISTS public.options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  is_correct boolean NOT NULL,
  order_index integer NOT NULL,
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  text text NOT NULL
);

-- attempts
CREATE TABLE IF NOT EXISTS public.attempts (
  exam_id uuid REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  max_score numeric,
  score numeric,
  started_at timestamptz NOT NULL,
  student_id uuid NOT NULL,
  submitted_at timestamptz,
  UNIQUE (exam_id, student_id)
);

-- attempt_answers
CREATE TABLE IF NOT EXISTS public.attempt_answers (
  attempt_id uuid REFERENCES public.attempts(id) ON DELETE CASCADE NOT NULL,
  awarded numeric NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  is_correct boolean,
  option_id uuid REFERENCES public.options(id) ON DELETE SET NULL,
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  text_answer text,
  UNIQUE (attempt_id, question_id)
);

-- assessments
CREATE TABLE IF NOT EXISTS public.assessments (
  created_at timestamptz NOT NULL DEFAULT now(),
  description text,
  due_at timestamptz,
  exam_id uuid,
  group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  held_on date,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  kind text NOT NULL,
  level_id uuid,
  max_score numeric NOT NULL,
  module_id uuid REFERENCES public.modules(id) ON DELETE CASCADE,
  program_id uuid,
  published boolean NOT NULL,
  published_at timestamptz,
  results_published boolean NOT NULL,
  skill_id uuid REFERENCES public.skills(id) ON DELETE SET NULL,
  specialization_id uuid,
  teacher_id uuid,
  title text NOT NULL,
  updated_at timestamptz NOT NULL,
  weight numeric NOT NULL
);

-- results
CREATE TABLE IF NOT EXISTS public.results (
  assessment_id uuid REFERENCES public.assessments(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  note text,
  recorded_by text,
  score numeric NOT NULL,
  student_id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (assessment_id, student_id)
);

-- homework_submissions
CREATE TABLE IF NOT EXISTS public.homework_submissions (
  assessment_id uuid REFERENCES public.assessments(id) ON DELETE CASCADE NOT NULL,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  feedback text,
  file_url text,
  graded_at timestamptz,
  graded_by text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  student_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (assessment_id, student_id)
);

-- announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  author_id uuid NOT NULL,
  body text NOT NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL
);

