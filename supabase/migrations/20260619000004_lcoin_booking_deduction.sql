-- 修改 book_ticket 函数，添加自动扣费逻辑
CREATE OR REPLACE FUNCTION public.book_ticket(p_session_id UUID, p_name TEXT, p_phone TEXT, p_user_id UUID, p_ticket_type TEXT DEFAULT 'regular', p_buyer_user_id UUID DEFAULT NULL, p_note_content TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_ticket_code TEXT;
  v_reg_id UUID;
  v_total_amount DECIMAL(18,2);
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', FALSE, 'error', 'sold_out'); END IF;

  v_total_amount := v_session.ticket_price + COALESCE(v_session.default_service_fee, 0);

  IF p_user_id IS NOT NULL AND v_total_amount > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM user_balances WHERE user_id = p_user_id) THEN
      INSERT INTO user_balances (user_id, balance) VALUES (p_user_id, 0);
    END IF;

    IF (SELECT balance FROM user_balances WHERE user_id = p_user_id) < v_total_amount THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', v_total_amount);
    END IF;

    UPDATE user_balances SET balance = balance - v_total_amount, updated_at = NOW() WHERE user_id = p_user_id;

    INSERT INTO balance_transactions (user_id, transaction_type, amount, balance_before, balance_after, description, reference_id)
    SELECT p_user_id, 'purchase', v_total_amount, balance + v_total_amount, balance, '购票消费', p_session_id
    FROM user_balances WHERE user_id = p_user_id;
  END IF;

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  v_ticket_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 10));
  INSERT INTO registrations (name, phone, session_id, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, note_author, order_source, service_fee)
  VALUES (p_name, p_phone, p_session_id, v_ticket_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'user'::note_author_enum ELSE NULL END, 'user', COALESCE(v_session.default_service_fee, 0))
  RETURNING id INTO v_reg_id;
  RETURN jsonb_build_object('success', TRUE, 'ticket_code', v_ticket_code, 'registration_id', v_reg_id);
END;
$$;

-- 修改 book_ticket_with_seat 函数
CREATE OR REPLACE FUNCTION public.book_ticket_with_seat(p_session_id UUID, p_seat_id UUID, p_name TEXT, p_phone TEXT, p_user_id UUID, p_ticket_type TEXT DEFAULT 'regular', p_buyer_user_id UUID DEFAULT NULL, p_note_content TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_code TEXT;
  v_reg_id UUID;
  v_total_amount DECIMAL(18,2);
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', false, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'sold_out'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired')) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id AND expires_at > NOW()) THEN RETURN jsonb_build_object('success', false, 'error', 'lock_expired'); END IF;

  v_total_amount := v_session.ticket_price + COALESCE(v_session.default_service_fee, 0);

  IF p_user_id IS NOT NULL AND v_total_amount > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM user_balances WHERE user_id = p_user_id) THEN
      INSERT INTO user_balances (user_id, balance) VALUES (p_user_id, 0);
    END IF;

    IF (SELECT balance FROM user_balances WHERE user_id = p_user_id) < v_total_amount THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', v_total_amount);
    END IF;

    UPDATE user_balances SET balance = balance - v_total_amount, updated_at = NOW() WHERE user_id = p_user_id;

    INSERT INTO balance_transactions (user_id, transaction_type, amount, balance_before, balance_after, description, reference_id)
    SELECT p_user_id, 'purchase', v_total_amount, balance + v_total_amount, balance, '购票消费', p_seat_id
    FROM user_balances WHERE user_id = p_user_id;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, note_author, order_source, service_fee)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'user'::note_author_enum ELSE NULL END, 'user', COALESCE(v_session.default_service_fee, 0))
  RETURNING id INTO v_reg_id;
  DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- 修改 cancel_ticket 函数，添加退款逻辑
CREATE OR REPLACE FUNCTION public.cancel_ticket(p_registration_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reg RECORD;
  v_session RECORD;
  v_total_amount DECIMAL(18,2);
BEGIN
  SELECT r.* INTO v_reg FROM registrations r WHERE r.id = p_registration_id AND r.status = 'active' AND r.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_ticket'); END IF;

  SELECT * INTO v_session FROM sessions WHERE id = v_reg.session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found'); END IF;

  UPDATE registrations SET status = 'cancelled', deleted_at = NOW() WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;

  v_total_amount := v_session.ticket_price + COALESCE(v_reg.service_fee, COALESCE(v_session.default_service_fee, 0));

  IF v_reg.user_id IS NOT NULL AND v_total_amount > 0 THEN
    UPDATE user_balances SET balance = balance + v_total_amount, updated_at = NOW() WHERE user_id = v_reg.user_id;

    INSERT INTO balance_transactions (user_id, transaction_type, amount, balance_before, balance_after, description, reference_id)
    SELECT v_reg.user_id, 'refund', v_total_amount, balance - v_total_amount, balance, '退票退款', p_registration_id
    FROM user_balances WHERE user_id = v_reg.user_id;
  END IF;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;
