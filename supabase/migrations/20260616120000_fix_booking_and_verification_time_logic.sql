-- Migration: Fix booking and verification time logic
-- Adds verify_date and stop_selling_minutes to sessions table

-- 1. Add verify_date (verification date, precise to year-month-day)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS verify_date DATE;

-- 2. Add stop_selling_minutes (stop selling countdown in minutes)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stop_selling_minutes INTEGER DEFAULT 0;

-- 3. Backfill verify_date from session_date for existing rows
UPDATE sessions SET verify_date = session_date WHERE verify_date IS NULL;

-- 4. Make verify_date NOT NULL after backfill (since all rows are now populated)
ALTER TABLE sessions ALTER COLUMN verify_date SET NOT NULL;

-- 5. Create index for queries that filter by verify_date
CREATE INDEX IF NOT EXISTS idx_sessions_verify_date ON sessions(verify_date);
