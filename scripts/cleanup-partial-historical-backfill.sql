-- =============================================================================
-- Cleanup if a PARTIAL historical backfill was committed
-- Same delete criteria as scripts/rollback-historical-incidents-through-jun2026.sql
-- Section B. Does NOT prune lookups (run rollback Section C separately if desired).
--
-- 1) Run scripts/check-partial-historical-backfill.sql first
-- 2) If import_no_email_in_range > 0, run this script
-- 3) Then re-run the FIXED backfill script
-- =============================================================================

BEGIN;

WITH deleted AS (
  DELETE FROM incidents i
  WHERE i.source = 'import'
    AND i.date_received >= DATE '2023-04-03'
    AND i.date_received <  DATE '2026-07-01'
    AND coalesce(btrim(i.email_sender), '') = ''
    AND coalesce(btrim(i.email_subject), '') = ''
  RETURNING i.id, i.date_received, i.reference_no
)
SELECT
  count(*) AS deleted_rows,
  min(date_received) AS min_deleted_date,
  max(date_received) AS max_deleted_date
FROM deleted;

SELECT
  (SELECT count(*) FROM incidents
     WHERE source = 'import'
       AND date_received >= DATE '2023-04-03'
       AND date_received < DATE '2026-07-01'
       AND coalesce(btrim(email_sender), '') = ''
       AND coalesce(btrim(email_subject), '') = '') AS remaining_backfill_candidates,
  (SELECT count(*) FROM incidents WHERE date_received >= DATE '2026-07-01') AS jul2026_or_later,
  (SELECT count(*) FROM incidents) AS total_incidents;

COMMIT;
