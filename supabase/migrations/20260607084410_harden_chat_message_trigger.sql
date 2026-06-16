-- Wrap the trigger body in an exception handler so that a failure to UPDATE
-- chat_conversations (e.g. conversation deleted, constraint issue) does NOT
-- cause the entire chat_messages INSERT transaction to roll back.
-- The message itself should always be saved even if metadata update fails.
CREATE OR REPLACE FUNCTION fn_after_chat_message_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    -- Metadata update failed — do not abort the message insert
    NULL;
  END;
  RETURN NEW;
END;
$$;
