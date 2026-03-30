ALTER TABLE users
ALTER COLUMN wallet_balance SET DEFAULT 100.00;

CREATE TABLE wallet_topup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX wallet_topup_requests_user_id_idx ON wallet_topup_requests(user_id);
CREATE INDEX wallet_topup_requests_status_created_at_idx ON wallet_topup_requests(status, created_at DESC);
