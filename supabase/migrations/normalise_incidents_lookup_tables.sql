-- Normalise incidents table: replace string columns with FK references
-- This migration:
--   1. Creates incident_types and incident_actions lookup tables
--   2. Populates them with existing values
--   3. Adds FK columns to incidents (type_id, action_id, driver_id, team_leader_id)
--   4. Backfills FK columns from existing string values
--   5. Drops the old string columns


-- ============================================================
-- 1. Create lookup tables
-- ============================================================

CREATE TABLE IF NOT EXISTS incident_types (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS incident_actions (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE
);


-- ============================================================
-- 2. Seed lookup tables with existing values
-- ============================================================

INSERT INTO incident_types (name) VALUES
  ('DELIVERY COMPLAINT'),
  ('Disputed Delivery'),
  ('Feedback'),
  ('Incident Report'),
  ('Investigation'),
  ('Missing item'),
  ('STOP DELIVERY'),
  ('CARDING ISSUE'),
  ('Redelivery Request'),
  ('Delivery Request'),
  ('Incorrect Delivery')
ON CONFLICT (name) DO NOTHING;

INSERT INTO incident_actions (name) VALUES
  ('New'),
  ('LIT'),
  ('LPO'),
  ('Resolved'),
  ('Ack'),
  ('AP staff')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- 3. Add new FK columns to incidents (nullable during migration)
-- ============================================================

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS type_id        UUID REFERENCES incident_types(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_id      UUID REFERENCES incident_actions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_id      UUID REFERENCES drivers(id)          ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_leader_id UUID REFERENCES team_leaders(id)     ON DELETE SET NULL;


-- ============================================================
-- 4. Backfill / Drop skipped
-- ============================================================
-- The old string columns (type, action, driver, team_leader) were already
-- removed in a prior migration, so there is nothing to backfill or drop.


-- ============================================================
-- 6. Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_incidents_type_id        ON incidents(type_id);
CREATE INDEX IF NOT EXISTS idx_incidents_action_id      ON incidents(action_id);
CREATE INDEX IF NOT EXISTS idx_incidents_driver_id      ON incidents(driver_id);
CREATE INDEX IF NOT EXISTS idx_incidents_team_leader_id ON incidents(team_leader_id);


-- ============================================================
-- 7. RLS policies for new lookup tables
-- ============================================================

ALTER TABLE incident_types   ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read for authenticated users" ON incident_types;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON incident_types;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON incident_types;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON incident_types;

CREATE POLICY "Enable read for authenticated users" ON incident_types
  FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON incident_types
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for authenticated users" ON incident_types
  FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for authenticated users" ON incident_types
  FOR DELETE USING (true);

DROP POLICY IF EXISTS "Enable read for authenticated users" ON incident_actions;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON incident_actions;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON incident_actions;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON incident_actions;

CREATE POLICY "Enable read for authenticated users" ON incident_actions
  FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON incident_actions
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for authenticated users" ON incident_actions
  FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for authenticated users" ON incident_actions
  FOR DELETE USING (true);
