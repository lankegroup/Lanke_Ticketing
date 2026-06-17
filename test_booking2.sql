-- Test booking - return result as query output
DO $$
DECLARE
  v_session_id UUID;
  v_seat_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_session_id FROM sessions WHERE is_active = true LIMIT 1;
  SELECT id INTO v_seat_id FROM seats WHERE session_id = v_session_id AND is_blocked = false LIMIT 1;
  SELECT id INTO v_user_id FROM user_profiles LIMIT 1;
  
  -- Output the IDs
  RAISE NOTICE 'Session: %, Seat: %, User: %', v_session_id, v_seat_id, v_user_id;
  
  -- Test call
  v_result := book_ticket_with_seat(
    v_session_id, v_seat_id, 'Test', '13800138000', v_user_id, 'adult', NULL, NULL
  );
  
  -- Output the JSON result using RAISE NOTICE
  RAISE NOTICE 'RESULT: %', v_result::text;
END $$;

-- Also test the function definition
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'book_ticket_with_seat'
LIMIT 1;
