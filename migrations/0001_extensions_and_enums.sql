-- 0001_extensions_and_enums.sql
-- Extensions and Global Enums for Study DZ

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM (
    'platform_admin',
    'institution_admin',
    'teacher',
    'student'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.institution_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'expired',
    'approved',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'verified',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.question_type AS ENUM (
    'single_choice',
    'multiple_choice',
    'open_text'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_status AS ENUM (
    'created',
    'institution_signed',
    'approved',
    'active',
    'rejected',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.official_contract_action AS ENUM (
    'institution_sign',
    'platform_sign',
    'return'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
