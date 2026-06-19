-- ============================================
-- 完整重构：座位锁定体系
-- ============================================

-- 1. 清理所有过期/无效锁记录
DELETE FROM seat_locks WHERE expires_at <= NOW();

-- 2. 删除已存在的策略（重新创建）
DROP POLICY IF EXISTS "anyone_read_locks" ON seat_locks;
DROP POLICY IF EXISTS "authenticated_users_can_insert_locks" ON seat_locks;
DROP POLICY IF EXISTS "authenticated_users_can_delete_locks" ON seat_locks;
DROP POLICY IF EXISTS "service_role_can_do_everything" ON seat_locks;

-- 3. 重新添加 seat_locks 的 RLS 策略
ALTER TABLE seat_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_locks" ON seat_locks
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "authenticated_users_can_insert_locks" ON seat_locks
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_users_can_delete_locks" ON seat_locks
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "service_role_can_do_everything" ON seat_locks
  FOR ALL TO service_role USING (true);

-- 4. 重新创建 lock_seat 函数（用户端使用）
CREATE OR REPLACE FUNCTION public.lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes')
  ON CONFLICT (seat_id) DO UPDATE SET
    user_id = v_user_id,
    expires_at = NOW() + INTERVAL '5 minutes';

  RETURN jsonb_build_object('success', true, 'expires_at', NOW() + INTERVAL '5 minutes');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lock_failed', 'detail', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO authenticated;

-- 5. 重新创建 lock_seat_for_user 函数（管理员端使用）
CREATE OR REPLACE FUNCTION public.lock_seat_for_user(p_seat_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, p_user_id, NOW() + INTERVAL '5 minutes')
  ON CONFLICT (seat_id) DO UPDATE SET
    user_id = p_user_id,
    expires_at = NOW() + INTERVAL '5 minutes';

  RETURN jsonb_build_object('success', true, 'expires_at', NOW() + INTERVAL '5 minutes');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lock_failed', 'detail', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat_for_user(UUID, UUID) TO service_role;

-- 6. 重新创建 unlock_seat 函数
CREATE OR REPLACE FUNCTION public.unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO authenticated;

-- 7. 重新创建 get_seat_map 函数
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
        AND r.deleted_at IS NULL
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
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO anon;

-- 8. 重新创建 book_ticket_with_seat 函数
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
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', false, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'sold_out'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired') AND deleted_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;

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
    SELECT create_lcoin_transaction(p_user_id, 'purchase', v_total_amount, NULL, p_session_id, p_ticket_type, v_seat_name, v_service_fee, 'user', p_buyer_user_id, '购票消费', 'lcoin') INTO v_deduct_result;

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

GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated;

-- 9. 通知 PostgREST 刷新 schema
NOTIFY pgrst, 'reload schema';
