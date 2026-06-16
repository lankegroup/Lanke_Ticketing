-- Restore book_ticket_with_seat with the correct signature matching the book-ticket edge function
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid, uuid, text, text, uuid);

CREATE FUNCTION public.book_ticket_with_seat(
  p_session_id UUID,
  p_seat_id    UUID,
  p_name       TEXT,
  p_phone      TEXT,
  p_user_id    UUID DEFAULT NULL
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

  -- Validate seat belongs to the session
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;

  -- Reject blocked seats
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
  END IF;

  -- Reject already-booked seats
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id)
  RETURNING id INTO v_reg_id;

  -- Release the seat lock now that booking is complete
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- Only the edge function (service_role) should call this directly
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid) TO service_role;
