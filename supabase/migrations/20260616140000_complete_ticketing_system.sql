-- ============================================================
-- Ticketing System - Full Initialization Script
-- Supabase PostgreSQL Compatible
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENUM Types (必须在表之前创建)
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE note_author_enum AS ENUM ('user', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE note_status_enum AS ENUM ('pending', 'completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ────────────────────────────────────────────────────────────
-- 2. Core Tables (按顺序创建，解决外键依赖)
-- ────────────────────────────────────────────────────────────

-- Step 1: sessions (场次表 - 最先创建，无外键依赖)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  verification_start TIME,
  verification_end TIME,
  verify_date DATE,
  stop_selling_minutes INTEGER DEFAULT 0,
  available_stock INTEGER,
  has_seating_chart BOOLEAN NOT NULL DEFAULT FALSE,
  seat_rows INT NOT NULL DEFAULT 0,
  seats_per_row INT NOT NULL DEFAULT 0,
  screen_direction TEXT NOT NULL DEFAULT 'top',
  description TEXT,
  cover_image TEXT,
  booking_notice TEXT,
  default_service_fee DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: seats (座位表 - 依赖 sessions)
CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  row_index INT NOT NULL,
  col_index INT NOT NULL,
  seat_name TEXT NOT NULL,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason TEXT,
  UNIQUE (session_id, row_index, col_index)
);

-- Step 3: admin_profiles
CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 5: registrations (依赖 sessions 和 seats)
CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ticket_code TEXT NOT NULL UNIQUE DEFAULT UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 10)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'cancelled', 'expired')),
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES auth.users(id),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seat_id UUID REFERENCES seats(id) ON DELETE SET NULL,
  ticket_type TEXT CHECK (ticket_type IN ('regular', 'vip', 'student', 'child')),
  order_source TEXT NOT NULL DEFAULT 'user' CHECK (order_source IN ('user', 'admin', 'front_desk')),
  was_force_booked BOOLEAN NOT NULL DEFAULT FALSE,
  reschedule_count INT NOT NULL DEFAULT 0,
  reschedule_history JSONB NOT NULL DEFAULT '[]',
  print_count INT NOT NULL DEFAULT 0,
  note_content TEXT,
  note_author note_author_enum,
  is_note_read BOOLEAN DEFAULT FALSE,
  note_status note_status_enum DEFAULT 'pending',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 6: seat_locks (依赖 seats)
CREATE TABLE IF NOT EXISTS seat_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  UNIQUE (seat_id)
);

-- Step 7: announcements
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  cover_image TEXT,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 8: validation_logs (依赖 registrations)
CREATE TABLE IF NOT EXISTS validation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code TEXT NOT NULL,
  registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  admin_id UUID REFERENCES auth.users(id)
);

-- Step 9: feedback_tickets
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE DEFAULT ('FB-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8))),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
  admin_reply TEXT,
  replied_at TIMESTAMPTZ,
  replied_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 10: notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 11: chat_conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','closed')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  user_unread INT NOT NULL DEFAULT 0,
  admin_unread INT NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Step 12: chat_messages (依赖 chat_conversations)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')),
  content TEXT NOT NULL CHECK (char_length(content) <= 2000),
  is_filtered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Step 13: admin_chat_status
CREATE TABLE IF NOT EXISTS admin_chat_status (
  admin_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','busy','offline')),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Step 14: chat_quick_replies
CREATE TABLE IF NOT EXISTS chat_quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. Indexes (表创建完成后创建索引)
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sessions_verify_date ON sessions(verify_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_seat_active ON registrations(seat_id) WHERE seat_id IS NOT NULL AND status NOT IN ('cancelled', 'expired');
CREATE INDEX IF NOT EXISTS idx_registrations_is_note_read ON registrations(is_note_read) WHERE note_content IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_msg ON chat_conversations(last_message_at DESC NULLS LAST);

-- ────────────────────────────────────────────────────────────
-- 4. Trigger Functions
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.sessions_verify_date_default()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verify_date IS NULL THEN
    NEW.verify_date = NEW.session_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ────────────────────────────────────────────────────────────
-- 5. Triggers
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER announcements_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER feedback_tickets_updated_at BEFORE UPDATE ON feedback_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER sessions_verify_date_default_trigger BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION sessions_verify_date_default();

-- ────────────────────────────────────────────────────────────
-- 6. RPC Functions
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.book_ticket(p_session_id UUID, p_name TEXT, p_phone TEXT, p_user_id UUID, p_ticket_type TEXT DEFAULT 'regular', p_buyer_user_id UUID DEFAULT NULL, p_note_content TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_ticket_code TEXT;
  v_reg_id UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', FALSE, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', FALSE, 'error', 'sold_out'); END IF;
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  v_ticket_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 10));
  INSERT INTO registrations (name, phone, session_id, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, note_author)
  VALUES (p_name, p_phone, p_session_id, v_ticket_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'user'::note_author_enum ELSE NULL END)
  RETURNING id INTO v_reg_id;
  RETURN jsonb_build_object('success', TRUE, 'ticket_code', v_ticket_code, 'registration_id', v_reg_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.book_ticket_with_seat(p_session_id UUID, p_seat_id UUID, p_name TEXT, p_phone TEXT, p_user_id UUID, p_ticket_type TEXT DEFAULT 'regular', p_buyer_user_id UUID DEFAULT NULL, p_note_content TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_code TEXT;
  v_reg_id UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', false, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'sold_out'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired')) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id AND expires_at > NOW()) THEN RETURN jsonb_build_object('success', false, 'error', 'lock_expired'); END IF;
  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, ticket_type, buyer_user_id, note_content, note_author)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_ticket_type, p_buyer_user_id, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'user'::note_author_enum ELSE NULL END)
  RETURNING id INTO v_reg_id;
  DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = p_user_id;
  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_book_ticket(p_session_id uuid, p_name text, p_phone text, p_user_id uuid DEFAULT NULL, p_seat_id uuid DEFAULT NULL, p_force boolean DEFAULT FALSE, p_order_source text DEFAULT 'admin', p_ticket_type text DEFAULT 'regular', p_note_content text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_code TEXT;
  v_reg_id UUID;
  v_was_blocked BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;
  IF NOT v_session.is_active THEN RETURN jsonb_build_object('success', false, 'error', 'session_inactive'); END IF;
  IF v_session.available_stock <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'sold_out'); END IF;
  IF p_seat_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND session_id = p_session_id) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
    IF EXISTS (SELECT 1 FROM seats WHERE id = p_seat_id AND is_blocked = TRUE) THEN IF NOT p_force THEN RETURN jsonb_build_object('success', false, 'error', 'seat_blocked'); END IF; v_was_blocked := TRUE; END IF;
    IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired') AND deleted_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;
  END IF;
  v_code := 'TK' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT), 1, 8));
  UPDATE sessions SET available_stock = available_stock - 1 WHERE id = p_session_id;
  INSERT INTO registrations (session_id, seat_id, name, phone, ticket_code, status, user_id, order_source, was_force_booked, ticket_type, note_content, note_author)
  VALUES (p_session_id, p_seat_id, p_name, p_phone, v_code, 'active', p_user_id, p_order_source, v_was_blocked, p_ticket_type, p_note_content, CASE WHEN p_note_content IS NOT NULL THEN 'admin'::note_author_enum ELSE NULL END)
  RETURNING id INTO v_reg_id;
  IF p_seat_id IS NOT NULL THEN DELETE FROM seat_locks WHERE seat_id = p_seat_id; END IF;
  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id, 'ticket_code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ticket(p_registration_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_status TEXT;
BEGIN
  SELECT session_id, status INTO v_session_id, v_status FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', FALSE, 'error', 'not_found'); END IF;
  IF v_status != 'active' THEN RETURN jsonb_build_object('success', FALSE, 'error', 'not_active'); END IF;
  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = p_registration_id AND (user_id = p_user_id OR user_id IS NULL)) THEN RETURN jsonb_build_object('success', FALSE, 'error', 'not_owner'); END IF;
  END IF;
  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_session_id;
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_registration(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_sess_name TEXT;
  v_seat_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN RETURN jsonb_build_object('success', false, 'error', 'unauthorized'); END IF;
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_reg.status IN ('cancelled', 'expired') THEN RETURN jsonb_build_object('success', false, 'error', 'already_cancelled'); END IF;
  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  UPDATE sessions SET available_stock = available_stock + 1 WHERE id = v_reg.session_id;
  IF v_reg.was_force_booked AND v_reg.seat_id IS NOT NULL THEN UPDATE seats SET is_blocked = TRUE WHERE id = v_reg.seat_id; END IF;
  IF v_reg.user_id IS NOT NULL THEN
    SELECT name INTO v_sess_name FROM sessions WHERE id = v_reg.session_id;
    IF v_reg.seat_id IS NOT NULL THEN SELECT seat_name INTO v_seat_name FROM seats WHERE id = v_reg.seat_id; END IF;
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (v_reg.user_id, 'warning', '您的订单已被取消', '您在场次"' || COALESCE(v_sess_name, '') || '"的预订' || CASE WHEN v_seat_name IS NOT NULL THEN '（座位：' || v_seat_name || '）' ELSE '' END || '（券码：' || v_reg.ticket_code || '）已被管理员取消，如有疑问请联系客服。');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_past_tickets()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE registrations r SET status = 'expired' FROM sessions s WHERE r.session_id = s.id AND r.status = 'active' AND (s.session_date + s.end_time::interval) < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_seat_map(p_session_id UUID)
RETURNS TABLE(id UUID, row_index INT, col_index INT, seat_name TEXT, is_booked BOOLEAN, is_locked BOOLEAN, locked_by_me BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY SELECT s.id, s.row_index, s.col_index, s.seat_name,
    EXISTS(SELECT 1 FROM registrations r WHERE r.seat_id = s.id AND r.status NOT IN ('cancelled', 'expired')) AS is_booked,
    EXISTS(SELECT 1 FROM seat_locks sl WHERE sl.seat_id = s.id AND sl.expires_at > NOW()) AS is_locked,
    EXISTS(SELECT 1 FROM seat_locks sl WHERE sl.seat_id = s.id AND sl.expires_at > NOW() AND sl.user_id = auth.uid()) AS locked_by_me
  FROM seats s WHERE s.session_id = p_session_id ORDER BY s.row_index, s.col_index;
END;
$$;

CREATE OR REPLACE FUNCTION generate_session_seats(p_session_id UUID, p_rows INT, p_seats_per_row INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r INT; c INT; row_letter TEXT; seat_label TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF EXISTS (SELECT 1 FROM registrations reg JOIN seats s ON s.id = reg.seat_id WHERE s.session_id = p_session_id AND reg.status NOT IN ('cancelled', 'expired')) THEN RAISE EXCEPTION 'active_bookings_exist'; END IF;
  DELETE FROM seats WHERE session_id = p_session_id;
  FOR r IN 1..p_rows LOOP
    row_letter := CHR(64 + r);
    FOR c IN 1..p_seats_per_row LOOP
      seat_label := row_letter || '排' || c || '座';
      INSERT INTO seats (session_id, row_index, col_index, seat_name) VALUES (p_session_id, r, c, seat_label);
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION lock_seat(p_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_seat_id AND status NOT IN ('cancelled', 'expired')) THEN RETURN jsonb_build_object('success', false, 'reason', 'already_booked'); END IF;
  IF EXISTS (SELECT 1 FROM seat_locks WHERE seat_id = p_seat_id AND expires_at > NOW() AND user_id != v_user_id) THEN RETURN jsonb_build_object('success', false, 'reason', 'locked_by_other'); END IF;
  DELETE FROM seat_locks WHERE seat_id = p_seat_id;
  INSERT INTO seat_locks (seat_id, user_id, expires_at) VALUES (p_seat_id, v_user_id, NOW() + INTERVAL '5 minutes') RETURNING expires_at INTO v_expires;
  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$$;

CREATE OR REPLACE FUNCTION unlock_seat(p_seat_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM seat_locks WHERE seat_id = p_seat_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.change_seat(p_registration_id UUID, p_new_seat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
  v_old_seat_name TEXT;
  v_new_seat_name TEXT;
  v_history JSONB;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_reg.status <> 'active' THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_status'); END IF;
  IF v_reg.reschedule_count >= 1 THEN RETURN jsonb_build_object('success', false, 'error', 'reschedule_limit_reached'); END IF;
  IF v_reg.seat_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'no_seat'); END IF;
  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND session_id = v_reg.session_id) THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_seat'); END IF;
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND is_blocked) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_blocked'); END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE seat_id = p_new_seat_id AND status NOT IN ('cancelled', 'expired') AND deleted_at IS NULL AND id <> p_registration_id) THEN RETURN jsonb_build_object('success', false, 'error', 'seat_taken'); END IF;
  SELECT seat_name INTO v_old_seat_name FROM seats WHERE id = v_reg.seat_id;
  SELECT seat_name INTO v_new_seat_name FROM seats WHERE id = p_new_seat_id;
  v_history := v_reg.reschedule_history || jsonb_build_array(jsonb_build_object('from_seat', v_old_seat_name, 'to_seat', v_new_seat_name, 'changed_at', NOW()));
  DELETE FROM seat_locks WHERE seat_id = p_new_seat_id;
  UPDATE registrations SET seat_id = p_new_seat_id, reschedule_count = reschedule_count + 1, reschedule_history = v_history WHERE id = p_registration_id;
  RETURN jsonb_build_object('success', true, 'old_seat', v_old_seat_name, 'new_seat', v_new_seat_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_print_count(p_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN RETURN jsonb_build_object('success', false, 'error', 'unauthorized'); END IF;
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  UPDATE registrations SET print_count = print_count + 1 WHERE id = p_registration_id;
  RETURN jsonb_build_object('success', true, 'print_count', v_reg.print_count + 1);
END;
$$;

CREATE OR REPLACE FUNCTION send_chat_message(p_conversation_id UUID, p_content TEXT, p_sender_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg chat_messages;
  v_filtered BOOLEAN := false;
  v_content TEXT;
BEGIN
  v_content := trim(p_content);
  IF char_length(v_content) = 0 THEN RAISE EXCEPTION 'empty_message'; END IF;
  IF char_length(v_content) > 2000 THEN v_content := left(v_content, 2000); END IF;
  INSERT INTO chat_messages(conversation_id, sender_id, sender_role, content, is_filtered) VALUES (p_conversation_id, auth.uid(), p_sender_role, v_content, v_filtered) RETURNING * INTO v_msg;
  IF p_sender_role = 'user' THEN
    UPDATE chat_conversations SET last_message_at = now(), admin_unread = admin_unread + 1, user_unread = 0 WHERE id = p_conversation_id;
  ELSE
    UPDATE chat_conversations SET last_message_at = now(), user_unread = user_unread + 1, admin_unread = 0 WHERE id = p_conversation_id;
  END IF;
  RETURN jsonb_build_object('id', v_msg.id, 'conversation_id', v_msg.conversation_id, 'sender_id', v_msg.sender_id, 'sender_role', v_msg.sender_role, 'content', v_msg.content, 'is_filtered', v_msg.is_filtered, 'created_at', v_msg.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION get_or_create_conversation() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv chat_conversations;
BEGIN
  SELECT * INTO v_conv FROM chat_conversations WHERE user_id = auth.uid() LIMIT 1;
  IF NOT FOUND THEN INSERT INTO chat_conversations(user_id) VALUES (auth.uid()) RETURNING * INTO v_conv; END IF;
  RETURN to_jsonb(v_conv);
END;
$$;

CREATE OR REPLACE FUNCTION mark_conversation_read(p_conversation_id UUID, p_side TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_side = 'user' THEN UPDATE chat_conversations SET user_unread = 0 WHERE id = p_conversation_id AND user_id = auth.uid();
  ELSIF p_side = 'admin' THEN UPDATE chat_conversations SET admin_unread = 0 WHERE id = p_conversation_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION purge_old_chat_messages() RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM chat_messages WHERE created_at < now() - INTERVAL '10 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. Row Level Security Policies
-- ────────────────────────────────────────────────────────────

ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_select_own" ON admin_profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "admins_insert_own" ON admin_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "admins_update_own" ON admin_profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "admins_delete_own" ON admin_profiles FOR DELETE TO authenticated USING (auth.uid() = id);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_select_public" ON sessions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "sessions_insert_admin" ON sessions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "sessions_update_admin" ON sessions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "sessions_delete_admin" ON sessions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registrations_select_own" ON registrations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "registrations_select_admin" ON registrations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "registrations_insert_anon" ON registrations FOR INSERT TO anon, authenticated WITH CHECK (status = 'active');
CREATE POLICY "registrations_update_admin" ON registrations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "registrations_delete_admin" ON registrations FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profiles_select_own" ON user_profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "user_profiles_insert_own" ON user_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "user_profiles_update_own" ON user_profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "user_profiles_delete_own" ON user_profiles FOR DELETE TO authenticated USING (auth.uid() = id);
CREATE POLICY "user_profiles_select_admin" ON user_profiles FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seats_select_public" ON seats FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "seats_insert_admin" ON seats FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "seats_update_admin" ON seats FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "seats_delete_admin" ON seats FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE seat_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seat_locks_select_public" ON seat_locks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "seat_locks_insert_authenticated" ON seat_locks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "seat_locks_delete_authenticated" ON seat_locks FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "announcements_select_public" ON announcements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "announcements_insert_admin" ON announcements FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "announcements_update_admin" ON announcements FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "announcements_delete_admin" ON announcements FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE validation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vlogs_insert_admin" ON validation_logs FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "vlogs_select_admin" ON validation_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "vlogs_update_admin" ON validation_logs FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "vlogs_delete_admin" ON validation_logs FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE feedback_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feedback_select_own" ON feedback_tickets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "feedback_insert_own" ON feedback_tickets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "feedback_update_own" ON feedback_tickets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "feedback_select_admin" ON feedback_tickets FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "feedback_update_admin" ON feedback_tickets FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conv_select_own" ON chat_conversations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "conv_insert_own" ON chat_conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conv_update_own" ON chat_conversations FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conv_delete_own" ON chat_conversations FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "conv_select_admin" ON chat_conversations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "conv_update_admin" ON chat_conversations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msg_select_own_conv" ON chat_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = chat_messages.conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "msg_insert_own_conv" ON chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id AND EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = chat_messages.conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "msg_no_update" ON chat_messages FOR UPDATE TO authenticated USING (false);
CREATE POLICY "msg_no_delete" ON chat_messages FOR DELETE TO authenticated USING (false);
CREATE POLICY "msg_select_admin" ON chat_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

ALTER TABLE admin_chat_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_status_select" ON admin_chat_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_status_insert" ON admin_chat_status FOR INSERT TO authenticated WITH CHECK (auth.uid() = admin_id);
CREATE POLICY "admin_status_update" ON admin_chat_status FOR UPDATE TO authenticated USING (auth.uid() = admin_id) WITH CHECK (auth.uid() = admin_id);
CREATE POLICY "admin_status_delete" ON admin_chat_status FOR DELETE TO authenticated USING (auth.uid() = admin_id);

ALTER TABLE chat_quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qr_select_public" ON chat_quick_replies FOR SELECT TO authenticated USING (true);
CREATE POLICY "qr_insert_admin" ON chat_quick_replies FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "qr_update_admin" ON chat_quick_replies FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
CREATE POLICY "qr_delete_admin" ON chat_quick_replies FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ────────────────────────────────────────────────────────────
-- 8. Permissions (GRANT/REVOKE)
-- ────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION get_seat_map(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION lock_seat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION unlock_seat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION book_ticket(UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_ticket(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION send_chat_message(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_conversation() TO authenticated;
GRANT EXECUTE ON FUNCTION mark_conversation_read(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION change_seat(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text,text,text) TO service_role;
REVOKE EXECUTE ON FUNCTION admin_book_ticket(uuid,text,text,uuid,uuid,boolean,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_session_seats(UUID, INT, INT) TO service_role;
REVOKE EXECUTE ON FUNCTION generate_session_seats(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_cancel_registration(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION admin_cancel_registration(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_print_count(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION increment_print_count(uuid) FROM PUBLIC, anon, authenticated;

GRANT SELECT, UPDATE ON notifications TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 9. Initialization Data (全部放在最末尾)
-- ────────────────────────────────────────────────────────────

UPDATE sessions SET available_stock = capacity WHERE available_stock IS NULL;
UPDATE sessions SET verify_date = session_date WHERE verify_date IS NULL;

-- ────────────────────────────────────────────────────────────
-- 10. Realtime Configuration (注释掉)
-- ────────────────────────────────────────────────────────────

/*
  ⚠️ 风险警告：Realtime 订阅会将所有表变更广播到客户端，可能导致敏感数据泄露。
  如需开启实时功能，请仔细评估安全风险，并仅为必要的表开启订阅。

  ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
  ALTER PUBLICATION supabase_realtime ADD TABLE registrations;
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
  ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
*/

-- ============================================================
-- Initialization Complete!
-- ============================================================