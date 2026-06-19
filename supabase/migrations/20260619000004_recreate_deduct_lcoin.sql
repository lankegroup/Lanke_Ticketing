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

GRANT EXECUTE ON FUNCTION deduct_lcoin(UUID, DECIMAL(18,2), TEXT, TEXT) TO authenticated;
