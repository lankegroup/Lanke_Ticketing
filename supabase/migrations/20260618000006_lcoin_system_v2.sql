DROP TABLE IF EXISTS lcoin_accounts CASCADE;
DROP TABLE IF EXISTS lcoin_transactions CASCADE;
DROP TABLE IF EXISTS lcoin_recharge_packages CASCADE;
DROP TABLE IF EXISTS lcoin_service_fee_rules CASCADE;
DROP TABLE IF EXISTS lcoin_exchange_rates CASCADE;
DROP TABLE IF EXISTS lcoin_config CASCADE;
DROP FUNCTION IF EXISTS get_user_lcoin_balance(UUID);
DROP FUNCTION IF EXISTS calculate_price(UUID, TEXT, INT, UUID, TEXT);
DROP FUNCTION IF EXISTS create_lcoin_transaction(UUID, UUID, UUID, TEXT, DECIMAL, TEXT, TEXT, DECIMAL, TEXT, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS admin_recharge_lcoin(UUID, DECIMAL, TEXT);
DROP FUNCTION IF EXISTS admin_adjust_lcoin(UUID, DECIMAL, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS deduct_lcoin_for_purchase(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, DECIMAL);
DROP FUNCTION IF EXISTS refund_lcoin_for_cancellation(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, DECIMAL);
DROP FUNCTION IF EXISTS get_lcoin_exchange_rate(TEXT, TEXT);

CREATE TABLE lcoin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance DECIMAL(18,2) NOT NULL DEFAULT 0,
  frozen_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  vip_expire_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_lcoin_accounts_user_id ON lcoin_accounts(user_id);
ALTER TABLE lcoin_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_can_view_own_account" ON lcoin_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins_can_manage_accounts" ON lcoin_accounts FOR ALL TO authenticated USING (true);

CREATE TABLE lcoin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID NULL REFERENCES registrations(id) ON DELETE SET NULL,
  session_id UUID NULL REFERENCES sessions(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('recharge','purchase','refund','adjust_add','adjust_subtract','fee','reschedule')),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount DECIMAL(18,2) NOT NULL CHECK (amount >= 0),
  balance_before DECIMAL(18,2) NOT NULL,
  balance_after DECIMAL(18,2) NOT NULL,
  ticket_type TEXT NULL,
  seat_name TEXT NULL,
  service_fee_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  operator_type TEXT NULL CHECK (operator_type IN ('user','admin','system','front_desk')),
  operator_id UUID NULL,
  description TEXT NULL,
  transaction_status TEXT NOT NULL DEFAULT 'completed' CHECK (transaction_status IN ('pending','completed','failed','cancelled')),
  third_party_transaction_id TEXT NULL,
  payment_method TEXT NULL CHECK (payment_method IN ('lcoin','rmb','wechat','alipay')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lcoin_transactions_user_id ON lcoin_transactions(user_id);
CREATE INDEX idx_lcoin_transactions_order_id ON lcoin_transactions(order_id);
CREATE INDEX idx_lcoin_transactions_session_id ON lcoin_transactions(session_id);
CREATE INDEX idx_lcoin_transactions_type ON lcoin_transactions(transaction_type);
CREATE INDEX idx_lcoin_transactions_created_at ON lcoin_transactions(created_at DESC);
ALTER TABLE lcoin_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_can_view_own_transactions" ON lcoin_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins_can_manage_transactions" ON lcoin_transactions FOR ALL TO authenticated USING (true);

CREATE TABLE lcoin_recharge_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_en TEXT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  lcoin_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  description TEXT NULL,
  description_en TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lcoin_recharge_packages_active ON lcoin_recharge_packages(is_active);
CREATE INDEX idx_lcoin_recharge_packages_sort ON lcoin_recharge_packages(sort_order);
ALTER TABLE lcoin_recharge_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "everyone_can_view_active_packages" ON lcoin_recharge_packages FOR SELECT TO anon, authenticated USING (is_active = TRUE);
CREATE POLICY "admins_can_manage_packages" ON lcoin_recharge_packages FOR ALL TO authenticated USING (true);

CREATE TABLE lcoin_service_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NULL REFERENCES sessions(id) ON DELETE CASCADE,
  apply_to_all_sessions BOOLEAN NOT NULL DEFAULT TRUE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('cancellation','reschedule','change_seat')),
  time_before_session INT NOT NULL DEFAULT 0,
  fee_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  min_fee DECIMAL(18,2) NOT NULL DEFAULT 0,
  max_fee DECIMAL(18,2) NOT NULL DEFAULT 99999999.99,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lcoin_service_fee_rules_session ON lcoin_service_fee_rules(session_id);
CREATE INDEX idx_lcoin_service_fee_rules_type ON lcoin_service_fee_rules(rule_type);
CREATE INDEX idx_lcoin_service_fee_rules_active ON lcoin_service_fee_rules(is_active);
ALTER TABLE lcoin_service_fee_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "everyone_can_view_active_rules" ON lcoin_service_fee_rules FOR SELECT TO anon, authenticated USING (is_active = TRUE);
CREATE POLICY "admins_can_manage_rules" ON lcoin_service_fee_rules FOR ALL TO authenticated USING (true);

CREATE TABLE lcoin_exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency TEXT NOT NULL CHECK (from_currency IN ('rmb','lcoin')),
  to_currency TEXT NOT NULL CHECK (to_currency IN ('rmb','lcoin')),
  rate DECIMAL(10,4) NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_lcoin_exchange_rates_currency_pair ON lcoin_exchange_rates(from_currency, to_currency);
ALTER TABLE lcoin_exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "everyone_can_view_rates" ON lcoin_exchange_rates FOR SELECT TO anon, authenticated USING (is_active = TRUE);
CREATE POLICY "admins_can_manage_rates" ON lcoin_exchange_rates FOR ALL TO authenticated USING (true);

CREATE TABLE lcoin_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NULL,
  value_en TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lcoin_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "everyone_can_view_config" ON lcoin_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins_can_manage_config" ON lcoin_config FOR ALL TO authenticated USING (true);

INSERT INTO lcoin_config (key, value, value_en) VALUES ('recharge_description', '', '') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION get_user_lcoin_balance(p_user_id UUID)
RETURNS DECIMAL(18,2) AS $$
DECLARE
  v_balance DECIMAL(18,2);
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
  INTO v_balance
  FROM lcoin_transactions
  WHERE user_id = p_user_id AND transaction_status = 'completed';
  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_lcoin_balance(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION calculate_price(
  p_session_id UUID,
  p_ticket_type TEXT DEFAULT 'adult',
  p_quantity INT DEFAULT 1,
  p_user_id UUID DEFAULT NULL,
  p_operation_type TEXT DEFAULT 'purchase'
)
RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_base_price DECIMAL(18,2);
  v_service_fee DECIMAL(18,2);
  v_total_price DECIMAL(18,2);
  v_user_balance DECIMAL(18,2);
  v_deduct_amount DECIMAL(18,2);
  v_final_pay DECIMAL(18,2);
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found'); END IF;

  v_base_price := v_session.ticket_price;
  IF p_ticket_type = 'child' THEN
    v_base_price := COALESCE(v_session.child_price, v_session.ticket_price * 0.5);
  ELSIF p_ticket_type = 'concession' THEN
    v_base_price := COALESCE(v_session.concession_price, v_session.ticket_price * 0.8);
  ELSIF p_ticket_type = 'vip' THEN
    v_base_price := COALESCE(v_session.vip_price, v_session.ticket_price * 1.5);
  END IF;

  v_service_fee := COALESCE(v_session.default_service_fee, 0);
  v_total_price := (v_base_price + v_service_fee) * p_quantity;

  v_user_balance := 0;
  IF p_user_id IS NOT NULL THEN
    v_user_balance := get_user_lcoin_balance(p_user_id);
  END IF;

  v_deduct_amount := LEAST(v_user_balance, v_total_price);
  v_final_pay := v_total_price - v_deduct_amount;

  RETURN jsonb_build_object(
    'success', TRUE,
    'base_price', v_base_price,
    'service_fee', v_service_fee,
    'total_price', v_total_price,
    'user_balance', v_user_balance,
    'deduct_amount', v_deduct_amount,
    'final_pay', v_final_pay,
    'ticket_type', p_ticket_type,
    'quantity', p_quantity
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION calculate_price(UUID, TEXT, INT, UUID, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION create_lcoin_transaction(
  p_user_id UUID,
  p_transaction_type TEXT DEFAULT 'purchase',
  p_amount DECIMAL(18,2) DEFAULT 0,
  p_order_id UUID DEFAULT NULL,
  p_session_id UUID DEFAULT NULL,
  p_ticket_type TEXT DEFAULT NULL,
  p_seat_name TEXT DEFAULT NULL,
  p_service_fee_amount DECIMAL(18,2) DEFAULT 0,
  p_operator_type TEXT DEFAULT 'system',
  p_operator_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'lcoin'
)
RETURNS JSONB AS $$
DECLARE
  v_balance_before DECIMAL(18,2);
  v_balance_after DECIMAL(18,2);
  v_direction TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_amount');
  END IF;

  v_balance_before := get_user_lcoin_balance(p_user_id);

  IF p_transaction_type IN ('recharge', 'refund', 'adjust_add') THEN
    v_direction := 'in';
    v_balance_after := v_balance_before + p_amount;
  ELSE
    v_direction := 'out';
    IF v_balance_before < p_amount THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_balance', 'required', p_amount, 'available', v_balance_before);
    END IF;
    v_balance_after := v_balance_before - p_amount;
  END IF;

  INSERT INTO lcoin_transactions (
    user_id, order_id, session_id, transaction_type, direction,
    amount, balance_before, balance_after, ticket_type, seat_name,
    service_fee_amount, operator_type, operator_id, description,
    transaction_status, payment_method
  ) VALUES (
    p_user_id, p_order_id, p_session_id, p_transaction_type, v_direction,
    p_amount, v_balance_before, v_balance_after, p_ticket_type, p_seat_name,
    p_service_fee_amount, p_operator_type, p_operator_id, p_description,
    'completed', p_payment_method
  );

  UPDATE lcoin_accounts SET balance = v_balance_after, updated_at = NOW() WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO lcoin_accounts (user_id, balance, frozen_balance) VALUES (p_user_id, v_balance_after, 0);
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'balance_before', v_balance_before, 'balance_after', v_balance_after);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_lcoin_transaction(UUID, TEXT, DECIMAL, UUID, UUID, TEXT, TEXT, DECIMAL, TEXT, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_recharge_lcoin(
  p_user_id UUID,
  p_amount DECIMAL(18,2) DEFAULT 0,
  p_description TEXT DEFAULT '管理员充值'
)
RETURNS JSONB AS $$
DECLARE
  v_operator_id UUID;
BEGIN
  SELECT auth.uid() INTO v_operator_id;
  RETURN create_lcoin_transaction(
    p_user_id, 'recharge', p_amount, NULL, NULL,
    NULL, NULL, 0, 'admin', v_operator_id, p_description, 'lcoin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_recharge_lcoin(UUID, DECIMAL, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_adjust_lcoin(
  p_user_id UUID,
  p_amount DECIMAL(18,2) DEFAULT 0,
  p_is_add BOOLEAN DEFAULT TRUE,
  p_description TEXT DEFAULT '管理员调整'
)
RETURNS JSONB AS $$
DECLARE
  v_operator_id UUID;
  v_transaction_type TEXT;
BEGIN
  SELECT auth.uid() INTO v_operator_id;
  v_transaction_type := CASE WHEN p_is_add THEN 'adjust_add' ELSE 'adjust_subtract' END;
  RETURN create_lcoin_transaction(
    p_user_id, v_transaction_type, p_amount, NULL, NULL,
    NULL, NULL, 0, 'admin', v_operator_id, p_description, 'lcoin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_adjust_lcoin(UUID, DECIMAL, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION deduct_lcoin_for_purchase(
  p_user_id UUID,
  p_order_id UUID DEFAULT NULL,
  p_session_id UUID DEFAULT NULL,
  p_amount DECIMAL(18,2) DEFAULT 0,
  p_ticket_type TEXT DEFAULT NULL,
  p_seat_name TEXT DEFAULT NULL,
  p_service_fee_amount DECIMAL(18,2) DEFAULT 0
)
RETURNS JSONB AS $$
BEGIN
  RETURN create_lcoin_transaction(
    p_user_id, 'purchase', p_amount, p_order_id, p_session_id,
    p_ticket_type, p_seat_name, p_service_fee_amount,
    'user', p_user_id, '购票消费', 'lcoin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION deduct_lcoin_for_purchase(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, DECIMAL) TO authenticated;

CREATE OR REPLACE FUNCTION refund_lcoin_for_cancellation(
  p_user_id UUID,
  p_order_id UUID DEFAULT NULL,
  p_session_id UUID DEFAULT NULL,
  p_amount DECIMAL(18,2) DEFAULT 0,
  p_ticket_type TEXT DEFAULT NULL,
  p_seat_name TEXT DEFAULT NULL,
  p_service_fee_amount DECIMAL(18,2) DEFAULT 0
)
RETURNS JSONB AS $$
BEGIN
  RETURN create_lcoin_transaction(
    p_user_id, 'refund', p_amount, p_order_id, p_session_id,
    p_ticket_type, p_seat_name, p_service_fee_amount,
    'system', NULL, '退票退款', 'lcoin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refund_lcoin_for_cancellation(UUID, UUID, UUID, DECIMAL, TEXT, TEXT, DECIMAL) TO authenticated;

CREATE OR REPLACE FUNCTION get_lcoin_exchange_rate(p_from TEXT, p_to TEXT)
RETURNS DECIMAL(10,4) AS $$
DECLARE
  v_rate DECIMAL(10,4);
BEGIN
  SELECT rate INTO v_rate FROM lcoin_exchange_rates
  WHERE from_currency = p_from AND to_currency = p_to AND is_active = TRUE
  ORDER BY effective_date DESC LIMIT 1;
  RETURN COALESCE(v_rate, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_lcoin_exchange_rate(TEXT, TEXT) TO anon, authenticated;

INSERT INTO lcoin_exchange_rates (from_currency, to_currency, rate)
VALUES ('rmb', 'lcoin', 10), ('lcoin', 'rmb', 0.1)
ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate = EXCLUDED.rate;
