-- Direct SELECT call to see the result as a row
SELECT book_ticket_with_seat(
  (SELECT id FROM sessions WHERE is_active = true LIMIT 1),
  (SELECT id FROM seats WHERE is_blocked = false LIMIT 1),
  'Test User',
  '13800138000',
  (SELECT id FROM user_profiles LIMIT 1),
  'adult',
  NULL,
  NULL
) as result;
