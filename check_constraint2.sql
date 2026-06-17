-- Find the check constraint definition
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = 'registrations')
  AND contype = 'c';

-- Also check pg_indexes for any index constraints
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'registrations';
