-- 0002_core_and_governance_tables.sql
-- Core, Profiles, Sessions, and Governance Tables

-- institutions
CREATE TABLE IF NOT EXISTS public.institutions (
  accreditation_authority text,
  accreditation_number text,
  address text,
  archived_at timestamptz,
  commercial_register text,
  commune text NOT NULL,
  cover_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  daira text,
  email text NOT NULL,
  facebook_url text,
  founded_on date,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_url text,
  is_trial boolean NOT NULL,
  legal_representative text,
  logo_url text,
  maps_url text,
  name text NOT NULL,
  name_fr text,
  owner_id uuid,
  phone text NOT NULL,
  primary_color text,
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  status text NOT NULL,
  subscription_end text,
  trial_ends_at timestamptz,
  type text NOT NULL,
  website text,
  wilaya text NOT NULL
);

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  first_name text NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  last_name text NOT NULL,
  phone text,
  totp_backup_codes text[],
  totp_enabled boolean NOT NULL,
  totp_secret text
);

-- user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  user_id uuid NOT NULL,
  UNIQUE (user_id, role)
);

-- user_sessions (Independent Session Store)
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  roles text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address text
);

-- login_attempts
CREATE TABLE IF NOT EXISTS public.login_attempts (
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  ip text,
  success boolean NOT NULL
);

-- password_reset_requests
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  full_name text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid,
  note text,
  resolved_at timestamptz,
  role text,
  status text NOT NULL,
  target text NOT NULL,
  temp_code text,
  updated_at timestamptz NOT NULL,
  user_id uuid
);

-- audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  action text NOT NULL,
  actor_id uuid,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid,
  ip text,
  metadata jsonb NOT NULL,
  resource text,
  resource_id uuid,
  result text NOT NULL
);

-- change_requests
CREATE TABLE IF NOT EXISTS public.change_requests (
  created_at timestamptz NOT NULL DEFAULT now(),
  decision_note text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  new_values jsonb NOT NULL,
  old_values jsonb NOT NULL,
  requester_id uuid NOT NULL,
  reviewed_at timestamptz,
  reviewer_id uuid,
  status text NOT NULL,
  target text NOT NULL
);

-- notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  link text,
  read_at timestamptz,
  recipient_id uuid NOT NULL,
  sender_id uuid,
  title text NOT NULL,
  type text NOT NULL
);

-- support_messages
CREATE TABLE IF NOT EXISTS public.support_messages (
  address text,
  commune text,
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  first_name text NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name text,
  last_name text NOT NULL,
  message text,
  phone text NOT NULL,
  wilaya text
);

-- trial_requests
CREATE TABLE IF NOT EXISTS public.trial_requests (
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name text NOT NULL,
  motivation text NOT NULL,
  note text,
  phone text NOT NULL,
  status text NOT NULL,
  trial_ends_at timestamptz,
  trial_started_at timestamptz,
  updated_at timestamptz NOT NULL
);

-- payments
CREATE TABLE IF NOT EXISTS public.payments (
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  method text NOT NULL,
  note text,
  paid_at timestamptz NOT NULL,
  proof_url text,
  reference text,
  rejection_reason text,
  reviewed_at timestamptz,
  status public.payment_status NOT NULL
);

-- invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  amount numeric NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  issued_at timestamptz NOT NULL,
  method text NOT NULL,
  number text NOT NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  period_end text,
  period_start text,
  status public.payment_status NOT NULL
);

