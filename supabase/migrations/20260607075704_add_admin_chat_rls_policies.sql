-- Allow admin users to access all chat data

-- Conversations: admin can read all, update any
CREATE POLICY "conv_admin_select" ON chat_conversations FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

CREATE POLICY "conv_admin_update" ON chat_conversations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

-- Messages: admin can read and insert (reply) to any conversation
CREATE POLICY "msg_admin_select" ON chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

CREATE POLICY "msg_admin_insert" ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );
