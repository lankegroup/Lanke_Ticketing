-- 1. Add deleted_at soft-delete column to registrations
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Change registrations.session_id FK to SET NULL on session delete
--    (preserves order records when the session is deleted)
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_session_id_fkey;
ALTER TABLE registrations ADD CONSTRAINT registrations_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- 3. Audit log table for admin operations
CREATE TABLE IF NOT EXISTS order_audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registration_id UUID,
  action       TEXT NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE order_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_admin" ON order_audit_logs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "audit_insert_admin" ON order_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- 4. Client soft-delete function: users can only delete their own registrations
--    that are in a terminal state (used, cancelled, expired).
CREATE OR REPLACE FUNCTION public.client_delete_registration(p_registration_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_user_id UUID;
BEGIN
  SELECT status, user_id INTO v_status, v_user_id
  FROM registrations
  WHERE id = p_registration_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  -- Ownership check
  IF v_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_owner');
  END IF;

  -- Only terminal statuses can be deleted by the client
  IF v_status = 'active' THEN
    RETURN json_build_object('success', FALSE, 'error', 'cannot_delete_active');
  END IF;

  UPDATE registrations SET deleted_at = NOW() WHERE id = p_registration_id;

  RETURN json_build_object('success', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_delete_registration(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.client_delete_registration(UUID) TO authenticated;

-- 5. Admin soft-delete function: admins can delete any order + log the action
CREATE OR REPLACE FUNCTION public.admin_delete_registration(
  p_registration_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Admin guard
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = p_registration_id AND deleted_at IS NULL) THEN
    RETURN json_build_object('success', FALSE, 'error', 'not_found');
  END IF;

  UPDATE registrations SET deleted_at = NOW() WHERE id = p_registration_id;

  INSERT INTO order_audit_logs (admin_id, registration_id, action, note)
  VALUES (auth.uid(), p_registration_id, 'soft_delete', p_note);

  RETURN json_build_object('success', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_registration(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_delete_registration(UUID, TEXT) TO authenticated;

-- 6. Auto-cleanup function: soft-delete terminal orders older than 7 days
CREATE OR REPLACE FUNCTION public.auto_cleanup_old_orders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE registrations
  SET deleted_at = NOW()
  WHERE deleted_at IS NULL
    AND status IN ('used', 'expired', 'cancelled')
    AND (
      -- used/expired: 7 days after validated_at (or created_at as fallback)
      (status IN ('used', 'expired') AND COALESCE(validated_at, created_at) < NOW() - INTERVAL '7 days')
      OR
      -- cancelled: 7 days after created_at (no validated_at for cancellations)
      (status = 'cancelled' AND created_at < NOW() - INTERVAL '7 days')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_cleanup_old_orders() FROM PUBLIC, anon, authenticated;

-- 7. Schedule daily cleanup at 03:00 UTC via pg_cron (extension assumed enabled)
DO $$
BEGIN
  -- Remove any existing job with this name to avoid duplicates on re-run
  PERFORM cron.unschedule('auto_cleanup_old_orders')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_cleanup_old_orders');

  PERFORM cron.schedule(
    'auto_cleanup_old_orders',
    '0 3 * * *',
    $cron$SELECT public.auto_cleanup_old_orders();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  -- If pg_cron is not available, silently continue — function exists and can be called manually
  NULL;
END;
$$;
