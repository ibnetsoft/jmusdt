CREATE TABLE IF NOT EXISTS password_recovery_grants (
 token_hash text PRIMARY KEY CHECK(token_hash~'^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, session_id uuid NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recovery_grants_user ON password_recovery_grants(user_id);
CREATE INDEX IF NOT EXISTS recovery_grants_expiry ON password_recovery_grants(expires_at);
ALTER TABLE password_recovery_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_recovery_grants FROM anon,authenticated;
