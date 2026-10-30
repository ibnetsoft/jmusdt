CREATE TABLE IF NOT EXISTS company_wallets (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), network text NOT NULL CHECK(network='mainnet'),
 address text NOT NULL UNIQUE, encrypted_private_key text NOT NULL,
 created_by uuid NOT NULL REFERENCES profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid NOT NULL REFERENCES profiles(id),
 network text NOT NULL CHECK(network='mainnet'), contract text NOT NULL, source text NOT NULL, destination text NOT NULL,
 amount bigint NOT NULL CHECK(amount > 0), fee_limit bigint NOT NULL CHECK(fee_limit > 0),
 status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','approved','signing','broadcast','completed','failed','needs_review')),
 expires_at timestamptz NOT NULL, reason text NOT NULL DEFAULT '', txid text UNIQUE, payload jsonb,
 note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_one_active_transfer ON company_transfers(source) WHERE status IN ('approved','signing','broadcast','needs_review');
ALTER TABLE company_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON company_wallets, company_transfers FROM PUBLIC, anon, authenticated;
