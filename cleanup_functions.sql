-- ============================================================
-- CLEANUP DUPLICATE FUNCTIONS - Drop ALL versions, keep only correct ones
-- ============================================================

-- First, let's see ALL function signatures
SELECT proname, pg_get_function_identity_arguments(oid) as args
FROM pg_proc 
WHERE proname IN ('book_ticket_with_seat', 'book_ticket', 'admin_book_ticket', 'get_seat_map', 'lock_seat', 'unlock_seat', 'admin_bulk_block_seats');

-- ------------------------------------------------------------
-- Drop EVERY version of these functions (by name only)
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop all versions of book_ticket_with_seat
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'book_ticket_with_seat' LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.oid::regprocedure);
  END LOOP;

  -- Drop all versions of book_ticket
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'book_ticket' LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.oid::regprocedure);
  END LOOP;

  -- Drop all versions of admin_book_ticket
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'admin_book_ticket' LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.oid::regprocedure);
  END LOOP;

  -- Drop all versions of get_seat_map
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'get_seat_map' LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.oid::regprocedure);
  END LOOP;

  -- Drop all versions of lock_seat
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'lock_seat' LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.oid::regprocedure);
  END LOOP;

  -- Drop all versions of unlock_seat
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'unlock_seat' LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.oid::regprocedure);
  END LOOP;

  -- Drop all versions of admin_bulk_block_seats
  FOR r IN SELECT oid FROM pg_proc WHERE proname = 'admin_bulk_block_seats' LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.oid::regprocedure);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Verify all dropped
-- ------------------------------------------------------------
SELECT proname FROM pg_proc WHERE proname IN ('book_ticket_with_seat', 'book_ticket', 'admin_book_ticket', 'get_seat_map', 'lock_seat', 'unlock_seat', 'admin_bulk_block_seats');
