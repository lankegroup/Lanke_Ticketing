-- ─────────────────────────────────────────────────────────────────────────────
-- Replace SECURITY DEFINER send_chat_message RPC with direct INSERT + trigger.
--
-- Root cause: SECURITY DEFINER functions run as the function owner, not the
-- calling user's JWT.  Supabase Realtime evaluates RLS in the subscriber's
-- JWT context against the WAL row — when the row was written by a different
-- pg role the realtime delivery is unreliable.  Direct INSERT preserves the
-- calling user's JWT all the way to the WAL, making realtime work correctly.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop SECURITY DEFINER hot-path RPCs
DROP FUNCTION IF EXISTS public.send_chat_message(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.mark_conversation_read(UUID, TEXT);

-- 2. Revoke from PUBLIC (belt-and-suspenders, they are dropped but keep clean)
-- (nothing to revoke — functions are gone)

-- 3. Fix chat_messages INSERT policies
--    Old policies allowed sender_role to be freely set by the caller.
--    New policies ENFORCE sender_role based on who is calling.

DROP POLICY IF EXISTS "msg_insert_own_conv" ON chat_messages;
DROP POLICY IF EXISTS "msg_admin_insert"    ON chat_messages;
DROP POLICY IF EXISTS "msg_no_update"       ON chat_messages;
DROP POLICY IF EXISTS "msg_no_delete"       ON chat_messages;

-- Users: must be owner of the conversation, not blocked, role locked to 'user'
CREATE POLICY "msg_insert_user" ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_role = 'user'
    AND EXISTS (
      SELECT 1 FROM chat_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = auth.uid()
        AND NOT c.is_blocked
    )
  );

-- Admins: must be in admin_profiles, role locked to 'admin'
CREATE POLICY "msg_insert_admin" ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_role = 'admin'
    AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

-- Messages are immutable (no UPDATE or DELETE for any authenticated user)
CREATE POLICY "msg_no_update" ON chat_messages FOR UPDATE TO authenticated USING (false);
CREATE POLICY "msg_no_delete" ON chat_messages FOR DELETE TO authenticated USING (false);

-- 4. Trigger: update conversation metadata atomically after each INSERT
--    (replaces the logic that was inside send_chat_message)
CREATE OR REPLACE FUNCTION fn_after_chat_message_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_role = 'user' THEN
    UPDATE chat_conversations
    SET last_message_at = now(),
        admin_unread    = admin_unread + 1,
        user_unread     = 0
    WHERE id = NEW.conversation_id;
  ELSE
    UPDATE chat_conversations
    SET last_message_at = now(),
        user_unread     = user_unread + 1,
        admin_unread    = 0
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_chat_message_insert ON chat_messages;
CREATE TRIGGER trg_after_chat_message_insert
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION fn_after_chat_message_insert();
