-- Function to send notifications to all users with active orders when a session is cancelled/deleted
CREATE OR REPLACE FUNCTION admin_send_session_cancelled_notifications(
  p_session_id   UUID,
  p_session_name TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id   UUID;
  v_count     INT := 0;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT user_id
    FROM public.registrations
    WHERE session_id = p_session_id
      AND status = 'active'
      AND user_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      v_user_id,
      'warning',
      '场次已取消',
      '您预约的场次【' || p_session_name || '】已被取消，您的订单已自动作废，如有疑问请联系客服。'
    );
    v_count := v_count + 1;
  END LOOP;

  -- Also cancel all active registrations for this session
  UPDATE public.registrations
  SET status = 'cancelled'
  WHERE session_id = p_session_id
    AND status = 'active';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION admin_send_session_cancelled_notifications(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_send_session_cancelled_notifications(UUID, TEXT) TO authenticated;
