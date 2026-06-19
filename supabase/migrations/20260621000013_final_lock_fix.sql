-- ============================================
-- 终极修复：最简 lock_seat 函数（直接插入，不做检查）
-- ============================================

-- 清理所有锁
DELETE FROM seat_locks;

-- 创建最简 lock_seat 函数
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

-- 创建管理员专用 lock_seat（指定用户ID）
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

NOTIFY pgrst, 'reload schema';
