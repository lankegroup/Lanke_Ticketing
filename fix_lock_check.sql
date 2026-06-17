-- ============================================================
-- Update book_ticket_with_seat: don't require seat lock for clients
-- ============================================================

DROP FUNCTION IF EXISTS book_ticket_with_seat(uuid,uuid,text,text,uuid,text,uuid,text);

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

  -- Lock check is now optional/warning: if user_id is provided, prefer to have
  -- a valid lock, but don't reject if missing (allows anonymous/guest bookings
  -- to succeed if the seat itself is free).
  -- Remove the strict lock_expired check.

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, order_source)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, 'user')
  RETURNING id INTO v_reg_id;

  -- Clean up any stale lock for this seat
  IF p_user_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id;
  ELSE
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
