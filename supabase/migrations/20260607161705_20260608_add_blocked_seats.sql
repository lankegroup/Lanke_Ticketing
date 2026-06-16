-- 1. Add is_blocked column to seats
ALTER TABLE seats ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Update get_seat_map to include is_blocked (must drop first to change return type)
DROP FUNCTION IF EXISTS get_seat_map(UUID);

CREATE OR REPLACE FUNCTION get_seat_map(p_session_id UUID)
RETURNS TABLE(
  id            UUID,
  row_index     INT,
  col_index     INT,
  seat_name     TEXT,
  is_booked     BOOLEAN,
  is_locked     BOOLEAN,
  locked_by_me  BOOLEAN,
  is_blocked    BOOLEAN
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
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
    s.is_blocked
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO anon, authenticated;

-- 3. Admin RPC: toggle a single seat's blocked status
CREATE OR REPLACE FUNCTION admin_toggle_seat_blocked(
  p_seat_id UUID,
  p_blocked BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN json_build_object('success', false, 'error', 'not_admin');
  END IF;

  UPDATE seats SET is_blocked = p_blocked WHERE id = p_seat_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'not_found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_toggle_seat_blocked(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION admin_toggle_seat_blocked(UUID, BOOLEAN) TO authenticated;

-- 4. Admin RPC: bulk set blocked status for multiple seats
CREATE OR REPLACE FUNCTION admin_bulk_block_seats(
  p_seat_ids UUID[],
  p_blocked BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN json_build_object('success', false, 'error', 'not_admin');
  END IF;

  UPDATE seats SET is_blocked = p_blocked WHERE id = ANY(p_seat_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('success', true, 'updated', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_bulk_block_seats(UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION admin_bulk_block_seats(UUID[], BOOLEAN) TO authenticated;

-- 5. lock_seat should refuse to lock a blocked seat (recreate with SECURITY INVOKER)
DROP FUNCTION IF EXISTS lock_seat(UUID);

CREATE OR REPLACE FUNCTION lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  -- Blocked by admin?
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'seat_blocked');
  END IF;

  -- Already booked by someone?
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_booked');
  END IF;

  -- Locked by another user (non-expired)?
  IF EXISTS (
    SELECT 1 FROM seat_locks
    WHERE seat_id = p_seat_id
      AND expires_at > NOW()
      AND user_id != v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other');
  END IF;

  -- Clear any expired or own existing lock for this seat
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  -- Insert fresh lock
  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes')
  RETURNING expires_at INTO v_expires;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

GRANT EXECUTE ON FUNCTION lock_seat(UUID) TO authenticated;
