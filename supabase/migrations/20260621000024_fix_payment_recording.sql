-- ============================================================
-- FIX: Add missing columns and update booking functions
-- ============================================================

-- ── 1. Add missing columns to registrations table ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'updated_at') THEN
    ALTER TABLE registrations ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'lcoin_amount') THEN
    ALTER TABLE registrations ADD COLUMN lcoin_amount DECIMAL(18,4) DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'cash_amount') THEN
    ALTER TABLE registrations ADD COLUMN cash_amount DECIMAL(18,4) DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'payment_method') THEN
    ALTER TABLE registrations ADD COLUMN payment_method TEXT DEFAULT 'lcoin';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'refund_penalty_applied') THEN
    ALTER TABLE registrations ADD COLUMN refund_penalty_applied DECIMAL(18,4);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'refunded_lcoin_amount') THEN
    ALTER TABLE registrations ADD COLUMN refunded_lcoin_amount DECIMAL(18,4);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'refunded_cash_amount') THEN
    ALTER TABLE registrations ADD COLUMN refunded_cash_amount DECIMAL(18,4);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'cancelled_at') THEN
    ALTER TABLE registrations ADD COLUMN cancelled_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'cancel_reason') THEN
    ALTER TABLE registrations ADD COLUMN cancel_reason TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'service_fee') THEN
    ALTER TABLE registrations ADD COLUMN service_fee DECIMAL(18,4) DEFAULT 0;
  END IF;
END;
$$;

-- ── 2. Update book_ticket_with_seat to record payment amounts ───────
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid,uuid,text,text,uuid,text,uuid,text);

CREATE OR REPLACE FUNCTION public.book_ticket_with_seat(
  p_session_id    UUID,
  p_seat_id       UUID,
  p_name          TEXT,
  p_phone         TEXT,
  p_user_id       UUID,
  p_ticket_type   TEXT DEFAULT 'adult',
  p_buyer_user_id UUID DEFAULT NULL,
  p_note_content  TEXT DEFAULT NULL,
  p_lcoin_amount  DECIMAL(18,4) DEFAULT 0,
  p_cash_amount   DECIMAL(18,4) DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
  v_price     NUMERIC;
  v_service_fee NUMERIC;
  v_total_amount NUMERIC;
  v_deduct_result JSONB;
  v_seat_name TEXT;
  v_is_blocked BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;

  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  IF p_seat_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
    END IF;

    SELECT is_blocked, seat_name INTO v_is_blocked, v_seat_name FROM seats WHERE id = p_seat_id;

    IF v_is_blocked THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
    END IF;

    IF EXISTS (
      SELECT 1 FROM registrations
      WHERE seat_id = p_seat_id
        AND status NOT IN ('cancelled', 'expired')
        AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
    END IF;
  END IF;

  IF p_ticket_type = 'child' THEN
    v_price := COALESCE(v_session.child_price, v_session.ticket_price * 0.5);
  ELSIF p_ticket_type = 'concession' THEN
    v_price := COALESCE(v_session.concession_price, v_session.ticket_price * 0.8);
  ELSIF p_ticket_type = 'vip' THEN
    v_price := COALESCE(v_session.vip_price, v_session.ticket_price * 1.5);
  ELSE
    v_price := v_session.ticket_price;
  END IF;

  v_service_fee := COALESCE(v_session.default_service_fee, 0);
  v_total_amount := v_price + v_service_fee;

  IF p_lcoin_amount > 0 AND p_user_id IS NOT NULL THEN
    SELECT create_lcoin_transaction(
      p_user_id,
      'purchase',
      p_lcoin_amount,
      NULL,
      p_session_id,
      p_ticket_type,
      v_seat_name,
      v_service_fee,
      'user',
      p_buyer_user_id,
      '购票消费',
      'lcoin'
    ) INTO v_deduct_result;

    IF (v_deduct_result->>'success')::BOOLEAN = FALSE THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', p_lcoin_amount);
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (
    session_id, seat_id, name, phone, ticket_code, status, user_id,
    ticket_type, buyer_user_id, note_content, order_source, service_fee,
    lcoin_amount, cash_amount, payment_method
  ) VALUES (
    p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id,
    p_ticket_type, p_buyer_user_id, p_note_content, 'user', v_service_fee,
    p_lcoin_amount, p_cash_amount,
    CASE
      WHEN p_lcoin_amount > 0 AND p_cash_amount > 0 THEN 'mixed'
      WHEN p_lcoin_amount > 0 THEN 'lcoin'
      ELSE 'rmb'
    END
  ) RETURNING id INTO v_reg_id;

  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── 3. Update book_ticket (no seat) to record payment amounts ───────
DROP FUNCTION IF EXISTS public.book_ticket(uuid,text,text,uuid,text,uuid,text);

CREATE OR REPLACE FUNCTION public.book_ticket(
  p_session_id    UUID,
  p_name          TEXT,
  p_phone         TEXT,
  p_user_id       UUID,
  p_ticket_type   TEXT DEFAULT 'adult',
  p_buyer_user_id UUID DEFAULT NULL,
  p_note_content  TEXT DEFAULT NULL,
  p_lcoin_amount  DECIMAL(18,4) DEFAULT 0,
  p_cash_amount   DECIMAL(18,4) DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
  v_price     NUMERIC;
  v_service_fee NUMERIC;
  v_total_amount NUMERIC;
  v_deduct_result JSONB;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;

  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  IF p_ticket_type = 'child' THEN
    v_price := COALESCE(v_session.child_price, v_session.ticket_price * 0.5);
  ELSIF p_ticket_type = 'concession' THEN
    v_price := COALESCE(v_session.concession_price, v_session.ticket_price * 0.8);
  ELSIF p_ticket_type = 'vip' THEN
    v_price := COALESCE(v_session.vip_price, v_session.ticket_price * 1.5);
  ELSE
    v_price := v_session.ticket_price;
  END IF;

  v_service_fee := COALESCE(v_session.default_service_fee, 0);
  v_total_amount := v_price + v_service_fee;

  IF p_lcoin_amount > 0 AND p_user_id IS NOT NULL THEN
    SELECT create_lcoin_transaction(
      p_user_id,
      'purchase',
      p_lcoin_amount,
      NULL,
      p_session_id,
      p_ticket_type,
      NULL,
      v_service_fee,
      'user',
      p_buyer_user_id,
      '购票消费',
      'lcoin'
    ) INTO v_deduct_result;

    IF (v_deduct_result->>'success')::BOOLEAN = FALSE THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', p_lcoin_amount);
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (
    session_id, name, phone, ticket_code, status, user_id,
    ticket_type, buyer_user_id, note_content, order_source, service_fee,
    lcoin_amount, cash_amount, payment_method
  ) VALUES (
    p_session_id, p_name, p_phone, v_code, 'active', p_user_id,
    p_ticket_type, p_buyer_user_id, p_note_content, 'user', v_service_fee,
    p_lcoin_amount, p_cash_amount,
    CASE
      WHEN p_lcoin_amount > 0 AND p_cash_amount > 0 THEN 'mixed'
      WHEN p_lcoin_amount > 0 THEN 'lcoin'
      ELSE 'rmb'
    END
  ) RETURNING id INTO v_reg_id;

  RETURN jsonb_build_object('success', TRUE, 'ticket_code', v_code, 'registration_id', v_reg_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── 4. Update admin_book_ticket to record payment amounts ───────────
DROP FUNCTION IF EXISTS public.admin_book_ticket(uuid,uuid,text,text,uuid,boolean,text,boolean,text,text);

CREATE OR REPLACE FUNCTION public.admin_book_ticket(
  p_session_id       UUID,
  p_seat_id          UUID,
  p_name             TEXT,
  p_phone            TEXT,
  p_user_id          UUID,
  p_force            BOOLEAN DEFAULT FALSE,
  p_order_source     TEXT DEFAULT 'admin',
  p_is_supplementary BOOLEAN DEFAULT FALSE,
  p_ticket_type      TEXT DEFAULT 'adult',
  p_note_content     TEXT DEFAULT NULL,
  p_lcoin_amount     DECIMAL(18,4) DEFAULT 0,
  p_cash_amount      DECIMAL(18,4) DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_session      sessions%ROWTYPE;
  v_code         TEXT;
  v_reg_id       UUID;
  v_is_blocked   BOOLEAN;
  v_price        NUMERIC;
  v_service_fee  NUMERIC;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;

  IF p_seat_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
    END IF;

    SELECT is_blocked INTO v_is_blocked FROM seats WHERE id = p_seat_id;

    IF v_is_blocked AND NOT p_force THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
    END IF;

    IF NOT p_force THEN
      IF EXISTS (
        SELECT 1 FROM registrations
        WHERE seat_id = p_seat_id
          AND status NOT IN ('cancelled', 'expired')
          AND deleted_at IS NULL
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
      END IF;
    END IF;
  END IF;

  IF NOT p_force AND v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  IF p_ticket_type = 'child' THEN
    v_price := COALESCE(v_session.child_price, v_session.ticket_price * 0.5);
  ELSIF p_ticket_type = 'concession' THEN
    v_price := COALESCE(v_session.concession_price, v_session.ticket_price * 0.8);
  ELSIF p_ticket_type = 'vip' THEN
    v_price := COALESCE(v_session.vip_price, v_session.ticket_price * 1.5);
  ELSE
    v_price := v_session.ticket_price;
  END IF;

  v_service_fee := COALESCE(v_session.default_service_fee, 0);

  IF NOT p_force THEN
    UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  END IF;

  INSERT INTO registrations (
    session_id, seat_id, name, phone, ticket_code, status, user_id,
    ticket_type, order_source, was_force_booked, is_supplementary,
    note_content, service_fee, lcoin_amount, cash_amount, payment_method
  ) VALUES (
    p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id,
    p_ticket_type, p_order_source, p_force, p_is_supplementary,
    p_note_content, v_service_fee, p_lcoin_amount, p_cash_amount,
    CASE
      WHEN p_lcoin_amount > 0 AND p_cash_amount > 0 THEN 'mixed'
      WHEN p_lcoin_amount > 0 THEN 'lcoin'
      ELSE 'rmb'
    END
  ) RETURNING id INTO v_reg_id;

  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code, 'price', v_price);
END;
$$;

-- ── 5. Fix cancel_ticket - remove updated_at reference ───────────────
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
  v_lcoin_pay_amount := COALESCE(v_reg.lcoin_amount, 0);

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
      refunded_cash_amount = v_refund_rmb_amount
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

-- ── 6. Ensure get_cancel_preview is correct ──────────────────────────
DROP FUNCTION IF EXISTS get_cancel_preview(UUID, TEXT);

CREATE OR REPLACE FUNCTION get_cancel_preview(
  p_registration_id UUID,
  p_role TEXT DEFAULT 'user'
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
  v_can_cancel BOOLEAN;
  v_session_start_time TIMESTAMPTZ;
  v_stop_selling_time TIMESTAMPTZ;
  v_now TIMESTAMPTZ;
BEGIN
  v_now := NOW();

  BEGIN
    SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false, 'message', '查询订单失败',
      'refund_fee', 0, 'actual_refund_amount', 0,
      'rmb_pay_amount', 0, 'lcoin_pay_amount', 0
    );
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'message', '订单不存在',
      'refund_fee', 0, 'actual_refund_amount', 0,
      'rmb_pay_amount', 0, 'lcoin_pay_amount', 0
    );
  END IF;

  IF v_reg.status NOT IN ('active') THEN
    RETURN jsonb_build_object(
      'success', false, 'message', '订单状态: ' || COALESCE(v_reg.status, 'unknown') || '，无法取消',
      'refund_fee', 0, 'actual_refund_amount', 0,
      'rmb_pay_amount', 0, 'lcoin_pay_amount', 0
    );
  END IF;

  BEGIN
    SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false, 'message', '查询场次失败',
      'refund_fee', 0, 'actual_refund_amount', 0,
      'rmb_pay_amount', 0, 'lcoin_pay_amount', 0
    );
  END;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'message', '场次不存在',
      'refund_fee', 0, 'actual_refund_amount', 0,
      'rmb_pay_amount', 0, 'lcoin_pay_amount', 0
    );
  END IF;

  v_rmb_pay_amount := COALESCE(v_reg.cash_amount, 0);
  v_lcoin_pay_amount := COALESCE(v_reg.lcoin_amount, 0);

  IF v_lcoin_pay_amount > 0 AND v_rmb_pay_amount > 0 THEN
    v_payment_type := 'mixed';
  ELSIF v_lcoin_pay_amount > 0 THEN
    v_payment_type := 'lcoin';
  ELSE
    v_payment_type := 'rmb';
  END IF;

  IF p_role = 'user' AND v_payment_type != 'lcoin' THEN
    RETURN jsonb_build_object(
      'success', false, 'message',
      CASE WHEN v_payment_type = 'rmb' THEN '纯人民币订单需联系管理员处理退票'
           WHEN v_payment_type = 'mixed' THEN '混合支付订单需联系管理员处理退票'
           ELSE '暂不支持退票' END,
      'payment_type', v_payment_type,
      'refund_fee', 0, 'actual_refund_amount', 0,
      'rmb_pay_amount', v_rmb_pay_amount, 'lcoin_pay_amount', v_lcoin_pay_amount
    );
  END IF;

  v_penalty := calculate_refund_penalty(v_reg.session_id, v_now);
  IF (v_penalty->>'success')::BOOLEAN = false THEN
    RETURN jsonb_build_object(
      'success', false, 'message', COALESCE(v_penalty->>'message', '计算退票费失败'),
      'refund_fee', 0, 'actual_refund_amount', 0,
      'rmb_pay_amount', v_rmb_pay_amount, 'lcoin_pay_amount', v_lcoin_pay_amount
    );
  END IF;

  v_penalty_rate := (v_penalty->>'penalty_rate')::DECIMAL;
  v_total_amount := v_lcoin_pay_amount + v_rmb_pay_amount;
  v_penalty_amount := v_total_amount * v_penalty_rate;

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

  v_can_cancel := v_now < v_stop_selling_time;

  RETURN jsonb_build_object(
    'success', true,
    'registration_id', p_registration_id,
    'session_name', v_session.name,
    'ticket_code', v_reg.ticket_code,
    'payment_type', v_payment_type,
    'rmb_pay_amount', v_rmb_pay_amount,
    'lcoin_pay_amount', v_lcoin_pay_amount,
    'total_amount', v_total_amount,
    'penalty_rate', v_penalty_rate,
    'penalty_amount', v_penalty_amount,
    'lcoin_exchange_rate', v_lcoin_exchange_rate,
    'refund_lcoin_amount', v_refund_lcoin_amount,
    'refund_rmb_amount', v_refund_rmb_amount,
    'description', COALESCE(v_penalty->>'description', ''),
    'hours_before', (v_penalty->>'hours_before')::DECIMAL,
    'can_release_seat', v_can_cancel,
    'session_start_time', v_session_start_time,
    'stop_selling_time', v_stop_selling_time,
    'refund_fee', v_penalty_amount,
    'actual_refund_amount', v_refund_lcoin_amount + (v_refund_rmb_amount / v_lcoin_exchange_rate)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false, 'message', '获取退票信息失败: ' || SQLERRM,
    'refund_fee', 0, 'actual_refund_amount', 0,
    'rmb_pay_amount', COALESCE(v_rmb_pay_amount, 0), 'lcoin_pay_amount', COALESCE(v_lcoin_pay_amount, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_cancel_preview(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

SELECT 'All fixes applied: columns added, booking functions updated, cancel functions fixed' as result;
