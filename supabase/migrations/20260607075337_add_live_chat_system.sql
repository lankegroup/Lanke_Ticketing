-- ─────────────────────────────────────────────────
-- Live Chat / Customer Service System
-- ─────────────────────────────────────────────────

-- 1. Conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','closed')),
  assigned_to     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  user_unread     INT  NOT NULL DEFAULT 0,
  admin_unread    INT  NOT NULL DEFAULT 0,
  is_blocked      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_select_own" ON chat_conversations FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "conv_insert_own" ON chat_conversations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conv_update_own" ON chat_conversations FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conv_delete_own" ON chat_conversations FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 2. Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id),
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('user','admin')),
  content         TEXT NOT NULL CHECK (char_length(content) <= 2000),
  is_filtered     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- User can see messages in their own conversations
CREATE POLICY "msg_select_own_conv" ON chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = chat_messages.conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "msg_insert_own_conv" ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = chat_messages.conversation_id AND c.user_id = auth.uid()
    )
  );

-- No UPDATE/DELETE for users — messages are immutable from user side
CREATE POLICY "msg_no_update" ON chat_messages FOR UPDATE TO authenticated USING (false);
CREATE POLICY "msg_no_delete" ON chat_messages FOR DELETE TO authenticated USING (false);

-- 3. Admin online status
CREATE TABLE IF NOT EXISTS admin_chat_status (
  admin_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','busy','offline')),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE admin_chat_status ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read admin status (to show "online" indicator to users)
CREATE POLICY "admin_status_select" ON admin_chat_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_status_insert" ON admin_chat_status FOR INSERT TO authenticated WITH CHECK (auth.uid() = admin_id);
CREATE POLICY "admin_status_update" ON admin_chat_status FOR UPDATE TO authenticated USING (auth.uid() = admin_id) WITH CHECK (auth.uid() = admin_id);
CREATE POLICY "admin_status_delete" ON admin_chat_status FOR DELETE TO authenticated USING (auth.uid() = admin_id);

-- 4. Quick replies (admin-managed canned responses)
CREATE TABLE IF NOT EXISTS chat_quick_replies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,
  content    TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE chat_quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qr_select" ON chat_quick_replies FOR SELECT TO authenticated USING (true);
CREATE POLICY "qr_insert" ON chat_quick_replies FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "qr_update" ON chat_quick_replies FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "qr_delete" ON chat_quick_replies FOR DELETE TO authenticated USING (true);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_msg ON chat_conversations(last_message_at DESC NULLS LAST);

-- 6. RPC: user sends a message (handles unread increment + last_message_at atomically)
CREATE OR REPLACE FUNCTION send_chat_message(
  p_conversation_id UUID,
  p_content         TEXT,
  p_sender_role     TEXT  -- 'user' or 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg chat_messages;
  v_filtered BOOLEAN := false;
  v_content TEXT;
BEGIN
  v_content := trim(p_content);
  IF char_length(v_content) = 0 THEN
    RAISE EXCEPTION 'empty_message';
  END IF;
  IF char_length(v_content) > 2000 THEN
    v_content := left(v_content, 2000);
  END IF;

  INSERT INTO chat_messages(conversation_id, sender_id, sender_role, content, is_filtered)
  VALUES (p_conversation_id, auth.uid(), p_sender_role, v_content, v_filtered)
  RETURNING * INTO v_msg;

  -- Update conversation metadata
  IF p_sender_role = 'user' THEN
    UPDATE chat_conversations
    SET last_message_at = now(),
        admin_unread = admin_unread + 1,
        user_unread  = 0
    WHERE id = p_conversation_id;
  ELSE
    UPDATE chat_conversations
    SET last_message_at = now(),
        user_unread  = user_unread + 1,
        admin_unread = 0
    WHERE id = p_conversation_id;
  END IF;

  RETURN jsonb_build_object(
    'id',              v_msg.id,
    'conversation_id', v_msg.conversation_id,
    'sender_id',       v_msg.sender_id,
    'sender_role',     v_msg.sender_role,
    'content',         v_msg.content,
    'is_filtered',     v_msg.is_filtered,
    'created_at',      v_msg.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_chat_message(UUID, TEXT, TEXT) TO authenticated;

-- 7. RPC: get or create conversation for current user
CREATE OR REPLACE FUNCTION get_or_create_conversation() RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

GRANT EXECUTE ON FUNCTION public.get_or_create_conversation() TO authenticated;

-- 8. RPC: mark messages as read (clear unread for given side)
CREATE OR REPLACE FUNCTION mark_conversation_read(
  p_conversation_id UUID,
  p_side            TEXT  -- 'user' or 'admin'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_side = 'user' THEN
    UPDATE chat_conversations SET user_unread = 0 WHERE id = p_conversation_id AND user_id = auth.uid();
  ELSIF p_side = 'admin' THEN
    UPDATE chat_conversations SET admin_unread = 0 WHERE id = p_conversation_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID, TEXT) TO authenticated;

-- 9. Auto-purge messages older than 10 days (call via pg_cron or periodic edge function)
CREATE OR REPLACE FUNCTION purge_old_chat_messages() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM chat_messages WHERE created_at < now() - INTERVAL '10 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;
-- Only service_role should call purge — no public grant
