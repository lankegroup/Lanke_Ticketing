-- 1. Revoke broad public EXECUTE from all SECURITY DEFINER functions
--    (PostgreSQL grants EXECUTE to PUBLIC by default on new functions)

-- update_updated_at_column: trigger-only, never callable via RPC by clients
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- book_ticket: only authenticated (logged-in) users should book
REVOKE ALL ON FUNCTION public.book_ticket(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_ticket(uuid, text, text, uuid) TO authenticated;

-- cancel_ticket: only authenticated users cancel their own tickets
REVOKE ALL ON FUNCTION public.cancel_ticket(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(uuid, uuid) TO authenticated;

-- expire_past_tickets: only authenticated (called by admin + client pages)
REVOKE ALL ON FUNCTION public.expire_past_tickets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_past_tickets() TO authenticated;

-- 2. Fix storage: drop the overly broad SELECT policy that allows anon listing
--    Public bucket URLs remain accessible without any RLS policy.
--    Replace with a policy scoped only to authenticated users and only for INSERT/UPDATE/DELETE
--    (SELECT not needed — public bucket objects are accessible via public URL without RLS).
DROP POLICY IF EXISTS "auth_images_select" ON storage.objects;
DROP POLICY IF EXISTS "public_images_select" ON storage.objects;

-- Admins can upload/update/delete objects in the announcements bucket
DROP POLICY IF EXISTS "auth_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "auth_images_update" ON storage.objects;
DROP POLICY IF EXISTS "auth_images_delete" ON storage.objects;

CREATE POLICY "auth_images_insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'announcements'
    AND EXISTS (SELECT 1 FROM public.admin_profiles WHERE id = auth.uid())
  );

CREATE POLICY "auth_images_update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'announcements'
    AND EXISTS (SELECT 1 FROM public.admin_profiles WHERE id = auth.uid())
  );

CREATE POLICY "auth_images_delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'announcements'
    AND EXISTS (SELECT 1 FROM public.admin_profiles WHERE id = auth.uid())
  );
