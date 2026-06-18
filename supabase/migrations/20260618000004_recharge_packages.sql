CREATE TABLE IF NOT EXISTS recharge_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  lcoin_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recharge_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_packages" ON recharge_packages FOR ALL TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS lcoin_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE lcoin_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_config" ON lcoin_config FOR ALL TO authenticated USING (true);

INSERT INTO lcoin_config (key, value) VALUES ('recharge_description', '') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION get_recharge_packages()
RETURNS TABLE (id UUID, name TEXT, price DECIMAL(10,2), lcoin_amount DECIMAL(18,2), description TEXT) AS \$\$
BEGIN
  RETURN QUERY SELECT id, name, price, lcoin_amount, description FROM recharge_packages WHERE is_active = TRUE ORDER BY sort_order;
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_lcoin_config(p_key TEXT)
RETURNS TEXT AS \$\$
DECLARE
  val TEXT;
BEGIN
  SELECT value INTO val FROM lcoin_config WHERE key = p_key;
  RETURN COALESCE(val, '');
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_lcoin_config(p_key TEXT, p_value TEXT)
RETURNS BOOLEAN AS \$\$
BEGIN
  INSERT INTO lcoin_config (key, value) VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = p_value, updated_at = NOW();
  RETURN TRUE;
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_recharge_packages() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_lcoin_config(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_lcoin_config(TEXT, TEXT) TO authenticated;
