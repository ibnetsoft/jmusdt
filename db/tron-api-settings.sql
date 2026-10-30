CREATE TABLE IF NOT EXISTS tron_api_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 encrypted_key text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL REFERENCES profiles(id)
);
ALTER TABLE tron_api_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tron_api_settings FROM PUBLIC, anon, authenticated;
