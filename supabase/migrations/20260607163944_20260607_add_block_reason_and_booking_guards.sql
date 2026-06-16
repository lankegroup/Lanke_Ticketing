
-- Add block_reason column to seats
ALTER TABLE seats ADD COLUMN IF NOT EXISTS block_reason TEXT DEFAULT NULL;

-- Update admin_bulk_block_seats to accept optional reason
CREATE OR REPLACE FUNCTION admin_bulk_block_seats(
  p_seat_ids  UUID[],
  p_blocked   BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
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

-- Guard book_ticket_with_seat: reject blocked seats
CREATE OR REPLACE FUNCTION book_ticket_with_seat(
  p_session_id UUID,
  p_seat_id    UUID,
  p_name       TEXT,
  p_phone      TEXT,
  p_user_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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

  -- Seat belongs to this session?
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;

  -- Seat blocked by admin?
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
  END IF;

  -- Seat not already booked?
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
    AND status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  -- User holds a valid lock?
  IF NOT EXISTS (
    SELECT 1 FROM seat_locks
    WHERE seat_id = p_seat_id
    AND user_id = p_user_id
    AND expires_at > NOW()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'lock_expired');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id)
  RETURNING id INTO v_reg_id;

  DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- Guard admin_book_ticket: reject blocked seats
CREATE OR REPLACE FUNCTION admin_book_ticket(
  p_session_id UUID,
  p_name       TEXT,
  p_phone      TEXT,
  p_user_id    UUID DEFAULT NULL,
  p_seat_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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

  IF p_seat_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
    END IF;
    -- Seat blocked by admin?
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
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id)
  RETURNING id INTO v_reg_id;

  -- Release any lock on this seat (if admin books over a lock)
  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;
