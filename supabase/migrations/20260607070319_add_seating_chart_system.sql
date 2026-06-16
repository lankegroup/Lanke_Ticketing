-- ── 1. Extend sessions table ────────────────────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS has_seating_chart BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS seat_rows         INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seats_per_row     INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS screen_direction  TEXT    NOT NULL DEFAULT 'top';

-- ── 2. Seats table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  row_index  INT  NOT NULL,
  col_index  INT  NOT NULL,
  seat_name  TEXT NOT NULL,
  UNIQUE (session_id, row_index, col_index)
);

ALTER TABLE seats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_seats" ON seats
  FOR SELECT TO anon, authenticated USING (true);

-- ── 3. Seat locks (temporary, 5-min TTL) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS seat_locks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id    UUID        NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  UNIQUE (seat_id)
);

ALTER TABLE seat_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_locks" ON seat_locks
  FOR SELECT TO anon, authenticated USING (true);

-- ── 4. Add seat_id to registrations ─────────────────────────────────────────
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS seat_id UUID REFERENCES seats(id) ON DELETE SET NULL;

-- Only one active booking per seat (cancelled/expired rows are excluded)
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_seat_active
  ON registrations(seat_id)
  WHERE seat_id IS NOT NULL AND status NOT IN ('cancelled', 'expired');

-- ── 5. RPC: get_seat_map ─────────────────────────────────────────────────────
-- Returns per-seat status for a session without exposing PII
CREATE OR REPLACE FUNCTION get_seat_map(p_session_id UUID)
RETURNS TABLE(
  id            UUID,
  row_index     INT,
  col_index     INT,
  seat_name     TEXT,
  is_booked     BOOLEAN,
  is_locked     BOOLEAN,
  locked_by_me  BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    ) AS locked_by_me
  FROM seats s
  WHERE s.session_id = p_session_id
  ORDER BY s.row_index, s.col_index;
END;
$$;

-- ── 6. RPC: generate_session_seats ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_session_seats(
  p_session_id   UUID,
  p_rows         INT,
  p_seats_per_row INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r            INT;
  c            INT;
  row_letter   TEXT;
  seat_label   TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations reg
    JOIN seats s ON s.id = reg.seat_id
    WHERE s.session_id = p_session_id
      AND reg.status NOT IN ('cancelled', 'expired')
  ) THEN
    RAISE EXCEPTION 'active_bookings_exist';
  END IF;

  DELETE FROM seats WHERE session_id = p_session_id;

  FOR r IN 1..p_rows LOOP
    row_letter := CHR(64 + r);
    FOR c IN 1..p_seats_per_row LOOP
      seat_label := row_letter || '排' || c || '座';
      INSERT INTO seats (session_id, row_index, col_index, seat_name)
      VALUES (p_session_id, r, c, seat_label);
    END LOOP;
  END LOOP;
END;
$$;

-- ── 7. RPC: lock_seat ────────────────────────────────────────────────────────
-- Called from authenticated client. auth.uid() is the calling user.
CREATE OR REPLACE FUNCTION lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
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

-- ── 8. RPC: unlock_seat ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM seat_locks
  WHERE seat_id = p_seat_id
    AND user_id = auth.uid();
END;
$$;

-- ── 9. RPC: book_ticket_with_seat ────────────────────────────────────────────
-- Called from book-ticket edge function (service-role key).
-- p_user_id is trusted (verified from JWT by the edge function).
CREATE OR REPLACE FUNCTION book_ticket_with_seat(
  p_session_id UUID,
  p_seat_id    UUID,
  p_name       TEXT,
  p_phone      TEXT,
  p_user_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;
  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;
  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  -- Seat belongs to this session?
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;

  -- Seat not already booked?
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_seat_id
      AND status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  -- User holds a valid lock?
  IF NOT EXISTS (
    SELECT 1 FROM seat_locks
    WHERE seat_id = p_seat_id
      AND user_id = p_user_id
      AND expires_at > NOW()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'lock_expired');
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id)
  RETURNING id INTO v_reg_id;

  DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- ── 10. RPC: admin_book_ticket ───────────────────────────────────────────────
-- Admin proxy booking — no lock check required.
CREATE OR REPLACE FUNCTION admin_book_ticket(
  p_session_id UUID,
  p_seat_id    UUID,   -- NULL for sessions without seating chart
  p_name       TEXT,
  p_phone      TEXT,
  p_user_id    UUID    -- the customer's user_id
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session   sessions%ROWTYPE;
  v_code      TEXT;
  v_reg_id    UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;
  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_inactive');
  END IF;
  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'sold_out');
  END IF;

  IF p_seat_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
    END IF;
    IF EXISTS (
      SELECT 1 FROM registrations
      WHERE seat_id = p_seat_id
        AND status NOT IN ('cancelled', 'expired')
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
    END IF;
  END IF;

  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id)
  RETURNING id INTO v_reg_id;

  -- Release any lock on this seat (if admin books over a lock)
  IF p_seat_id IS NOT NULL THEN
    DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

-- Grant execute on public RPCs
GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION lock_seat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION unlock_seat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_session_seats(UUID, INT, INT) TO authenticated;
