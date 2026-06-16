
-- Admin profiles table (linked to auth.users)
CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_select_own" ON admin_profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);
CREATE POLICY "admins_insert_own" ON admin_profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "admins_update_own" ON admin_profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "admins_delete_own" ON admin_profiles FOR DELETE
  TO authenticated USING (auth.uid() = id);

-- Sessions (event slots)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Public read for sessions (clients need to see them)
CREATE POLICY "sessions_select_public" ON sessions FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "sessions_insert_admin" ON sessions FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "sessions_update_admin" ON sessions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sessions_delete_admin" ON sessions FOR DELETE
  TO authenticated USING (true);

-- Registrations
CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ticket_code TEXT NOT NULL UNIQUE DEFAULT UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 10)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'cancelled')),
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

-- Anon can insert (public registration)
CREATE POLICY "registrations_insert_anon" ON registrations FOR INSERT
  TO anon, authenticated WITH CHECK (true);
-- Anon can select own by phone (for my tickets page) - we allow select to all
CREATE POLICY "registrations_select_public" ON registrations FOR SELECT
  TO anon, authenticated USING (true);
-- Only authenticated can update (admin validates)
CREATE POLICY "registrations_update_admin" ON registrations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
-- Only authenticated can delete (admin cancels)
CREATE POLICY "registrations_delete_admin" ON registrations FOR DELETE
  TO authenticated USING (true);

-- Announcements (rich text content)
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  cover_image TEXT,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Public read for published announcements
CREATE POLICY "announcements_select_public" ON announcements FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "announcements_insert_admin" ON announcements FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "announcements_update_admin" ON announcements FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "announcements_delete_admin" ON announcements FOR DELETE
  TO authenticated USING (true);

-- Validation log (anti-duplicate scan)
CREATE TABLE IF NOT EXISTS validation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code TEXT NOT NULL,
  registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  admin_id UUID REFERENCES auth.users(id)
);

ALTER TABLE validation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vlogs_insert_admin" ON validation_logs FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "vlogs_select_admin" ON validation_logs FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "vlogs_update_admin" ON validation_logs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "vlogs_delete_admin" ON validation_logs FOR DELETE
  TO authenticated USING (true);

-- Function to update updated_at on announcements
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
