
-- Recreate get_seat_map to include block_reason
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
