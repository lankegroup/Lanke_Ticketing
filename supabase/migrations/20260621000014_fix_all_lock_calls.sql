-- ============================================
-- 紧急修复：所有 lock_seat 调用失败
-- ============================================

-- 清理所有锁记录
DELETE FROM seat_locks;

-- 重新创建 lock_seat 函数（最简版本，确保能执行）
CREATE OR REPLACE FUNCTION public.lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, auth.uid(), NOW() + INTERVAL '5 minutes')
  ON CONFLICT (seat_id) DO UPDATE SET
    user_id = auth.uid(),
    expires_at = NOW() + INTERVAL '5 minutes';

  RETURN jsonb_build_object('success', true, 'expires_at', NOW() + INTERVAL '5 minutes');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lock_failed', 'detail', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO authenticated;

-- 重新创建 lock_seat_for_user 函数（管理员用）
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

NOTIFY pgrst, 'reload schema';
