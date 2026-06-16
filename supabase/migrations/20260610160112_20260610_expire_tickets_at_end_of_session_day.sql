-- Expire active tickets at 23:59:59 on the session date (not at end_time)
CREATE OR REPLACE FUNCTION public.expire_past_tickets()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE registrations r
  SET status = 'expired'
  FROM sessions s
  WHERE r.session_id = s.id
    AND r.status = 'active'
    AND (s.session_date::date + interval '23 hours 59 minutes 59 seconds') < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
