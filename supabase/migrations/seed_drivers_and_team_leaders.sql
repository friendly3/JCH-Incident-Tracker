-- Seed team_leaders and drivers tables from existing dataset
-- Run this BEFORE normalise_incidents_lookup_tables.sql so the backfill
-- step can match driver/team_leader strings to their new FK ids.

-- ============================================================
-- 1. Team Leaders
-- ============================================================

INSERT INTO team_leaders (id, name)
VALUES
  (gen_random_uuid(), 'Andrew Tran'),
  (gen_random_uuid(), 'Jake Pham'),
  (gen_random_uuid(), 'Brett Hopgood')
ON CONFLICT DO NOTHING;


-- ============================================================
-- 2. Drivers (username = the value stored in incidents.driver)
--    name is set to username as no full names are available in the dataset.
--    team_leader_id is left NULL — assign manually after if needed.
-- ============================================================

INSERT INTO drivers (id, name, username)
VALUES
  (gen_random_uuid(), 'DANGINP',    'DANGINP'),
  (gen_random_uuid(), 'CHUAIPHAC',  'CHUAIPHAC'),
  (gen_random_uuid(), 'DETVONGSK',  'DETVONGSK'),
  (gen_random_uuid(), 'DONTITHIW',  'DONTITHIW'),
  (gen_random_uuid(), 'GRICIN',     'GRICIN'),
  (gen_random_uuid(), 'HUYNHD13',   'HUYNHD13'),
  (gen_random_uuid(), 'KHAMPORNC',  'KHAMPORNC'),
  (gen_random_uuid(), 'KONGTHONP',  'KONGTHONP'),
  (gen_random_uuid(), 'LOUD3',      'LOUD3'),
  (gen_random_uuid(), 'NANPANYAT',  'NANPANYAT'),
  (gen_random_uuid(), 'NGUYENM72',  'NGUYENM72'),
  (gen_random_uuid(), 'NGUYENS35',  'NGUYENS35'),
  (gen_random_uuid(), 'PACHARASJ',  'PACHARASJ'),
  (gen_random_uuid(), 'PARMENTEM',  'PARMENTEM'),
  (gen_random_uuid(), 'PATELD133',  'PATELD133'),
  (gen_random_uuid(), 'PHAMJ8',     'PHAMJ8'),
  (gen_random_uuid(), 'PHAMT60',    'PHAMT60'),
  (gen_random_uuid(), 'SANTANGELONDN', 'SANTANGELONDN'),
  (gen_random_uuid(), 'SOCACIUD',   'SOCACIUD'),
  (gen_random_uuid(), 'STEWARTR9',  'STEWARTR9'),
  (gen_random_uuid(), 'TRANR11',    'TRANR11'),
  (gen_random_uuid(), 'TRUONGW',    'TRUONGW'),
  (gen_random_uuid(), 'VOH7',       'VOH7')
ON CONFLICT (username) DO NOTHING;
