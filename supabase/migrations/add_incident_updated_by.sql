-- Track who last changed an incident (display name denormalised for client reads).
-- updated_at may already exist from earlier schemas; IF NOT EXISTS keeps this safe.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_updated_at ON incidents (updated_at DESC NULLS LAST);

COMMENT ON COLUMN incidents.updated_at IS 'When the incident row was last written';
COMMENT ON COLUMN incidents.updated_by IS 'auth.users id of the last editor (when known)';
COMMENT ON COLUMN incidents.updated_by_name IS 'Display name/email of last editor at time of write';
