CREATE TABLE IF NOT EXISTS auth_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  code_hash TEXT NOT NULL,
  requested_name TEXT,
  requested_avatar_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS auth_otps_email_created_idx
  ON auth_otps (email, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_otps_pending_idx
  ON auth_otps (email, expires_at)
  WHERE consumed_at IS NULL;
