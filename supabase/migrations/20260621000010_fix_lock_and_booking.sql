-- ============================================
-- 修复锁超时和管理员出票问题
-- ============================================

-- 1. 修改 lock_seat 函数，支持指定 user_id
CREATE OR REPLACE FUNCTION public.lock_seat(
  p_seat_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  -- 如果指定了 user_id，使用指定的；否则使用当前登录用户
  IF p_user_id IS NOT NULL THEN
    v_user_id := p_user_id;
  ELSE
    v_user_id := auth.uid();
  END IF;

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
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '60 seconds')
  RETURNING expires_at INTO v_expires;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID) TO authenticated;

-- 2. 修改 book_ticket_with_seat 函数，支持自动重新锁定和管理员模式
CREATE OR REPLACE FUNCTION public.book_ticket_with_seat(
  p_session_id UUID,
  p_seat_id UUID,
  p_name TEXT,
  p_phone TEXT,
  p_user_id UUID,
  p_ticket_type TEXT DEFAULT 'adult',
  p_buyer_user_id UUID DEFAULT NULL,
  p_note_content TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_code TEXT;
  v_reg_id UUID;
  v_total_amount DECIMAL(18,2);
  v_price DECIMAL(18,2);
  v_service_fee DECIMAL(18,2);
  v_seat_name TEXT;
  v_deduct_result JSONB;
  v_lock_exists BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', false, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'sold_out'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired') AND deleted_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;

  -- 检查锁状态
  SELECT EXISTS (
    SELECT 1 FROM seat_locks 
    WHERE seat_id = p_seat_id 
      AND expires_at > NOW()
  ) INTO v_lock_exists;

  -- 如果没有有效锁，尝试自动锁定（适用于管理员前台售票场景）
  IF NOT v_lock_exists THEN
    INSERT INTO seat_locks (seat_id, user_id, expires_at)
    VALUES (p_seat_id, COALESCE(p_user_id, auth.uid()), NOW() + INTERVAL '60 seconds')
    ON CONFLICT (seat_id) DO UPDATE SET user_id = COALESCE(p_user_id, auth.uid()), expires_at = NOW() + INTERVAL '60 seconds';
  END IF;

  SELECT seat_name INTO v_seat_name FROM seats WHERE id = p_seat_id;

  IF p_ticket_type = 'child' THEN
    v_price := COALESCE(v_session.child_price, v_session.ticket_price * 0.5);
  ELSIF p_ticket_type = 'concession' THEN
    v_price := COALESCE(v_session.concession_price, v_session.ticket_price * 0.8);
  ELSIF p_ticket_type = 'vip' THEN
    v_price := COALESCE(v_session.vip_price, v_session.ticket_price * 1.5);
  ELSE
    v_price := v_session.ticket_price;
  END IF;

  v_service_fee := COALESCE(v_session.default_service_fee, 0);
  v_total_amount := v_price + v_service_fee;

  IF p_user_id IS NOT NULL AND v_total_amount > 0 THEN
    SELECT create_lcoin_transaction(
      p_user_id,
      'purchase',
      v_total_amount,
      NULL,
      p_session_id,
      p_ticket_type,
      v_seat_name,
      v_service_fee,
      'user',
      p_buyer_user_id,
      '购票消费',
      'lcoin'
    ) INTO v_deduct_result;

    IF (v_deduct_result->>'success')::BOOLEAN = FALSE THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', v_total_amount, 'available', (v_deduct_result->>'available')::DECIMAL);
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, note_author, order_source, service_fee)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'user'::note_author_enum ELSE NULL END, 'user', v_service_fee)
  RETURNING id INTO v_reg_id;
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 3. 修改 book_ticket 函数，保持一致
CREATE OR REPLACE FUNCTION public.book_ticket(
  p_session_id UUID,
  p_name TEXT,
  p_phone TEXT,
  p_user_id UUID,
  p_ticket_type TEXT DEFAULT 'adult',
  p_buyer_user_id UUID DEFAULT NULL,
  p_note_content TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_code TEXT;
  v_reg_id UUID;
  v_total_amount DECIMAL(18,2);
  v_price DECIMAL(18,2);
  v_service_fee DECIMAL(18,2);
  v_deduct_result JSONB;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', FALSE, 'error', 'sold_out'); END IF;

  IF p_ticket_type = 'child' THEN
    v_price := COALESCE(v_session.child_price, v_session.ticket_price * 0.5);
  ELSIF p_ticket_type = 'concession' THEN
    v_price := COALESCE(v_session.concession_price, v_session.ticket_price * 0.8);
  ELSIF p_ticket_type = 'vip' THEN
    v_price := COALESCE(v_session.vip_price, v_session.ticket_price * 1.5);
  ELSE
    v_price := v_session.ticket_price;
  END IF;

  v_service_fee := COALESCE(v_session.default_service_fee, 0);
  v_total_amount := v_price + v_service_fee;

  IF p_user_id IS NOT NULL AND v_total_amount > 0 THEN
    SELECT create_lcoin_transaction(
      p_user_id,
      'purchase',
      v_total_amount,
      NULL,
      p_session_id,
      p_ticket_type,
      NULL,
      v_service_fee,
      'user',
      p_buyer_user_id,
      '购票消费',
      'lcoin'
    ) INTO v_deduct_result;

    IF (v_deduct_result->>'success')::BOOLEAN = FALSE THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', v_total_amount, 'available', (v_deduct_result->>'available')::DECIMAL);
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  INSERT INTO registrations (session_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, note_author, order_source, service_fee)
  VALUES (p_session_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'user'::note_author_enum ELSE NULL END, 'user', v_service_fee)
  RETURNING id INTO v_reg_id;

  RETURN jsonb_build_object('success', TRUE, 'ticket_code', v_code, 'registration_id', v_reg_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
