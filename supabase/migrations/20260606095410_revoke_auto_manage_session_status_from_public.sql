-- Revoke the implicit PUBLIC grant that covers anon + authenticated
REVOKE EXECUTE ON FUNCTION public.auto_manage_session_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_manage_session_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_manage_session_status() FROM authenticated;
