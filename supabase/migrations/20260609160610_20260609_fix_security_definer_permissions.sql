-- ── 1. admin_send_session_cancelled_notifications ────────────────────────────
-- Fix: add admin check + explicitly revoke from anon/public

CREATE OR REPLACE FUNCTION public.admin_send_session_cancelled_notifications(
  p_session_id   UUID,
  p_session_name TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_count   INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  FOR v_user_id IN
    SELECT DISTINCT user_id
    FROM public.registrations
    WHERE session_id = p_session_id
      AND status = 'active'
      AND user_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      v_user_id,
      'warning',
      '场次已取消',
      '您预约的场次【' || p_session_name || '】已被取消，您的订单已自动作废，如有疑问请联系客服。'
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.registrations
  SET status = 'cancelled'
  WHERE session_id = p_session_id
    AND status = 'active';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_session_cancelled_notifications(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_send_session_cancelled_notifications(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_send_session_cancelled_notifications(UUID, TEXT) TO authenticated;


-- ── 2. reschedule_seat ────────────────────────────────────────────────────────
-- Drop and recreate to fix ownership bypass (p_user_id IS NULL skipped check)
-- p_user_id kept for backwards-compat but auth.uid() is used for ownership check

DROP FUNCTION IF EXISTS public.reschedule_seat(UUID, UUID, UUID);

CREATE FUNCTION public.reschedule_seat(
  p_registration_id UUID,
  p_new_seat_id     UUID,
  p_user_id         UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg            public.registrations%ROWTYPE;
  v_old_seat_name  TEXT;
  v_new_seat_name  TEXT;
  v_history_entry  JSONB;
  v_is_admin       BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  v_is_admin := EXISTS (SELECT 1 FROM public.admin_profiles WHERE id = auth.uid());

  SELECT * INTO v_reg FROM public.registrations WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- Non-admins can only reschedule their own registrations
  IF NOT v_is_admin THEN
    IF v_reg.user_id IS NULL OR v_reg.user_id != auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'error', 'not_owner');
    END IF;
  END IF;

  IF v_reg.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_active');
  END IF;

  IF v_reg.seat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_seat');
  END IF;

  IF v_reg.reschedule_count >= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'reschedule_limit');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.seats WHERE id = p_new_seat_id AND session_id = v_reg.session_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;

  IF EXISTS (SELECT 1 FROM public.seats WHERE id = p_new_seat_id AND is_blocked) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE seat_id = p_new_seat_id
      AND status NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
      AND id != p_registration_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  SELECT seat_name INTO v_old_seat_name FROM public.seats WHERE id = v_reg.seat_id;
  SELECT seat_name INTO v_new_seat_name FROM public.seats WHERE id = p_new_seat_id;

  v_history_entry := jsonb_build_object(
    'from_seat',      v_old_seat_name,
    'to_seat',        v_new_seat_name,
    'from_seat_id',   v_reg.seat_id,
    'to_seat_id',     p_new_seat_id,
    'rescheduled_at', NOW()
  );

  UPDATE public.registrations
  SET seat_id            = p_new_seat_id,
      reschedule_count   = reschedule_count + 1,
      reschedule_history = reschedule_history || v_history_entry
  WHERE id = p_registration_id;

  DELETE FROM public.seat_locks WHERE seat_id IN (v_reg.seat_id, p_new_seat_id);

  RETURN jsonb_build_object(
    'success',       true,
    'old_seat_name', v_old_seat_name,
    'new_seat_name', v_new_seat_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_seat(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_seat(UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_seat(UUID, UUID, UUID) TO authenticated;


-- ── 3. Explicit REVOKE from PUBLIC/anon for all other admin SECURITY DEFINER functions ──
-- These functions already enforce admin_profiles checks in their bodies.

REVOKE ALL ON FUNCTION public.admin_cancel_registration(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_registration(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_registration(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_cancel_ticket(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_ticket(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_ticket(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_increment_print_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_increment_print_count(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_increment_print_count(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_reschedule_seat(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reschedule_seat(UUID, UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reschedule_seat(UUID, UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.change_seat(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_seat(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.change_seat(UUID, UUID) TO authenticated;
