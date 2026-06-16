
-- Add a seat-row lock inside book_ticket_with_seat so that concurrent
-- booking attempts for the same seat are serialised at the seat row level,
-- not just at the session level.  The existing session FOR UPDATE already
-- prevents stock over-selling; this addition prevents the narrow window
-- where two calls can both pass the "seat_taken?" check before either
-- has committed its INSERT into registrations.

CREATE OR REPLACE FUNCTION public.book_ticket_with_seat(
  p_session_id  UUID,
  p_seat_id     UUID,
  p_name        TEXT,
  p_phone       TEXT,
  p_user_id     UUID    DEFAULT NULL,
  p_ticket_type TEXT    DEFAULT 'adult'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_code    TEXT;
  v_reg_id  UUID;
BEGIN
  -- Lock the session row to serialise concurrent bookings for this session.
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

  -- Lock the seat row so two concurrent booking calls for the same seat
  -- cannot both pass the "already taken?" check simultaneously.
  PERFORM 1 FROM seats WHERE id = p_seat_id FOR UPDATE;

  -- Re-check after acquiring the seat-row lock.
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id   = p_seat_id
      AND status    NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id,
          COALESCE(p_ticket_type, 'adult'))
  RETURNING id INTO v_reg_id;

  -- Release the seat lock by clearing it.
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid, text) TO service_role;
