-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Fix chat_quick_replies RLS — restrict write access to admins only
-- ──────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "qr_update" ON chat_quick_replies;
DROP POLICY IF EXISTS "qr_delete" ON chat_quick_replies;

CREATE POLICY "qr_update" ON chat_quick_replies FOR UPDATE
  TO authenticated
  USING   (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "qr_delete" ON chat_quick_replies FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Strip the implicit PUBLIC execute grant from every SECURITY DEFINER RPC,
--    then re-grant only to the roles that legitimately need each function.
--
--    Supabase grants EXECUTE to PUBLIC by default for all functions.
--    REVOKING from individual roles (anon/authenticated) does NOT help when
--    PUBLIC still has the grant — roles inherit through PUBLIC.
--    We must REVOKE FROM PUBLIC first.
-- ──────────────────────────────────────────────────────────────────────────────

-- Seating RPCs
REVOKE EXECUTE ON FUNCTION public.get_seat_map(UUID)                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_seat(UUID)                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlock_seat(UUID)                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_session_seats(UUID, INT, INT)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;

-- Chat RPCs
REVOKE EXECUTE ON FUNCTION public.send_chat_message(UUID, TEXT, TEXT)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation()                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(UUID, TEXT)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_old_chat_messages()                       FROM PUBLIC;

-- Also drop any lingering per-role grants that previous migrations may have left
REVOKE EXECUTE ON FUNCTION public.get_seat_map(UUID)                              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_seat(UUID)                                 FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_seat(UUID)                               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_session_seats(UUID, INT, INT)          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_book_ticket(UUID, UUID, TEXT, TEXT, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.book_ticket_with_seat(UUID, UUID, TEXT, TEXT, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_chat_message(UUID, TEXT, TEXT)             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation()                    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(UUID, TEXT)              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_chat_messages()                       FROM anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Re-grant to exactly the right roles
-- ──────────────────────────────────────────────────────────────────────────────

-- Client-callable seating RPCs (requires login)
GRANT EXECUTE ON FUNCTION public.get_seat_map(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_seat(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_seat(UUID)              TO authenticated;
-- generate_session_seats is called by admin frontend (authenticated admin user)
GRANT EXECUTE ON FUNCTION public.generate_session_seats(UUID, INT, INT) TO authenticated;

-- admin_book_ticket + book_ticket_with_seat: called ONLY via edge function with
-- service_role key — no public or authenticated grant needed
-- (service_role bypasses RLS and always has EXECUTE)

-- Client & admin chat RPCs (requires login)
GRANT EXECUTE ON FUNCTION public.send_chat_message(UUID, TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID, TEXT)   TO authenticated;

-- purge_old_chat_messages: maintenance only — no public grant (service_role only)
