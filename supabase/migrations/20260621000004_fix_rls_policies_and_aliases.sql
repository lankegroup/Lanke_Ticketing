CREATE TABLE IF NOT EXISTS lcoin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(18,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lcoin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(18,4) NOT NULL,
  balance_before NUMERIC(18,4),
  balance_after NUMERIC(18,4),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  operator_type TEXT DEFAULT 'system',
  description TEXT,
  reference_id UUID,
  payment_method TEXT DEFAULT 'lcoin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lcoin_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price_rmb NUMERIC(10,2) NOT NULL,
  lcoin_amount NUMERIC(18,4) NOT NULL,
  bonus NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lcoin_exchange_rate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lcoin_to_rmb NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  rmb_to_lcoin NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registration_id UUID,
  action TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO lcoin_exchange_rate (lcoin_to_rmb, rmb_to_lcoin) SELECT 1.0, 1.0 WHERE NOT EXISTS (SELECT 1 FROM lcoin_exchange_rate);

ALTER TABLE IF EXISTS lcoin_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY lcoin_account_select_own ON lcoin_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY lcoin_account_select_admin ON lcoin_accounts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY lcoin_account_insert ON lcoin_accounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY lcoin_account_update ON lcoin_accounts FOR UPDATE TO authenticated WITH CHECK (true);

ALTER TABLE IF EXISTS lcoin_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lcoin_transaction_select_own ON lcoin_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY lcoin_transaction_select_admin ON lcoin_transactions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY lcoin_transaction_insert ON lcoin_transactions FOR INSERT TO authenticated WITH CHECK (true);

ALTER TABLE IF EXISTS lcoin_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY lcoin_package_select_all ON lcoin_packages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY lcoin_package_insert ON lcoin_packages FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY lcoin_package_update ON lcoin_packages FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY lcoin_package_delete ON lcoin_packages FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE IF EXISTS lcoin_exchange_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY lcoin_exchange_rate_select_all ON lcoin_exchange_rate FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY lcoin_exchange_rate_insert ON lcoin_exchange_rate FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY lcoin_exchange_rate_update ON lcoin_exchange_rate FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY lcoin_exchange_rate_delete ON lcoin_exchange_rate FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE IF EXISTS order_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_audit_select_admin ON order_audit_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY order_audit_insert_admin ON order_audit_logs FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_select_own ON notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY notification_insert_admin ON notifications FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE IF EXISTS seat_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY seat_lock_select_all ON seat_locks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY seat_lock_insert ON seat_locks FOR INSERT TO authenticated, anon WITH CHECK (true);
CREATE POLICY seat_lock_update ON seat_locks FOR UPDATE TO authenticated, anon WITH CHECK (true);
CREATE POLICY seat_lock_delete ON seat_locks FOR DELETE TO authenticated, anon USING (true);

ALTER TABLE IF EXISTS registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY registration_select_own ON registrations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY registration_select_admin ON registrations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE IF EXISTS sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_select_all ON sessions FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY seat_select_all ON seats FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE IF EXISTS admin_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_profile_select_own ON admin_profiles FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.cancel_ticket(p_registration_id UUID, p_user_id UUID DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN public.admin_cancel_registration(p_registration_id); END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
