-- 添加缺失的 service_fee 列
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS service_fee DECIMAL(18,2) NOT NULL DEFAULT 0;

-- 清理所有锁记录
DELETE FROM seat_locks WHERE expires_at <= NOW();

-- 删除已存在的策略
DROP POLICY IF EXISTS "anyone_read_locks" ON seat_locks;
DROP POLICY IF EXISTS "authenticated_users_can_insert_locks" ON seat_locks;
DROP POLICY IF EXISTS "authenticated_users_can_delete_locks" ON seat_locks;
DROP POLICY IF EXISTS "service_role_can_do_everything" ON seat_locks;

-- 重新添加 RLS 策略
ALTER TABLE seat_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_locks" ON seat_locks
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "authenticated_users_can_insert_locks" ON seat_locks
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_users_can_delete_locks" ON seat_locks
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "service_role_can_do_everything" ON seat_locks
  FOR ALL TO service_role USING (true);

-- 重新创建 lock_seat 函数（最简版本）
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

-- 重新创建 lock_seat_for_user 函数
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

-- 重新创建 unlock_seat 函数
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

-- 重新创建 get_seat_map 函数
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

NOTIFY pgrst, 'reload schema';
