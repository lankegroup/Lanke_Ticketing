-- ============================================================
-- FIX: 核销后票池数据异常 - 禁止已核销订单返回库存
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_cancel_registration(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_sess_name TEXT;
  v_seat_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN RETURN jsonb_build_object('success', false, 'error', 'unauthorized'); END IF;
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_reg.status IN ('cancelled', 'expired', 'used') THEN RETURN jsonb_build_object('success', false, 'error', 'already_processed'); END IF;
  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;
  IF v_reg.was_force_booked AND v_reg.seat_id IS NOT NULL THEN UPDATE seats SET is_blocked = TRUE WHERE id = v_reg.seat_id; END IF;
  IF v_reg.user_id IS NOT NULL THEN
    SELECT name INTO v_sess_name FROM sessions WHERE id = v_reg.session_id;
    IF v_reg.seat_id IS NOT NULL THEN SELECT seat_name INTO v_seat_name FROM seats WHERE id = v_reg.seat_id; END IF;
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (v_reg.user_id, 'warning', '您的订单已被取消', '您在场次"' || COALESCE(v_sess_name, '') || '"的预订' || CASE WHEN v_seat_name IS NOT NULL THEN '（座位：' || v_seat_name || '）' ELSE '' END || '（券码：' || v_reg.ticket_code || '）已被管理员取消，如有疑问请联系客服。');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ticket(p_registration_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_status TEXT;
BEGIN
  SELECT session_id, status INTO v_session_id, v_status FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'not_found'); END IF;
  IF v_status != 'active' THEN RETURN jsonb_build_object('success', FALSE, 'error', 'not_active'); END IF;
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = p_registration_id AND (user_id = p_user_id OR user_id IS NULL)) THEN RETURN jsonb_build_object('success', FALSE, 'error', 'not_owner'); END IF;
  END IF;
  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_session_id;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

NOTIFY pgrst, 're