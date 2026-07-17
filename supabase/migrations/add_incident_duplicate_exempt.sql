-- Allow later same-reference incidents to be treated as distinct (not DUPLICATE).
-- Default false: automatic DUPE tagging from shared reference numbers still applies.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS duplicate_exempt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN incidents.duplicate_exempt IS
  'When true, this row is not tagged DUPLICATE even if a later/earlier row shares the same reference number';

CREATE INDEX IF NOT EXISTS idx_incidents_duplicate_exempt
  ON incidents (duplicate_exempt)
  WHERE duplicate_exempt = true;
