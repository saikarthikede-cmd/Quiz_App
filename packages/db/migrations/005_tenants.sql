-- Multi-tenancy: add tenants table and scope users/contests to a tenant.
-- Existing data is migrated to a default "seed" tenant so nothing breaks.

-- 1. Tenants master table
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'standard',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slug),
  CHECK (plan IN ('standard', 'pro', 'enterprise'))
);

-- 2. Seed the default tenant (fixed UUID so re-running is idempotent)
INSERT INTO tenants (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default', 'standard')
ON CONFLICT (slug) DO NOTHING;

-- 3. Add tenant_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE users SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

-- 4. Scope users email uniqueness per tenant (drop global unique, create scoped index)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_tenant_idx ON users (email, tenant_id);

-- 5. Add tenant_id to oauth_accounts
ALTER TABLE oauth_accounts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE oauth_accounts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE oauth_accounts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE oauth_accounts DROP CONSTRAINT IF EXISTS oauth_accounts_provider_provider_uid_key;
CREATE UNIQUE INDEX IF NOT EXISTS oauth_accounts_tenant_provider_uid_idx
  ON oauth_accounts (tenant_id, provider, provider_uid);

-- 6. Add tenant_id to contests
ALTER TABLE contests ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE contests SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE contests ALTER COLUMN tenant_id SET NOT NULL;

-- 7. Indexes for tenant-scoped queries
CREATE INDEX IF NOT EXISTS tenants_slug_idx ON tenants (slug);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users (tenant_id);
CREATE INDEX IF NOT EXISTS contests_tenant_idx ON contests (tenant_id);
