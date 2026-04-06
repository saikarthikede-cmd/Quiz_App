-- Platform administration primitives for tenant provisioning and management.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET is_platform_admin = TRUE
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND is_admin = TRUE;
