-- =============================================================================
-- ROLLBACK: historical incident backfill (through June 2026)
-- Companion to: scripts/backfill-historical-incidents-through-jun2026.sql
-- Generated: 2026-08-09T01:54:15Z
-- Backfill extract: 3769 rows | 2023-04-03 → 2026-06-30
--
-- WHAT THIS REMOVES
--   Incidents from the Google Sheet historical backfill:
--     source = 'import'
--     date_received >= 2023-04-03 AND date_received < 2026-07-01
--     email_sender and email_subject empty/NULL
--       (sheet import left email fields blank; Gmail/Apps Script imports usually do not)
--
-- WHAT THIS KEEPS
--   - All July 2026+ incidents
--   - source = 'ui' rows
--   - import rows that still have email_sender / email_subject set
--
-- HOW TO RUN (Supabase → SQL Editor)
--   1. Run SECTION A only first and check the counts
--   2. If counts look correct, run SECTION B (delete)
--   3. Optionally run SECTION C to prune orphan lookup rows created for the import
--
-- Tip: In SQL Editor, highlight/run each section separately.
-- Safe to re-run after a successful rollback (deletes become no-ops).
-- =============================================================================


-- ############################################################################
-- SECTION A — PREVIEW (read-only)
-- ############################################################################

-- A1. Rows that will be deleted
SELECT
  count(*) AS will_delete,
  min(date_received) AS min_date,
  max(date_received) AS max_date
FROM incidents i
WHERE i.source = 'import'
  AND i.date_received >= DATE '2023-04-03'
  AND i.date_received <  DATE '2026-07-01'
  AND coalesce(btrim(i.email_sender), '') = ''
  AND coalesce(btrim(i.email_subject), '') = '';

-- A2. Blank-reference subset of the above
SELECT count(*) AS will_delete_blank_ref
FROM incidents i
WHERE i.source = 'import'
  AND i.date_received >= DATE '2023-04-03'
  AND i.date_received <  DATE '2026-07-01'
  AND coalesce(btrim(i.email_sender), '') = ''
  AND coalesce(btrim(i.email_subject), '') = ''
  AND coalesce(btrim(i.reference_no), '') = '';

-- A3. Sanity: July 2026+ total (must remain)
SELECT count(*) AS jul2026_or_later_kept
FROM incidents
WHERE date_received >= DATE '2026-07-01';

-- A4. Sanity: UI rows in the historical range (must remain)
SELECT count(*) AS ui_rows_in_range_kept
FROM incidents
WHERE source = 'ui'
  AND date_received >= DATE '2023-04-03'
  AND date_received <  DATE '2026-07-01';

-- A5. Sample of rows that would be deleted (spot-check)
SELECT id, date_received, reference_no, left(coalesce(reference_text,''), 80) AS reference_text, source
FROM incidents i
WHERE i.source = 'import'
  AND i.date_received >= DATE '2023-04-03'
  AND i.date_received <  DATE '2026-07-01'
  AND coalesce(btrim(i.email_sender), '') = ''
  AND coalesce(btrim(i.email_subject), '') = ''
ORDER BY date_received DESC
LIMIT 25;


-- ############################################################################
-- SECTION B — DELETE INCIDENTS (destructive)
-- Run after reviewing SECTION A.
-- ############################################################################

BEGIN;

WITH deleted AS (
  DELETE FROM incidents i
  WHERE i.source = 'import'
    AND i.date_received >= DATE '2023-04-03'
    AND i.date_received <  DATE '2026-07-01'
    AND coalesce(btrim(i.email_sender), '') = ''
    AND coalesce(btrim(i.email_subject), '') = ''
  RETURNING i.id, i.date_received, i.reference_no
)
SELECT
  count(*) AS deleted_rows,
  min(date_received) AS min_deleted_date,
  max(date_received) AS max_deleted_date
FROM deleted;

-- Post-delete sanity
SELECT
  (SELECT count(*) FROM incidents
     WHERE source = 'import'
       AND date_received >= DATE '2023-04-03'
       AND date_received < DATE '2026-07-01'
       AND coalesce(btrim(email_sender), '') = ''
       AND coalesce(btrim(email_subject), '') = '') AS remaining_backfill_candidates,
  (SELECT count(*) FROM incidents WHERE date_received >= DATE '2026-07-01') AS jul2026_or_later,
  (SELECT count(*) FROM incidents) AS total_incidents;

COMMIT;


-- ############################################################################
-- SECTION C — OPTIONAL: prune unreferenced lookup rows from the extract
-- Only deletes rows that are no longer referenced by any incident.
-- Skip this section if you want to keep expanded dropdown options.
-- ############################################################################

BEGIN;

-- C1. Drivers from the extract with no remaining incidents
DELETE FROM drivers d
WHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.driver_id = d.id)
  AND ((upper(d.username) IN (
    'ACHILLES',
    'ALANAZIA2',
    'ARVANITIH',
    'BANIYAA',
    'BONNIE.WONG7',
    'BUIV2',
    'BUNARBA',
    'CATTELLJ2',
    'CHENGZ2',
    'CHUAIPHAC',
    'CONSTANTJ',
    'CORTESANA',
    'CURTISB',
    'DANGINP',
    'DANGOLD',
    'DANGV9',
    'DETVONGSK',
    'DONTITHIW',
    'DONTITHIWU',
    'DUNKLEYR',
    'DURHAMJ2',
    'ELK80J',
    'ESKANDERR',
    'FERREIRAL2',
    'GRICIN',
    'GUNAYDINK',
    'HAMBLYNP2',
    'HAMLINGN',
    'HANTESJ',
    'HERRERAGR',
    'HERRERAVC',
    'HOANGA5',
    'HUNTP5',
    'HUYNHD13',
    'HUYNHH8',
    'HUYNHH8 ONBOARD',
    'JANTAKIEJ',
    'JANTAKIEJL',
    'JOVENK',
    'JOVENK2',
    'KHAMPORNC',
    'KHAWKHAMJ',
    'KOBAYASHY',
    'KONGTHONP',
    'KONGZ',
    'KONGZ3',
    'LAIJ14',
    'LEED34',
    'LEEH104',
    'LIMPARGOK',
    'LIUJ40',
    'LOUD',
    'LOUD2',
    'LOUD3',
    'MAAMARIT',
    'MACASAQUD',
    'MACASAQUJ',
    'MEDIPALLV',
    'MEDIPALV',
    'MORCOMT',
    'MORRISB11',
    'NANPANYAT',
    'NGUYENM72',
    'NGUYENM90',
    'NGUYENS14',
    'NGUYENS35',
    'NGUYENT',
    'NGUYENT136',
    'NGUYENTOA2',
    'ONGUENP',
    'PACHARASG',
    'PACHARASJ',
    'PACHARASJC',
    'PARMENTEM',
    'PATELD133',
    'PAYNECOGD2',
    'PHAMA9',
    'PHAMH9',
    'PHAMHIJ',
    'PHAMJ8',
    'PHAMP3',
    'PHAMT60',
    'RANDALLM',
    'RANDALLM4',
    'RANDALLM5',
    'RISTEVSKC',
    'ROUND 0011',
    'SALAK',
    'SALEHA2',
    'SANTANGELONDN',
    'SATOS',
    'SAWANGNIA',
    'SHAROBEMG',
    'SOCACIUD',
    'SONGX',
    'STEWARTR9',
    'STEWARTR9C',
    'TANGKHAOK',
    'TANGKHAOK2',
    'THANGJ',
    'THANGJ3',
    'THAPAK4',
    'THENGS2',
    'THIJAIT',
    'THIJAIW2',
    'TOAG',
    'TOD2',
    'TOOAG',
    'TRAEADWED',
    'TRANA29',
    'TRANA30',
    'TRANH13',
    'TRANH50',
    'TRANJ26',
    'TRANJ39',
    'TRANNHF',
    'TRANQ14',
    'TRANR11',
    'TRANT60',
    'TROUNG',
    'TROUNGW',
    'TRUONGW',
    'VOH7',
    'VOH9',
    'VONGMANYB',
    'VONGMANYK',
    'WALKERA21',
    'WONGHOK5',
    'WONGLOMNS',
    'XIEL5'
  )));

-- C2. Team leaders from the extract with no remaining incidents
DELETE FROM team_leaders tl
WHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.team_leader_id = tl.id)
  AND ((lower(tl.name) IN (
    'andrew tran',
    'arron nguyen',
    'dennis to',
    'jake pham',
    'jason tran'
  )));

-- C3. Types from the extract with no remaining incidents
DELETE FROM incident_types t
WHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.type_id = t.id)
  AND ((lower(t.name) IN (
    '2nd carding issue',
    '3rd delivery complaint',
    'address correction',
    'address correction',
    'address correction',
    'address update',
    'article carded',
    'article carded',
    'article carded - nda',
    'carding issue',
    'carding issue',
    'carding issue',
    'carding issues',
    'carding location',
    'check address',
    'check address',
    'check address dont rts',
    'check address startrack',
    'cod',
    'complaint',
    'complaint',
    'compliment',
    'consignment rts''d',
    'customer care',
    'customer care',
    'customer care escalation',
    'customer care escalation',
    'customer complaint',
    'customer complaint',
    'customer feedback',
    'customer feedback',
    'customer request',
    'customer request',
    'customer request',
    'cx care specialist',
    'cx footage',
    'cx responded',
    'cx responded re disputed delivery',
    'damage',
    'damage investigation',
    'damage to article',
    'damage to property',
    'damage to property',
    'damage to vehicle',
    'damaged',
    'damaged article',
    'damaged article',
    'damaged item',
    'damaged item',
    'damaged missing contents',
    'damaged/missing',
    'damaged/missing contents',
    'damaged/missing contents',
    'damaged/missing item',
    'damages',
    'delayed express post',
    'delivered back to sender',
    'delivery',
    'delivery complaint',
    'delivery complaint',
    'delivery complaint',
    'delivery enquiry',
    'delivery req/new label',
    'delivery request',
    'delivery request',
    'delivery request',
    'delivery request send to po',
    'delivery request startrack',
    'disputed delivery',
    'disputed delivery',
    'disputed delivery',
    'disputed delivery high value',
    'disputed delivery scan',
    'disputed delivery ­',
    'disputed delivery/staff complaint',
    'disputed express delivery',
    'dlivery request',
    'do not safe drop',
    'dont rts',
    'dont rts address is correct',
    'driver compliment',
    'enquiry',
    'eta - within edd',
    'exp rts request',
    'express delayed delivery request',
    'express delivery complaint',
    'express disputed delivery',
    'express investigation',
    'express item',
    'express missing item',
    'express post',
    'express rts request',
    'facility reported damages',
    'facility reported damages investigation',
    'feedback',
    'feedback',
    'fraud',
    'fyi',
    'hold failure r+r',
    'in transit',
    'incident report',
    'incorrect address',
    'incorrect delivery',
    'incorrect delivery',
    'incorrect delivery',
    'incorrectly redi',
    'incorrectly rts''d',
    'investigation',
    'investigation',
    'mail hold',
    'mail monitor request',
    'mail stopper req',
    'mail stopper request',
    'mail stopper request',
    'medication',
    'medication - disputed delivery',
    'medication express',
    'missing article',
    'missing express item',
    'missing item',
    'missing item',
    'missing item',
    'missing item express',
    'missing item startrack',
    'missing m2m item',
    'missing new label item',
    'missing parcel',
    'missing startrack item',
    'missort',
    'missort',
    'n_tranist req',
    'ncorrect delivery',
    'network delay',
    'no attempt',
    'no delivery attempt',
    'no delivery attempt',
    'no delivery attempts',
    'non delivery',
    'ombudsman enquiry',
    'parcel open missing contents',
    'pick up failure',
    'pick up failure',
    'post office',
    'privacy issue',
    'recover & return',
    'redelivery',
    'redelivery no attempt',
    'redelivery request',
    'redelivery request',
    'redelivery request',
    'redi failure',
    'redi failure',
    'redi failure/disputed delivery',
    'redirect',
    'redirection',
    'redirection failure',
    'redirection failure',
    'redirection failure/unsafe drop',
    'redirection request',
    'repeat issue delivery complaint',
    'req not to sd',
    'req to return to startrack',
    'req to send to po',
    'req to send to po',
    'req to take to po',
    'request to send',
    'request to send to po',
    'request to send to po',
    'retrieval req',
    'retrieve incorrect delivery',
    'return to sender request',
    'rtn to startrack',
    'rts',
    'rts complaint',
    'rts req',
    'rts request',
    'rts request',
    'rts request',
    'rts requested',
    'rts startrack',
    'rts to startrack investigation',
    'school missing item',
    'send to po',
    'sod delivery complaint',
    'staff complaint',
    'staff complaint',
    'staff compliment',
    'staff compliment',
    'staff compliment',
    'staff delivery complaint',
    'staff/delivery complaint',
    'startrack',
    'startrack - feedback',
    'startrack address clarification',
    'startrack carding issue',
    'startrack delivery complaint',
    'startrack delivery request',
    'startrack disputed delivery',
    'startrack disputed delivery',
    'startrack investigation',
    'startrack medication',
    'startrack missing item',
    'startrack missing item',
    'startrack network delay',
    'startrack return insufficient address',
    'startrack rts request',
    'startrack short - no scan',
    'startrack urgent delivery',
    'stop delivery',
    'stop delivery',
    'stop delivery',
    'stop delivery and rts',
    'stop delivery fraud',
    'stop delivery return to startrack',
    'stop delivery rtn to st',
    'stop delivery rtn to startrack',
    'stop delivery rtn to startrack',
    'stop delivery rts',
    'stop delivery/rtn to startrack',
    'stop delviery rtn to st',
    'stop rts',
    'stop rts address correction',
    'stop rts/delivery request',
    'unanswered investigation',
    'unanswered investigation',
    'unanswered: investigation',
    'unauthorised redi',
    'unauthorised redirection',
    'unsafe drop',
    'unsafe drop',
    'unsafe drop investigation',
    'unsafe drop/ disputed delivery',
    'unsafe drop/damaged',
    'unsafe drop/delivery complaint',
    'unsafe drop/disputed delivery',
    'urgent',
    'urgent care delivery request',
    'urgent delivery',
    'urgent delivery medication',
    'urgent medical',
    'urgent medical',
    'urgent medication',
    'urgent medication',
    'urgent startrack delivery request',
    'voc incident'
  )));

-- C4. Actions from the extract with no remaining incidents
DELETE FROM incident_actions a
WHERE NOT EXISTS (SELECT 1 FROM incidents i WHERE i.action_id = a.id)
  AND ((lower(a.name) IN (
    '2 complaints',
    '2 issues raised',
    'ack',
    'ap',
    'ap staff',
    'ccc',
    'cronulla contract',
    'cust cl',
    'custc',
    'custcl',
    'custclsd',
    'duplicate',
    'duplicated',
    'escalated',
    'follow up',
    'followed up',
    'fyi',
    'kirrawdc',
    'lit',
    'local po',
    'lpo',
    'na',
    'new case no.',
    'nfa',
    'no driver detail provided, issues with address',
    'not our contract',
    'not our driver',
    'not ours',
    'not out driver',
    'number plate - dc55fa',
    'ok, 2 diff emails',
    'ongoing',
    'ongoing',
    'r&r',
    're: 2 parcels',
    'reported originally as 53938570',
    'resolved',
    'rts',
    'same q, diff person',
    'stopped',
    'tba',
    'wrong contract',
    'wrong contract (chullora).',
    'y',
    'yvette closed case'
  )));

-- C5. Responded-by options from the extract unused as free-text response
DELETE FROM responded_by rb
WHERE NOT EXISTS (
    SELECT 1 FROM incidents i
    WHERE lower(btrim(coalesce(i.response, ''))) = lower(btrim(rb.name))
  )
  AND ((lower(rb.name) IN (
    'andrew tran',
    'arron nguyen',
    'brett hopgood',
    'caingbah cust exp',
    'caringbah cust exp',
    'david miils',
    'dennis to',
    'dennis to',
    'jake pham',
    'jason tran',
    'nisha albert',
    'phi pham',
    'wrong contract',
    'yvette goddard'
  )));

SELECT 'lookup_prune_complete' AS status;

COMMIT;
