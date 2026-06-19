-- ============================================
-- VIP会员系统数据库迁移
-- ============================================

-- 1. 为 user_profiles 表添加 VIP 相关字段
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vip_expire_at TIMESTAMPTZ;

-- 2. 创建 VIP 升级函数
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
  -- 获取当前VIP状态
  SELECT is_vip, vip_expire_at INTO v_is_vip, v_new_expire_at
  FROM user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;

  -- 计算新的过期时间
  -- 如果当前是VIP且未过期，追加时间
  IF v_is_vip AND v_new_expire_at > NOW() THEN
    v_new_expire_at := v_new_expire_at + (p_duration_days || ' days')::INTERVAL;
  ELSE
    -- 否则从现在开始计算
    v_new_expire_at := NOW() + (p_duration_days || ' days')::INTERVAL;
  END IF;

  -- 更新用户VIP状态
  UPDATE user_profiles
  SET is_vip = TRUE,
      vip_expire_at = v_new_expire_at,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- 记录交易（可选，用于统计）
  INSERT INTO lcoin_transactions (
    user_id,
    transaction_type,
    direction,
    amount,
    description,
    operator_type,
    transaction_status
  ) VALUES (
    p_user_id,
    'vip_upgrade',
    'out',
    0,
    'VIP升级：' || p_duration_days || '天，有效期至 ' || TO_CHAR(v_new_expire_at, 'YYYY-MM-DD HH24:MI'),
    'admin',
    'completed'
  );

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

-- 3. 创建取消VIP函数
CREATE OR REPLACE FUNCTION public.cancel_user_vip(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET is_vip = FALSE,
      vip_expire_at = NULL,
      updated_at = NOW()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'user_not_found');
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'is_vip', FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_user_vip(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_user_vip(UUID) TO service_role;

-- 4. 创建自动检查并更新VIP状态的函数
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

  -- 如果是VIP但已过期，自动更新状态
  IF v_is_vip AND (v_vip_expire_at IS NULL OR v_vip_expire_at < NOW()) THEN
    UPDATE user_profiles
    SET is_vip = FALSE,
        updated_at = NOW()
    WHERE id = p_user_id;

    RETURN jsonb_build_object('success', TRUE, 'is_vip', FALSE, 'expired', TRUE);
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'is_vip', v_is_vip, 'expired', FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_update_vip_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_update_vip_status(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_and_update_vip_status(UUID) TO anon;

-- 5. 创建获取用户完整信息（含VIP状态）的函数
CREATE OR REPLACE FUNCTION public.get_user_profile_with_vip(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- 先检查并更新VIP状态
  PERFORM check_and_update_vip_status(p_user_id);

  -- 获取用户信息
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

-- 6. 修改 user_profiles 的 SELECT 策略，允许所有人读取 is_vip 和 vip_expire_at
DROP POLICY IF EXISTS "user_profiles_select_all_vip_fields" ON user_profiles;
CREATE POLICY "user_profiles_select_all_vip_fields" ON user_profiles
  FOR SELECT USING (true);
