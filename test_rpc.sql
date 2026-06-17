-- Test the book_ticket_with_seat RPC directly
-- Replace these with actual values from your database

-- First, get a real session_id
SELECT id, name, capacity, available_stock, is_active 
FROM sessions 
WHERE is_active = true 
LIMIT 5;

-- Get a real seat_id for that session
SELECT id, session_id, row_index, col_index, seat_name, is_blocked
FROM seats
WHERE is_blocked = false
LIMIT 5;
