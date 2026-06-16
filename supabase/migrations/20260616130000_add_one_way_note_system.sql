-- Migration: Add one-way note system to registrations
-- Note: Once created, notes are immutable (cannot be edited or deleted)

-- 1. Add note_content column
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS note_content TEXT;

-- 2. Add note_author enum ('user' or 'admin')
DO $$ BEGIN
  CREATE TYPE note_author_enum AS ENUM ('user', 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS note_author note_author_enum;

-- 3. Add is_note_read column (default false)
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS is_note_read BOOLEAN DEFAULT FALSE;

-- 4. Create index for efficient querying of unread notes
CREATE INDEX IF NOT EXISTS idx_registrations_is_note_read ON registrations(is_note_read) WHERE note_content IS NOT NULL;

-- 5. Add note status enum for customer center summary view
DO $$ BEGIN
  CREATE TYPE note_status_enum AS ENUM ('pending', 'completed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS note_status note_status_enum DEFAULT 'pending';
