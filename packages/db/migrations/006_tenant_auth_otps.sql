-- Scope OTP requests to a tenant so tenants cannot interfere with each other's login flow.

ALTER TABLE auth_otps
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE auth_otps
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE auth_otps
  ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS auth_otps_email_created_idx;
DROP INDEX IF EXISTS auth_otps_pending_idx;

CREATE INDEX IF NOT EXISTS auth_otps_tenant_email_created_idx
  ON auth_otps (tenant_id, email, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_otps_tenant_pending_idx
  ON auth_otps (tenant_id, email, expires_at)
  WHERE consumed_at IS NULL;
