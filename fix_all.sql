-- ============================================================
-- FULL RESET FIX SCRIPT - Drop and recreate all functions
-- ============================================================

-- ------------------------------------------------------------
-- 1. Get current function signatures (for reference)
-- ------------------------------------------------------------
SELECT proname, pg_get_function_identity_arguments(oid) as args
FROM pg_proc 
WHERE proname IN ('book_ticket_with_seat', 'book_ticket', 'admin_book_ticket', 'get_seat_map', 'lock_seat', 'unlock_seat', 'admin_bulk_block_seats');

-- ------------------------------------------------------------
-- 2. Drop ALL existing function versions
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid,uuid,text,text,uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid,uuid,text,text,text,uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid,uuid,text,text,uuid);
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid,uuid,text,text);

DROP FUNCTION IF EXISTS public.book_ticket(uuid,text,text,uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.book_ticket(uuid,text,text,uuid);
DROP FUNCTION IF EXISTS public.book_ticket(uuid,text,text);

DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid,uuid,text,text,uuid,boolean,text,boolean,text);
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid,uuid,text,text,uuid);
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid,text,text,uuid);

DROP FUNCTION IF EXISTS public.get_seat_map(uuid);

DROP FUNCTION IF EXISTS public.lock_seat(uuid);
DROP FUNCTION IF EXISTS public.unlock_seat(uuid);

DROP FUNCTION IF EXISTS public.admin_bulk_block_seats(uuid[],boolean,text);
DROP FUNCTION IF EXISTS public.admin_bulk_block_seats(uuid[],text);

-- ------------------------------------------------------------
-- 3. Create lock_seat function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'seat_blocked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations r
    WHERE r.seat_id = p_seat_id
      AND r.status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_booked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM seat_locks sl
    WHERE sl.seat_id = p_seat_id
      AND sl.user_id != v_user_id
      AND sl.expires_at > NOW()
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other');
  END IF;

  v_expires_at := NOW() + INTERVAL '5 minutes';

  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, v_user_id, v_expires_at)
  ON CONFLICT (seat_id) DO UPDATE
    SET user_id = v_user_id, expires_at = v_expires_at
  WHERE seat_locks.user_id = v_user_id OR seat_locks.expires_at <= NOW();

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires_at::TEXT);
END;
$$;

-- ------------------------------------------------------------
-- 4. Create unlock_seat function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unlock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  DELETE FROM seat_locks
  WHERE seat_id = p_seat_id
    AND user_id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------
-- 5. Create book_ticket_with_seat function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION book_ticket_with_seat(
  p_session_id    UUID,
  p_seat_id       UUID,
  p_name          TEXT,
  p_phone         TEXT,
  p_user_id       UUID,
  p_ticket_type   TEXT DEFAULT 'adult',
  p_buyer_user_id UUID DEFAULT NULL,
  p_note_content  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;
  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;
  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;

  IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM seat_locks
      WHERE seat_id = p_seat_id
        AND user_id = p_user_id
        AND expires_at > NOW()
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'lock_expired');
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, order_source)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, 'user')
  RETURNING id INTO v_reg_id;

  IF p_user_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- ------------------------------------------------------------
-- 6. Create book_ticket function (no seat)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION book_ticket(
  p_session_id    UUID,
  p_name          TEXT,
  p_phone         TEXT,
  p_user_id       UUID,
  p_ticket_type   TEXT DEFAULT 'adult',
  p_buyer_user_id UUID DEFAULT NULL,
  p_note_content  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;
  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;
  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, order_source)
  VALUES (p_session_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, 'user')
  RETURNING id INTO v_reg_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- ------------------------------------------------------------
-- 7. Create admin_book_ticket function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_book_ticket(
  p_session_id       UUID,
  p_seat_id          UUID,
  p_name             TEXT,
  p_phone            TEXT,
  p_user_id          UUID,
  p_force            BOOLEAN DEFAULT FALSE,
  p_order_source     TEXT DEFAULT 'admin',
  p_is_supplementary BOOLEAN DEFAULT FALSE,
  p_ticket_type      TEXT DEFAULT 'adult'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
  v_seat_blocked BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;
  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;
  IF v_session.available_stock <= 0 AND NOT p_force THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  IF p_seat_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
    END IF;

    SELECT is_blocked INTO v_seat_blocked FROM seats WHERE id = p_seat_id;

    IF v_seat_blocked = TRUE AND NOT p_force THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
    END IF;

    IF EXISTS (
      SELECT 1 FROM registrations
      WHERE seat_id = p_seat_id
        AND status NOT IN ('cancelled', 'expired')
    ) AND NOT p_force THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (
    session_id, seat_id, name, phone, ticket_code, status, user_id,
    ticket_type, order_source, is_supplementary, was_force_booked
  ) VALUES (
    p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id,
    p_ticket_type, p_order_source, p_is_supplementary, p_force
  ) RETURNING id INTO v_reg_id;

  IF p_seat_id IS NOT NULL AND p_force AND v_seat_blocked THEN
    UPDATE seats SET is_blocked = FALSE WHERE id = p_seat_id;
  END IF;

  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- ------------------------------------------------------------
-- 8. Create get_seat_map function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_seat_map(p_session_id UUID)
RETURNS TABLE(
  id                UUID,
  row_index         INT,
  col_index         INT,
  seat_name         TEXT,
  is_booked         BOOLEAN,
  is_locked         BOOLEAN,
  locked_by_me      BOOLEAN,
  is_blocked        BOOLEAN,
  block_reason      TEXT,
  booked_ticket_type TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.row_index,
    s.col_index,
    s.seat_name,
    EXISTS(
      SELECT 1 FROM registrations r
      WHERE r.seat_id = s.id
        AND r.status NOT IN ('cancelled', 'expired')
    ) AS is_booked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id AND sl.expires_at > NOW()
    ) AS is_locked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id
        AND sl.expires_at > NOW()
        AND sl.user_id = auth.uid()
    ) AS locked_by_me,
    COALESCE(s.is_blocked, FALSE) AS is_blocked,
    s.block_reason,
    (SELECT r.ticket_type FROM registrations r WHERE r.seat_id = s.id AND r.status NOT IN ('cancelled', 'expired') LIMIT 1) AS booked_ticket_type
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

-- ------------------------------------------------------------
-- 9. Create admin_bulk_block_seats function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_bulk_block_seats(
  p_seat_ids  UUID[],
  p_blocked   BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE seats
  SET is_blocked = p_blocked, block_reason = p_reason
  WHERE id = ANY(p_seat_ids);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------
-- 10. Grant execute permissions
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_block_seats(UUID[], BOOLEAN, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 11. Fix RLS policies
-- ------------------------------------------------------------

-- admin_profiles - allow authenticated users to read (for login check)
DROP POLICY IF EXISTS "admin_profiles_all_access" ON admin_profiles;
CREATE POLICY "admin_profiles_all_access" ON admin_profiles FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- user_profiles - allow admins full access
DROP POLICY IF EXISTS "user_profiles_update_admin" ON user_profiles;
CREATE POLICY "user_profiles_update_admin" ON user_profiles FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "user_profiles_delete_admin" ON user_profiles;
CREATE POLICY "user_profiles_delete_admin" ON user_profiles FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "user_profiles_select_admin" ON user_profiles;
CREATE POLICY "user_profiles_select_admin" ON user_profiles FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "user_profiles_insert_admin" ON user_profiles;
CREATE POLICY "user_profiles_insert_admin" ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- seats - allow admins full access
DROP POLICY IF EXISTS "seats_admin_full_access" ON seats;
CREATE POLICY "seats_admin_full_access" ON seats FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- registrations - allow admins full access
DROP POLICY IF EXISTS "registrations_admin_full_access" ON registrations;
CREATE POLICY "registrations_admin_full_access" ON registrations FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ------------------------------------------------------------
-- 12. Force schema cache reload
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 13. Verify functions exist
-- ------------------------------------------------------------
SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname IN ('book_ticket_with_seat', 'book_ticket', 'admin_book_ticket', 'get_seat_map', 'lock_seat', 'unlock_seat', 'admin_bulk_block_seats');
