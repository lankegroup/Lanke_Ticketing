﻿﻿﻿﻿-- Create admin_book_ticket function
DROP FUNCTION IF EXISTS admin_book_ticket(uuid,uuid,text,text,uuid,boolean,text,boolean,text);

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
  v_is_blocked BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;
  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;

  IF p_seat_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
    END IF;

    SELECT is_blocked INTO v_is_blocked FROM seats WHERE id = p_seat_id;

    IF v_is_blocked AND NOT p_force THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
    END IF;

    IF NOT p_force THEN
      IF EXISTS (
        SELECT 1 FROM registrations
        WHERE seat_id = p_seat_id
          AND status NOT IN ('cancelled', 'expired')
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
      END IF;
    END IF;
  END IF;

  IF NOT p_force AND v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  IF NOT p_force THEN
    UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  END IF;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, order_source, was_force_booked, is_supplementary)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_order_source, p_force, p_is_supplementary)
  RETURNING id INTO v_reg_id;

  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, TEXT, BOOLEAN, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
