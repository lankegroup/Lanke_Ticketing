
-- Add missing UPDATE policy for seats table so admin_bulk_block_seats can update is_blocked
CREATE POLICY "seats_admin_update"
  ON seats FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));
