ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_reason_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_reason_check
  CHECK (reason IN ('entry_fee', 'prize', 'refund', 'topup', 'manual_topup', 'redeem'));
