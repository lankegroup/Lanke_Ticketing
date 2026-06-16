
-- Add ticket_price to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ticket_price NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Add service_fee, paid_at, printed_at to registrations
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS service_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;
