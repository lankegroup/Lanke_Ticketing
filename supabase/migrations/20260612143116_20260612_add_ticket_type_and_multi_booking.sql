-- ── 1. Add ticket_type to registrations ──────────────────────────────────────
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS ticket_type TEXT NOT NULL DEFAULT 'adult';

ALTER TABLE registrations
  DROP CONSTRAINT IF EXISTS registrations_ticket_type_check;
ALTER TABLE registrations
  ADD CONSTRAINT registrations_ticket_type_check
  CHECK (ticket_type IN ('adult', 'child', 'concession'));

-- ── 2. Update book_ticket to accept p_ticket_type ────────────────────────────
DROP FUNCTION IF EXISTS public.book_ticket(uuid, text, text, uuid);

CREATE FUNCTION public.book_ticket(
  p_session_id  UUID,
  p_name        TEXT,
  p_phone       TEXT,
  p_user_id     UUID    DEFAULT NULL,
  p_ticket_type TEXT    DEFAULT 'adult'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_updated_count INT;
  v_ticket_code   TEXT;
  v_reg_id        UUID;
BEGIN
  UPDATE sessions
  SET available_stock = available_stock - 1
  WHERE id = p_session_id
    AND is_active = TRUE
    AND available_stock > 0;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN json_build_object('success', FALSE, 'error', 'sold_out');
  END IF;

  v_ticket_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 10));

  INSERT INTO registrations (name, phone, session_id, ticket_code, status, user_id, ticket_type)
  VALUES (p_name, p_phone, p_session_id, v_ticket_code, 'active', p_user_id,
          COALESCE(p_ticket_type, 'adult'))
  RETURNING id INTO v_reg_id;

  RETURN json_build_object('success', TRUE, 'ticket_code', v_ticket_code, 'registration_id', v_reg_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_ticket(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.book_ticket(uuid, text, text, uuid, text) TO service_role;

-- ── 3. Update book_ticket_with_seat to accept p_ticket_type ──────────────────
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid, uuid, text, text, uuid);

CREATE FUNCTION public.book_ticket_with_seat(
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

  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, text, text, uuid, text) TO service_role;

-- ── 4. Update admin_book_ticket to accept p_ticket_type ──────────────────────
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid, text, text, uuid, uuid, boolean, text, boolean);

CREATE FUNCTION public.admin_book_ticket(
  p_session_id        uuid,
  p_name              text,
  p_phone             text,
  p_user_id           uuid    DEFAULT NULL,
  p_seat_id           uuid    DEFAULT NULL,
  p_force             boolean DEFAULT FALSE,
  p_order_source      text    DEFAULT 'admin',
  p_is_supplementary  boolean DEFAULT FALSE,
  p_ticket_type       text    DEFAULT 'adult'
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
      UPDATE seats SET is_blocked = FALSE WHERE id = p_seat_id;
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (
    session_id, seat_id, name, phone, ticket_code, status, user_id,
    order_source, was_force_booked, is_supplementary, ticket_type
  )
  VALUES (
    p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id,
    p_order_source, v_was_blocked, p_is_supplementary,
    COALESCE(p_ticket_type, 'adult')
  )
  RETURNING id INTO v_reg_id;

  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

GRANT  EXECUTE ON FUNCTION public.admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text,boolean,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text,boolean,text) FROM PUBLIC, anon, authenticated;
