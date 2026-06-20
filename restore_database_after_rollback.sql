-- ============================================================
-- 回滚后数据库恢复脚本
-- 将数据库恢复到与下午4:41代码兼容的状态
-- ============================================================

-- 1. 创建 system_settings 表（如果不存在）
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  setting TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 插入默认汇率设置
INSERT INTO system_settings (key, setting, description)
VALUES ('lcoin_exchange_rate', '10', '兰克币兑换人民币汇率（1人民币 = 10兰克币）')
ON CONFLICT (key) DO NOTHING;

-- 2. 删除所有新版本函数（避免冲突）
DROP FUNCTION IF EXISTS public.change_seat(UUID, UUID, DECIMAL, BOOLEAN);
DROP FUNCTION IF EXISTS public.admin_change_seat(UUID, UUID, DECIMAL, BOOLEAN);
DROP FUNCTION IF EXISTS public.get_reschedule_preview(UUID, UUID);
DROP FUNCTION IF EXISTS public.create_lcoin_transaction(UUID, TEXT, DECIMAL, TEXT);

-- 3. 恢复旧版 change_seat 函数（客户端换座，2参数）
CREATE OR REPLACE FUNCTION public.change_seat(
  p_registration_id UUID,
  p_new_seat_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_old_seat_name TEXT;
  v_new_seat_name TEXT;
  v_history JSONB;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_reg.status <> 'active' THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_status'); END IF;
  IF v_reg.reschedule_count >= 1 THEN RETURN jsonb_build_object('success', false, 'error', 'reschedule_limit_reached'); END IF;
  IF v_reg.seat_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_seat'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND session_id = v_reg.session_id) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND is_blocked) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_blocked'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_new_seat_id AND status NOT IN ('cancelled', 'expired') AND deleted_at IS NULL AND id <> p_registration_id) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;
  SELECT seat_name INTO v_old_seat_name FROM seats WHERE id = v_reg.seat_id;
  SELECT seat_name INTO v_new_seat_name FROM seats WHERE id = p_new_seat_id;
  v_history := v_reg.reschedule_history || jsonb_build_array(jsonb_build_object('from_seat', v_old_seat_name, 'to_seat', v_new_seat_name, 'changed_at', NOW()));
  DELETE FROM seat_locks WHERE seat_id = p_new_seat_id;
  UPDATE registrations SET seat_id = p_new_seat_id, reschedule_count = reschedule_count + 1, reschedule_history = v_history WHERE id = p_registration_id;
  RETURN jsonb_build_object('success', true, 'old_seat', v_old_seat_name, 'new_seat', v_new_seat_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_seat(UUID, UUID) TO authenticated;

-- 4. 恢复旧版 admin_reschedule_seat 函数（管理员协助换座，3参数）
CREATE OR REPLACE FUNCTION public.admin_reschedule_seat(
  p_registration_id UUID,
  p_new_seat_id     UUID,
  p_force           BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_reg            registrations%ROWTYPE;
  v_old_seat_name  TEXT;
  v_new_seat_name  TEXT;
  v_history        JSONB;
  v_was_blocked    BOOLEAN := FALSE;
  v_is_repeat      BOOLEAN := FALSE;
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

  v_is_repeat := v_reg.reschedule_count >= 1;

  v_history := v_reg.reschedule_history || jsonb_build_array(
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
      reschedule_count   = reschedule_count + 1,
      reschedule_history = v_history,
      was_force_booked   = (p_force AND v_was_blocked)
  WHERE id = p_registration_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_seat', v_old_seat_name,
    'new_seat', v_new_seat_name,
    'reschedule_count', v_reg.reschedule_count + 1,
    'is_repeat', v_is_repeat
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reschedule_seat(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reschedule_seat(UUID, UUID, BOOLEAN) TO authenticated;

-- 5. 恢复锁座相关函数

-- 确保 seat_locks 表结构正确
ALTER TABLE seat_locks
  ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS seat_id UUID NOT NULL,
  ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seat_locks_seat_id_key') THEN
    ALTER TABLE seat_locks ADD CONSTRAINT seat_locks_seat_id_key UNIQUE (seat_id);
  END IF;
END $$;

ALTER TABLE seat_locks DISABLE ROW LEVEL SECURITY;

-- 删除旧策略
DROP POLICY IF EXISTS "anyone_read_locks" ON seat_locks;
DROP POLICY IF EXISTS "authenticated_users_can_insert_locks" ON seat_locks;
DROP POLICY IF EXISTS "authenticated_users_can_delete_locks" ON seat_locks;
DROP POLICY IF EXISTS "service_role_can_do_everything" ON seat_locks;

-- 6. 恢复 lock_seat 函数（1参数版本 - 用户端换座）
DROP FUNCTION IF EXISTS public.lock_seat(UUID);

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

  BEGIN
    INSERT INTO seat_locks (seat_id, user_id, expires_at)
    VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes')
    ON CONFLICT (seat_id) DO UPDATE SET
      user_id = v_user_id,
      expires_at = NOW() + INTERVAL '5 minutes';

    RETURN jsonb_build_object('success', true, 'expires_at', NOW() + INTERVAL '5 minutes');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lock_failed', 'detail', SQLERRM);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID) TO service_role, authenticated, anon;

-- 7. 恢复 lock_seat 函数（2参数版本 - 客户端下单）
DROP FUNCTION IF EXISTS public.lock_seat(UUID, UUID);

CREATE OR REPLACE FUNCTION public.lock_seat(p_seat_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO seat_locks (seat_id, user_id, expires_at)
    VALUES (p_seat_id, p_user_id, NOW() + INTERVAL '5 minutes')
    ON CONFLICT (seat_id) DO UPDATE SET
      user_id = p_user_id,
      expires_at = NOW() + INTERVAL '5 minutes';

    RETURN jsonb_build_object('success', true, 'expires_at', NOW() + INTERVAL '5 minutes');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lock_failed', 'detail', SQLERRM);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID) TO service_role, authenticated, anon;

-- 8. 恢复 unlock_seat 函数
DROP FUNCTION IF EXISTS public.unlock_seat(UUID);

CREATE OR REPLACE FUNCTION public.unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO service_role, authenticated, anon;

-- 9. 恢复 get_seat_map 函数
DROP FUNCTION IF EXISTS public.get_seat_map(UUID);

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

GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO service_role, authenticated, anon;

-- 10. 恢复 get_user_lcoin_balance 函数（确保正确）
CREATE OR REPLACE FUNCTION public.get_user_lcoin_balance(p_user_id UUID)
RETURNS DECIMAL
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE -amount END)
    FROM lcoin_transactions
    WHERE user_id = p_user_id AND transaction_status = 'completed'
  ), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_lcoin_balance(UUID) TO service_role, authenticated;

-- 11. 强制刷新 PostgREST schema
NOTIFY pgrst, 'reload schema';

SELECT 'Database restored to 16:41 compatible state' AS status;
