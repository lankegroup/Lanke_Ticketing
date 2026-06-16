
-- 1. Fix function search path mutable vulnerability
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- 2. Fix sessions admin policies (replace USING(true) with admin check)
DROP POLICY IF EXISTS "sessions_insert_admin" ON sessions;
DROP POLICY IF EXISTS "sessions_update_admin" ON sessions;
DROP POLICY IF EXISTS "sessions_delete_admin" ON sessions;

CREATE POLICY "sessions_insert_admin" ON sessions FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "sessions_update_admin" ON sessions FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "sessions_delete_admin" ON sessions FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 3. Fix registrations policies
DROP POLICY IF EXISTS "registrations_insert_anon" ON registrations;
DROP POLICY IF EXISTS "registrations_update_admin" ON registrations;
DROP POLICY IF EXISTS "registrations_delete_admin" ON registrations;

-- Anon can only insert with status='active' (prevents status manipulation)
CREATE POLICY "registrations_insert_anon" ON registrations FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'active');

CREATE POLICY "registrations_update_admin" ON registrations FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "registrations_delete_admin" ON registrations FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 4. Fix announcements admin policies
DROP POLICY IF EXISTS "announcements_insert_admin" ON announcements;
DROP POLICY IF EXISTS "announcements_update_admin" ON announcements;
DROP POLICY IF EXISTS "announcements_delete_admin" ON announcements;

CREATE POLICY "announcements_insert_admin" ON announcements FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "announcements_update_admin" ON announcements FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "announcements_delete_admin" ON announcements FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 5. Fix validation_logs admin policies
DROP POLICY IF EXISTS "vlogs_insert_admin" ON validation_logs;
DROP POLICY IF EXISTS "vlogs_update_admin" ON validation_logs;
DROP POLICY IF EXISTS "vlogs_delete_admin" ON validation_logs;

CREATE POLICY "vlogs_insert_admin" ON validation_logs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "vlogs_update_admin" ON validation_logs FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "vlogs_delete_admin" ON validation_logs FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 6. Fix storage bucket SELECT policy (remove anon listing; public URLs still work without a policy)
DROP POLICY IF EXISTS "public_images_select" ON storage.objects;

CREATE POLICY "auth_images_select" ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'announcements');
