-- Fix: Drop and recreate ticket_type check constraint to include all valid types
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_ticket_type_check;
ALTER TABLE registrations ADD CONSTRAINT registrations_ticket_type_check CHECK (
  ticket_type = ANY (ARRAY['regular'::text, 'vip'::text, 'student'::text, 'adult'::text, 'child'::text, 'concession'::text])
);

-- Verify
SELECT conname, pg_get_constraintdef(c.oid) AS constraint_def
FROM pg_constraint c
WHERE c.conrelid = (SELECT oid FROM pg_class WHERE relname = 'registrations')
  AND c.conname = 'registrations_ticket_type_check';
