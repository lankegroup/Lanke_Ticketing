-- Test booking directly with real data
-- This simulates what book-ticket Edge Function does

-- Get a real session
DO $$
DECLARE
  v_session_id UUID;
  v_seat_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- Get first active session
  SELECT id INTO v_session_id FROM sessions WHERE is_active = true LIMIT 1;
  RAISE NOTICE 'Session ID: %', v_session_id;

  -- Get first available seat
  SELECT id INTO v_seat_id FROM seats 
  WHERE session_id = v_session_id AND is_blocked = false
  LIMIT 1;
  RAISE NOTICE 'Seat ID: %', v_seat_id;

  -- Get a user
  SELECT id INTO v_user_id FROM user_profiles LIMIT 1;
  RAISE NOTICE 'User ID: %', v_user_id;

  -- Test the booking
  SELECT book_ticket_with_seat(
    v_session_id,
    v_seat_id,
    'Test User',
    '13800138000',
    v_user_id,
    'adult',
    NULL,
    NULL
  ) INTO v_result;
  
  RAISE NOTICE 'Booking Result: %', v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'ERROR: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END $$;
