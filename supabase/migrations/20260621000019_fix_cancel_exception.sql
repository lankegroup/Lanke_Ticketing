-- Fix: Add exception handling to cancel/refund functions
-- Problem: get_cancel_preview and cancel_ticket were throwing unhandled exceptions
-- causing "获取退票信息失败" on both client and admin sides.

-- Recreate calculate_refund_penalty with EXCEPTION block
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
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found', 'message', '场次不存在');
  END IF;

  -- Safe calculation of hours_before
  BEGIN
    v_hours_before := EXTRACT(EPOCH FROM (v_session.session_date::date + v_session.start_time::time - p_cancel_time)) / 3600;
  EXCEPTION WHEN OTHERS THEN
    v_hours_before := -999999; -- Already started / invalid time
  END;

  v_rules := v_session.refund_penalty_rules;
  IF v_rules IS NULL OR jsonb_typeof(v_rules) != 'array' OR jsonb_array_length(v_rules) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'hours_before', v_hours_before,
      'penalty_rate', 0,
      'description', '无退票规则，全额退款'
    );
  END IF;

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

  v_rule := v_rules->(jsonb_array_length(v_rules)-1);
  v_penalty_rate := (v_rule->>'penalty_rate')::DECIMAL;
  v_description := v_rule->>'description';

  RETURN jsonb_build_object(
    'success', true,
    'hours_before', v_hours_before,
    'penalty_rate', v_penalty_rate,
    'description', COALESCE(v_description, '')
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLSTATE,
    'message', '计算退票费时发生错误: ' || SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_refund_penalty(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_refund_penalty(UUID, TIMESTAMPTZ) TO service_role;

-- Recreate get_cancel_preview with EXCEPTION block and detailed error info
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
    RETURN jsonb_build_object('success', false, 'error', 'registration_not_found', 'message', '订单不存在');
  END IF;

  SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found', 'message', '场次不存在');
  END IF;

  v_penalty_info := calculate_refund_penalty(v_reg.session_id, NOW());
  IF (v_penalty_info->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'penalty_calculation_failed',
      'message', COALESCE(v_penalty_info->>'message', '计算退票费失败')
    );
  END IF;

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
    'description', COALESCE(v_penalty_info->>'description', ''),
    'has_cash_payment', v_original_cash > 0
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLSTATE,
    'message', '获取退票信息失败: ' || SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID) TO service_role;

-- Recreate cancel_ticket with EXCEPTION block
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
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_not_found', 'message', '订单不存在');
  END IF;

  IF v_reg.status NOT IN ('active', 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status', 'message', '订单已核销或已取消，无法重复操作');
  END IF;

  SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found', 'message', '场次不存在');
  END IF;

  v_penalty_info := calculate_refund_penalty(v_reg.session_id, NOW());
  IF (v_penalty_info->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'penalty_calculation_failed', 'message', COALESCE(v_penalty_info->>'message', '计算退票费失败'));
  END IF;

  v_penalty_rate := (v_penalty_info->>'penalty_rate')::DECIMAL;

  v_original_lcoin := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
  v_original_cash := COALESCE(v_reg.cash_amount, 0);

  v_penalty_amount := v_original_lcoin * v_penalty_rate;
  v_refund_amount := v_original_lcoin - v_penalty_amount;

  UPDATE registrations SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancel_reason = p_reason,
    refund_penalty_applied = v_penalty_amount,
    refunded_lcoin_amount = v_refund_amount,
    refund_pending_cash = v_original_cash,
    updated_at = NOW()
  WHERE id = p_registration_id;

  IF v_reg.seat_id IS NOT NULL THEN
    UPDATE seats SET is_booked = false, is_blocked = COALESCE(seats.original_blocked, false)
    WHERE id = v_reg.seat_id;
    DELETE FROM seat_locks WHERE seat_id = v_reg.seat_id;
  END IF;

  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;

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
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLSTATE,
    'message', '取消订单失败: ' || SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, TEXT, UUID) TO service_role;
