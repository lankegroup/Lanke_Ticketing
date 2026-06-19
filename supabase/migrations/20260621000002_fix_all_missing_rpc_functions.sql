-- ============================================================
-- 修复所有缺失的 RPC 函数
-- 请在 Supabase SQL 编辑器中执行此文件
-- ============================================================

-- 1. admin_book_ticket - 代客预约/前台售票核心函数
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text);
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid,uuid,text,text,uuid,boolean,text,boolean,text,text);

CREATE OR REPLACE FUNCTION public.admin_book_ticket(
  p_session_id       UUID,
  p_seat_id          UUID,
  p_name             TEXT,
  p_phone            TEXT,
  p_user_id          UUID,
  p_force            BOOLEAN DEFAULT FALSE,
  p_order_source     TEXT DEFAULT 'admin',
  p_is_supplementary BOOLEAN DEFAULT FALSE,
  p_ticket_type      TEXT DEFAULT 'adult',
  p_note_content     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_session      sessions%ROWTYPE;
  v_code         TEXT;
  v_reg_id       UUID;
  v_is_blocked   BOOLEAN;
  v_price        NUMERIC;
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
          AND deleted_at IS NULL
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
      END IF;
    END IF;
  END IF;

  IF NOT p_force AND v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  IF p_ticket_type = 'child' THEN
    v_price := COALESCE(v_session.child_price, v_session.ticket_price * 0.5);
  ELSIF p_ticket_type = 'concession' THEN
    v_price := COALESCE(v_session.concession_price, v_session.ticket_price * 0.8);
  ELSIF p_ticket_type = 'vip' THEN
    v_price := COALESCE(v_session.vip_price, v_session.ticket_price * 1.5);
  ELSE
    v_price := v_session.ticket_price;
  END IF;

  IF NOT p_force THEN
    UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  END IF;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, order_source, was_force_booked, is_supplementary, note_content)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_order_source, p_force, p_is_supplementary, p_note_content)
  RETURNING id INTO v_reg_id;

  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code, 'price', v_price);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT) TO anon;

-- 2. admin_reschedule_seat - 协助换座
DROP FUNCTION IF EXISTS public.admin_reschedule_seat(uuid,uuid,boolean);

CREATE OR REPLACE FUNCTION public.admin_reschedule_seat(
  p_registration_id UUID,
  p_new_seat_id     UUID,
  p_force           BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_reg            registrations%ROWTYPE;
  v_old_seat_name  TEXT;
  v_new_seat_name  TEXT;
  v_history        JSONB;
  v_was_blocked    BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_reg.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status');
  END IF;
  IF v_reg.seat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_seat');
  END IF;
  IF v_reg.seat_id = p_new_seat_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'same_seat');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND session_id = v_reg.session_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;

  IF EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND is_blocked = TRUE) THEN
    IF NOT p_force THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
    END IF;
    v_was_blocked := TRUE;
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

  IF v_reg.was_force_booked THEN
    UPDATE seats SET is_blocked = TRUE WHERE id = v_reg.seat_id;
  END IF;

  IF v_was_blocked THEN
    UPDATE seats SET is_blocked = FALSE WHERE id = p_new_seat_id;
  END IF;

  DELETE FROM seat_locks WHERE seat_id = p_new_seat_id;

  v_history := COALESCE(v_reg.reschedule_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'from_seat',   v_old_seat_name,
      'to_seat',     v_new_seat_name,
      'changed_at',  NOW(),
      'by_admin',    TRUE,
      'force',       p_force AND v_was_blocked
    )
  );

  UPDATE registrations
  SET seat_id            = p_new_seat_id,
      reschedule_count   = COALESCE(reschedule_count, 0) + 1,
      reschedule_history = v_history,
      was_force_booked   = (p_force AND v_was_blocked)
  WHERE id = p_registration_id;

  RETURN jsonb_build_object('success', true, 'old_seat', v_old_seat_name, 'new_seat', v_new_seat_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reschedule_seat(UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reschedule_seat(UUID, UUID, BOOLEAN) TO authenticated;

-- 3. admin_cancel_registration - 取消订单/报名
DROP FUNCTION IF EXISTS public.admin_cancel_registration(uuid);

CREATE OR REPLACE FUNCTION public.admin_cancel_registration(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_sess_name TEXT;
  v_seat_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_reg.status IN ('cancelled', 'expired', 'used') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;
  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;
  IF v_reg.was_force_booked AND v_reg.seat_id IS NOT NULL THEN
    UPDATE seats SET is_blocked = TRUE WHERE id = v_reg.seat_id;
  END IF;
  IF v_reg.user_id IS NOT NULL THEN
    SELECT name INTO v_sess_name FROM sessions WHERE id = v_reg.session_id;
    IF v_reg.seat_id IS NOT NULL THEN SELECT seat_name INTO v_seat_name FROM seats WHERE id = v_reg.seat_id; END IF;
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (v_reg.user_id, 'warning', '您的订单已被取消',
      '您在场次"' || COALESCE(v_sess_name, '') || '"的预订' ||
      CASE WHEN v_seat_name IS NOT NULL THEN '（座位：' || v_seat_name || '）' ELSE '' END ||
      '（券码：' || v_reg.ticket_code || '）已被管理员取消，如有疑问请联系客服。');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_registration(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_registration(UUID) TO authenticated;

-- 4. admin_delete_registration - 删除订单（软删除）
DROP FUNCTION IF EXISTS public.admin_delete_registration(uuid,text);

CREATE OR REPLACE FUNCTION public.admin_delete_registration(
  p_registration_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = p_registration_id AND deleted_at IS NULL) THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  UPDATE registrations SET deleted_at = NOW() WHERE id = p_registration_id;

  INSERT INTO order_audit_logs (admin_id, registration_id, action, note)
  VALUES (auth.uid(), p_registration_id, 'soft_delete', p_note);

  RETURN json_build_object('success', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_registration(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_registration(UUID, TEXT) TO authenticated;

-- 5. auto_manage_session_status - 自动管理场次状态
DROP FUNCTION IF EXISTS public.auto_manage_session_status();

CREATE OR REPLACE FUNCTION auto_manage_session_status()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  UPDATE sessions
  SET is_active = false
  WHERE is_active = true
    AND verification_end IS NOT NULL
    AND (session_date + verification_end)::timestamp < now();

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_manage_session_status() TO service_role;

-- 6. expire_past_tickets - 过期已结束场次的票券
DROP FUNCTION IF EXISTS public.expire_past_tickets();

CREATE OR REPLACE FUNCTION expire_past_tickets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE registrations
  SET status = 'expired'
  WHERE status = 'active'
    AND session_id IN (
      SELECT id FROM sessions
      WHERE (session_date + COALESCE(end_time, '23:59:59'::time))::timestamp < NOW()
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_past_tickets() TO service_role;

-- 7. create_lcoin_transaction - 创建兰克币交易记录
DROP FUNCTION IF EXISTS public.create_lcoin_transaction(uuid,text,numeric,uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.create_lcoin_transaction(
  p_user_id UUID,
  p_transaction_type TEXT,
  p_amount NUMERIC,
  p_session_id UUID DEFAULT NULL,
  p_operator_type TEXT DEFAULT 'system',
  p_description TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'lcoin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_new_balance NUMERIC;
  v_tx_id UUID;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_balance FROM lcoin_accounts WHERE user_id = p_user_id;
  IF v_balance IS NULL THEN v_balance := 0; END IF;

  IF p_transaction_type = 'deduct' OR p_transaction_type = 'consume' THEN
    v_new_balance := v_balance - p_amount;
    IF v_new_balance < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance', 'balance', v_balance);
    END IF;
    UPDATE lcoin_accounts SET balance = v_new_balance WHERE user_id = p_user_id;
  ELSE
    v_new_balance := v_balance + p_amount;
    UPDATE lcoin_accounts SET balance = v_new_balance WHERE user_id = p_user_id;
  END IF;

  INSERT INTO lcoin_transactions (user_id, transaction_type, amount, balance_before, balance_after, session_id, operator_type, description, payment_method)
  VALUES (p_user_id, p_transaction_type, p_amount, v_balance, v_new_balance, p_session_id, p_operator_type, p_description, p_payment_method)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lcoin_transaction(UUID, TEXT, NUMERIC, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_lcoin_transaction(UUID, TEXT, NUMERIC, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- 8. deduct_lcoin - 扣除兰克币
DROP FUNCTION IF EXISTS public.deduct_lcoin(uuid,numeric,text,uuid);

CREATE OR REPLACE FUNCTION public.deduct_lcoin(
  p_user_id UUID,
  p_amount NUMERIC,
  p_description TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_balance FROM lcoin_accounts WHERE user_id = p_user_id;
  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_balance', 'current_balance', COALESCE(v_balance, 0));
  END IF;
  UPDATE lcoin_accounts SET balance = balance - p_amount WHERE user_id = p_user_id;
  INSERT INTO lcoin_transactions (user_id, transaction_type, amount, balance_before, balance_after, description, reference_id)
  VALUES (p_user_id, 'deduct', p_amount, v_balance, v_balance - p_amount, p_description, p_reference_id);
  RETURN jsonb_build_object('success', true, 'new_balance', v_balance - p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_lcoin(UUID, NUMERIC, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_lcoin(UUID, NUMERIC, TEXT, UUID) TO authenticated;

-- 9. get_user_lcoin_balance - 获取用户兰克币余额
DROP FUNCTION IF EXISTS public.get_user_lcoin_balance(uuid);

CREATE OR REPLACE FUNCTION public.get_user_lcoin_balance(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_balance FROM lcoin_accounts WHERE user_id = p_user_id;
  RETURN COALESCE(v_balance, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_lcoin_balance(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_lcoin_balance(UUID) TO authenticated;

-- 10. unlock_seat - 释放锁定的座位
DROP FUNCTION IF EXISTS public.unlock_seat(uuid);

CREATE OR REPLACE FUNCTION public.unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO authenticated;

-- 11. get_seat_map - 获取座位图
DROP FUNCTION IF EXISTS public.get_seat_map(uuid);

CREATE OR REPLACE FUNCTION public.get_seat_map(p_session_id UUID)
RETURNS TABLE (
  id UUID,
  row_index INT,
  col_index INT,
  seat_name TEXT,
  is_booked BOOLEAN,
  is_locked BOOLEAN,
  locked_by_me BOOLEAN,
  is_blocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.row_index,
    s.col_index,
    s.seat_name,
    EXISTS(
      SELECT 1 FROM registrations r
      WHERE r.seat_id = s.id
        AND r.status NOT IN ('cancelled', 'expired')
    ) AS is_booked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id AND sl.expires_at > NOW()
    ) AS is_locked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id
        AND sl.expires_at > NOW()
        AND sl.user_id = auth.uid()
    ) AS locked_by_me,
    COALESCE(s.is_blocked, FALSE) AS is_blocked
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO authenticated;

-- 12. lock_seat - 锁定座位
DROP FUNCTION IF EXISTS public.lock_seat(uuid,uuid,timestamptz);

CREATE OR REPLACE FUNCTION public.lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_booked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM seat_locks
    WHERE seat_id = p_seat_id
      AND expires_at > NOW()
      AND user_id != v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other');
  END IF;

  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes')
  RETURNING expires_at INTO v_expires;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
