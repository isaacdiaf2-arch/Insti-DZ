-- 0005_contracts_and_legal_tables.sql
-- Contracts, Artifacts, and Official Signing Workflow

-- contracts
CREATE TABLE IF NOT EXISTS public.contracts (
  amount numeric NOT NULL,
  approved_at timestamptz,
  body text NOT NULL,
  contract_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  duration_months integer NOT NULL,
  expires_at timestamptz,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  institution_signature text,
  institution_signed_at timestamptz,
  platform_signature text,
  platform_signed_at timestamptz,
  qr_payload text,
  signed_at timestamptz,
  snapshot jsonb NOT NULL,
  status public.contract_status NOT NULL,
  updated_at timestamptz NOT NULL
);

-- contract_events
CREATE TABLE IF NOT EXISTS public.contract_events (
  actor_id uuid,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  note text,
  status text NOT NULL
);

-- contract_provider_settings
CREATE TABLE IF NOT EXISTS public.contract_provider_settings (
  details jsonb NOT NULL,
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);

-- official_contracts
CREATE TABLE IF NOT EXISTS public.official_contracts (
  content_hash text NOT NULL,
  correction_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  fields jsonb NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_evidence jsonb,
  institution_id uuid REFERENCES public.institutions(id) NOT NULL,
  legal_text text NOT NULL,
  number text NOT NULL,
  platform_evidence jsonb,
  provider jsonb NOT NULL,
  replaces_id uuid REFERENCES public.official_contracts(id),
  state text NOT NULL,
  updated_at timestamptz NOT NULL,
  version text NOT NULL
);

-- contract_artifacts
CREATE TABLE IF NOT EXISTS public.contract_artifacts (
  contract_id uuid PRIMARY KEY REFERENCES public.official_contracts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  pdf_base64 text NOT NULL,
  sha256 text NOT NULL
);

