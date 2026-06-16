-- Revoke public/anon execute on all seating SECURITY DEFINER functions.
-- Edge-function-only RPCs: revoke from both anon and authenticated.
-- Client-callable RPCs: revoke from anon only (authenticated still needed).

-- Called exclusively from proxy-book-ticket edge function (service_role key)
REVOKE EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID) FROM anon, authenticated;

-- Called exclusively from book-ticket edge function (service_role key)
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID) FROM anon, authenticated;

-- Client-callable but only by logged-in users
REVOKE EXECUTE ON FUNCTION public.get_seat_map(UUID)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.lock_seat(UUID)                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.unlock_seat(UUID)                            FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_session_seats(UUID, INT, INT)       FROM anon;
