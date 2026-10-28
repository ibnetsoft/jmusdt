CREATE TABLE IF NOT EXISTS app_branding (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 logo_png bytea NOT NULL CHECK(octet_length(logo_png)<=1048576),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_branding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_branding FROM PUBLIC,anon,authenticated;
