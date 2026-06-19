-- ============================================
-- 紧急修复：清理过期锁 + 修复锁机制
-- ============================================

-- 1. 立即清理所有过期的座位锁（紧急）
DELETE FROM seat_locks WHERE expires_at <= NOW();

-- 2. 创建全局解锁接口：按场次解锁所有座位
CREATE OR REPLACE FUNCTION public.unlock_all_seats_by_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM seat_locks 
  WHERE seat_id IN (SELECT id FROM seats WHERE session_id = p_session_id);
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RETURN jsonb_build_object('success', TRUE, 'unlocked_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_all_seats_by_session(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_all_seats_by_session(UUID) TO authenticated;

-- 3. 创建全局解锁接口：解锁所有用户的所有座位（管理员用）
CREATE OR REPLACE FUNCTION public.admin_unlock_all_seats()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM seat_locks;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RETURN jsonb_build_object('success', TRUE, 'unlocked_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unlock_all_seats() TO service_role;

-- 4. 创建定期清理过期锁的函数（可以被定时任务调用）
CREATE OR REPLACE FUNCTION public.cleanup_expired_seat_locks()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM seat_locks WHERE expires_at <= NOW();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RETURN jsonb_build_object('success', TRUE, 'cleaned_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_seat_locks() TO service_role;

-- 5. 修改 lock_seat 函数，确保TTL为5分钟（300秒），防止永久锁定
-- 添加 SET ROLE service_role 绕过 RLS，确保锁定操作成功
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
  -- 绕过 RLS 策略
  SET ROLE service_role;

  IF p_user_id IS NOT NULL THEN
    v_user_id := p_user_id;
  ELSE
    v_user_id := auth.uid();
  END IF;

  IF v_user_id IS NULL THEN
    RESET ROLE;
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  -- 检查座位是否已被预订
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
  ) THEN
    RESET ROLE;
    RETURN jsonb_build_object('success', false, 'reason', 'already_booked');
  END IF;

  -- 检查是否有其他用户的有效锁
  IF EXISTS (
    SELECT 1 FROM seat_locks
    WHERE seat_id = p_seat_id
      AND expires_at > NOW()
      AND user_id != v_user_id
  ) THEN
    RESET ROLE;
    RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other');
  END IF;

  -- 删除旧锁（自己的锁或其他人的过期锁）
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  -- 创建新锁，TTL 5分钟
  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes')
  RETURNING expires_at INTO v_expires;

  RESET ROLE;
  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID) TO authenticated;

-- 6. 修改 book_ticket_with_seat 函数，移除严格锁检查，支持自动锁定
-- 添加 SET ROLE service_role 绕过 RLS
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
  -- 绕过 RLS 策略
  SET ROLE service_role;

  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RESET ROLE; RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RESET ROLE; RETURN jsonb_build_object('success', false, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RESET ROLE; RETURN jsonb_build_object('success', false, 'error', 'sold_out'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN RESET ROLE; RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired') AND deleted_at IS NULL) THEN RESET ROLE; RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;

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
      RESET ROLE;
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', v_total_amount, 'available', (v_deduct_result->>'available')::DECIMAL);
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, note_author, order_source, service_fee)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'user'::note_author_enum ELSE NULL END, 'user', v_service_fee)
  RETURNING id INTO v_reg_id;
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  RESET ROLE;
  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
EXCEPTION
  WHEN OTHERS THEN
    RESET ROLE;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated;

-- 6.5 修复 unlock_seat 函数，添加 SET ROLE service_role 绕过 RLS
CREATE OR REPLACE FUNCTION public.unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 绕过 RLS 策略
  SET ROLE service_role;
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  RESET ROLE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO authenticated;

-- 7. 修改 get_seat_map 函数，自动过滤过期锁
-- 添加 SET ROLE service_role 绕过 RLS
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
DECLARE
  v_user_id UUID;
BEGIN
  -- 绕过 RLS 策略
  SET ROLE service_role;

  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  RETURN QUERY
  SELECT
    s.id,
    s.row_index,
    s.col_index,
    s.seat_name,
    COALESCE(r.status IS NOT NULL AND r.status NOT IN ('cancelled', 'expired'), FALSE) AS is_booked,
    COALESCE(l.seat_id IS NOT NULL AND l.expires_at > NOW(), FALSE) AS is_locked,
    COALESCE(l.user_id = v_user_id AND l.expires_at > NOW(), FALSE) AS locked_by_me,
    COALESCE(s.is_blocked, FALSE) AS is_blocked
  FROM seats s
  LEFT JOIN registrations r ON s.id = r.seat_id AND r.status NOT IN ('cancelled', 'expired') AND r.deleted_at IS NULL
  LEFT JOIN seat_locks l ON s.id = l.seat_id AND l.expires_at > NOW()
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO anon;

NOTIFY pgrst, 'reload schema';
