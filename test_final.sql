-- Test booking after fixing ticket_type constraint
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

-- Verify the booking was created
SELECT id, name, phone, ticket_code, status, ticket_type, order_source 
FROM registrations 
ORDER BY created_at DESC 
LIMIT 5;
