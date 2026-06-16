-- Drop all overloaded variants of the three functions to eliminate stale definitions

DROP FUNCTION IF EXISTS public.admin_bulk_block_seats(uuid[], text);
DROP FUNCTION IF EXISTS public.admin_bulk_block_seats(uuid[], boolean);
DROP FUNCTION IF EXISTS public.admin_bulk_block_seats(uuid[], boolean, text);

DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid, uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.book_ticket_with_seat(uuid, uuid, uuid, integer);

-- Recreate admin_bulk_block_seats as SECURITY INVOKER with fixed search_path
-- Relies on RLS on the seats table to restrict access to admins only
CREATE OR REPLACE FUNCTION public.admin_bulk_block_seats(
  p_seat_ids UUID[],
  p_block    BOOLEAN,
  p_reason   TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, blocked_count INT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE seats
  SET is_blocked = p_block,
      block_reason = CASE WHEN p_block THEN p_reason ELSE NULL END
  WHERE id = ANY(p_seat_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT true, v_count;
END;
$$;

-- Revoke broad execute; only service_role (admin edge functions) needs it
REVOKE EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) TO authenticated;

-- Recreate book_ticket_with_seat with fixed search_path (SECURITY INVOKER, single canonical signature)
CREATE OR REPLACE FUNCTION public.book_ticket_with_seat(
  p_user_id    UUID,
  p_session_id UUID,
  p_seat_id    UUID,
  p_quantity   INT DEFAULT 1
)
RETURNS TABLE (success BOOLEAN, message TEXT, registration_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_registration_id UUID;
BEGIN
  IF p_quantity != 1 THEN
    RETURN QUERY SELECT false, 'Seat booking supports quantity 1 only', NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked
  ) THEN
    RETURN QUERY SELECT false, 'Seat is blocked', NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
  ) THEN
    RETURN QUERY SELECT false, 'Seat already booked', NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO registrations (user_id, session_id, seat_id, status, created_at)
  VALUES (p_user_id, p_session_id, p_seat_id, 'active', NOW())
  RETURNING registrations.id INTO v_registration_id;

  RETURN QUERY SELECT true, 'Booking successful', v_registration_id;
END;
$$;

-- Ensure proper execute grants on book_ticket_with_seat
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, uuid, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.book_ticket_with_seat(uuid, uuid, uuid, integer) TO authenticated;
