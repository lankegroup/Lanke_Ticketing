-- ── 1. Extend registrations table ──────────────────────────────────────────
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS order_source      TEXT    NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS was_force_booked  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reschedule_count  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reschedule_history JSONB  NOT NULL DEFAULT '[]';

ALTER TABLE registrations
  DROP CONSTRAINT IF EXISTS registrations_order_source_check;
ALTER TABLE registrations
  ADD CONSTRAINT registrations_order_source_check
  CHECK (order_source IN ('user', 'admin', 'front_desk'));

-- ── 2. Notifications table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL DEFAULT 'info',
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_notifications" ON notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users_update_own_notifications" ON notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- service_role inserts on behalf of admins
GRANT SELECT, UPDATE ON notifications TO authenticated;

-- ── 3. Update admin_book_ticket to support force-booking + order_source ─────
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid, text, text, uuid, uuid);

CREATE FUNCTION public.admin_book_ticket(
  p_session_id   uuid,
  p_name         text,
  p_phone        text,
  p_user_id      uuid    DEFAULT NULL,
  p_seat_id      uuid    DEFAULT NULL,
  p_force        boolean DEFAULT FALSE,
  p_order_source text    DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
  v_was_blocked BOOLEAN := FALSE;
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

    -- Check blocked — allow if force booking
    IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN
      IF NOT p_force THEN
        RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
      END IF;
      v_was_blocked := TRUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM registrations
      WHERE seat_id = p_seat_id
        AND status NOT IN ('cancelled', 'expired')
        AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (
    session_id, seat_id, name, phone, ticket_code, status, user_id,
    order_source, was_force_booked
  )
  VALUES (
    p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id,
    p_order_source, v_was_blocked
  )
  RETURNING id INTO v_reg_id;

  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text) FROM PUBLIC, anon, authenticated;

-- ── 4. admin_cancel_registration RPC ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_cancel_registration(
  p_registration_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_reg       registrations%ROWTYPE;
  v_sess_name TEXT;
  v_seat_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_reg.status IN ('cancelled', 'expired') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_cancelled');
  END IF;

  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;

  -- If force-booked, restore blocked status on seat
  IF v_reg.was_force_booked AND v_reg.seat_id IS NOT NULL THEN
    UPDATE seats SET is_blocked = TRUE WHERE id = v_reg.seat_id;
  END IF;

  -- Send in-app notification to user
  IF v_reg.user_id IS NOT NULL THEN
    SELECT name INTO v_sess_name FROM sessions WHERE id = v_reg.session_id;
    IF v_reg.seat_id IS NOT NULL THEN
      SELECT seat_name INTO v_seat_name FROM seats WHERE id = v_reg.seat_id;
    END IF;
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (
      v_reg.user_id,
      'warning',
      '您的订单已被取消',
      '您在场次"' || COALESCE(v_sess_name, '') || '"的预订' ||
      CASE WHEN v_seat_name IS NOT NULL THEN '（座位：' || v_seat_name || '）' ELSE '' END ||
      '（券码：' || v_reg.ticket_code || '）已被管理员取消，如有疑问请联系客服。'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_registration(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_cancel_registration(uuid) TO authenticated;

-- ── 5. change_seat RPC (client seat change, max 1 per order) ────────────────
CREATE OR REPLACE FUNCTION public.change_seat(
  p_registration_id UUID,
  p_new_seat_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_reg           registrations%ROWTYPE;
  v_old_seat_name TEXT;
  v_new_seat_name TEXT;
  v_history       JSONB;
BEGIN
  SELECT * INTO v_reg
  FROM registrations
  WHERE id = p_registration_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_reg.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status');
  END IF;
  IF v_reg.reschedule_count >= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'reschedule_limit_reached');
  END IF;
  IF v_reg.seat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_seat');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND session_id = v_reg.session_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND is_blocked) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
  END IF;
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_new_seat_id
      AND status NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
      AND id <> p_registration_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  SELECT seat_name INTO v_old_seat_name FROM seats WHERE id = v_reg.seat_id;
  SELECT seat_name INTO v_new_seat_name FROM seats WHERE id = p_new_seat_id;

  v_history := v_reg.reschedule_history || jsonb_build_array(
    jsonb_build_object(
      'from_seat', v_old_seat_name,
      'to_seat',   v_new_seat_name,
      'changed_at', NOW()
    )
  );

  DELETE FROM seat_locks WHERE seat_id = p_new_seat_id;

  UPDATE registrations
  SET seat_id           = p_new_seat_id,
      reschedule_count  = reschedule_count + 1,
      reschedule_history = v_history
  WHERE id = p_registration_id;

  RETURN jsonb_build_object('success', true, 'old_seat', v_old_seat_name, 'new_seat', v_new_seat_name);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.change_seat(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.change_seat(uuid, uuid) TO authenticated;

-- ── 6. Realtime for notifications ─────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
