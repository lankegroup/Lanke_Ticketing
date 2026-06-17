-- Step 1: Add missing columns first
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS buyer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS note_content TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS order_source TEXT DEFAULT 'user';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS was_force_booked BOOLEAN DEFAULT FALSE;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS is_supplementary BOOLEAN DEFAULT FALSE;
