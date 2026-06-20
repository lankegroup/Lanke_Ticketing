-- ============================================================
-- PART 4: cancel_ticket FUNCTION
-- ============================================================

DROP FUNCTION IF EXISTS cancel_ticket(UUID, TEXT, UUID, DECIMAL);
CREATE OR REPLACE FUNCTION cancel_ticket(
  p_registration_id UUID,
  p_reason TEXT DEFAULT 'user_cancel',
  p_operator_id UUID DEFAULT NULL,
  p_custom_penalty_amount DECIMAL DEFAULT NULL
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
  v_total_amount DECIMAL;
  v_rmb_pay_amount DECIMAL;
  v_lcoin_pay_amount DECIMAL;
  v_penalty_rate DECIMAL;
  v_penalty_amount DECIMAL;
  v_lcoin_exchange_rate DECIMAL;
  v_refund_lcoin_amount DECIMAL;
  v_refund_rmb_amount DECIMAL;
  v_payment_type TEXT;
  v_session_start_time TIMESTAMPTZ;
  v_stop_selling_time TIMESTAMPTZ;
  v_now TIMESTAMPTZ;
  v_can_release_seat BOOLEAN;
BEGIN
  v_now := NOW();

  BEGIN
    SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '锁定订单失败: ' || SQLERRM);
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', '订单不存在');
  END IF;

  IF v_reg.status NOT IN ('active') THEN
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

  v_rmb_pay_amount := COALESCE(v_reg.cash_amount, 0);
  v_lcoin_pay_amount := COALESCE(v_reg.lcoin_amount, COALESCE(v_reg.price, 0));

  IF v_lcoin_pay_amount > 0 AND v_rmb_pay_amount > 0 THEN
    v_payment_type := 'mixed';
  ELSIF v_lcoin_pay_amount > 0 THEN
    v_payment_type := 'lcoin';
  ELSE
    v_payment_type := 'rmb';
  END IF;

  v_penalty := calculate_refund_penalty(v_reg.session_id, v_now);
  IF (v_penalty->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object('success', false, 'message', COALESCE(v_penalty->>'message', '计算退票费失败'));
  END IF;

  v_penalty_rate := (v_penalty->>'penalty_rate')::DECIMAL;
  v_total_amount := v_lcoin_pay_amount + v_rmb_pay_amount;

  IF p_custom_penalty_amount IS NOT NULL THEN
    v_penalty_amount := p_custom_penalty_amount;
  ELSE
    v_penalty_amount := v_total_amount * v_penalty_rate;
  END IF;

  v_lcoin_exchange_rate := get_lcoin_to_rmb_rate();

  IF v_lcoin_pay_amount >= v_penalty_amount THEN
    v_refund_lcoin_amount := v_lcoin_pay_amount - v_penalty_amount;
    v_refund_rmb_amount := v_rmb_pay_amount;
  ELSE
    v_refund_lcoin_amount := 0;
    v_refund_rmb_amount := v_rmb_pay_amount - ((v_penalty_amount - v_lcoin_pay_amount) * v_lcoin_exchange_rate);
    IF v_refund_rmb_amount < 0 THEN
      v_refund_rmb_amount := 0;
    END IF;
  END IF;

  BEGIN
    v_session_start_time := v_session.session_date::date + v_session.start_time::time;
    v_stop_selling_time := v_session_start_time - INTERVAL '1 minute' * COALESCE(v_session.stop_selling_minutes, 0);
  EXCEPTION WHEN OTHERS THEN
    v_session_start_time := NOW();
    v_stop_selling_time := NOW();
  END;

  v_can_release_seat := v_now < v_stop_selling_time;

  BEGIN
    UPDATE registrations SET
      status = 'cancelled',
      cancelled_at = v_now,
      cancel_reason = p_reason,
      refund_penalty_applied = v_penalty_amount,
      refunded_lcoin_amount = v_refund_lcoin_amount,
      refunded_cash_amount = v_refund_rmb_amount,
      updated_at = NOW()
    WHERE id = p_registration_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '更新订单失败: ' || SQLERRM);
  END;

  IF v_can_release_seat THEN
    BEGIN
      IF v_reg.seat_id IS NOT NULL THEN
        UPDATE seats SET is_booked = false WHERE id = v_reg.seat_id;
      END IF;
      UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF v_refund_lcoin_amount > 0 AND v_reg.user_id IS NOT NULL THEN
    BEGIN
      PERFORM create_lcoin_transaction(
        v_reg.user_id, 'refund', v_refund_lcoin_amount,
        v_reg.id, v_reg.session_id, v_reg.ticket_type,
        NULL, 0, 'system', p_operator_id,
        CONCAT('退票退款：', v_session.name, '（扣', v_penalty_amount, 'LC）'),
        'lcoin'
      );
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'message', '退款转账失败: ' || SQLERRM);
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'registration_id', p_registration_id,
    'payment_type', v_payment_type,
    'penalty_amount', v_penalty_amount,
    'refunded_lcoin', v_refund_lcoin_amount,
    'refunded_rmb', v_refund_rmb_amount,
    'seat_released', v_can_release_seat,
    'message', '退款已完成'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', '取消订单失败: ' || SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_ticket(UUID, TEXT, UUID, DECIMAL) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

SELECT 'Full refund system refactor completed successfully' as result;