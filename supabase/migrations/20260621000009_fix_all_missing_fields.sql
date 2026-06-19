-- ============================================
-- 紧急修复：数据库字段缺失问题
-- ============================================

-- 1. 添加 user_profiles 表缺失的 updated_at 字段
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. 添加 VIP 相关字段（如果不存在）
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS vip_expire_at TIMESTAMPTZ;

-- 3. 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_user_profiles_vip_status ON user_profiles(is_vip, vip_expire_at);
CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);

-- 4. 创建 VIP 升级函数（修复版本，不依赖 updated_at 字段）
CREATE OR REPLACE FUNCTION public.upgrade_user_vip(
  p_user_id UUID,
  p_duration_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_expire_at TIMESTAMPTZ;
  v_is_vip BOOLEAN;
BEGIN
  SELECT is_vip, vip_expire_at INTO v_is_vip, v_new_expire_at
  FROM user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;

  IF v_is_vip AND v_new_expire_at > NOW() THEN
    v_new_expire_at := v_new_expire_at + (p_duration_days || ' days')::INTERVAL;
  ELSE
    v_new_expire_at := NOW() + (p_duration_days || ' days')::INTERVAL;
  END IF;

  UPDATE user_profiles
  SET is_vip = TRUE,
      vip_expire_at = v_new_expire_at
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'is_vip', TRUE,
    'vip_expire_at', v_new_expire_at,
    'duration_days', p_duration_days
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upgrade_user_vip(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_user_vip(UUID, INTEGER) TO service_role;

-- 5. 创建取消VIP函数
CREATE OR REPLACE FUNCTION public.cancel_user_vip(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET is_vip = FALSE,
      vip_expire_at = NULL
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'is_vip', FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_user_vip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_user_vip(UUID) TO service_role;

-- 6. 创建自动检查并更新VIP状态的函数
CREATE OR REPLACE FUNCTION public.check_and_update_vip_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_vip BOOLEAN;
  v_vip_expire_at TIMESTAMPTZ;
BEGIN
  SELECT is_vip, vip_expire_at INTO v_is_vip, v_vip_expire_at
  FROM user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;

  IF v_is_vip AND (v_vip_expire_at IS NULL OR v_vip_expire_at < NOW()) THEN
    UPDATE user_profiles
    SET is_vip = FALSE
    WHERE id = p_user_id;

    RETURN jsonb_build_object('success', TRUE, 'is_vip', FALSE, 'expired', TRUE);
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'is_vip', v_is_vip, 'expired', FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_update_vip_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_update_vip_status(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_and_update_vip_status(UUID) TO anon;

-- 7. 创建获取用户完整信息（含VIP状态）的函数
CREATE OR REPLACE FUNCTION public.get_user_profile_with_vip(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM check_and_update_vip_status(p_user_id);

  SELECT jsonb_build_object(
    'id', up.id,
    'display_name', up.display_name,
    'phone', up.phone,
    'email', up.email,
    'created_at', up.created_at,
    'is_vip', COALESCE(up.is_vip, FALSE),
    'vip_expire_at', up.vip_expire_at,
    'lcoin_balance', get_user_lcoin_balance(up.id)
  ) INTO v_result
  FROM user_profiles up
  WHERE up.id = p_user_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'user', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_profile_with_vip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_profile_with_vip(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_profile_with_vip(UUID) TO anon;

-- 8. 修改 user_profiles 的 SELECT 策略，允许所有人读取
DROP POLICY IF EXISTS "user_profiles_select_all_vip_fields" ON user_profiles;
CREATE POLICY "user_profiles_select_all_vip_fields" ON user_profiles
  FOR SELECT USING (true);
