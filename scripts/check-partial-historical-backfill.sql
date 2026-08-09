-- =============================================================================
-- Check whether the historical backfill partially applied
-- Safe / read-only. Run in Supabase SQL Editor.
-- =============================================================================

-- 1) Import-style rows in the backfill date window (sheet signature)
SELECT
  count(*) AS import_no_email_in_range,
  min(date_received) AS min_date,
  max(date_received) AS max_date
FROM incidents
WHERE source = 'import'
  AND date_received >= DATE '2023-04-03'
  AND date_received <  DATE '2026-07-01'
  AND coalesce(btrim(email_sender), '') = ''
  AND coalesce(btrim(email_subject), '') = '';

-- 2) All import rows (any date)
SELECT count(*) AS all_import_rows
FROM incidents
WHERE source = 'import';

-- 3) Sample of possible backfill rows
SELECT id, date_received, reference_no, left(coalesce(reference_text,''), 60) AS reference_text,
       source, type_id, driver_id, action_id, team_leader_id
FROM incidents
WHERE source = 'import'
  AND date_received >= DATE '2023-04-03'
  AND date_received <  DATE '2026-07-01'
  AND coalesce(btrim(email_sender), '') = ''
  AND coalesce(btrim(email_subject), '') = ''
ORDER BY date_received DESC
LIMIT 20;

-- 4) Lookups that look recently added (optional signal only)
SELECT 'incident_types' AS tbl, count(*) AS n FROM incident_types
UNION ALL
SELECT 'incident_actions', count(*) FROM incident_actions
UNION ALL
SELECT 'drivers', count(*) FROM drivers
UNION ALL
SELECT 'team_leaders', count(*) FROM team_leaders
UNION ALL
SELECT 'responded_by', count(*) FROM responded_by;

-- 5) Types that are UPPERCASE and match common sheet styles (informational)
SELECT count(*) AS uppercase_types
FROM incident_types
WHERE name = upper(name);

-- Interpretation:
--   import_no_email_in_range = 0  → incident inserts did NOT stick (full rollback or never reached)
--   import_no_email_in_range > 0 → some/all incident rows were committed; use rollback script Section B
--   Lookups may still have grown even if incidents rolled back (only if statements ran outside one txn)
