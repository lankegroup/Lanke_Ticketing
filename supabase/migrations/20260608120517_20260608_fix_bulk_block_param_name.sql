-- Rename parameter p_block -> p_blocked to match all client call sites
DROP FUNCTION IF EXISTS public.admin_bulk_block_seats(uuid[], boolean, text);

CREATE OR REPLACE FUNCTION public.admin_bulk_block_seats(
  p_seat_ids UUID[],
  p_blocked  BOOLEAN,
  p_reason   TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, blocked_count INT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE seats
  SET is_blocked = p_blocked,
      block_reason = CASE WHEN p_blocked THEN p_reason ELSE NULL END
  WHERE id = ANY(p_seat_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT true, v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_bulk_block_seats(uuid[], boolean, text) TO service_role;
