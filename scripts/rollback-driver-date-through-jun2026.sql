-- =============================================================================
-- ROLLBACK: driver + date_received-only backfill (through June 2026)
-- Companion to: scripts/backfill-driver-date-through-jun2026.sql
-- Generated: 2026-08-09T02:08:09Z
--
-- Deletes minimal import rows matching the backfill signature:
--   source = 'import'
--   date_received in [2023-04-03, 2026-07-01)
--   empty email fields
--   type_id IS NULL AND action_id IS NULL
--     (this backfill never set type/action; reduces richer imports)
-- =============================================================================

-- PREVIEW
SELECT count(*) AS will_delete, min(date_received), max(date_received)
FROM incidents
WHERE source = 'import'
  AND date_received >= DATE '2023-04-03'
  AND date_received <  DATE '2026-07-01'
  AND coalesce(btrim(email_sender), '') = ''
  AND coalesce(btrim(email_subject), '') = ''
  AND type_id IS NULL
  AND action_id IS NULL;

-- DELETE
BEGIN;
WITH deleted AS (
  DELETE FROM incidents
  WHERE source = 'import'
    AND date_received >= DATE '2023-04-03'
    AND date_received <  DATE '2026-07-01'
    AND coalesce(btrim(email_sender), '') = ''
    AND coalesce(btrim(email_subject), '') = ''
    AND type_id IS NULL
    AND action_id IS NULL
  RETURNING id
)
SELECT count(*) AS deleted_rows FROM deleted;
COMMIT;
