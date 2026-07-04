-- Add sender, marked, and source columns to incidents
-- source distinguishes UI-created incidents (editable email fields) from imports

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS sender TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS marked TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import'
    CHECK (source IN ('ui', 'import'));

-- Classify imports: email metadata, or legacy rows without a user_id (e.g. Apps Script)
UPDATE incidents
SET source = 'import'
WHERE NULLIF(TRIM(COALESCE(email_sender, '')), '') IS NOT NULL
   OR NULLIF(TRIM(COALESCE(email_subject, '')), '') IS NOT NULL
   OR user_id IS NULL;

-- Remaining rows with a user_id and no email metadata were likely created in the UI
UPDATE incidents
SET source = 'ui'
WHERE source = 'import'
  AND NULLIF(TRIM(COALESCE(email_sender, '')), '') IS NULL
  AND NULLIF(TRIM(COALESCE(email_subject, '')), '') IS NULL
  AND user_id IS NOT NULL;

-- Defense-in-depth: reject email column changes on imported incidents (bypasses app layer)
CREATE OR REPLACE FUNCTION prevent_import_email_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.source = 'import' THEN
    IF NEW.email_sender IS DISTINCT FROM OLD.email_sender THEN
      RAISE EXCEPTION 'Cannot modify email_sender on imported incidents';
    END IF;
    IF NEW.email_subject IS DISTINCT FROM OLD.email_subject THEN
      RAISE EXCEPTION 'Cannot modify email_subject on imported incidents';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS incidents_prevent_import_email_update ON incidents;
CREATE TRIGGER incidents_prevent_import_email_update
  BEFORE UPDATE ON incidents
  FOR EACH ROW
  EXECUTE FUNCTION prevent_import_email_update();