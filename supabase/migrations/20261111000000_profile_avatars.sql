CREATE TABLE IF NOT EXISTS profile_avatars (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 262144),
  version uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profile_avatars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON profile_avatars FROM PUBLIC, anon, authenticated;
