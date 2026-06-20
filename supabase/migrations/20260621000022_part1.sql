-- ============================================================
-- PART 1: TABLE STRUCTURE
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'lcoin_amount') THEN
    ALTER TABLE registrations ADD COLUMN lcoin_amount DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'cash_amount') THEN
    ALTER TABLE registrations ADD COLUMN cash_amount DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'payment_method') THEN
    ALTER TABLE registrations ADD COLUMN payment_method TEXT DEFAULT 'rmb';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'refund_penalty_applied') THEN
    ALTER TABLE registrations ADD COLUMN refund_penalty_applied DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'refunded_lcoin_amount') THEN
    ALTER TABLE registrations ADD COLUMN refunded_lcoin_amount DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'refunded_cash_amount') THEN
    ALTER TABLE registrations ADD COLUMN refunded_cash_amount DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'cancelled_at') THEN
    ALTER TABLE registrations ADD COLUMN cancelled_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'registrations' AND column_name = 'cancel_reason') THEN
    ALTER TABLE registrations ADD COLUMN cancel_reason TEXT DEFAULT NULL;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'refund_penalty_rules') THEN
    ALTER TABLE sessions ADD COLUMN refund_penalty_rules JSONB DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'stop_selling_minutes') THEN
    ALTER TABLE sessions ADD COLUMN stop_selling_minutes INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lcoin_exchange_rates') THEN
    CREATE TABLE lcoin_exchange_rates (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate DECIMAL(18,4) NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT true,
      effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO lcoin_exchange_rates (from_currency, to_currency, rate, is_active, effective_date)
    VALUES ('lcoin', 'rmb', 1, true, CURRENT_DATE) ON CONFLICT DO NOTHING;
  END IF;
END $$;

UPDATE sessions 
SET refund_penalty_rules = '[{"hours_before": 24, "penalty_rate": 0, "description": "开场前24小时以上，全额退款"}, {"hours_before": 6, "penalty_rate": 0.1, "description": "开场前6-24小时，扣除10%"}, {"hours_before": 2, "penalty_rate": 0.3, "description": "开场前2-6小时，扣除30%"}, {"hours_before": 0, "penalty_rate": 1.0, "description": "开场后/过期，扣除100%"}]'::jsonb
WHERE refund_penalty_rules IS NULL;