
-- Replace the advisory-lock approach with a single atomic UPSERT that is
-- safe under pgBouncer transaction-mode pooling.
--
-- How it works:
--   INSERT: claims the seat if no lock row exists.
--   ON CONFLICT DO UPDATE … WHERE:
--     • existing lock EXPIRED          → take it over (update to new owner)
--     • existing lock is OURS          → renew it
--     • existing lock is ACTIVE/OTHER  → WHERE is false → row unchanged
--
-- PostgreSQL row-locks the conflicting row during ON CONFLICT processing, so
-- two concurrent calls for the same seat_id are serialised at the row level
-- without any advisory lock.  The final SELECT verifies ownership so the
-- caller gets a clear success / locked_by_other result.

CREATE OR REPLACE FUNCTION lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID        := auth.uid();
  v_expires  TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  -- Reject if the seat already has an active booking.
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id  = p_seat_id
      AND status   NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_booked');
  END IF;

  -- Atomic upsert.  PostgreSQL acquires a row-level lock on any conflicting
  -- row before evaluating the WHERE clause, so this cannot race.
  INSERT INTO seat_locks (seat_id, user_id, expires_at, locked_at)
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes', NOW())
  ON CONFLICT (seat_id) DO UPDATE
    SET user_id   = EXCLUDED.user_id,
        expires_at = EXCLUDED.expires_at,
        locked_at  = EXCLUDED.locked_at
  WHERE seat_locks.expires_at <= NOW()           -- expired → free to claim
     OR seat_locks.user_id   = EXCLUDED.user_id; -- our own lock → renew

  -- Verify we now own the lock.
  -- If the DO UPDATE WHERE was false (active lock by another user), this
  -- SELECT returns nothing and we report locked_by_other.
  SELECT expires_at INTO v_expires
  FROM   seat_locks
  WHERE  seat_id   = p_seat_id
    AND  user_id   = v_user_id
    AND  expires_at > NOW();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other');
  END IF;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

REVOKE EXECUTE ON FUNCTION lock_seat(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lock_seat(UUID) TO authenticated;
