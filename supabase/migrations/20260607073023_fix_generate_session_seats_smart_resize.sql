-- Drop old VOID-returning version, re-create with JSONB return
DROP FUNCTION IF EXISTS generate_session_seats(UUID, INT, INT);

CREATE OR REPLACE FUNCTION generate_session_seats(
  p_session_id    UUID,
  p_rows          INT,
  p_seats_per_row INT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r                 INT;
  c                 INT;
  row_letter        TEXT;
  seat_label        TEXT;
  v_cancelled_count INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Step 1: Count bookings on seats being removed (outside new bounds)
  SELECT COUNT(*) INTO v_cancelled_count
  FROM registrations reg
  JOIN seats s ON s.id = reg.seat_id
  WHERE s.session_id = p_session_id
    AND (s.row_index > p_rows OR s.col_index > p_seats_per_row)
    AND reg.status NOT IN ('cancelled', 'expired');

  IF v_cancelled_count > 0 THEN
    -- Cancel those registrations
    UPDATE registrations
    SET status = 'cancelled'
    WHERE seat_id IN (
      SELECT s.id FROM seats s
      WHERE s.session_id = p_session_id
        AND (s.row_index > p_rows OR s.col_index > p_seats_per_row)
    )
    AND status NOT IN ('cancelled', 'expired');

    -- Restore stock
    UPDATE sessions
    SET available_stock = available_stock + v_cancelled_count
    WHERE id = p_session_id;
  END IF;

  -- Step 2: Release any seat locks on removed seats then delete them
  DELETE FROM seat_locks
  WHERE seat_id IN (
    SELECT id FROM seats
    WHERE session_id = p_session_id
      AND (row_index > p_rows OR col_index > p_seats_per_row)
  );

  DELETE FROM seats
  WHERE session_id = p_session_id
    AND (row_index > p_rows OR col_index > p_seats_per_row);

  -- Step 3: Insert new seats (skip existing — preserves active bookings)
  FOR r IN 1..p_rows LOOP
    row_letter := CHR(64 + r);
    FOR c IN 1..p_seats_per_row LOOP
      seat_label := row_letter || '排' || c || '座';
      INSERT INTO seats (session_id, row_index, col_index, seat_name)
      VALUES (p_session_id, r, c, seat_label)
      ON CONFLICT (session_id, row_index, col_index) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_bookings', v_cancelled_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generate_session_seats(UUID, INT, INT) TO authenticated;
