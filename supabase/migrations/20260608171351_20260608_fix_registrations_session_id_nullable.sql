-- Allow session_id to be NULL so ON DELETE SET NULL works when a session is deleted
ALTER TABLE registrations ALTER COLUMN session_id DROP NOT NULL;
