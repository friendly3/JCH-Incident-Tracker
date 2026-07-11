-- Responded By lookup values (managed under Configuration).
-- Starting values are seeded from existing team_leaders names.

CREATE TABLE IF NOT EXISTS responded_by (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_responded_by_name ON responded_by(name);

-- Seed from current team leaders (idempotent)
INSERT INTO responded_by (name)
SELECT DISTINCT trim(tl.name)
FROM team_leaders tl
WHERE tl.name IS NOT NULL
  AND trim(tl.name) <> ''
ON CONFLICT (name) DO NOTHING;

-- Also capture any free-text values already stored on incidents.response
INSERT INTO responded_by (name)
SELECT DISTINCT trim(i.response)
FROM incidents i
WHERE i.response IS NOT NULL
  AND trim(i.response) <> ''
ON CONFLICT (name) DO NOTHING;

ALTER TABLE responded_by ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read for authenticated users" ON responded_by;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON responded_by;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON responded_by;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON responded_by;

CREATE POLICY "Enable read for authenticated users" ON responded_by
  FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON responded_by
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for authenticated users" ON responded_by
  FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for authenticated users" ON responded_by
  FOR DELETE USING (true);
