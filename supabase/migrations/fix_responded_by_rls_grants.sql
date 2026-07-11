-- Fix responded_by access for the app (authenticated browser client).
-- Symptoms: list empty and/or "Could not add — name may already exist" on every insert
-- when the real cause is RLS / missing GRANTs (not uniqueness).

ALTER TABLE responded_by ENABLE ROW LEVEL SECURITY;

-- Recreate policies scoped like other lookup tables, with explicit roles
DROP POLICY IF EXISTS "Enable read for authenticated users" ON responded_by;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON responded_by;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON responded_by;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON responded_by;

CREATE POLICY "responded_by_select_authenticated"
  ON responded_by FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "responded_by_insert_authenticated"
  ON responded_by FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "responded_by_update_authenticated"
  ON responded_by FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "responded_by_delete_authenticated"
  ON responded_by FOR DELETE
  TO authenticated
  USING (true);

-- Also allow anon if the project uses anon key without a user JWT (optional safety)
DROP POLICY IF EXISTS "responded_by_select_anon" ON responded_by;
DROP POLICY IF EXISTS "responded_by_insert_anon" ON responded_by;
DROP POLICY IF EXISTS "responded_by_update_anon" ON responded_by;
DROP POLICY IF EXISTS "responded_by_delete_anon" ON responded_by;

CREATE POLICY "responded_by_select_anon"
  ON responded_by FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "responded_by_insert_anon"
  ON responded_by FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "responded_by_update_anon"
  ON responded_by FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "responded_by_delete_anon"
  ON responded_by FOR DELETE
  TO anon
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE responded_by TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE responded_by TO anon;
GRANT ALL ON TABLE responded_by TO service_role;
