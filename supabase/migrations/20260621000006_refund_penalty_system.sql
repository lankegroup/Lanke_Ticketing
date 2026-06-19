-- =====================================================
-- 退票费梯度系统 + 全场景退款机制
-- =====================================================

-- 1. sessions表新增退票费梯度配置字段
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS refund_penalty_rules JSONB DEFAULT NULL;

-- 默认梯度规则（全场次通用）
COMMENT ON COLUMN sessions.refund_penalty_rules IS '退票费梯度规则JSON数组，按hours_before降序排列';

-- 2. registrations表新增退款相关字段
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refund_pending_cash DECIMAL(18,2) DEFAULT 0;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refund_penalty_applied DECIMAL(18,2) DEFAULT 0;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS refunded_lcoin_amount DECIMAL(18,2) DEFAULT 0;

COMMENT ON COLUMN registrations.refund_pending_cash IS '待退现金金额（混合支付时记录，需人工处理）';
COMMENT ON COLUMN registrations.refund_penalty_applied IS '实际扣除的退票费';
COMMENT ON COLUMN registrations.refund_lcoin_amount IS '已退回的蓝克币金额';

-- 3. 设置默认退票规则（对现有场次）
UPDATE sessions 
SET refund_penalty_rules = '[{"hours_before": 24, "penalty_rate": 0, "description": "开场前24小时以上，全额退款"}, {"hours_before": 6, "penalty_rate": 0.1, "description": "开场前6-24小时，扣除10%"}, {"hours_before": 2, "penalty_rate": 0.3, "description": "开场前2-6小时，扣除30%"}, {"hours_before": 0, "penalty_rate": 1.0, "description": "开场后/过期，扣除100%"}]'::jsonb
WHERE refund_penalty_rules IS NULL;

-- 4. 计算退票费的辅助函数
CREATE OR REPLACE FUNCTION calculate_refund_penalty(
  p_session_id UUID,
  p_cancel_time TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_hours_before DECIMAL;
  v_rules JSONB;
  v_rule JSONB;
  v_penalty_rate DECIMAL;
  v_description TEXT;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- 计算距开场时间（小时）
  v_hours_before := EXTRACT(EPOCH FROM (v_session.session_date::date + v_session.start_time::time - p_cancel_time)) / 3600;

  -- 获取梯度规则
  v_rules := v_session.refund_penalty_rules;
  IF v_rules IS NULL OR jsonb_array_length(v_rules) = 0 THEN
    -- 无规则时默认全额退款
    RETURN jsonb_build_object(
      'success', true,
      'hours_before', v_hours_before,
      'penalty_rate', 0,
      'description', '无退票规则，全额退款'
    );
  END IF;

  -- 按hours_before降序匹配（找到第一个满足条件的规则）
  FOR i IN 0..jsonb_array_length(v_rules)-1 LOOP
    v_rule := v_rules->i;
    IF v_hours_before >= (v_rule->>'hours_before')::DECIMAL THEN
      v_penalty_rate := (v_rule->>'penalty_rate')::DECIMAL;
      v_description := v_rule->>'description';
      RETURN jsonb_build_object(
        'success', true,
        'hours_before', v_hours_before,
        'penalty_rate', v_penalty_rate,
        'description', COALESCE(v_description, '')
      );
    END IF;
  END LOOP;

  -- 未匹配任何规则，使用最后一档（最严格的）
  v_rule := v_rules->(jsonb_array_length(v_rules)-1);
  v_penalty_rate := (v_rule->>'penalty_rate')::DECIMAL;
  v_description := v_rule->>'description';

  RETURN jsonb_build_object(
    'success', true,
    'hours_before', v_hours_before,
    'penalty_rate', v_penalty_rate,
    'description', COALESCE(v_description, '过期/开场后退票')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_refund_penalty(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_refund_penalty(UUID, TIMESTAMPTZ) TO service_role;

-- 5. 重构cancel_ticket函数：支持阶梯退票费 + 蓝克币原路退回
DROP FUNCTION IF EXISTS public.cancel_ticket(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.cancel_ticket(
  p_registration_id UUID,
  p_reason TEXT DEFAULT 'user_cancel',
  p_operator_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_session sessions%ROWTYPE;
  v_penalty_info JSONB;
  v_penalty_rate DECIMAL;
  v_penalty_amount DECIMAL;
  v_refund_amount DECIMAL;
  v_original_lcoin DECIMAL;
  v_original_cash DECIMAL;
  v_tx_result JSONB;
BEGIN
  -- 获取订单信息
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_not_found');
  END IF;

  -- 检查订单状态（只能取消active/pending状态的订单）
  IF v_reg.status NOT IN ('active', 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status', 'message', '订单已核销或已取消，无法重复操作');
  END IF;

  -- 获取场次信息
  SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- 计算退票费
  v_penalty_info := calculate_refund_penalty(v_reg.session_id, NOW());
  v_penalty_rate := (v_penalty_info->>'penalty_rate')::DECIMAL;

  -- 获取原始支付金额
  v_original_lcoin := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
  v_original_cash := COALESCE(v_reg.cash_amount, 0);

  -- 计算扣费和退款金额
  v_penalty_amount := v_original_lcoin * v_penalty_rate;
  v_refund_amount := v_original_lcoin - v_penalty_amount;

  -- 更新订单状态
  UPDATE registrations SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancel_reason = p_reason,
    refund_penalty_applied = v_penalty_amount,
    refunded_lcoin_amount = v_refund_amount,
    refund_pending_cash = v_original_cash,
    updated_at = NOW()
  WHERE id = p_registration_id;

  -- 释放座位（如果有）
  IF v_reg.seat_id IS NOT NULL THEN
    UPDATE seats SET is_booked = false, is_blocked = COALESCE(seats.original_blocked, false)
    WHERE id = v_reg.seat_id;
    DELETE FROM seat_locks WHERE seat_id = v_reg.seat_id;
  END IF;

  -- 恢复库存
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;

  -- 蓝克币退款（调用标准退款接口）
  IF v_refund_amount > 0 THEN
    SELECT * INTO v_tx_result FROM create_lcoin_transaction(
      v_reg.user_id,
      'refund',
      v_refund_amount,
      v_reg.id,
      v_reg.session_id,
      v_reg.ticket_type,
      NULL,
      0,
      'system',
      NULL,
      CONCAT('退票退款：', v_session.name, '（扣除退票费', v_penalty_amount, 'LC）'),
      'lcoin'
    );
  END IF;

  -- 返回结果
  RETURN jsonb_build_object(
    'success', true,
    'penalty_rate', v_penalty_rate,
    'penalty_amount', v_penalty_amount,
    'refunded_lcoin', v_refund_amount,
    'pending_cash_refund', v_original_cash,
    'hours_before', (v_penalty_info->>'hours_before')::DECIMAL,
    'description', v_penalty_info->>'description',
    'message', CASE
      WHEN v_original_cash > 0 THEN '蓝克币已退回，现金部分需联系管理员处理'
      ELSE '退款已完成'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, TEXT, UUID) TO service_role;

-- 6. 管理员强制作废订单函数（支持指定退票费比例）
DROP FUNCTION IF EXISTS public.admin_void_ticket(uuid, decimal, text, uuid);

CREATE OR REPLACE FUNCTION public.admin_void_ticket(
  p_registration_id UUID,
  p_penalty_rate DECIMAL DEFAULT 1.0,
  p_reason TEXT DEFAULT 'admin_void',
  p_operator_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_session sessions%ROWTYPE;
  v_penalty_amount DECIMAL;
  v_refund_amount DECIMAL;
  v_original_lcoin DECIMAL;
  v_original_cash DECIMAL;
  v_tx_result JSONB;
BEGIN
  -- 获取订单信息
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_not_found');
  END IF;

  IF v_reg.status NOT IN ('active', 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status');
  END IF;

  SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;

  -- 获取原始支付金额
  v_original_lcoin := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
  v_original_cash := COALESCE(v_reg.cash_amount, 0);

  -- 计算扣费和退款
  v_penalty_amount := v_original_lcoin * p_penalty_rate;
  v_refund_amount := v_original_lcoin - v_penalty_amount;

  -- 更新订单状态
  UPDATE registrations SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancel_reason = p_reason,
    refund_penalty_applied = v_penalty_amount,
    refunded_lcoin_amount = v_refund_amount,
    refund_pending_cash = v_original_cash,
    updated_at = NOW()
  WHERE id = p_registration_id;

  -- 释放座位
  IF v_reg.seat_id IS NOT NULL THEN
    UPDATE seats SET is_booked = false, is_blocked = COALESCE(seats.original_blocked, false)
    WHERE id = v_reg.seat_id;
    DELETE FROM seat_locks WHERE seat_id = v_reg.seat_id;
  END IF;

  -- 恢复库存
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;

  -- 蓝克币退款
  IF v_refund_amount > 0 THEN
    SELECT * INTO v_tx_result FROM create_lcoin_transaction(
      v_reg.user_id,
      'refund',
      v_refund_amount,
      v_reg.id,
      v_reg.session_id,
      v_reg.ticket_type,
      NULL,
      0,
      'admin',
      p_operator_id,
      CONCAT('管理员作废退款：', v_session.name),
      'lcoin'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'penalty_rate', p_penalty_rate,
    'penalty_amount', v_penalty_amount,
    'refunded_lcoin', v_refund_amount,
    'pending_cash_refund', v_original_cash,
    'message', CASE
      WHEN v_original_cash > 0 THEN '蓝克币已退回，现金部分需联系管理员处理'
      ELSE '作废完成'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_ticket(UUID, DECIMAL, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_void_ticket(UUID, DECIMAL, TEXT, UUID) TO service_role;

-- 7. 过期订单自动作废函数（定时任务调用）
CREATE OR REPLACE FUNCTION auto_expire_registrations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_reg RECORD;
  v_result JSONB;
BEGIN
  -- 查找所有过期但未核销的订单
  FOR v_reg IN
    SELECT r.id, r.session_id, r.user_id, r.price, r.lcoin_amount, r.cash_amount, r.ticket_type, r.seat_id
    FROM registrations r
    JOIN sessions s ON r.session_id = s.id
    WHERE r.status IN ('active', 'pending')
      AND (s.session_date::date + s.end_time::time) < NOW()
  LOOP
    -- 使用最高档退票费（100%扣除）
    v_result := admin_void_ticket(v_reg.id, 1.0, 'auto_expire', NULL);
    IF (v_result->>'success')::BOOLEAN THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_expire_registrations() TO service_role;

-- 8. 获取订单退款预览信息（前端弹窗使用）
CREATE OR REPLACE FUNCTION get_cancel_preview(
  p_registration_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_session sessions%ROWTYPE;
  v_penalty_info JSONB;
  v_penalty_rate DECIMAL;
  v_penalty_amount DECIMAL;
  v_refund_amount DECIMAL;
  v_original_lcoin DECIMAL;
  v_original_cash DECIMAL;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_not_found');
  END IF;

  SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;

  v_penalty_info := calculate_refund_penalty(v_reg.session_id, NOW());
  v_penalty_rate := (v_penalty_info->>'penalty_rate')::DECIMAL;

  v_original_lcoin := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
  v_original_cash := COALESCE(v_reg.cash_amount, 0);

  v_penalty_amount := v_original_lcoin * v_penalty_rate;
  v_refund_amount := v_original_lcoin - v_penalty_amount;

  RETURN jsonb_build_object(
    'success', true,
    'registration_id', p_registration_id,
    'session_name', v_session.name,
    'session_date', v_session.session_date,
    'start_time', v_session.start_time,
    'ticket_code', v_reg.ticket_code,
    'original_lcoin', v_original_lcoin,
    'original_cash', v_original_cash,
    'hours_before', (v_penalty_info->>'hours_before')::DECIMAL,
    'penalty_rate', v_penalty_rate,
    'penalty_amount', v_penalty_amount,
    'refund_amount', v_refund_amount,
    'description', v_penalty_info->>'description',
    'has_cash_payment', v_original_cash > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID) TO service_role;