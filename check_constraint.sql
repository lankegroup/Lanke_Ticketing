-- Check ticket_type constraint
SELECT tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'registrations' AND tc.constraint_type = 'CHECK';

-- Check if ticket_type is an enum
SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname LIKE '%ticket%';

-- Check column type
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'registrations' AND column_name = 'ticket_type';
