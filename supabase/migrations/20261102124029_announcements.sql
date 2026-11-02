-- Announcements are delivered to every signed-in user through the server API.
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ko text NOT NULL CHECK (char_length(trim(title_ko)) BETWEEN 1 AND 200),
  body_ko text NOT NULL CHECK (char_length(trim(body_ko)) BETWEEN 1 AND 10000),
  title_en text NOT NULL CHECK (char_length(trim(title_en)) BETWEEN 1 AND 200),
  body_en text NOT NULL CHECK (char_length(trim(body_en)) BETWEEN 1 AND 10000),
  title_ja text NOT NULL CHECK (char_length(trim(title_ja)) BETWEEN 1 AND 200),
  body_ja text NOT NULL CHECK (char_length(trim(body_ja)) BETWEEN 1 AND 10000),
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_created ON announcements(created_at DESC, id DESC);
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE announcements FROM PUBLIC, anon, authenticated;
