-- Enable REPLICA IDENTITY FULL so UPDATE broadcasts the full new row
-- (without this, only the PK is sent and available_stock wouldn't appear in the payload)
ALTER TABLE sessions REPLICA IDENTITY FULL;

-- Add sessions table to the Supabase Realtime publication if not already there
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
  END IF;
END $$;
