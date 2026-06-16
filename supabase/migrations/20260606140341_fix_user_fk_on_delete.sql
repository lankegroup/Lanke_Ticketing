
-- Fix FK constraints that block user deletion by changing RESTRICT to SET NULL

ALTER TABLE registrations
  DROP CONSTRAINT IF EXISTS registrations_validated_by_fkey,
  ADD CONSTRAINT registrations_validated_by_fkey
    FOREIGN KEY (validated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE validation_logs
  DROP CONSTRAINT IF EXISTS validation_logs_admin_id_fkey,
  ADD CONSTRAINT validation_logs_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE feedback_tickets
  DROP CONSTRAINT IF EXISTS feedback_tickets_replied_by_fkey,
  ADD CONSTRAINT feedback_tickets_replied_by_fkey
    FOREIGN KEY (replied_by) REFERENCES auth.users(id) ON DELETE SET NULL;
