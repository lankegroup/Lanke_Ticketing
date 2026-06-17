-- ============================================================
-- PATCH: Add missing columns to sessions table
-- Run this in Supabase SQL Editor if you got errors like:
--   "Could not find the 'stage_center_col' column of 'sessions' in the schema cache"
--   "Could not find the 'ticket_price' column of 'sessions' in the schema cache"
-- ============================================================

-- 1. Add stage_center_col if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'stage_center_col'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN stage_center_col NUMERIC DEFAULT NULL;
    COMMENT ON COLUMN public.sessions.stage_center_col IS 'Column number where the stage center aligns (1-based). NULL means auto-center.';
  END IF;
END $$;

-- 2. Add ticket_price if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'ticket_price'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN ticket_price DECIMAL(10,2) DEFAULT 0;
    COMMENT ON COLUMN public.sessions.ticket_price IS 'Default ticket price in CNY.';
  END IF;
END $$;

-- 3. Add default_service_fee if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'default_service_fee'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN default_service_fee DECIMAL(10,2) DEFAULT 0;
    COMMENT ON COLUMN public.sessions.default_service_fee IS 'Default service fee in CNY.';
  END IF;
END $$;

-- 4. Add booking_notice if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'booking_notice'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN booking_notice TEXT;
    COMMENT ON COLUMN public.sessions.booking_notice IS 'HTML booking notice displayed to clients before purchase.';
  END IF;
END $$;

-- 5. Add stop_selling_minutes if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'stop_selling_minutes'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN stop_selling_minutes INTEGER DEFAULT 0;
    COMMENT ON COLUMN public.sessions.stop_selling_minutes IS 'Minutes before verification end to stop selling.';
  END IF;
END $$;

-- 6. Add screen_direction if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'screen_direction'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN screen_direction TEXT NOT NULL DEFAULT 'top';
    COMMENT ON COLUMN public.sessions.screen_direction IS 'Screen/stage position: top, bottom, left, or right.';
  END IF;
END $$;

-- 7. Add has_seating_chart if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'has_seating_chart'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN has_seating_chart BOOLEAN NOT NULL DEFAULT FALSE;
    COMMENT ON COLUMN public.sessions.has_seating_chart IS 'Whether this session has a seating chart.';
  END IF;
END $$;

-- 8. Add cover_image if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'cover_image'
  ) THEN
    ALTER TABLE public.sessions ADD COLUMN cover_image TEXT;
    COMMENT ON COLUMN public.sessions.cover_image IS 'Cover image URL.';
  END IF;
END $$;

-- 9. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

-- 10. Verify all columns now exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sessions'
ORDER BY ordinal_position;

