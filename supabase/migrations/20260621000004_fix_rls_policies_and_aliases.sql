-- ============================================================
-- 修复 RLS 策略和函数别名
-- 请在 Supabase SQL 编辑器中执行此文件
-- ============================================================

-- 先创建所有可能缺失的表
CREATE TABLE IF NOT EXISTS lcoin_accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lcoin_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount          NUMERIC(18,4) NOT NULL,
  balance_before  NUMERIC(18,4),
  balance_after   NUMERIC(18,4),
  session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,
  operator_type   TEXT DEFAULT 'system',
  description     TEXT,
  reference_id    UUID,
  payment_method  TEXT DEFAULT 'lcoin',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lcoin_packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  price_rmb   NUMERIC(10,2) NOT NULL,
  lcoin_amount NUMERIC(18,4) NOT NULL,
  bonus       NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lcoin_exchange_rate (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lcoin_to_rmb  NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  rmb_to_lcoin  NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registration_id UUID,
  action          TEXT NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_profiles (
  id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO lcoin_exchange_rate (lcoin_to_rmb, rmb_to_lcoin)
SELECT 1.0, 1.0
WHERE NOT EXISTS (SELECT 1 FROM lcoin_exchange_rate);

-- ── 1. lcoin_accounts RLS 策略 ──────────────────────────────
ALTER TABLE IF EXISTS lcoin_accounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "lcoin_account_select_own" ON lcoin_accounts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "lcoin_account_select_admin" ON lcoin_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE OR REPLACE POLICY "lcoin_account_insert_system" ON lcoin_accounts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 2. lcoin_transactions RLS 策略 ──────────────────────────
ALTER TABLE IF EXISTS lcoin_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "lcoin_transaction_select_own" ON lcoin_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "lcoin_transaction_select_admin" ON lcoin_transactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 3. lcoin_packages RLS 策略 ──────────────────────────────
ALTER TABLE IF EXISTS lcoin_packages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "lcoin_package_select_all" ON lcoin_packages
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE OR REPLACE POLICY "lcoin_package_admin_only" ON lcoin_packages
  FOR INSERT, UPDATE, DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 4. lcoin_exchange_rate RLS 策略 ─────────────────────────
ALTER TABLE IF EXISTS lcoin_exchange_rate ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "lcoin_exchange_rate_select_all" ON lcoin_exchange_rate
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE OR REPLACE POLICY "lcoin_exchange_rate_admin_only" ON lcoin_exchange_rate
  FOR INSERT, UPDATE, DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 5. order_audit_logs RLS 策略 ────────────────────────────
ALTER TABLE IF EXISTS order_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "order_audit_select_admin" ON order_audit_logs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE OR REPLACE POLICY "order_audit_insert_admin" ON order_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 6. notifications RLS 策略 ────────────────────────────────
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "notification_select_own" ON notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "notification_insert_admin" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 7. seat_locks RLS 策略（如果之前未设置）───────────────────
ALTER TABLE IF EXISTS seat_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "seat_lock_select_all" ON seat_locks
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE OR REPLACE POLICY "seat_lock_insert_update_delete" ON seat_locks
  FOR INSERT, UPDATE, DELETE TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 8. feedback_tickets RLS 策略 ────────────────────────────
ALTER TABLE IF EXISTS feedback_tickets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "feedback_ticket_select_admin" ON feedback_tickets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 9. registrations RLS 策略（确保存在）──────────────────────
ALTER TABLE IF EXISTS registrations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "registration_select_own" ON registrations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "registration_select_admin" ON registrations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 10. sessions RLS 策略 ────────────────────────────────────
ALTER TABLE IF EXISTS sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "session_select_all" ON sessions
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE OR REPLACE POLICY "session_admin_only" ON sessions
  FOR INSERT, UPDATE, DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 11. seats RLS 策略 ──────────────────────────────────────
ALTER TABLE IF EXISTS seats ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "seat_select_all" ON seats
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE OR REPLACE POLICY "seat_admin_only" ON seats
  FOR INSERT, UPDATE, DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 12. chat_conversations RLS 策略 ─────────────────────────
ALTER TABLE IF EXISTS chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "chat_conv_select_own" ON chat_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE POLICY "chat_conv_select_admin" ON chat_conversations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 13. chat_messages RLS 策略 ──────────────────────────────
ALTER TABLE IF EXISTS chat_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "chat_msg_select_own" ON chat_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = sender_id);

CREATE OR REPLACE POLICY "chat_msg_select_admin" ON chat_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ── 14. 函数别名 cancel_ticket（兼容旧代码）─────────────────
CREATE OR REPLACE FUNCTION public.cancel_ticket(p_registration_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.admin_cancel_registration(p_registration_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, UUID) TO authenticated;

-- ── 15. admin_profiles RLS 策略 ──────────────────────────────
ALTER TABLE IF EXISTS admin_profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE POLICY "admin_profile_select_own" ON admin_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- ── 16. 确保 seat_locks 表支持匿名用户操作（锁座需要）─────────
CREATE OR REPLACE POLICY "seat_lock_select_anon" ON seat_locks
  FOR SELECT TO anon
  USING (true);

CREATE OR REPLACE POLICY "seat_lock_insert_anon" ON seat_locks
  FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);

-- ── 17. 修复 lock_seat 函数（允许匿名用户调用）───────────────
DROP FUNCTION IF EXISTS public.lock_seat(uuid,uuid,timestamptz);

CREATE OR REPLACE FUNCTION public.lock_seat(
  p_seat_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
BEGIN
  SELECT user_id INTO v_existing FROM seat_locks WHERE seat_id = p_seat_id;
  IF v_existing IS NOT NULL AND v_existing <> COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'::UUID) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_locked');
  END IF;

  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'::UUID), COALESCE(p_expires_at, NOW() + INTERVAL '5 minutes'))
  ON CONFLICT (seat_id) DO UPDATE SET
    user_id = COALESCE(EXCLUDED.user_id, '00000000-0000-0000-0000-000000000000'::UUID),
    expires_at = EXCLUDED.expires_at,
    locked_at = NOW();

  RETURN jsonb_build_object('success', true, 'expires_at', COALESCE(p_expires_at, NOW() + INTERVAL '5 minutes'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID, UUID, TIMESTAMPTZ) TO anon;

-- ── 18. 修复 unlock_seat 函数（允许匿名用户调用）─────────────
DROP FUNCTION IF EXISTS public.unlock_seat(uuid);

CREATE OR REPLACE FUNCTION public.unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID) TO anon;

-- ── 19. 修复 get_seat_map 函数（允许匿名用户调用）────────────
DROP FUNCTION IF EXISTS public.get_seat_map(uuid);

CREATE OR REPLACE FUNCTION public.get_seat_map(p_session_id UUID)
RETURNS TABLE (
  id UUID,
  session_id UUID,
  row_index INT,
  col_index INT,
  seat_name TEXT,
  is_blocked BOOLEAN,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.session_id,
    s.row_index,
    s.col_index,
    s.seat_name,
    s.is_blocked,
    COALESCE(
      (SELECT r.status::TEXT FROM registrations r
       WHERE r.seat_id = s.id
         AND r.status NOT IN ('cancelled', 'expired')
       LIMIT 1),
      'available'
    ) AS status
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID) TO anon;

NOTIFY pgrst, 'reload schema';
