-- Fix mutable search_path on trigger function
CREATE OR REPLACE FUNCTION sessions_auto_is_active_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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

-- Revoke public RPC access to auto_manage_session_status
-- (only service_role via cron/edge function should call it)
REVOKE EXECUTE ON FUNCTION public.auto_manage_session_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_manage_session_status() FROM authenticated;
