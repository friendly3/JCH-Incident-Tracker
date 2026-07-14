-- Persist geocoded NSW map coordinates on incidents.
-- Filled on save / backfill / first map resolve; dashboard map reads these first
-- so page loads do not re-hit Nominatim for every place.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS location_precision TEXT NULL,
  ADD COLUMN IF NOT EXISTS location_geocoded_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN incidents.location_lat IS 'Geocoded latitude (WGS84) for NSW map pin.';
COMMENT ON COLUMN incidents.location_lng IS 'Geocoded longitude (WGS84) for NSW map pin.';
COMMENT ON COLUMN incidents.location_precision IS 'street | suburb | region — geocode quality.';
COMMENT ON COLUMN incidents.location_geocoded_at IS 'When location_lat/lng were last resolved.';

-- Optional index for “still needs geocode” scans
CREATE INDEX IF NOT EXISTS incidents_location_coords_missing_idx
  ON incidents (id)
  WHERE location_suburb IS NOT NULL
    AND btrim(location_suburb) <> ''
    AND location_lat IS NULL;
