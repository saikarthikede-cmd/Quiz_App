ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS company_type TEXT NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS code_or_reference_id TEXT,
  ADD COLUMN IF NOT EXISTS id_pattern TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_company_type_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_company_type_check
      CHECK (company_type IN ('college', 'company'));
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS membership_type TEXT,
  ADD COLUMN IF NOT EXISTS entered_reference_id TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_membership_type_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_membership_type_check
      CHECK (membership_type IS NULL OR membership_type IN ('student', 'employee', 'player'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'wallet_topup_requests'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'wallet_requests'
  ) THEN
    ALTER TABLE wallet_topup_requests RENAME TO wallet_requests;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS wallet_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'add_money',
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE wallet_requests
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'add_money',
  ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE wallet_requests wr
SET company_id = u.tenant_id
FROM users u
WHERE wr.user_id = u.id
  AND wr.company_id IS NULL;

ALTER TABLE wallet_requests
  ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallet_requests_request_type_check'
  ) THEN
    ALTER TABLE wallet_requests
      ADD CONSTRAINT wallet_requests_request_type_check
      CHECK (request_type IN ('add_money', 'redeem'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS wallet_requests_user_id_idx ON wallet_requests(user_id);
CREATE INDEX IF NOT EXISTS wallet_requests_company_status_created_at_idx ON wallet_requests(company_id, status, created_at DESC);
