-- Manual map location for incidents (street + suburb, NSW).
-- Overrides email-subject parsing when set; used by the dashboard map.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS location_street TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_suburb TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN incidents.location_street IS 'User-identified street for map placement (NSW).';
COMMENT ON COLUMN incidents.location_suburb IS 'User-identified suburb for map placement (NSW).';
