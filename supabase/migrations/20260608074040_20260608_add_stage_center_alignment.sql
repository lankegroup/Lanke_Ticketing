
-- Add stage_center_col to sessions table to store horizontal stage alignment
ALTER TABLE sessions ADD COLUMN stage_center_col NUMERIC DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN sessions.stage_center_col IS 'Column number where the stage center aligns (1-based). NULL means auto-center. Used for asymmetric stage positioning.';
