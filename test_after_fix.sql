-- Test booking after fix
SELECT book_ticket_with_seat(
  (SELECT id FROM sessions WHERE is_active = true LIMIT 1),
  (SELECT id FROM seats WHERE is_blocked = false LIMIT 1),
  'Test User',
  '17870020667',
  NULL,
  'adult',
  NULL,
  NULL
) as result;

-- Test admin booking
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
) as admin_result;
