-- Enforce uppercase storage for name fields in lookup tables
-- This migration:
--   1. Uppercases all existing name values in lookup tables
--   2. Drops case-sensitive UNIQUE constraints and replaces with
--      case-insensitive functional unique indexes on UPPER(name)
--   3. Adds CHECK constraints to reject non-uppercase inserts at the DB level


-- ============================================================
-- 1. Uppercase existing data
-- ============================================================

UPDATE incident_types   SET name = UPPER(name);
UPDATE incident_actions SET name = UPPER(name);
UPDATE team_leaders     SET name = UPPER(name);
UPDATE drivers          SET name = UPPER(name), username = UPPER(username);


-- ============================================================
-- 2. Replace UNIQUE constraints with case-insensitive functional indexes
--    (prevents "New" and "NEW" being treated as distinct rows)
-- ============================================================

-- incident_types
ALTER TABLE incident_types DROP CONSTRAINT IF EXISTS incident_types_name_key;
DROP INDEX IF EXISTS idx_incident_types_name_upper;
CREATE UNIQUE INDEX idx_incident_types_name_upper ON incident_types (UPPER(name));

-- incident_actions
ALTER TABLE incident_actions DROP CONSTRAINT IF EXISTS incident_actions_name_key;
DROP INDEX IF EXISTS idx_incident_actions_name_upper;
CREATE UNIQUE INDEX idx_incident_actions_name_upper ON incident_actions (UPPER(name));

-- team_leaders: deduplicate first, then enforce uniqueness
-- For each duplicate group, keep the row with the earliest created_at (or smallest id),
-- re-point any incidents referencing the discarded IDs, then delete the duplicates.
DO $$
DECLARE
  canonical_id UUID;
  dup_id       UUID;
BEGIN
  FOR canonical_id, dup_id IN
    WITH ranked AS (
      SELECT
        id,
        FIRST_VALUE(id) OVER (
          PARTITION BY UPPER(name)
          ORDER BY created_at NULLS LAST, id
        ) AS keep_id,
        COUNT(*) OVER (PARTITION BY UPPER(name)) AS cnt
      FROM team_leaders
    )
    SELECT keep_id, id FROM ranked WHERE cnt > 1 AND id <> keep_id
  LOOP
    UPDATE incidents SET team_leader_id = canonical_id WHERE team_leader_id = dup_id;
    UPDATE drivers   SET team_leader_id = canonical_id WHERE team_leader_id = dup_id;
    DELETE FROM team_leaders WHERE id = dup_id;
  END LOOP;
END $$;

DROP INDEX IF EXISTS idx_team_leaders_name_upper;
CREATE UNIQUE INDEX idx_team_leaders_name_upper ON team_leaders (UPPER(name));

-- drivers (unique on username)
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_username_key;
DROP INDEX IF EXISTS idx_drivers_username_upper;
CREATE UNIQUE INDEX idx_drivers_username_upper ON drivers (UPPER(username));


-- ============================================================
-- 3. CHECK constraints to enforce uppercase at DB level
--    Rejects any INSERT/UPDATE where name != UPPER(name)
-- ============================================================

ALTER TABLE incident_types
  DROP CONSTRAINT IF EXISTS chk_incident_types_name_upper,
  ADD  CONSTRAINT chk_incident_types_name_upper CHECK (name = UPPER(name));

ALTER TABLE incident_actions
  DROP CONSTRAINT IF EXISTS chk_incident_actions_name_upper,
  ADD  CONSTRAINT chk_incident_actions_name_upper CHECK (name = UPPER(name));

ALTER TABLE team_leaders
  DROP CONSTRAINT IF EXISTS chk_team_leaders_name_upper,
  ADD  CONSTRAINT chk_team_leaders_name_upper CHECK (name = UPPER(name));

ALTER TABLE drivers
  DROP CONSTRAINT IF EXISTS chk_drivers_name_upper,
  DROP CONSTRAINT IF EXISTS chk_drivers_username_upper,
  ADD  CONSTRAINT chk_drivers_name_upper     CHECK (name     = UPPER(name)),
  ADD  CONSTRAINT chk_drivers_username_upper CHECK (username = UPPER(username));
