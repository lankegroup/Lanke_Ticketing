-- Check table structures
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'seat_locks'
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'registrations'
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'sessions'
ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'seats'
ORDER BY ordinal_position;
