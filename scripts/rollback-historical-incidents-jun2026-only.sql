-- =============================================================================
-- ROLLBACK: June 2026-only historical backfill
-- Companion to: scripts/backfill-historical-incidents-jun2026-only.sql
-- Generated: 2026-08-09T02:04:56Z
--
-- Deletes import-signature rows for June 2026 only:
--   source = 'import'
--   date_received in [2026-06-01, 2026-07-01)
--   empty email_sender / email_subject
-- =============================================================================

-- PREVIEW
SELECT count(*) AS will_delete, min(date_received), max(date_received)
FROM incidents
WHERE source = 'import'
  AND date_received >= DATE '2026-06-01'
  AND date_received <  DATE '2026-07-01'
  AND coalesce(btrim(email_sender), '') = ''
  AND coalesce(btrim(email_subject), '') = '';

-- DELETE
BEGIN;
WITH deleted AS (
  DELETE FROM incidents
  WHERE source = 'import'
    AND date_received >= DATE '2026-06-01'
    AND date_received <  DATE '2026-07-01'
    AND coalesce(btrim(email_sender), '') = ''
    AND coalesce(btrim(email_subject), '') = ''
  RETURNING id
)
SELECT count(*) AS deleted_rows FROM deleted;
COMMIT;
