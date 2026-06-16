
-- Rewrite lock_seat to be fully atomic using pg_advisory_xact_lock.
-- This prevents the TOCTOU race: two concurrent calls for the same seat
-- are serialized by the advisory lock so only one INSERT succeeds.

CREATE OR REPLACE FUNCTION lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expires  TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  -- Serialize concurrent calls for the same seat at the DB level.
  -- hashtext gives a stable int8 from the UUID string.
  PERFORM pg_advisory_xact_lock(hashtext(p_seat_id::text));

  -- Already booked (active registration)?
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_booked');
  END IF;

  -- Locked by a DIFFERENT user and lock not yet expired?
  IF EXISTS (
    SELECT 1 FROM seat_locks
    WHERE seat_id   = p_seat_id
      AND expires_at > NOW()
      AND user_id   != v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other');
  END IF;

  -- Remove any stale or own lock for this seat, then insert a fresh one.
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes')
  RETURNING expires_at INTO v_expires;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

-- Revoke direct public/authenticated execute; callers go through the edge
-- functions or the existing RPC grant (mirroring the pattern used by all
-- other seat functions in this project).
REVOKE EXECUTE ON FUNCTION lock_seat(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lock_seat(UUID) TO authenticated;
