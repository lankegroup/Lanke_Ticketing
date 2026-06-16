-- ── 1. Add print_count to registrations ──────────────────────────────────────
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS print_count INT NOT NULL DEFAULT 0;

-- ── 2. admin_increment_print_count RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_increment_print_count(
  p_registration_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE registrations
  SET print_count = print_count + 1
  WHERE id = p_registration_id
  RETURNING print_count INTO v_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_increment_print_count(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_increment_print_count(uuid) FROM PUBLIC, anon;
