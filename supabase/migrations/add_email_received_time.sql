-- ============================================================
-- Email received time (when Gmail delivered the message)
-- Distinct from incidents.time (incident/event time from body)
-- Written by Google Apps Script as email_received_time (HH:mm)
-- ============================================================

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS email_received_time TEXT;

COMMENT ON COLUMN incidents.email_received_time IS
  'Clock time the email was received (Australia/Sydney HH:mm), from Gmail message date. Separate from incident event time (`time`).';

-- Optional: copy existing incident.time into email_received_time only where
-- email_received_time is blank and time looks like a pure clock (HH:mm / HH:mm:ss).
-- Uncomment if you want a one-time backfill for rows already imported with time only.
/*
UPDATE incidents
SET email_received_time = LEFT(trim(time), 5)
WHERE (email_received_time IS NULL OR trim(email_received_time) = '')
  AND time IS NOT NULL
  AND trim(time) ~ '^\d{1,2}:\d{2}(:\d{2})?$';
*/
