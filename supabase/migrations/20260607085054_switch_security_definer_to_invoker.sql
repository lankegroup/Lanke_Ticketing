-- ═══════════════════════════════════════════════════════════════════════════════
-- Security hardening: remove SECURITY DEFINER privilege escalation from
-- RPC-exposed functions by switching to SECURITY INVOKER + proper RLS policies.
--
-- Strategy per function:
--   fn_after_chat_message_insert   → REVOKE entirely (trigger, not an RPC)
--   get_or_create_conversation     → SECURITY INVOKER (touches only own conv row)
--   get_seat_map                   → SECURITY INVOKER (all reads are USING true)
--   lock_seat / unlock_seat        → SECURITY INVOKER after adding seat_locks policies
--   generate_session_seats         → SECURITY INVOKER after adding seats admin policies
-- ═══════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Trigger function: not meant to be called directly via /rpc
-- ──────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_after_chat_message_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_after_chat_message_insert() FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Add missing seat_locks RLS policies (needed for SECURITY INVOKER lock/unlock)
-- ──────────────────────────────────────────────────────────────────────────────

-- Users can insert their own lock
CREATE POLICY "seat_locks_insert_own" ON seat_locks FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own locks OR expired locks (the lock_seat cleanup deletes
-- all locks for a seat — after confirming no other active lock — so expired + own
-- covers the full set that needs clearing)
CREATE POLICY "seat_locks_delete_own_or_expired" ON seat_locks FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR expires_at < NOW());

-- Admins can delete any lock (generate_session_seats removes locks on deleted seats)
CREATE POLICY "seat_locks_admin_delete" ON seat_locks FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Add missing seats RLS policies (needed for SECURITY INVOKER generate_session_seats)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "seats_admin_insert" ON seats FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "seats_admin_delete" ON seats FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- Also need sessions UPDATE for stock restoration in generate_session_seats
CREATE POLICY "sessions_admin_update_stock" ON sessions FOR UPDATE
  TO authenticated
  USING   (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Switch functions to SECURITY INVOKER (no privilege escalation)
-- ──────────────────────────────────────────────────────────────────────────────

-- get_or_create_conversation: user's own conv — covered by conv_select_own + conv_insert_own
CREATE OR REPLACE FUNCTION public.get_or_create_conversation()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conv chat_conversations;
BEGIN
  SELECT * INTO v_conv FROM chat_conversations WHERE user_id = auth.uid() LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO chat_conversations(user_id) VALUES (auth.uid()) RETURNING * INTO v_conv;
  END IF;
  RETURN to_jsonb(v_conv);
END;
$$;

-- get_seat_map: read-only; registrations + seats + seat_locks all have USING true SELECT
CREATE OR REPLACE FUNCTION public.get_seat_map(p_session_id UUID)
RETURNS TABLE(
  id           UUID,
  row_index    INT,
  col_index    INT,
  seat_name    TEXT,
  is_booked    BOOLEAN,
  is_locked    BOOLEAN,
  locked_by_me BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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
      WHERE r.seat_id = s.id AND r.status NOT IN ('cancelled', 'expired')
    ) AS is_booked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id AND sl.expires_at > NOW()
    ) AS is_locked,
    EXISTS(
      SELECT 1 FROM seat_locks sl
      WHERE sl.seat_id = s.id AND sl.expires_at > NOW() AND sl.user_id = auth.uid()
    ) AS locked_by_me
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

-- lock_seat: SELECT covered by public policies; INSERT/DELETE covered by new seat_locks policies
CREATE OR REPLACE FUNCTION public.lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_booked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM seat_locks
    WHERE seat_id = p_seat_id AND expires_at > NOW() AND user_id != v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other');
  END IF;

  -- By this point no other user holds an active lock; the RLS policy
  -- "seat_locks_delete_own_or_expired" will correctly remove own + expired rows.
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;

  INSERT INTO seat_locks (seat_id, user_id, expires_at)
  VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes')
  RETURNING expires_at INTO v_expires;

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

-- unlock_seat: user deletes only their own lock — covered by seat_locks_delete_own_or_expired
CREATE OR REPLACE FUNCTION public.unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = auth.uid();
END;
$$;

-- generate_session_seats: internal admin check + new admin RLS on seats/seat_locks/sessions
CREATE OR REPLACE FUNCTION public.generate_session_seats(
  p_session_id    UUID,
  p_rows          INT,
  p_seats_per_row INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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

  SELECT COUNT(*) INTO v_cancelled_count
  FROM registrations reg
  JOIN seats s ON s.id = reg.seat_id
  WHERE s.session_id = p_session_id
    AND (s.row_index > p_rows OR s.col_index > p_seats_per_row)
    AND reg.status NOT IN ('cancelled', 'expired');

  IF v_cancelled_count > 0 THEN
    UPDATE registrations
    SET status = 'cancelled'
    WHERE seat_id IN (
      SELECT s.id FROM seats s
      WHERE s.session_id = p_session_id
        AND (s.row_index > p_rows OR s.col_index > p_seats_per_row)
    )
    AND status NOT IN ('cancelled', 'expired');

    UPDATE sessions
    SET available_stock = available_stock + v_cancelled_count
    WHERE id = p_session_id;
  END IF;

  DELETE FROM seat_locks
  WHERE seat_id IN (
    SELECT id FROM seats
    WHERE session_id = p_session_id
      AND (row_index > p_rows OR col_index > p_seats_per_row)
  );

  DELETE FROM seats
  WHERE session_id = p_session_id
    AND (row_index > p_rows OR col_index > p_seats_per_row);

  FOR r IN 1..p_rows LOOP
    row_letter := CHR(64 + r);
    FOR c IN 1..p_seats_per_row LOOP
      seat_label := row_letter || '排' || c || '座';
      INSERT INTO seats (session_id, row_index, col_index, seat_name)
      VALUES (p_session_id, r, c, seat_label)
      ON CONFLICT (session_id, row_index, col_index) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'cancelled_bookings', v_cancelled_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_session_seats(UUID, INT, INT) TO authenticated;
