-- admin_reschedule_seat: admin-only seat change, supports force-booking blocked seats
CREATE OR REPLACE FUNCTION public.admin_reschedule_seat(
  p_registration_id UUID,
  p_new_seat_id     UUID,
  p_force           BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_reg            registrations%ROWTYPE;
  v_old_seat_name  TEXT;
  v_new_seat_name  TEXT;
  v_history        JSONB;
  v_was_blocked    BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_reg.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status');
  END IF;
  IF v_reg.seat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_seat');
  END IF;
  IF v_reg.seat_id = p_new_seat_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'same_seat');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND session_id = v_reg.session_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_seat');
  END IF;

  -- Check if new seat is blocked
  IF EXISTS (SELECT 1 FROM seats WHERE id = p_new_seat_id AND is_blocked = TRUE) THEN
    IF NOT p_force THEN
      RETURN jsonb_build_object('success', false, 'error', 'seat_blocked');
    END IF;
    v_was_blocked := TRUE;
  END IF;

  -- Check if new seat is already booked by another active registration
  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE seat_id = p_new_seat_id
      AND status NOT IN ('cancelled', 'expired')
      AND deleted_at IS NULL
      AND id <> p_registration_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'seat_taken');
  END IF;

  SELECT seat_name INTO v_old_seat_name FROM seats WHERE id = v_reg.seat_id;
  SELECT seat_name INTO v_new_seat_name FROM seats WHERE id = p_new_seat_id;

  -- If old seat was force-booked, restore is_blocked on old seat
  IF v_reg.was_force_booked THEN
    UPDATE seats SET is_blocked = TRUE WHERE id = v_reg.seat_id;
  END IF;

  -- If force-booking new blocked seat, clear is_blocked so it shows as sold
  IF v_was_blocked THEN
    UPDATE seats SET is_blocked = FALSE WHERE id = p_new_seat_id;
  END IF;

  -- Clear any lock on the new seat
  DELETE FROM seat_locks WHERE seat_id = p_new_seat_id;

  v_history := v_reg.reschedule_history || jsonb_build_array(
    jsonb_build_object(
      'from_seat',   v_old_seat_name,
      'to_seat',     v_new_seat_name,
      'changed_at',  NOW(),
      'by_admin',    TRUE,
      'force',       p_force AND v_was_blocked
    )
  );

  UPDATE registrations
  SET seat_id            = p_new_seat_id,
      reschedule_count   = reschedule_count + 1,
      reschedule_history = v_history,
      was_force_booked   = (p_force AND v_was_blocked)
  WHERE id = p_registration_id;

  RETURN jsonb_build_object('success', true, 'old_seat', v_old_seat_name, 'new_seat', v_new_seat_name);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reschedule_seat(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_reschedule_seat(uuid, uuid, boolean) TO authenticated;
