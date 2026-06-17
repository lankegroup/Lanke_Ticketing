-- ============================================================
-- PATCH: Fix permission issues for admin functions
-- ============================================================

-- 0. Add admin policies for user_profiles (update/delete)
CREATE POLICY "user_profiles_update_admin" ON user_profiles FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "user_profiles_delete_admin" ON user_profiles FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 0.5. Create storage bucket for announcements (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'announcements') THEN
    PERFORM storage.create_bucket('announcements');
    PERFORM storage.set_bucket_public('announcements');
  END IF;
END $$;

-- Grant storage permissions
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT ON storage.buckets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- Create storage policy for announcements
CREATE POLICY "announcements_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'announcements' AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "announcements_select_public" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'announcements');

-- 1. Fix generate_session_seats - switch back to SECURITY DEFINER
-- SECURITY INVOKER requires the caller to have all RLS permissions,
-- which doesn't work well with the supabase client in browser
CREATE OR REPLACE FUNCTION public.generate_session_seats(
  p_session_id    UUID,
  p_rows          INT,
  p_seats_per_row INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
    AND (s.row_index >= p_rows OR s.col_index >= p_seats_per_row)
    AND reg.status = 'active';

  DELETE FROM seats WHERE session_id = p_session_id;

  FOR r IN 0..p_rows-1 LOOP
    row_letter := CHR(65 + r);
    FOR c IN 0..p_seats_per_row-1 LOOP
      seat_label := row_letter || '排' || (c + 1) || '座';
      INSERT INTO seats (session_id, seat_name, row_index, col_index)
      VALUES (p_session_id, seat_label, r, c);
    END LOOP;
  END LOOP;

  UPDATE sessions SET available_stock = p_rows * p_seats_per_row WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'cancelled_bookings', v_cancelled_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_session_seats(UUID, INT, INT) TO anon, authenticated;

-- 2. Fix admin_book_ticket - SECURITY DEFINER for admin operations
CREATE OR REPLACE FUNCTION public.admin_book_ticket(
  p_session_id    UUID,
  p_seat_id       UUID,
  p_name          TEXT,
  p_phone         TEXT,
  p_user_id       UUID,
  p_force         BOOLEAN DEFAULT FALSE,
  p_order_source  TEXT DEFAULT 'admin',
  p_ticket_type   TEXT DEFAULT 'normal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session       sessions%ROWTYPE;
  v_ticket_code   TEXT;
  v_reg_id        UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found');
  END IF;

  IF v_session.available_stock <= 0 AND NOT p_force THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'sold_out');
  END IF;

  IF p_seat_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status = 'active') THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'seat_taken');
    END IF;
  END IF;

  v_ticket_code := LPAD(FLOOR(RANDOM() * 100000000)::TEXT, 8, '0');

  INSERT INTO registrations (
    session_id, seat_id, name, phone, user_id, ticket_code,
    status, order_source, ticket_type, buyer_user_id
  ) VALUES (
    p_session_id, p_seat_id, p_name, p_phone, p_user_id, v_ticket_code,
    'active', p_order_source, p_ticket_type, p_user_id
  ) RETURNING id INTO v_reg_id;

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_code', v_ticket_code,
    'registration_id', v_reg_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, TEXT, TEXT) TO anon, authenticated;

-- 3. Fix cancel_ticket - SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.cancel_ticket(
  p_registration_id UUID,
  p_user_id         UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg       registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'ticket_not_found');
  END IF;

  IF p_user_id IS NOT NULL AND v_reg.user_id != p_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = p_user_id) THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'unauthorized');
    END IF;
  END IF;

  IF v_reg.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'already_cancelled');
  END IF;

  UPDATE registrations SET status = 'cancelled', cancelled_at = NOW() WHERE id = p_registration_id;

  IF v_reg.seat_id IS NOT NULL THEN
    UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;
  END IF;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_ticket(UUID, UUID) TO anon, authenticated;

-- 4. Fix book_ticket - SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.book_ticket(
  p_session_id     UUID,
  p_name           TEXT,
  p_phone          TEXT,
  p_user_id        UUID,
  p_ticket_type    TEXT DEFAULT 'normal',
  p_buyer_user_id  UUID,
  p_note_content   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session     sessions%ROWTYPE;
  v_ticket_code TEXT;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found');
  END IF;

  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'sold_out');
  END IF;

  v_ticket_code := LPAD(FLOOR(RANDOM() * 100000000)::TEXT, 8, '0');

  INSERT INTO registrations (
    session_id, name, phone, user_id, ticket_code, status,
    ticket_type, buyer_user_id, note_content, note_author
  ) VALUES (
    p_session_id, p_name, p_phone, p_user_id, v_ticket_code, 'active',
    p_ticket_type, p_buyer_user_id, p_note_content, 'user'
  );

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  RETURN jsonb_build_object('success', TRUE, 'ticket_code', v_ticket_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO anon, authenticated;

-- 5. Fix book_ticket_with_seat - SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.book_ticket_with_seat(
  p_session_id     UUID,
  p_seat_id        UUID,
  p_name           TEXT,
  p_phone          TEXT,
  p_user_id        UUID,
  p_ticket_type    TEXT DEFAULT 'normal',
  p_buyer_user_id  UUID,
  p_note_content   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session     sessions%ROWTYPE;
  v_ticket_code TEXT;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found');
  END IF;

  IF v_session.available_stock <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'sold_out');
  END IF;

  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status = 'active') THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'seat_taken');
  END IF;

  v_ticket_code := LPAD(FLOOR(RANDOM() * 100000000)::TEXT, 8, '0');

  INSERT INTO registrations (
    session_id, seat_id, name, phone, user_id, ticket_code, status,
    ticket_type, buyer_user_id, note_content, note_author
  ) VALUES (
    p_session_id, p_seat_id, p_name, p_phone, p_user_id, v_ticket_code, 'active',
    p_ticket_type, p_buyer_user_id, p_note_content, 'user'
  );

  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;

  RETURN jsonb_build_object('success', TRUE, 'ticket_code', v_ticket_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO anon, authenticated;

-- 6. Force schema cache reload
NOTIFY pgrst, 'reload schema';
