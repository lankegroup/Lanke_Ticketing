-- ============================================================
-- Fix: admin_bulk_block_seats function signature
-- ============================================================
-- The function was incorrectly redefined with wrong parameters.
-- It should have: p_seat_ids UUID[], p_blocked BOOLEAN, p_reason TEXT DEFAULT NULL
-- But currently has: p_seat_ids UUID[], p_block_reason TEXT DEFAULT NULL

DROP FUNCTION IF EXISTS admin_bulk_block_seats(UUID[], TEXT);

CREATE OR REPLACE FUNCTION admin_bulk_block_seats(
  p_seat_ids  UUID[],
  p_blocked   BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN json_build_object('success', false, 'error', 'not_admin');
  END IF;

  UPDATE seats
  SET is_blocked = p_blocked,
      block_reason = CASE WHEN p_blocked THEN p_reason ELSE NULL END
  WHERE id = ANY(p_seat_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('success', true, 'updated', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_block_seats(UUID[], BOOLEAN, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_bulk_block_seats(UUID[], BOOLEAN, TEXT) FROM public;

-- ============================================================
-- Fix: book_ticket_with_seat function - add buyer_user_id parameter
-- ============================================================
-- The frontend passes p_buyer_user_id but the function doesn't accept it

DROP FUNCTION IF EXISTS book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION book_ticket_with_seat(
  p_session_id     UUID,
  p_seat_id        UUID,
  p_name           TEXT,
  p_phone          TEXT,
  p_user_id        UUID DEFAULT NULL,
  p_ticket_type    TEXT DEFAULT 'adult',
  p_buyer_user_id  UUID DEFAULT NULL,
  p_note_content   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_session_id UUID;
  v_seat_id UUID;
  v_registration_id UUID;
  v_ticket_code TEXT;
  v_ticket_code_validated TEXT;
BEGIN
  -- Validate seat exists and session exists
  SELECT s.id, s.session_id INTO v_seat_id, v_session_id
  FROM seats s
  WHERE s.id = p_seat_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_not_found');
  END IF;

  -- Check if seat is blocked
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
  END IF;

  -- Check if seat is booked
  IF EXISTS (SELECT 1 FROM registrations r WHERE r.seat_id = p_seat_id AND r.status NOT IN ('cancelled', 'expired') AND r.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  -- Check if seat is locked by someone else
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND locked_by IS NOT NULL AND locked_expires_at > NOW() AND locked_by != COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'::UUID)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  -- Check session availability
  IF EXISTS (SELECT 1 FROM sessions WHERE id = v_session_id AND available_stock <= 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  -- Generate ticket code
  v_ticket_code := LEFT(MD5(RANDOM()::TEXT || NOW()::TEXT || p_seat_id::TEXT), 16);
  v_ticket_code_validated := LEFT(MD5(RANDOM()::TEXT || NOW()::TEXT || p_seat_id::TEXT || 'VALIDATED'), 16);

  -- Create registration
  INSERT INTO registrations (session_id, seat_id, name, phone, status, ticket_code, ticket_code_validated, ticket_type, user_id, buyer_user_id, note_content)
  VALUES (v_session_id, p_seat_id, p_name, p_phone, 'pending', v_ticket_code, v_ticket_code_validated, COALESCE(p_ticket_type, 'adult'), p_user_id, p_buyer_user_id, p_note_content)
  RETURNING id INTO v_registration_id;

  -- Update session stock
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = v_session_id;

  -- Clear lock if exists
  UPDATE seats SET locked_by = NULL, locked_expires_at = NULL WHERE id = p_seat_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_registration_id::TEXT, 'ticket_code', v_ticket_code);
END;
$$;

GRANT EXECUTE ON FUNCTION book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) FROM public;

-- ============================================================
-- Fix: book_ticket function - add buyer_user_id parameter
-- ============================================================

DROP FUNCTION IF EXISTS book_ticket(UUID, TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION book_ticket(
  p_session_id     UUID,
  p_name           TEXT,
  p_phone          TEXT,
  p_user_id        UUID DEFAULT NULL,
  p_ticket_type    TEXT DEFAULT 'adult',
  p_buyer_user_id  UUID DEFAULT NULL,
  p_note_content   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_registration_id UUID;
  v_ticket_code TEXT;
  v_ticket_code_validated TEXT;
BEGIN
  -- Check session availability
  IF EXISTS (SELECT 1 FROM sessions WHERE id = p_session_id AND available_stock <= 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  -- Generate ticket code
  v_ticket_code := LEFT(MD5(RANDOM()::TEXT || NOW()::TEXT || p_session_id::TEXT), 16);
  v_ticket_code_validated := LEFT(MD5(RANDOM()::TEXT || NOW()::TEXT || p_session_id::TEXT || 'VALIDATED'), 16);

  -- Create registration
  INSERT INTO registrations (session_id, name, phone, status, ticket_code, ticket_code_validated, ticket_type, user_id, buyer_user_id, note_content)
  VALUES (p_session_id, p_name, p_phone, 'pending', v_ticket_code, v_ticket_code_validated, COALESCE(p_ticket_type, 'adult'), p_user_id, p_buyer_user_id, p_note_content)
  RETURNING id INTO v_registration_id;

  -- Update session stock
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_registration_id::TEXT, 'ticket_code', v_ticket_code);
END;
$$;

GRANT EXECUTE ON FUNCTION book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) FROM public;

-- ============================================================
-- Force schema cache reload
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Fix: Add admin permissions for user_profiles UPDATE and DELETE
-- ============================================================
DROP POLICY IF EXISTS "user_profiles_update_admin" ON user_profiles;
CREATE POLICY "user_profiles_update_admin" ON user_profiles FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "user_profiles_delete_admin" ON user_profiles;
CREATE POLICY "user_profiles_delete_admin" ON user_profiles FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ============================================================
-- Fix: generate_session_seats should update available_stock
-- ============================================================
CREATE OR REPLACE FUNCTION generate_session_seats(
  p_session_id    UUID,
  p_rows          INT,
  p_seats_per_row INT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r                 INT;
  c                 INT;
  row_letter        TEXT;
  seat_label        TEXT;
  v_cancelled_count INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COUNT(*) INTO v_cancelled_count
  FROM registrations reg
  JOIN seats s ON s.id = reg.seat_id
  WHERE s.session_id = p_session_id
    AND (s.row_index > p_rows OR s.col_index > p_seats_per_row)
    AND reg.status NOT IN ('cancelled', 'expired');

  IF v_cancelled_count > 0 THEN
    UPDATE registrations
    SET status = 'cancelled'
    WHERE seat_id IN (
      SELECT s.id FROM seats s
      WHERE s.session_id = p_session_id
        AND (s.row_index > p_rows OR s.col_index > p_seats_per_row)
    )
    AND status NOT IN ('cancelled', 'expired');

    UPDATE sessions
    SET available_stock = available_stock + v_cancelled_count
    WHERE id = p_session_id;
  END IF;

  DELETE FROM seat_locks
  WHERE seat_id IN (
    SELECT id FROM seats
    WHERE session_id = p_session_id
      AND (row_index > p_rows OR col_index > p_seats_per_row)
  );

  DELETE FROM seats
  WHERE session_id = p_session_id
    AND (row_index > p_rows OR col_index > p_seats_per_row);

  FOR r IN 1..p_rows LOOP
    row_letter := CHR(64 + r);
    FOR c IN 1..p_seats_per_row LOOP
      seat_label := row_letter || '排' || c || '座';
      INSERT INTO seats (session_id, row_index, col_index, seat_name)
      VALUES (p_session_id, r, c, seat_label)
      ON CONFLICT (session_id, row_index, col_index) DO NOTHING;
    END LOOP;
  END LOOP;

  UPDATE sessions
  SET available_stock = (
    SELECT COUNT(*) FROM seats
    WHERE session_id = p_session_id AND is_blocked = false
  )
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_bookings', v_cancelled_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generate_session_seats(UUID, INT, INT) TO authenticated;
