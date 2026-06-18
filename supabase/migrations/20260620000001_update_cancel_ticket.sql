CREATE OR REPLACE FUNCTION public.cancel_ticket(p_registration_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS 
DECLARE
  v_reg RECORD;
  v_session RECORD;
  v_total_amount DECIMAL(18,2);
  v_fee_rate DECIMAL(5,2) := 0;
  v_refund_amount DECIMAL(18,2);
  v_balance_before DECIMAL(18,2);
BEGIN
  SELECT r.* INTO v_reg FROM registrations r WHERE r.id = p_registration_id AND r.status = 'active' AND r.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_ticket'); END IF;

  SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found'); END IF;

  UPDATE registrations SET status = 'cancelled', deleted_at = NOW() WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;

  v_total_amount := v_session.ticket_price + COALESCE(v_reg.service_fee, COALESCE(v_session.default_service_fee, 0));

  IF v_reg.user_id IS NOT NULL AND v_total_amount > 0 THEN
    SELECT fee_rate INTO v_fee_rate 
    FROM lcoin_service_fee_rules 
    WHERE session_id = v_reg.session_id 
      AND NOW() >= start_time 
      AND (end_time IS NULL OR NOW() <= end_time)
    ORDER BY start_time DESC LIMIT 1;

    IF v_fee_rate IS NULL THEN
      SELECT fee_rate INTO v_fee_rate 
      FROM lcoin_service_fee_rules 
      WHERE session_id IS NULL 
        AND NOW() >= start_time 
        AND (end_time IS NULL OR NOW() <= end_time)
      ORDER BY start_time DESC LIMIT 1;
    END IF;

    v_fee_rate := COALESCE(v_fee_rate, 0);
    v_refund_amount := v_total_amount * (1 - v_fee_rate);

    SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) INTO v_balance_before
    FROM lcoin_transactions
    WHERE user_id = v_reg.user_id AND status = 'completed';

    INSERT INTO lcoin_transactions (
      user_id, order_id, transaction_type, direction, 
      amount, balance_before, balance_after, session_id, 
      ticket_type, service_fee, operator_type, operator_id,
      description, status
    ) VALUES (
      v_reg.user_id, p_registration_id, 'refund', 'in',
      v_refund_amount, v_balance_before, v_balance_before + v_refund_amount, 
      v_reg.session_id, v_reg.ticket_type, COALESCE(v_reg.service_fee, 0),
      'system', NULL, '退票退款', 'completed'
    );

    IF v_total_amount > v_refund_amount THEN
      INSERT INTO lcoin_transactions (
        user_id, order_id, transaction_type, direction, 
        amount, balance_before, balance_after, session_id, 
        ticket_type, service_fee, operator_type, operator_id,
        description, status
      ) VALUES (
        v_reg.user_id, p_registration_id, 'fee', 'out',
        v_total_amount - v_refund_amount, v_balance_before + v_refund_amount, 
        v_balance_before + v_refund_amount, v_reg.session_id, 
        v_reg.ticket_type, COALESCE(v_reg.service_fee, 0),
        'system', NULL, '退票手续费', 'completed'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'refund_amount', v_refund_amount);
END;
;

CREATE OR REPLACE FUNCTION public.admin_reschedule_seat(
  p_registration_id UUID,
  p_new_seat_id UUID,
  p_new_session_id UUID = NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS 
DECLARE
  v_reg RECORD;
  v_old_session RECORD;
  v_new_session RECORD;
  v_old_seat RECORD;
  v_new_seat RECORD;
  v_price_diff DECIMAL(18,2);
  v_fee_rate DECIMAL(5,2) := 0;
  v_reschedule_fee DECIMAL(18,2);
  v_balance_before DECIMAL(18,2);
BEGIN
  SELECT r.* INTO v_reg FROM registrations r WHERE r.id = p_registration_id AND r.status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_registration'); END IF;

  SELECT * INTO v_old_session FROM sessions WHERE id = v_reg.session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'old_session_not_found'); END IF;

  SELECT * INTO v_new_session FROM sessions WHERE id = COALESCE(p_new_session_id, v_reg.session_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'new_session_not_found'); END IF;

  IF v_reg.seat_id IS NOT NULL THEN
    SELECT * INTO v_old_seat FROM seats WHERE id = v_reg.seat_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'old_seat_not_found'); END IF;
  END IF;

  SELECT * INTO v_new_seat FROM seats WHERE id = p_new_seat_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'new_seat_not_found'); END IF;

  IF v_new_seat.is_sold THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'seat_already_sold');
  END IF;

  SELECT fee_rate INTO v_fee_rate 
  FROM lcoin_service_fee_rules 
  WHERE session_id = v_reg.session_id 
    AND NOW() >= start_time 
    AND (end_time IS NULL OR NOW() <= end_time)
  ORDER BY start_time DESC LIMIT 1;

  IF v_fee_rate IS NULL THEN
    SELECT fee_rate INTO v_fee_rate 
    FROM lcoin_service_fee_rules 
    WHERE session_id IS NULL 
      AND NOW() >= start_time 
      AND (end_time IS NULL OR NOW() <= end_time)
    ORDER BY start_time DESC LIMIT 1;
  END IF;

  v_fee_rate := COALESCE(v_fee_rate, 0);
  v_reschedule_fee := v_old_session.ticket_price * v_fee_rate;

  v_price_diff := 0;
  IF p_new_session_id IS NOT NULL AND v_new_session.ticket_price != v_old_session.ticket_price THEN
    v_price_diff := v_new_session.ticket_price - v_old_session.ticket_price;
  END IF;

  IF v_reg.user_id IS NOT NULL AND (v_price_diff > 0 OR v_reschedule_fee > 0) THEN
    SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) INTO v_balance_before
    FROM lcoin_transactions
    WHERE user_id = v_reg.user_id AND status = 'completed';

    IF v_balance_before < v_price_diff + v_reschedule_fee THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance');
    END IF;

    IF v_reschedule_fee > 0 THEN
      INSERT INTO lcoin_transactions (
        user_id, order_id, transaction_type, direction, 
        amount, balance_before, balance_after, session_id, 
        ticket_type, service_fee, operator_type, operator_id,
        description, status
      ) VALUES (
        v_reg.user_id, p_registration_id, 'fee', 'out',
        v_reschedule_fee, v_balance_before, v_balance_before - v_reschedule_fee, 
        v_reg.session_id, v_reg.ticket_type, v_reschedule_fee,
        'system', NULL, '改签手续费', 'completed'
      );
      v_balance_before := v_balance_before - v_reschedule_fee;
    END IF;

    IF v_price_diff > 0 THEN
      INSERT INTO lcoin_transactions (
        user_id, order_id, transaction_type, direction, 
        amount, balance_before, balance_after, session_id, 
        ticket_type, service_fee, operator_type, operator_id,
        description, status
      ) VALUES (
        v_reg.user_id, p_registration_id, 'purchase', 'out',
        v_price_diff, v_balance_before, v_balance_before - v_price_diff, 
        p_new_session_id, v_reg.ticket_type, 0,
        'system', NULL, '改签差价', 'completed'
      );
    END IF;
  END IF;

  IF v_reg.seat_id IS NOT NULL THEN
    UPDATE seats SET is_sold = FALSE WHERE id = v_reg.seat_id;
  END IF;

  UPDATE seats SET is_sold = TRUE WHERE id = p_new_seat_id;

  UPDATE registrations SET 
    seat_id = p_new_seat_id,
    seat_name = v_new_seat.seat_name,
    session_id = COALESCE(p_new_session_id, v_reg.session_id),
    reschedule_count = reschedule_count + 1,
    reschedule_history = COALESCE(reschedule_history, '[]'::JSONB) || jsonb_build_object(
      'timestamp', NOW(),
      'old_seat_id', v_reg.seat_id,
      'old_seat_name', v_reg.seat_name,
      'new_seat_id', p_new_seat_id,
      'new_seat_name', v_new_seat.seat_name,
      'old_session_id', v_reg.session_id,
      'new_session_id', COALESCE(p_new_session_id, v_reg.session_id)
    )
  WHERE id = p_registration_id;

  RETURN jsonb_build_object('success', TRUE, 'fee', v_reschedule_fee, 'price_diff', v_price_diff);
END;
;
