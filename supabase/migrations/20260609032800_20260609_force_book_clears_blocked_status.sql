-- When admin force-books a blocked seat, clear is_blocked so it shows as "sold"
-- admin_cancel_registration already restores is_blocked=TRUE when was_force_booked

CREATE OR REPLACE FUNCTION public.admin_book_ticket(
  p_session_id    uuid,
  p_name          text,
  p_phone         text,
  p_user_id       uuid    DEFAULT NULL,
  p_seat_id       uuid    DEFAULT NULL,
  p_force         boolean DEFAULT FALSE,
  p_order_source  text    DEFAULT 'admin',
  p_is_supplementary boolean DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_session     sessions%ROWTYPE;
  v_code        text;
  v_reg_id      uuid;
  v_was_blocked boolean := FALSE;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  IF p_seat_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM registrations
      WHERE seat_id = p_seat_id
        AND session_id = p_session_id
        AND status NOT IN ('cancelled', 'expired')
        AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
    END IF;

    IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN
      IF NOT p_force THEN
        RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
      END IF;
      v_was_blocked := TRUE;
      -- Clear blocked status so seat shows as "sold" in seat maps
      UPDATE seats SET is_blocked = FALSE WHERE id = p_seat_id;
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (
    session_id, seat_id, name, phone, ticket_code, status, user_id,
    order_source, was_force_booked, is_supplementary
  )
  VALUES (
    p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id,
    p_order_source, v_was_blocked, p_is_supplementary
  )
  RETURNING id INTO v_reg_id;

  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text,boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
