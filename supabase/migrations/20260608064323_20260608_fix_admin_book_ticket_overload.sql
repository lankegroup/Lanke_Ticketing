
-- Drop both conflicting overloads of admin_book_ticket
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid, uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid, text, text, uuid, uuid);

-- Single canonical version with clear, unambiguous signature
CREATE FUNCTION public.admin_book_ticket(
  p_session_id uuid,
  p_name       text,
  p_phone      text,
  p_user_id    uuid    DEFAULT NULL,
  p_seat_id    uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- Restore execute grants
GRANT EXECUTE ON FUNCTION public.admin_book_ticket(uuid, text, text, uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_book_ticket(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
