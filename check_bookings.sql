-- Check if any bookings were created
SELECT 
  r.id, 
  r.name, 
  r.phone, 
  r.ticket_code, 
  r.status,
  r.ticket_type,
  r.order_source,
  r.created_at,
  s.name as session_name
FROM registrations r
LEFT JOIN sessions s ON s.id = r.session_id
ORDER BY r.created_at DESC
LIMIT 10;

-- Also check current stock
SELECT id, name, capacity, available_stock 
FROM sessions 
ORDER BY created_at DESC 
LIMIT 5;
