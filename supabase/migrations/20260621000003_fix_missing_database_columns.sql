-- ============================================================
-- 修复数据库中所有可能缺失的字段和表
-- 请在 Supabase SQL 编辑器中执行此文件
-- ============================================================

-- ── 1. registrations 表缺失字段 ─────────────────────────────
DO $$
BEGIN
  -- ticket_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'ticket_type') THEN
    ALTER TABLE registrations ADD COLUMN ticket_type TEXT DEFAULT 'adult';
  END IF;

  -- order_source
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'order_source') THEN
    ALTER TABLE registrations ADD COLUMN order_source TEXT NOT NULL DEFAULT 'user';
  END IF;

  -- was_force_booked
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'was_force_booked') THEN
    ALTER TABLE registrations ADD COLUMN was_force_booked BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- reschedule_count
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'reschedule_count') THEN
    ALTER TABLE registrations ADD COLUMN reschedule_count INT NOT NULL DEFAULT 0;
  END IF;

  -- reschedule_history
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'reschedule_history') THEN
    ALTER TABLE registrations ADD COLUMN reschedule_history JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  -- note_content
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'note_content') THEN
    ALTER TABLE registrations ADD COLUMN note_content TEXT;
  END IF;

  -- note_author (enum type may not exist yet, use TEXT as fallback)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'note_author') THEN
    ALTER TABLE registrations ADD COLUMN note_author TEXT;
  END IF;

  -- is_note_read
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'is_note_read') THEN
    ALTER TABLE registrations ADD COLUMN is_note_read BOOLEAN DEFAULT FALSE;
  END IF;

  -- note_status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'note_status') THEN
    ALTER TABLE registrations ADD COLUMN note_status TEXT DEFAULT 'pending';
  END IF;

  -- deleted_at (soft delete)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'deleted_at') THEN
    ALTER TABLE registrations ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;

  -- is_supplementary
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'is_supplementary') THEN
    ALTER TABLE registrations ADD COLUMN is_supplementary BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- print_count
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'print_count') THEN
    ALTER TABLE registrations ADD COLUMN print_count INT NOT NULL DEFAULT 0;
  END IF;

  -- validated_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'validated_at') THEN
    ALTER TABLE registrations ADD COLUMN validated_at TIMESTAMPTZ;
  END IF;
END;
$$;

-- ── 2. seat_locks 表缺失字段 ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'seat_locks' AND column_name = 'locked_at') THEN
    ALTER TABLE seat_locks ADD COLUMN locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END;
$$;

-- ── 3. sessions 表缺失字段 ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'child_price') THEN
    ALTER TABLE sessions ADD COLUMN child_price DECIMAL(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'concession_price') THEN
    ALTER TABLE sessions ADD COLUMN concession_price DECIMAL(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'vip_price') THEN
    ALTER TABLE sessions ADD COLUMN vip_price DECIMAL(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'default_service_fee') THEN
    ALTER TABLE sessions ADD COLUMN default_service_fee DECIMAL(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'has_seating_chart') THEN
    ALTER TABLE sessions ADD COLUMN has_seating_chart BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'seat_rows') THEN
    ALTER TABLE sessions ADD COLUMN seat_rows INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'seats_per_row') THEN
    ALTER TABLE sessions ADD COLUMN seats_per_row INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'screen_direction') THEN
    ALTER TABLE sessions ADD COLUMN screen_direction TEXT NOT NULL DEFAULT 'top';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'available_stock') THEN
    ALTER TABLE sessions ADD COLUMN available_stock INTEGER;
  END IF;
END;
$$;

-- ── 4. 缺失的表 ─────────────────────────────────────────────

-- order_audit_logs
CREATE TABLE IF NOT EXISTS order_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registration_id UUID,
  action          TEXT NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- chat_conversations (if missing fields, fix them)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_conversations' AND column_name = 'user_unread') THEN
    ALTER TABLE chat_conversations ADD COLUMN user_unread INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_conversations' AND column_name = 'admin_unread') THEN
    ALTER TABLE chat_conversations ADD COLUMN admin_unread INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_conversations' AND column_name = 'last_message_at') THEN
    ALTER TABLE chat_conversations ADD COLUMN last_message_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_conversations' AND column_name = 'is_blocked') THEN
    ALTER TABLE chat_conversations ADD COLUMN is_blocked BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END;
$$;

-- ── 5. lcoin 相关表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lcoin_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance        NUMERIC(18,4) NOT NULL DEFAULT 0,
  frozen_balance NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_vip         BOOLEAN NOT NULL DEFAULT FALSE,
  vip_expire_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
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

-- lcoin_packages
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

-- lcoin_exchange_rate
CREATE TABLE IF NOT EXISTS lcoin_exchange_rate (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lcoin_to_rmb  NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  rmb_to_lcoin  NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default exchange rate if not exists
INSERT INTO lcoin_exchange_rate (lcoin_to_rmb, rmb_to_lcoin)
SELECT 1.0, 1.0
WHERE NOT EXISTS (SELECT 1 FROM lcoin_exchange_rate);

-- ── 6. 确保座位表外键存在 ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'seat_id') THEN
    ALTER TABLE registrations ADD COLUMN seat_id UUID REFERENCES seats(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- ── 7. 重建 get_seat_map 函数（使用现有表结构）─────────────
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
         AND r.deleted_at IS NULL
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

NOTIFY pgrst, 'reload schema';
