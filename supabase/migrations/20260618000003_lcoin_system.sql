CREATE TABLE IF NOT EXISTS user_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  balance DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_balance" ON user_balances FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "admins_select_all_balances" ON user_balances FOR SELECT
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS balance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('recharge', 'purchase', 'refund', 'admin_adjust')),
  amount DECIMAL(18,2) NOT NULL,
  balance_before DECIMAL(18,2) NOT NULL,
  balance_after DECIMAL(18,2) NOT NULL,
  description TEXT,
  reference_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE balance_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_transactions" ON balance_transactions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "admins_select_all_transactions" ON balance_transactions FOR SELECT
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS recharge_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_image TEXT,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recharge_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_select_recharge_settings" ON recharge_settings FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "admins_update_recharge_settings" ON recharge_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION get_user_balance(p_user_id UUID)
RETURNS DECIMAL(18,2) AS $$
DECLARE
  bal DECIMAL(18,2);
BEGIN
  SELECT COALESCE(balance, 0) INTO bal FROM user_balances WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO user_balances (user_id, balance) VALUES (p_user_id, 0);
    RETURN 0;
  END IF;
  RETURN bal;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_recharge_lcoin(p_user_id UUID, p_amount DECIMAL(18,2), p_description TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  current_bal DECIMAL(18,2);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION '金额必须大于0';
  END IF;

  SELECT balance INTO current_bal FROM user_balances WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO user_balances (user_id, balance) VALUES (p_user_id, 0);
    current_bal := 0;
  END IF;

  UPDATE user_balances SET balance = current_bal + p_amount, updated_at = NOW() WHERE user_id = p_user_id;

  INSERT INTO balance_transactions (
    user_id, transaction_type, amount, balance_before, balance_after, description
  ) VALUES (
    p_user_id, 'recharge', p_amount, current_bal, current_bal + p_amount,
    COALESCE(p_description, '管理员充值')
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION deduct_lcoin(p_user_id UUID, p_amount DECIMAL(18,2), p_description TEXT, p_reference_id TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  current_bal DECIMAL(18,2);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION '金额必须大于0';
  END IF;

  SELECT balance INTO current_bal FROM user_balances WHERE user_id = p_user_id;
  IF NOT FOUND OR current_bal < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE user_balances SET balance = current_bal - p_amount, updated_at = NOW() WHERE user_id = p_user_id;

  INSERT INTO balance_transactions (
    user_id, transaction_type, amount, balance_before, balance_after, description, reference_id
  ) VALUES (
    p_user_id, 'purchase', p_amount, current_bal, current_bal - p_amount,
    COALESCE(p_description, '购票消费'), p_reference_id
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION refund_lcoin(p_user_id UUID, p_amount DECIMAL(18,2), p_description TEXT, p_reference_id TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  current_bal DECIMAL(18,2);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION '金额必须大于0';
  END IF;

  SELECT balance INTO current_bal FROM user_balances WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO user_balances (user_id, balance) VALUES (p_user_id, 0);
    current_bal := 0;
  END IF;

  UPDATE user_balances SET balance = current_bal + p_amount, updated_at = NOW() WHERE user_id = p_user_id;

  INSERT INTO balance_transactions (
    user_id, transaction_type, amount, balance_before, balance_after, description, reference_id
  ) VALUES (
    p_user_id, 'refund', p_amount, current_bal, current_bal + p_amount,
    COALESCE(p_description, '退款'), p_reference_id
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_transactions(p_user_id UUID, p_limit INT DEFAULT 20, p_offset INT DEFAULT 0)
RETURNS SETOF balance_transactions AS $$
BEGIN
  RETURN QUERY SELECT * FROM balance_transactions
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

INSERT INTO recharge_settings (banner_image, description) VALUES (
  NULL,
  '如需充值兰克币，请联系客服确认'
) ON CONFLICT DO NOTHING;

GRANT EXECUTE ON FUNCTION get_user_balance(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_recharge_lcoin(UUID, DECIMAL(18,2), TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_lcoin(UUID, DECIMAL(18,2), TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_lcoin(UUID, DECIMAL(18,2), TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_transactions(UUID, INT, INT) TO authenticated;
