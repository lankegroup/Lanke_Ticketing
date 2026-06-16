-- Fix search_path for functions to prevent variability warnings
-- SET search_path = 'public' prevents functions from having variable search_path

-- Fix get_seat_map function
DROP FUNCTION IF EXISTS get_seat_map(UUID);

CREATE OR REPLACE FUNCTION get_seat_map(p_session_id UUID)
RETURNS TABLE (
  id           UUID,
  row_index    INT,
  col_index    INT,
  seat_name    TEXT,
  is_booked    BOOLEAN,
  is_locked    BOOLEAN,
  locked_by_me BOOLEAN,
  is_blocked   BOOLEAN,
  block_reason TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.row_index,
    s.col_index,
    s.seat_name,
    EXISTS(
      SELECT 1 FROM registrations r
      WHERE r.seat_id = s.id
      AND r.status NOT IN ('cancelled', 'expired')
      AND r.deleted_at IS NULL
    ) AS is_booked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id AND sl.expires_at > NOW()
    ) AS is_locked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id
      AND sl.expires_at > NOW()
      AND sl.user_id = auth.uid()
    ) AS locked_by_me,
    s.is_blocked,
    s.block_reason
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

-- Fix book_ticket_with_seat function
DROP FUNCTION IF EXISTS book_ticket_with_seat(UUID, UUID, UUID, INT);

CREATE OR REPLACE FUNCTION book_ticket_with_seat(
  p_user_id UUID,
  p_session_id UUID,
  p_seat_id UUID,
  p_quantity INT DEFAULT 1
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  registration_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_registration_id UUID;
  v_seat_blocked BOOLEAN;
  v_seat_booked BOOLEAN;
BEGIN
  SELECT s.is_blocked INTO v_seat_blocked FROM seats s WHERE s.id = p_seat_id;

  IF v_seat_blocked THEN
    RETURN QUERY SELECT false, 'Seat is blocked', NULL::UUID;
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM registrations r
    WHERE r.seat_id = p_seat_id
    AND r.status NOT IN ('cancelled', 'expired')
    AND r.deleted_at IS NULL
  ) INTO v_seat_booked;

  IF v_seat_booked THEN
    RETURN QUERY SELECT false, 'Seat already booked', NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO registrations (user_id, session_id, seat_id, status, created_at)
  VALUES (p_user_id, p_session_id, p_seat_id, 'active', NOW())
  RETURNING registrations.id INTO v_registration_id;

  RETURN QUERY SELECT true, 'Booking successful', v_registration_id;
END;
$$;

-- Fix admin_bulk_block_seats function
DROP FUNCTION IF EXISTS admin_bulk_block_seats(UUID[], TEXT);

CREATE OR REPLACE FUNCTION admin_bulk_block_seats(
  p_seat_ids UUID[],
  p_block_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  blocked_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_blocked_count INT := 0;
  v_seat_id UUID;
BEGIN
  FOREACH v_seat_id IN ARRAY p_seat_ids
  LOOP
    UPDATE seats SET is_blocked = true, block_reason = p_block_reason WHERE id = v_seat_id;
  END LOOP;

  SELECT COUNT(*) INTO v_blocked_count FROM seats WHERE id = ANY(p_seat_ids) AND is_blocked = true;

  RETURN QUERY SELECT true, 'Seats blocked successfully', v_blocked_count;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_block_seats(UUID[], TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_bulk_block_seats(UUID[], TEXT) FROM public;
