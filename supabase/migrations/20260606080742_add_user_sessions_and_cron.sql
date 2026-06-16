-- user_sessions table for multi-device login enforcement
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE user_sessions;

CREATE POLICY "select_own_sessions" ON user_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_sessions" ON user_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_sessions" ON user_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_sessions" ON user_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Daily auto-expire job: void all still-active tickets for past sessions at 23:59 every night
SELECT cron.schedule(
  'expire-tickets-daily',
  '59 23 * * *',
  $$SELECT expire_past_tickets()$$
);
