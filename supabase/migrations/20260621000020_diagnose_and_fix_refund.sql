-- ============================================================
-- DIAGNOSTIC AND FIX: Refund/Cancel Ticket System
-- ============================================================

-- 1. CHECK AND ADD MISSING COLUMNS
-- ============================================================

-- Add lcoin_amount to registrations if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'lcoin_amount') THEN
    ALTER TABLE registrations ADD COLUMN lcoin_amount DECIMAL(18,2) DEFAULT 0;
    RAISE NOTICE 'Added lcoin_amount column to registrations';
  END IF;
END $$;

-- Add cash_amount to registrations if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'cash_amount') THEN
    ALTER TABLE registrations ADD COLUMN cash_amount DECIMAL(18,2) DEFAULT 0;
    RAISE NOTICE 'Added cash_amount column to registrations';
  END IF;
END $$;

-- Add refund_penalty_rules to sessions if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'refund_penalty_rules') THEN
    ALTER TABLE sessions ADD COLUMN refund_penalty_rules JSONB DEFAULT NULL;
    RAISE NOTICE 'Added refund_penalty_rules column to sessions';
  END IF;
END $$;

-- Add refund_pending_cash to registrations if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'refund_pending_cash') THEN
    ALTER TABLE registrations ADD COLUMN refund_pending_cash DECIMAL(18,2) DEFAULT 0;
    RAISE NOTICE 'Added refund_pending_cash column to registrations';
  END IF;
END $$;

-- Add refund_penalty_applied to registrations if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'refund_penalty_applied') THEN
    ALTER TABLE registrations ADD COLUMN refund_penalty_applied DECIMAL(18,2) DEFAULT 0;
    RAISE NOTICE 'Added refund_penalty_applied column to registrations';
  END IF;
END $$;

-- Add refunded_lcoin_amount to registrations if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'refunded_lcoin_amount') THEN
    ALTER TABLE registrations ADD COLUMN refunded_lcoin_amount DECIMAL(18,2) DEFAULT 0;
    RAISE NOTICE 'Added refunded_lcoin_amount column to registrations';
  END IF;
END $$;

-- 2. SET DEFAULT REFUND RULES FOR EXISTING SESSIONS
-- ============================================================
UPDATE sessions 
SET refund_penalty_rules = '[{"hours_before": 24, "penalty_rate": 0, "description": "开场前24小时以上，全额退款"}, {"hours_before": 6, "penalty_rate": 0.1, "description": "开场前6-24小时，扣除10%"}, {"hours_before": 2, "penalty_rate": 0.3, "description": "开场前2-6小时，扣除30%"}, {"hours_before": 0, "penalty_rate": 1.0, "description": "开场后/过期，扣除100%"}]'::jsonb
WHERE refund_penalty_rules IS NULL;

RAISE NOTICE 'Set default refund rules for % sessions', (SELECT COUNT(*) FROM sessions WHERE refund_penalty_rules IS NOT NULL);

-- 3. RECREATE FUNCTIONS WITH FULL DIAGNOSTICS
-- ============================================================

-- calculate_refund_penalty - with robust error handling
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
  v_rule JSONB;
  v_penalty_rate DECIMAL;
  v_description TEXT;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found', 'message', '场次不存在');
  END IF;

  BEGIN
    v_hours_before := EXTRACT(EPOCH FROM (v_session.session_date::date + v_session.start_time::time - p_cancel_time)) / 3600;
  EXCEPTION WHEN OTHERS THEN
    v_hours_before := -999999;
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
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  v_rule := v_rules->(jsonb_array_length(v_rules)-1);
  BEGIN
    v_penalty_rate := (v_rule->>'penalty_rate')::DECIMAL;
    v_description := v_rule->>'description';
  EXCEPTION WHEN OTHERS THEN
    v_penalty_rate := 1.0;
    v_description := '规则解析失败，按100%扣款';
  END;

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

-- get_cancel_preview - with FULL diagnostics
DROP FUNCTION IF EXISTS get_cancel_preview(UUID);
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
  BEGIN
    SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_select_failed', 'message', '查询订单失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_not_found', 'message', '订单不存在');
  END IF;

  BEGIN
    SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_select_failed', 'message', '查询场次失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found', 'message', '场次不存在');
  END IF;

  v_penalty_info := calculate_refund_penalty(v_reg.session_id, NOW());
  IF (v_penalty_info->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'penalty_calculation_failed',
      'message', COALESCE(v_penalty_info->>'message', '计算退票费失败'),
      'session_id', v_reg.session_id::TEXT
    );
  END IF;

  v_penalty_rate := (v_penalty_info->>'penalty_rate')::DECIMAL;

  BEGIN
    v_original_lcoin := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
    v_original_cash := COALESCE(v_reg.cash_amount, 0);
  EXCEPTION WHEN OTHERS THEN
    v_original_lcoin := COALESCE(v_reg.price, 0);
    v_original_cash := 0;
  END;

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
    'message', '获取退票信息失败: ' || SQLERRM,
    'registration_id', p_registration_id::TEXT
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID) TO service_role;

-- cancel_ticket - with FULL diagnostics
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
  BEGIN
    SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_lock_failed', 'message', '锁定订单失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_not_found', 'message', '订单不存在');
  END IF;

  IF v_reg.status NOT IN ('active', 'pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status', 'message', '订单状态为: ' || COALESCE(v_reg.status, 'unknown') || '，无法取消');
  END IF;

  BEGIN
    SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_select_failed', 'message', '查询场次失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found', 'message', '场次不存在');
  END IF;

  v_penalty_info := calculate_refund_penalty(v_reg.session_id, NOW());
  IF (v_penalty_info->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'penalty_calculation_failed', 'message', COALESCE(v_penalty_info->>'message', '计算退票费失败'));
  END IF;

  v_penalty_rate := (v_penalty_info->>'penalty_rate')::DECIMAL;

  BEGIN
    v_original_lcoin := COALESCE(v_reg.lcoin_amount, v_reg.price, 0);
    v_original_cash := COALESCE(v_reg.cash_amount, 0);
  EXCEPTION WHEN OTHERS THEN
    v_original_lcoin := COALESCE(v_reg.price, 0);
    v_original_cash := 0;
  END;

  v_penalty_amount := v_original_lcoin * v_penalty_rate;
  v_refund_amount := v_original_lcoin - v_penalty_amount;

  BEGIN
    UPDATE registrations SET
      status = 'cancelled',
      cancelled_at = NOW(),
      cancel_reason = p_reason,
      refund_penalty_applied = v_penalty_amount,
      refunded_lcoin_amount = v_refund_amount,
      refund_pending_cash = v_original_cash,
      updated_at = NOW()
    WHERE id = p_registration_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'registration_update_failed', 'message', '更新订单状态失败: ' || SQLERRM);
  END;

  IF v_reg.seat_id IS NOT NULL THEN
    BEGIN
      UPDATE seats SET is_booked = false, is_blocked = COALESCE(seats.original_blocked, false)
      WHERE id = v_reg.seat_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      DELETE FROM seat_locks WHERE seat_id = v_reg.seat_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  BEGIN
    UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF v_refund_amount > 0 THEN
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'refund_transaction_failed', 'message', '退款转账失败: ' || SQLERRM);
    END;
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
    'message', '取消订单失败: ' || SQLERRM,
    'registration_id', p_registration_id::TEXT
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, TEXT, UUID) TO service_role;

-- 4. DIAGNOSTIC OUTPUT
-- ============================================================
RAISE NOTICE '===== REFUND SYSTEM DIAGNOSTICS =====';
RAISE NOTICE 'Registrations table columns:';
SELECT column_name, data_type, is_nullable FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'registrations' 
AND column_name IN ('id', 'session_id', 'status', 'price', 'lcoin_amount', 'cash_amount', 'seat_id', 'user_id');

RAISE NOTICE 'Sessions table columns:';
SELECT column_name, data_type, is_nullable FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'sessions' 
AND column_name IN ('id', 'name', 'session_date', 'start_time', 'refund_penalty_rules');

RAISE NOTICE 'Functions available:';
SELECT proname FROM pg_proc WHERE proname IN ('get_cancel_preview', 'cancel_ticket', 'calculate_refund_penalty');

RAISE NOTICE '===== DIAGNOSTICS COMPLETE =====';

-- Force schema reload
NOTIFY pgrst, 'reload schema';
