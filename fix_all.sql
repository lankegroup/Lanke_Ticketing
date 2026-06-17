-- ============================================================
-- Comprehensive Fix Script for Lanke Ticketing System
-- ============================================================

-- ------------------------------------------------------------
-- FIX 1: Update book_ticket_with_seat to match frontend params
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID);

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

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content)
  RETURNING id INTO v_reg_id;

  IF p_user_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- ------------------------------------------------------------
-- FIX 2: Update book_ticket to match frontend params
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS book_ticket(UUID, TEXT, TEXT, UUID);

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

  INSERT INTO registrations (session_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content)
  VALUES (p_session_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content)
  RETURNING id INTO v_reg_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- ------------------------------------------------------------
-- FIX 3: Update get_seat_map to include is_blocked and booked_ticket_type
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_seat_map(UUID);

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
    (SELECT r.ticket_type FROM registrations r WHERE r.seat_id = s.id AND r.status NOT IN ('cancelled', 'expired') LIMIT 1) AS booked_ticket_type
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

-- ------------------------------------------------------------
-- FIX 4: Update admin_bulk_block_seats to work correctly
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS admin_bulk_block_seats(UUID[], BOOLEAN, TEXT);

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
-- FIX 5: Grant execute permissions
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_block_seats(UUID[], BOOLEAN, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- FIX 6: Ensure user_profiles RLS policies are correct
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "user_profiles_update_admin" ON user_profiles;
CREATE POLICY "user_profiles_update_admin" ON user_profiles FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "user_profiles_delete_admin" ON user_profiles;
CREATE POLICY "user_profiles_delete_admin" ON user_profiles FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ------------------------------------------------------------
-- FIX 7: Ensure admin_profiles RLS allows admins to see all
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "admin_profiles_admin_access" ON admin_profiles;
CREATE POLICY "admin_profiles_admin_access" ON admin_profiles FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ------------------------------------------------------------
-- FIX 8: Ensure seats table has proper RLS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "seats_view_session" ON seats;
CREATE POLICY "seats_view_session" ON seats FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = seats.session_id AND s.is_active = TRUE));

DROP POLICY IF EXISTS "seats_admin_full_access" ON seats;
CREATE POLICY "seats_admin_full_access" ON seats FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ------------------------------------------------------------
-- Force schema cache reload
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Verify functions exist
-- ------------------------------------------------------------
SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname IN ('book_ticket_with_seat', 'book_ticket', 'get_seat_map', 'admin_bulk_block_seats');
