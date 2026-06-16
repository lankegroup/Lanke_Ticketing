-- These three functions are now called exclusively through edge functions
-- (which run server-side with the service role key).
-- Revoke direct RPC access so no client role can invoke them.
REVOKE ALL ON FUNCTION public.book_ticket(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_ticket(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_past_tickets() FROM PUBLIC, anon, authenticated;
