-- Function: auto-deactivate sessions where verification_end has passed,
-- and auto-reactivate when the window is extended into the future.
CREATE OR REPLACE FUNCTION auto_manage_session_status()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  -- Deactivate sessions whose verification window has passed
  UPDATE sessions
  SET is_active = false
  WHERE is_active = true
    AND verification_end IS NOT NULL
    AND (session_date + verification_end)::timestamp < now();

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_manage_session_status() TO service_role;

-- Cron job: sweep every 5 minutes
SELECT cron.schedule(
  'auto-manage-sessions',
  '*/5 * * * *',
  $$SELECT auto_manage_session_status()$$
);

-- Trigger: fires on BEFORE UPDATE when verification_end or session_date changes.
-- Automatically sets is_active based on whether the new window is in the future.
CREATE OR REPLACE FUNCTION sessions_auto_is_active_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.verification_end IS DISTINCT FROM OLD.verification_end
      OR NEW.session_date IS DISTINCT FROM OLD.session_date) THEN
    IF NEW.verification_end IS NOT NULL THEN
      IF (NEW.session_date + NEW.verification_end)::timestamp < now() THEN
        NEW.is_active := false;
      ELSE
        NEW.is_active := true;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_auto_is_active ON sessions;
CREATE TRIGGER sessions_auto_is_active
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION sessions_auto_is_active_fn();
