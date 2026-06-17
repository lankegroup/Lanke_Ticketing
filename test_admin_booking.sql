-- Get admin_book_ticket function definition
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'admin_book_ticket'
LIMIT 1;

-- Test admin_book_ticket directly
SELECT admin_book_ticket(
  (SELECT id FROM sessions WHERE is_active = true LIMIT 1),
  (SELECT id FROM seats WHERE is_blocked = false LIMIT 1),
  'Test Admin',
  '17870020667',
  (SELECT id FROM user_profiles LIMIT 1),
  false,
  'admin',
  false,
  'adult'
) as result;
