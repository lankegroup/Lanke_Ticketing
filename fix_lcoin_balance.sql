-- ============================================================
-- 紧急修复：兰克币余额计算错误
-- 根因：get_user_lcoin_balance 函数使用了错误的字段判断
--       使用 transaction_type = 'deposit'（不存在）代替了 direction = 'in'
-- ============================================================

-- 1. 修复 get_user_lcoin_balance 函数（使用正确的 direction 字段）
CREATE OR REPLACE FUNCTION public.get_user_lcoin_balance(p_user_id UUID)
RETURNS DECIMAL(18,2)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance DECIMAL(18,2);
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
  INTO v_balance
  FROM lcoin_transactions
  WHERE user_id = p_user_id AND transaction_status = 'completed';
  RETURN COALESCE(v_balance, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_lcoin_balance(UUID) TO service_role, authenticated, anon;

-- 2. 同步更新 lcoin_accounts 表的余额
-- 将所有用户的账户余额与交易记录重新对齐
UPDATE lcoin_accounts la
SET balance = get_user_lcoin_balance(la.user_id),
    updated_at = NOW();

-- 3. 强制刷新 schema
NOTIFY pgrst, 'reload schema';

-- 4. 输出验证结果（显示前5个用户的余额）
SELECT 
  up.display_name, 
  up.phone, 
  get_user_lcoin_balance(up.id) AS correct_balance
FROM user_profiles up
LIMIT 5;

SELECT 'Lcoin balance calculation fixed!' AS status;