-- Null out resolution status and priority for incidents with no reference number.
-- Aligns DB with app rules: no-ref rows show empty status/priority; priority is not defaulted.
--
-- Run in Supabase SQL Editor (or psql) against the app database.
-- Safe to re-run (idempotent for already-cleared rows).

-- ---------------------------------------------------------------------------
-- Preview (optional): how many rows will be updated
-- ---------------------------------------------------------------------------
-- SELECT
--   id,
--   reference_no,
--   action_id,
--   marked
-- FROM incidents
-- WHERE btrim(coalesce(reference_no, '')) = '';

-- ---------------------------------------------------------------------------
-- Apply
-- ---------------------------------------------------------------------------
-- action_id: FK → null (no resolution status)
-- marked:    text NOT NULL DEFAULT '' → empty string (blank priority; column disallows SQL NULL)

UPDATE incidents
SET
  action_id = NULL,
  marked = '',
  updated_at = now()
WHERE btrim(coalesce(reference_no, '')) = '';

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- SELECT count(*) AS blank_ref_still_with_status_or_priority
-- FROM incidents
-- WHERE btrim(coalesce(reference_no, '')) = ''
--   AND (action_id IS NOT NULL OR btrim(coalesce(marked, '')) <> '');
