-- Fix: Ensure refund system works correctly

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'lcoin_amount') THEN
    ALTER TABLE registrations ADD COLUMN lcoin_amount DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'cash_amount') THEN
    ALTER TABLE registrations ADD COLUMN cash_amount DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'refund_penalty_rules') THEN
    ALTER TABLE sessions ADD COLUMN refund_penalty_rules JSONB DEFAULT NULL;
  END IF;
END $$;

UPDATE sessions 
SET refund_penalty_rules = '[{"hours_before": 24, "penalty_rate": 0, "description": "开场前24小时以上，全额退款"}, {"hours_before": 6, "penalty_rate": 0.1, "description": "开场前6-24小时，扣除10%"}, {"hours_before": 2, "penalty_rate": 0.3, "description": "开场前2-6小时，扣除30%"}, {"hours_before": 0, "penalty_rate": 1.0, "description": "开场后/过期，扣除100%"}]'::jsonb
WHERE refund_penalty_rules IS NULL;

DROP FUNCTION IF EXISTS calculate_refund_penalty(UUID, TIMESTAMPTZ);
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
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '场次不存在');
  END IF;

  BEGIN
    v_hours_before := EXTRACT(EPOCH FROM (v_session.session_date::date + v_session.start_time::time - p_cancel_time)) / 3600;
  EXCEPTION WHEN OTHERS THEN
    v_hours_before := -999999;
  END;

  v_rules := v_session.refund_penalty_rules;
  IF v_rules IS NULL OR jsonb_typeof(v_rules) != 'array' OR jsonb_array_length(v_rules) = 0 THEN
    RETURN jsonb_build_object('success', true, 'hours_before', v_hours_before, 'penalty_rate', 0, 'description', '全额退款');
  END IF;

  FOR i IN 0..jsonb_array_length(v_rules)-1 LOOP
    BEGIN
      IF v_hours_before >= (v_rules->i->>'hours_before')::DECIMAL THEN
        RETURN jsonb_build_object(
          'success', true,
          'hours_before', v_hours_before,
          'penalty_rate', (v_rules->i->>'penalty_rate')::DECIMAL,
          'description', COALESCE(v_rules->i->>'description', '')
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  BEGIN
    RETURN jsonb_build_object(
      'success', true,
      'hours_before', v_hours_before,
      'penalty_rate', (v_rules->(jsonb_array_length(v_rules)-1)->>'penalty_rate')::DECIMAL,
      'description', COALESCE(v_rules->(jsonb_array_length(v_rules)-1)->>'description', '')
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', true, 'hours_before', v_hours_before, 'penalty_rate', 1.0, 'description', '过期退票');
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', '计算失败: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_refund_penalty(UUID, TIMESTAMPTZ) TO authenticated, service_role;

DROP FUNCTION IF EXISTS get_cancel_preview(UUID);
CREATE OR REPLACE FUNCTION get_cancel_preview(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_session sessions%ROWTYPE;
  v_penalty JSONB;
  v_price DECIMAL;
BEGIN
  BEGIN
    SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '查询订单失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '订单不存在');
  END IF;

  BEGIN
    SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '查询场次失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '场次不存在');
  END IF;

  v_penalty := calculate_refund_penalty(v_reg.session_id, NOW());
  IF (v_penalty->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object('success', false, 'message', COALESCE(v_penalty->>'message', '计算退票费失败'));
  END IF;

  BEGIN
    v_price := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
  EXCEPTION WHEN OTHERS THEN
    v_price := COALESCE(v_reg.price, 0);
  END;

  RETURN jsonb_build_object(
    'success', true,
    'registration_id', p_registration_id,
    'session_name', v_session.name,
    'ticket_code', v_reg.ticket_code,
    'original_lcoin', v_price,
    'original_cash', COALESCE(v_reg.cash_amount, 0),
    'penalty_rate', (v_penalty->>'penalty_rate')::DECIMAL,
    'penalty_amount', v_price * (v_penalty->>'penalty_rate')::DECIMAL,
    'refund_amount', v_price * (1 - (v_penalty->>'penalty_rate')::DECIMAL),
    'description', COALESCE(v_penalty->>'description', ''),
    'has_cash_payment', COALESCE(v_reg.cash_amount, 0) > 0
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', '获取退票信息失败: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID) TO authenticated, service_role;

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
  v_penalty JSONB;
  v_price DECIMAL;
  v_penalty_amount DECIMAL;
  v_refund_amount DECIMAL;
BEGIN
  BEGIN
    SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '锁定订单失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '订单不存在');
  END IF;

  IF v_reg.status NOT IN ('active', 'pending') THEN
    RETURN jsonb_build_object('success', false, 'message', '订单状态: ' || COALESCE(v_reg.status, 'unknown') || '，无法取消');
  END IF;

  BEGIN
    SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '查询场次失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '场次不存在');
  END IF;

  v_penalty := calculate_refund_penalty(v_reg.session_id, NOW());
  IF (v_penalty->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object('success', false, 'message', COALESCE(v_penalty->>'message', '计算退票费失败'));
  END IF;

  BEGIN
    v_price := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
  EXCEPTION WHEN OTHERS THEN
    v_price := COALESCE(v_reg.price, 0);
  END;

  v_penalty_amount := v_price * (v_penalty->>'penalty_rate')::DECIMAL;
  v_refund_amount := v_price - v_penalty_amount;

  BEGIN
    UPDATE registrations SET
      status = 'cancelled',
      cancelled_at = NOW(),
      cancel_reason = p_reason,
      refund_penalty_applied = v_penalty_amount,
      refunded_lcoin_amount = v_refund_amount,
      updated_at = NOW()
    WHERE id = p_registration_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '更新订单失败: ' || SQLERRM);
  END;

  IF v_reg.seat_id IS NOT NULL THEN
    BEGIN
      UPDATE seats SET is_booked = false WHERE id = v_reg.seat_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  BEGIN
    UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_refund_amount > 0 AND v_reg.user_id IS NOT NULL THEN
    BEGIN
      PERFORM create_lcoin_transaction(
        v_reg.user_id, 'refund', v_refund_amount, v_reg.id, v_reg.session_id,
        v_reg.ticket_type, NULL, 0, 'system', NULL,
        CONCAT('退票退款：', v_session.name, '（扣', v_penalty_amount, 'LC）'), 'lcoin'
      );
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', '退款转账失败: ' || SQLERRM);
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'penalty_amount', v_penalty_amount,
    'refunded_lcoin', v_refund_amount,
    'message', '退款已完成'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', '取消订单失败: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, TEXT, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

SELECT 'Refund system fixed successfully' as result;
