-- 1. Add user_profiles table for client-side users
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_select_own" ON user_profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);
CREATE POLICY "user_profiles_insert_own" ON user_profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "user_profiles_update_own" ON user_profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "user_profiles_delete_own" ON user_profiles FOR DELETE
  TO authenticated USING (auth.uid() = id);

-- Admin can read all user profiles
CREATE POLICY "user_profiles_select_admin" ON user_profiles FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 2. Add feedback_tickets table
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE DEFAULT ('FB-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8))),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
  admin_reply TEXT,
  replied_at TIMESTAMPTZ,
  replied_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE feedback_tickets ENABLE ROW LEVEL SECURITY;

-- Users can CRUD their own feedback
CREATE POLICY "feedback_select_own" ON feedback_tickets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "feedback_insert_own" ON feedback_tickets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "feedback_update_own" ON feedback_tickets FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Admin can see all and update
CREATE POLICY "feedback_select_admin" ON feedback_tickets FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "feedback_update_admin" ON feedback_tickets FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 3. Add verification time window columns to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS verification_start TIME;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS verification_end TIME;

-- 4. Add available_stock column to sessions for CAS-based stock management
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS available_stock INTEGER;

-- Initialize available_stock = capacity for existing sessions
UPDATE sessions SET available_stock = capacity WHERE available_stock IS NULL;

-- 5. Add 'expired' status to registrations
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_status_check;
ALTER TABLE registrations ADD CONSTRAINT registrations_status_check
  CHECK (status IN ('active', 'used', 'cancelled', 'expired'));

-- 6. Add user_id to registrations (for logged-in users)
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 7. RPC function for atomic booking with CAS anti-oversell
CREATE OR REPLACE FUNCTION public.book_ticket(
  p_session_id UUID,
  p_name TEXT,
  p_phone TEXT,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_ticket_code TEXT;
  v_reg_id UUID;
  v_updated_count INT;
BEGIN
  -- Step 1: Re-check session status and stock (atomic CAS update)
  UPDATE sessions
  SET available_stock = available_stock - 1
  WHERE id = p_session_id
    AND is_active = TRUE
    AND available_stock > 0;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'sold_out'
    );
  END IF;

  -- Step 2: Generate ticket code and insert registration
  v_ticket_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 10));

  INSERT INTO registrations (name, phone, session_id, ticket_code, status, user_id)
  VALUES (p_name, p_phone, p_session_id, v_ticket_code, 'active', p_user_id)
  RETURNING id INTO v_reg_id;

  RETURN json_build_object(
    'success', TRUE,
    'ticket_code', v_ticket_code,
    'registration_id', v_reg_id
  );
END;
$$;

-- 8. RPC function for cancelling a ticket (return stock)
CREATE OR REPLACE FUNCTION public.cancel_ticket(
  p_registration_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_status TEXT;
  v_updated_count INT;
BEGIN
  -- Get current registration state
  SELECT session_id, status INTO v_session_id, v_status
  FROM registrations WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  -- Only active tickets can be cancelled
  IF v_status != 'active' THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_active');
  END IF;

  -- Verify ownership (if user_id provided)
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = p_registration_id AND (user_id = p_user_id OR user_id IS NULL)) THEN
      RETURN json_build_object('success', FALSE, 'error', 'not_owner');
    END IF;
  END IF;

  -- Mark as cancelled
  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;

  -- Return stock (+1)
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_session_id;

  RETURN json_build_object('success', TRUE);
END;
$$;

-- 9. RPC function for marking expired tickets
CREATE OR REPLACE FUNCTION public.expire_past_tickets()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE registrations r
  SET status = 'expired'
  FROM sessions s
  WHERE r.session_id = s.id
    AND r.status = 'active'
    AND (s.session_date + s.end_time::interval) < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 10. Trigger to auto-update updated_at on feedback_tickets
CREATE TRIGGER feedback_tickets_updated_at
  BEFORE UPDATE ON feedback_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 11. Fix registrations select policy: allow users to see their own tickets by user_id
-- First drop the existing public select policy
DROP POLICY IF EXISTS "registrations_select_public" ON registrations;

-- Allow anon to still select (for phone-based lookup backward compat)
CREATE POLICY "registrations_select_public" ON registrations FOR SELECT
  TO anon, authenticated USING (true);

-- Allow users to insert with their own user_id
DROP POLICY IF EXISTS "registrations_insert_anon" ON registrations;
CREATE POLICY "registrations_insert_anon" ON registrations FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'active');
