-- =============================================================================
-- Historical incident backfill — JUNE 2026 ONLY
-- Source: Google Sheet tab Jun26
-- Rows:  110
-- Range: 2026-06-01 → 2026-06-30
-- Generated: 2026-08-09T02:04:56Z
--
-- Resolution status (Action column):
--   Only canonical statuses are linked: RESOLVED, LIT, LPO, ACK, AP STAFF, NEW, ONGOING
--   Other sheet values (CustCl, RTS, Duplicate, R&R, …) are left BLANK — not inserted
--   into incident_actions.
-- Types / drivers / team leaders: stored UPPERCASE (DB check constraints).
--
-- HOW TO RUN
-- 1. Supabase → SQL Editor
-- 2. Run without enabling extra RLS (temp staging table only)
-- 3. Review summary SELECT at the end
--
-- Re-run safe: skips non-blank reference_no already present.
-- Does not touch other months.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS _hist_jun26 (
  date_received    date NOT NULL,
  time_received    text,
  sender           text,
  team_leader      text,
  type_name        text,
  marked           text,
  reference_no     text,
  reference_text   text,
  driver_username  text,
  response         text,
  date_response    date,
  time_response    text,
  action_canonical text  -- already UPPER canonical, or empty
) ON COMMIT DROP;

TRUNCATE _hist_jun26;

-- batch 1 (1–100)
INSERT INTO _hist_jun26 (
  date_received, time_received, sender, team_leader, type_name, marked,
  reference_no, reference_text, driver_username, response, date_response, time_response, action_canonical
) VALUES
('2026-06-01', '06:56', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72414906', 'Article carded - no delivery attempt: 72414906 N22226 Menai CHUAIPHAC - Mirang Pl', 'CHUAIPHAC', '', NULL, NULL, ''),
('2026-06-01', '07:16', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72417132', 'Disputed Delivery: 72417132 N22226 Jannali SANTANGELONDN - Kaloona Pl', 'SANTANGELONDN', 'Andrew Tran', '2026-06-02', '05:18', 'RESOLVED'),
('2026-06-01', '10:45', 'Caringbah Cust Exp', 'Jake Pham', 'Delivery complaint', '', '72327666', 'Delivery complaint: 72327666 N22226 Menai KHAMPORNC - Caldarra Ave', 'KHAMPORNC', 'Jake Pham', '2026-06-02', '13:05', ''),
('2026-06-01', '14:18', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery request Send to PO', '', '72429042', 'Delivery request Send to PO: 72429042 N22226 Menai KHAMPORNC - Anzac Ave', 'KHAMPORNC', '', NULL, NULL, ''),
('2026-06-01', '16:39', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72431340', 'Missing item: 72431340 N22226 Menai PARMENTEM - Llawarra Road', 'PARMENTEM', 'Andrew Tran', '2026-06-01', '17:08', 'RESOLVED'),
('2026-06-02', '09:17', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72220914', 'Missing item: 72220914 N22226 Jannali ARVANITIH - Woronora', 'ARVANITIH', '', NULL, NULL, ''),
('2026-06-03', '06:51', 'Caringbah Cust Exp', 'Andrew Tran', 'Startrack Delivery complaint', 'HIGH', '72449616', '*HIGH PRIORITY* Startrack Delivery complaint: 72449616 N22226 Jannali GRICIN - Como Rd', 'GRICIN', '', NULL, NULL, ''),
('2026-06-03', '11:18', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72461041', 'Missing item: 72461041 N22226 Jannali ARVANITIH - The Circle', 'ARVANITIH', 'Andrew Tran', '2026-06-03', '11:43', ''),
('2026-06-03', '12:52', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72463997', 'Missing item: 72463997 CI-00185309 N22226 Jannali NGUYENTOA2 - Rickard Rd', 'NGUYENTOA2', '', NULL, NULL, ''),
('2026-06-03', '16:32', 'Caringbah Cust Exp', 'Arron Nguyen', 'Damage to property', '', '72470495', 'Damage to property: 72470495 N22226 Menai KONGZ - Menai Rd', 'KONGZ', 'Arron Nguyen', '2026-06-03', '18:37', 'RESOLVED'),
('2026-06-04', '07:29', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72473405', 'Disputed Delivery: 72473405 N22226 Jannali THANGJ - Arcadia Ave', 'THANGJ', 'Andrew Tran', '2026-06-04', '07:48', 'RESOLVED'),
('2026-06-04', '07:33', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72474144', 'Disputed Delivery: 72474144 N22226 Menai CHUAIPHAC - Banbal Rd', 'CHUAIPHAC', '', NULL, NULL, ''),
('2026-06-04', '10:17', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72478076', 'Missing item: 72478076 N22226 Jannali - Auburn St', '', '', NULL, NULL, ''),
('2026-06-04', '13:58', 'Caringbah Cust Exp', 'Andrew Tran', 'Damaged', '', '72470223', 'Damaged: 72470223 CI-00185543 N22226 Jannali GRICIN - Como Rd', '', 'Andrew Tran', '2026-06-04', '18:45', ''),
('2026-06-04', '16:01', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72485745', 'Disputed Delivery: 72485745 N22226 Menai DETVONGSK - Fowler Rd', 'DETVONGSK', 'Jake Pham', '2026-06-05', '08:37', 'RESOLVED'),
('2026-06-04', '16:05', 'Caringbah Cust Exp', 'Andrew Tran', 'RTS request', '', '72488020', 'RTS request: 72488020 N22226 Jannali Yet to arrive- RTS at Senders Request - Pls keep a lookout - Mitchell Ave', '', 'Andrew Tran', '2026-06-04', '18:46', ''),
('2026-06-05', '13:25', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72499975', 'Article carded - no delivery attempt: 72499975 N22226 Jannali NGUYENTOA2 - Linden St', 'NGUYENTOA2', 'Andrew Tran', '2026-06-05', '16:15', ''),
('2026-06-05', '15:45', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed delivery scan', '', '72504060', 'Disputed delivery scan: 72504060 N22226 Jannali NANPANYAT - Flora St', 'NANPANYAT', 'Andrew Tran', '2026-06-05', '16:13', 'RESOLVED'),
('2026-06-05', '15:58', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72505013', 'Disputed Delivery: 72505013 N22226 Jannali VOH7', 'VOH7', 'Andrew Tran', '2026-06-05', '16:14', ''),
('2026-06-05', '17:24', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72507104', 'Disputed Delivery: 72507104 N22226 Jannali NGUYENS35 - Soldiers Road', 'NGUYENS35', 'Andrew Tran', '2026-06-12', '16:08', 'ACK'),
('2026-06-09', '14:05', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72361109', 'Disputed Delivery: 72361109 N22226 Menai PARMENTEM - The Woods Cir', 'PARMENTEM', '', NULL, NULL, ''),
('2026-06-09', '15:22', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery request', '', '72532715', 'Delivery request: 72532715 N22226 Menai RISTEVSKC - Rosewall Dr', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-09', '16:19', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72533867', 'Disputed Delivery: 72533867 N22226 Jannali NGUYENS35 - Railway', 'NGUYENS35', '', NULL, NULL, ''),
('2026-06-10', '10:01', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72541704', 'Disputed Delivery: 72541704 N22226 Jannali VOH7 - Garfield Ave', 'VOH7', 'Andrew Tran', '2026-06-15', '17:52', 'LIT'),
('2026-06-10', '12:11', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72545405', 'Article carded - no delivery attempt: 72545405 N22226 Jannali TRANA30 - Village Pl', 'TRANA30', 'Andrew Tran', '2026-06-10', '17:56', 'RESOLVED'),
('2026-06-10', '13:30', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72547287', 'Delivery complaint: 72547287 N22226 Jannali PACHARASJ - Minerva St', 'PACHARASJ', 'Andrew Tran', '2026-06-10', '17:57', 'ACK'),
('2026-06-10', '16:41', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72553495', 'Disputed Delivery: 72553495 N22226 Menai LAIJ14 - Canobolas Pl', 'LAIJ14', 'Jake Pham', '2026-06-15', '12:19', 'RESOLVED'),
('2026-06-11', '14:12', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72476332', 'Disputed Delivery: 72476332 N22226 Jannali NGUYENTOA2 -B River Road', 'NGUYENTOA2', 'Andrew Tran', '2026-06-11', '15:19', 'RESOLVED'),
('2026-06-11', '14:20', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72565612', 'Delivery complaint: 72565612 N22226 Jannali NANPANYAT - Glencoe St', 'NANPANYAT', '', NULL, NULL, ''),
('2026-06-11', '16:55', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72569193', 'Disputed Delivery: 72569193 N22226 Jannali TRAEADWED - Garnet Road', 'TRAEADWED', 'Andrew Tran', '2026-06-12', '15:52', 'RESOLVED'),
('2026-06-11', '17:01', 'Caringbah Cust Exp', 'Andrew Tran', 'RTS request', '', '72551469', 'RTS request: 72551469 N22226 Menai Yet to arrive- RTS at Sender''s request- Pls keep a lookout - Fowler Road', 'DETVONGSK', 'Caringbah Cust Exp', '2026-06-12', '12:07', ''),
('2026-06-12', '10:59', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72578270', 'Article carded - no delivery attempt: 72578270 N22226 Jannali DANGINP - Manchester Rd', 'DANGINP', '', NULL, NULL, ''),
('2026-06-12', '12:06', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72582884', 'Article carded - no delivery attempt: 72582884 N22226 Jannali RISTEVSKC - Corella Road', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-12', '13:05', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72583594', 'Delivery complaint: 72583594 N22226 Jannali RISTEVSKC - Corella Road', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-12', '17:23', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72591246', 'Disputed Delivery: 72591246 N22226 Menai DETVONGSK - Redman Ave', 'DETVONGSK', 'Jake Pham', '2026-06-15', '12:13', ''),
('2026-06-15', '07:11', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72595525', 'Disputed Delivery: 72595525 N22226 Jannali DANGINP - Coonong Rd', 'DANGINP', 'Andrew Tran', '2026-06-15', '12:21', ''),
('2026-06-15', '09:25', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72575270', 'Disputed Delivery: 72575270 N22226 Menai CHENGZ2 - Lavender Pl Alford', 'CHENGZ2', 'Jake Pham', '2026-06-15', '12:15', 'RESOLVED'),
('2026-06-15', '10:13', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72576325', 'Missing item: 72576325 N22226 Jannali PAYNECOGD2 - Grays Point Rd', 'PAYNECOGD2', 'Andrew Tran', '2026-06-15', '12:21', ''),
('2026-06-15', '12:01', 'Caringbah Cust Exp', 'Andrew Tran', 'Unsafe Drop', '', '72578734', 'Unsafe Drop/Disputed Delivery: 72578734 N22226 Jannali HUYNHD13 - Manchester Road', 'HUYNHD13', 'Andrew Tran', '2026-06-15', '12:24', ''),
('2026-06-15', '14:04', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72605562', 'Disputed Delivery: 72605562 N22226 Menai PARMENTEM - Carter Road', 'PARMENTEM', 'Andrew Tran', '2026-06-15', '15:12', ''),
('2026-06-15', '15:41', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72609700', 'Disputed Delivery: 72609700 N22226 Menai PARMENTEM - Old Illawarra Rd', 'PARMENTEM', 'Andrew Tran', '2026-06-15', '16:18', ''),
('2026-06-16', '09:25', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72614852', 'Disputed Delivery: 72614852 N22226 Jannali TRAEADWED', 'TRAEADWED', 'Andrew Tran', '2026-06-16', '11:15', ''),
('2026-06-16', '09:38', 'Caringbah Cust Exp', 'Andrew Tran', 'Feedback', '', '72618364', 'Feedback: 72618364 N22226 Jannali NGUYENTOA2', 'NGUYENTOA2', '', NULL, NULL, ''),
('2026-06-16', '09:45', 'Caringbah Cust Exp', 'Andrew Tran', 'RTS request', '', '72608984', 'REQ RTS 72608984 N22226 Jannali THANGJ', 'THANGJ', 'Andrew Tran', '2026-06-16', '12:22', ''),
('2026-06-16', '09:49', 'Caringbah Cust Exp', 'Andrew Tran', 'Feedback', '', '72618238', 'Feedback: 72618238 N22226 Jannali NGUYENTOA2', 'NGUYENTOA2', '', NULL, NULL, ''),
('2026-06-16', '11:01', 'Caringbah Cust Exp', 'Andrew Tran', 'RTS request', '', '72619854', 'RTS request: 72619854 N22226 Jannali ARVANITIH - Loftus Ave', 'ARVANITIH', 'Andrew Tran', '2026-06-16', '11:09', 'RESOLVED'),
('2026-06-16', '16:56', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72631545', 'Disputed Delivery: 72631545 N22226 Jannali NGUYENS35 - Ninth Ave', 'NGUYENS35', 'Andrew Tran', '2026-06-17', '07:21', ''),
('2026-06-17', '10:30', 'Caringbah Cust Exp', 'Andrew Tran', 'Startrack Missing item', 'HIGH', '72638257', '*HIGH PRIORITY* STARTRACK S8 MEDS - Missing item: 72638257 CI-00187267 N22226 Jannali NGUYENTOA2 - Oak Road', 'NGUYENTOA2', 'Andrew Tran', '2026-06-17', '11:18', ''),
('2026-06-17', '10:57', 'Caringbah Cust Exp', 'Arron Nguyen', 'Startrack Network Delay', '', '72627039', 'ST Network Delay: 72627039 CI-00187289 N22226 Menai PAYNECOGD2 - New Illawarra Rd', 'PAYNECOGD2', 'Arron Nguyen', '2026-06-17', '15:46', ''),
('2026-06-17', '11:20', 'Caringbah Cust Exp', 'Arron Nguyen', 'Missing item', '', '72627039', 'Missing item: 72627039 CI-00187289 N22226 Menai PAYNECOGD2 - New Illawarra Rd', 'PAYNECOGD2', 'Arron Nguyen', '2026-06-17', '15:46', 'RESOLVED'),
('2026-06-17', '13:37', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', 'HIGH', '72643947', 'HIGH PRIORITY* Disputed Delivery: 72643947 N22226 Menai PARMENTEM - Mathers Pl', 'PARMENTEM', 'Caringbah Cust Exp', '2026-06-17', '15:35', ''),
('2026-06-18', '08:00', 'Caringbah Cust Exp', 'Jake Pham', 'Startrack Disputed Delivery', '', '72638071', 'Startrack Disputed Delivery: 72638071 CI-00187384 N22226 Menai DETVONGSK - Bignell St', 'DETVONGSK', 'Jake Pham', '2026-06-18', '13:17', ''),
('2026-06-18', '08:15', 'Caringbah Cust Exp', 'Andrew Tran', 'Address Correction', '', '72647989', 'Address Correction/Delivery request: 72647989 N22226 Jannali PAYNECOGD2 -Vivek Sood Wylie St', 'PAYNECOGD2', '', NULL, NULL, ''),
('2026-06-18', '08:34', 'Caringbah Cust Exp', 'Andrew Tran', 'RTS request', '', '72486014', 'Missing/Delayed - RTS request: 72486014 N22226 Jannali CURTISB - Spur', 'CURTISB', '', NULL, NULL, ''),
('2026-06-18', '09:13', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72630082', 'Disputed Delivery: 72630082 N22226 Menai THENGS2 -A Kingswood Rd', 'THENGS2', 'Jake Pham', '2026-06-18', '13:15', 'RESOLVED'),
('2026-06-18', '09:21', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72655320', 'Article carded - no delivery attempt: 72655320 N22226 Jannali GRICIN - Como Rd', 'GRICIN', '', NULL, NULL, ''),
('2026-06-18', '13:59', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72575270', 'CX RESPONDED RE: Disputed Delivery: 72575270 N22226 Menai CHENGZ2 - Lavender Pl Alford', '', 'Caingbah Cust Exp', '2026-06-19', '06:59', ''),
('2026-06-18', '15:06', 'Caringbah Cust Exp', 'Andrew Tran', 'RTS request', '', '72656376', 'RTS request: 72656376 N22226 Jannali Yet to arrive- RTS at sender''s request- Pls keep a lookout. - Acacia Rd', '', 'Andrew Tran', '2026-06-18', '17:07', ''),
('2026-06-18', '15:11', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72663044', 'Article carded - no delivery attempt: 72663044 N22226 Jannali RISTEVSKC - Ellesmere Rd', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-18', '16:43', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72662962', 'Delivery complaint: 72662962 N22226 Jannali PAYNECOGD2 -A Ellesmere Rd', 'PAYNECOGD2', 'Caingbah Cust Exp', '2026-06-29', '12:46', 'ACK'),
('2026-06-19', '07:13', 'Caringbah Cust Exp', 'Andrew Tran', 'CX FOOTAGE', '', '72664055', 'CX FOOTAGE: New VOC Incident Assigned: 72664055 - Consignment Number: C3QZ00221353 Due Date: 24/6/2026 VOH7', 'VOH7', 'Andrew Tran', '2026-06-19', '11:33', 'RESOLVED'),
('2026-06-19', '07:33', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72584706', 'Delivery complaint: 72584706 N22226 Menai PAYNECOGD2 - Parcel Locker', 'PAYNECOGD2', '', NULL, NULL, ''),
('2026-06-19', '07:58', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72670855', 'Disputed Delivery: 72670855 N22226 Jannali NGUYENTOA2 - The Grand', 'NGUYENTOA2', 'Andrew Tran', '2026-06-19', '11:12', ''),
('2026-06-19', '11:23', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72674796', 'Article carded - no delivery attempt: 72674796 N22226 Jannali RISTEVSKC - Talara Rd', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-19', '11:57', 'Caringbah Cust Exp', 'Andrew Tran', 'Medication - Disputed Delivery', 'HIGH', '72676204', '*HIGH PRIORITY* MEDICATION - Disputed Delivery: 72676204 N22226 Jannali NGUYENS35 - Jannali Ave', 'NGUYENS35', 'Andrew Tran', '2026-06-19', '12:43', 'RESOLVED'),
('2026-06-19', '12:57', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72678199', 'Article carded - no delivery attempt: 72678199 N22226 Jannali RISTEVSKC - Chapman St', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-19', '13:17', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', 'HIGH', '72678580', '**HIGH** Disputed Delivery: 72678580 N22226 Jannali NGUYENTOA2 - The Grand', 'NGUYENTOA2', 'Andrew Tran', '2026-06-19', '14:32', 'RESOLVED'),
('2026-06-19', '14:07', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72679516', 'Delivery complaint: 72679516 N22226 Jannali RISTEVSKC - Coonong Rd', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-19', '17:15', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72682943', 'Article carded - no delivery attempt: 72682943 N22226 Jannali RISTEVSKC - Mansion Point Road', 'RISTEVSKC', '', NULL, NULL, ''),
('2026-06-22', '07:29', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72685495', 'Disputed Delivery: 72685495 N22226 Jannali NGUYENS35 - Railway', 'NGUYENS35', 'Andrew Tran', '2026-06-23', '09:31', 'RESOLVED'),
('2026-06-22', '07:36', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72689343', 'Disputed Delivery: 72689343 N22226 Menai KONGZ - Akuna Ave', 'KONGZ', 'Jake Pham', '2026-06-23', '11:09', ''),
('2026-06-22', '11:18', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72672583', 'Disputed Delivery: 72672583 N22226 Jannali PACHARASJ - Mundakal Ave', 'PACHARASJ', 'Andrew Tran', '2026-06-23', '06:20', ''),
('2026-06-22', '13:42', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery request', '', '72700205', 'Delivery request: 72700205 N22226 Jannali NANPANYAT - Linden St', 'NANPANYAT', '', NULL, NULL, ''),
('2026-06-22', '13:44', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72700689', 'Disputed Delivery: 72700689 N22226 Jannali PACHARASJ - Forest Rd', 'PACHARASJ', 'Andrew Tran', '2026-06-23', '06:21', ''),
('2026-06-22', '13:49', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72701219', 'Disputed Delivery: 72701219 N22226 Jannali DANGINP - Moani Ave', 'DANGINP', 'Andrew Tran', '2026-06-23', '06:22', 'RESOLVED'),
('2026-06-22', '15:47', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72704458', 'Disputed Delivery: 72704458 N22226 Jannali PACHARASJ - Gorada Avenue Kirrawee Nsw Aust', 'PACHARASJ', 'Andrew Tran', '2026-06-23', '06:23', 'RESOLVED'),
('2026-06-23', '08:16', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72707926', 'Disputed Delivery: 72707926 N22226 Jannali SANTANGELONDN -B Marshall Road', 'SANTANGELONDN', 'Andrew Tran', '2026-06-24', '12:52', 'RESOLVED'),
('2026-06-23', '11:04', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72696027', 'Missing item: 72696027 N22226 Jannali SANTANGELONDN - Acacia Road', 'SANTANGELONDN', 'Andrew Tran', '2026-06-24', '03:25', ''),
('2026-06-23', '11:13', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72712887', 'Disputed Delivery: 72712887 N22226 Jannali NGUYENS35 -A Shorland Ave', 'NGUYENS35', 'Andrew Tran', '2026-06-24', '12:10', 'RESOLVED'),
('2026-06-23', '11:35', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72713072', 'Delivery complaint: 72713072 N22226 Jannali VOH7 - Fillmore Rd', 'VOH7', '', NULL, NULL, ''),
('2026-06-24', '10:39', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72722478', 'Disputed Delivery: 72722478 N22226 Jannali PACHARASJ - Gore Ave', 'PACHARASJ', 'Andrew Tran', '2026-06-24', '11:16', ''),
('2026-06-24', '11:39', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72723774', 'Missing item: 72723774 N22226 Jannali - Premier St', '', '', NULL, NULL, ''),
('2026-06-24', '12:37', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72729040', 'Disputed Delivery: 72729040 N22226 Menai CHENGZ2 - Bassia Pl Alford', 'CHENGZ2', 'Jake Pham', '2026-06-24', '12:46', ''),
('2026-06-25', '07:25', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72745450', 'Disputed Delivery: 72745450 N22226 Jannali THANGJ - Arcadia Ave', 'THANGJ', 'Andrew Tran', '2026-06-25', '10:07', 'RESOLVED'),
('2026-06-25', '07:39', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72746242', 'Disputed Delivery: 72746242 N22226 Jannali TRAEADWED - Argyle Pl', 'TRAEADWED', 'Andrew Tran', '2026-06-25', '10:10', 'RESOLVED'),
('2026-06-25', '08:01', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72720943', 'Delivery complaint: 72720943 N22226 Menai NGUYENM72 - Hopman Ave', 'NGUYENM72', '', NULL, NULL, ''),
('2026-06-25', '10:05', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72749746', 'Disputed Delivery: 72749746 N22226 Menai CHUAIPHAC - Lowry Pl', 'CHUAIPHAC', '', NULL, NULL, ''),
('2026-06-25', '11:34', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72750125', 'Article carded - no delivery attempt: 72750125 N22226 Menai KONGZ - Yanderra Ave', 'KONGZ', 'Andrew Tran', '2026-06-25', '18:33', 'RESOLVED'),
('2026-06-25', '11:34', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed delivery scan', '', '72749746', 'Disputed delivery scan: 72749746 N22226 Menai CHUAIPHAC - Lowry Pl', 'CHUAIPHAC', 'Caringbah Cust Exp', '2026-06-25', '11:34', ''),
('2026-06-25', '13:10', 'Caringbah Cust Exp', 'Andrew Tran', 'VOC Incident', '', '72752268', 'New VOC Incident Assigned: 72752268 - Consignment Number: ZHJZ00153177 Due Date: 1/7/2026', '', '', NULL, NULL, ''),
('2026-06-25', '16:31', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72753871', 'Delivery complaint: 72753871 N22226 Jannali RISTEVSKC - Gore Ave', 'RISTEVSKC', 'Andrew Tran', '2026-06-25', '18:31', 'RESOLVED'),
('2026-06-25', '16:33', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72752305', 'Disputed Delivery: 72752305 N22226 Jannali CATTELLJ2 - Siandra Dr', 'CATTELLJ2', 'Andrew Tran', '2026-06-26', '07:58', 'RESOLVED'),
('2026-06-25', '16:38', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72759647', 'Disputed Delivery: 72759647 N22226 Jannali PACHARASJ - Princes Hwy', 'PACHARASJ', 'Andrew Tran', '2026-06-25', '18:19', 'RESOLVED'),
('2026-06-26', '07:15', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72761914', 'Disputed Delivery: 72761914 N22226 Jannali VOH7 - Mulyan St', 'VOH7', 'Andrew Tran', '2026-06-26', '07:57', 'RESOLVED'),
('2026-06-26', '07:22', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72747060', 'Disputed Delivery: 72747060 N22226 Menai PARMENTEM - Old Illawarra Rd', 'PARMENTEM', '', NULL, NULL, ''),
('2026-06-26', '07:32', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72764932', 'Disputed Delivery: 72764932 N22226 Menai CHUAIPHAC - Bundanoon Road', 'CHUAIPHAC', 'Jake Pham', '2026-06-26', '12:28', ''),
('2026-06-26', '07:37', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72684398', 'Disputed Delivery: 72684398 N22226 Jannali VOH7 - Como Pde', 'VOH7', 'Andrew Tran', '2026-06-26', '09:21', ''),
('2026-06-26', '08:57', 'Caringbah Cust Exp', 'Andrew Tran', 'Article carded - NDA', '', '72766002', 'Article carded - no delivery attempt: 72766002 N22226 Jannali HUYNHD13 -A Kingsway', 'HUYNHD13', '', NULL, NULL, ''),
('2026-06-26', '13:45', 'Caringbah Cust Exp', 'Andrew Tran', 'Express Missing item', '', '72759378', 'Express Missing item: 72759378 N22226 Jannali CURTISB - Mary St', 'CURTISB', '', NULL, NULL, ''),
('2026-06-26', '13:52', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72770560', 'Disputed Delivery: 72770560 N22226 Jannali STEWARTR9 -B Ninth Ave', 'STEWARTR9', 'Andrew Tran', '2026-06-26', '14:49', 'LPO');

-- batch 2 (101–110)
INSERT INTO _hist_jun26 (
  date_received, time_received, sender, team_leader, type_name, marked,
  reference_no, reference_text, driver_username, response, date_response, time_response, action_canonical
) VALUES
('2026-06-29', '08:14', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72779306', 'Disputed Delivery: 72779306 N22226 Menai CHENGZ2 - Coachwood Cres Alford', 'CHENGZ2', 'Jake Pham', '2026-06-29', '11:34', ''),
('2026-06-29', '08:22', 'Caringbah Cust Exp', 'Arron Nguyen', 'Disputed Delivery', 'HIGH', '72779783', '*HIGH PRIORITY* Dont RTS/Disputed Delivery: 72779783 N22226 Menai DETVONGSK - Fowler Road', 'DETVONGSK', 'Arron Nguyen', '2026-06-29', '08:47', 'RESOLVED'),
('2026-06-29', '08:36', 'Caringbah Cust Exp', 'Andrew Tran', 'Missing item', '', '72785845', 'Delayed/Missing delivery: 72785845 N22226 Menai ARVANITIH - Clothier Rd', 'ARVANITIH', '', NULL, NULL, ''),
('2026-06-29', '12:18', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72789993', 'Disputed Delivery: 72789993 N22226 Jannali PACHARASJ - Flora St', 'PACHARASJ', 'Andrew Tran', '2026-06-29', '13:18', 'RESOLVED'),
('2026-06-30', '07:28', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72796265', 'SOD Delivery complaint: 72796265 N22226 Menai LOUD3 -B Allies Road', 'LOUD3', '', NULL, NULL, ''),
('2026-06-30', '07:40', 'Caringbah Cust Exp', 'Jake Pham', 'Disputed Delivery', '', '72797272', 'Disputed Delivery: 72797272 N22226 Menai DETVONGSK - Fowler Road', 'DETVONGSK', 'Jake Pham', '2026-06-30', '12:45', ''),
('2026-06-30', '12:19', 'Caringbah Cust Exp', 'Arron Nguyen', 'Missing item', '', '72809248', 'Missing item: 72809248 CI-00189248 N22226 Jannali ARVANITIH - Georges River Rd', 'ARVANITIH', 'Arron Nguyen', '2026-06-30', '13:51', ''),
('2026-06-30', '12:29', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72773946', 'Delivery complaint: 72773946 N22226 Jannali RISTEVSKC - Chapman St', 'RISTEVSKC', 'Andrew Tran', '2026-06-30', '13:53', 'ACK'),
('2026-06-30', '12:36', 'Caringbah Cust Exp', 'Andrew Tran', 'Delivery complaint', '', '72809934', 'Delivery complaint: 72809934 N22226 Jannali RISTEVSKC - President Ave', 'RISTEVSKC', 'Andrew Tran', '2026-06-30', '13:55', 'ACK'),
('2026-06-30', '13:45', 'Caringbah Cust Exp', 'Andrew Tran', 'Disputed Delivery', '', '72759767', 'Disputed Delivery: 72759767 N22226 Jannali PACHARASJ - Princes Hwy', 'PACHARASJ', 'Andrew Tran', '2026-07-01', '03:26', 'RESOLVED');

-- -----------------------------------------------------------------------------
-- Lookups (UPPERCASE names only)
-- -----------------------------------------------------------------------------

-- Types
INSERT INTO incident_types (id, name)
SELECT gen_random_uuid(), x.name
FROM (
  SELECT DISTINCT upper(btrim(type_name)) AS name
  FROM _hist_jun26
  WHERE btrim(coalesce(type_name, '')) <> ''
) x
WHERE NOT EXISTS (
  SELECT 1 FROM incident_types t WHERE upper(t.name) = x.name
);

-- Actions: ONLY the canonical list present in this import
INSERT INTO incident_actions (id, name)
SELECT gen_random_uuid(), x.name
FROM (
  SELECT DISTINCT upper(btrim(action_canonical)) AS name
  FROM _hist_jun26
  WHERE btrim(coalesce(action_canonical, '')) <> ''
) x
WHERE NOT EXISTS (
  SELECT 1 FROM incident_actions a WHERE upper(a.name) = x.name
);

-- Team leaders
INSERT INTO team_leaders (id, name)
SELECT gen_random_uuid(), upper(btrim(x.name))
FROM (
  SELECT DISTINCT btrim(team_leader) AS name
  FROM _hist_jun26
  WHERE btrim(coalesce(team_leader, '')) <> ''
) x
WHERE NOT EXISTS (
  SELECT 1 FROM team_leaders tl WHERE upper(tl.name) = upper(x.name)
);

-- Drivers
INSERT INTO drivers (id, name, username)
SELECT gen_random_uuid(), upper(btrim(x.username)), upper(btrim(x.username))
FROM (
  SELECT DISTINCT btrim(driver_username) AS username
  FROM _hist_jun26
  WHERE btrim(coalesce(driver_username, '')) <> ''
) x
WHERE NOT EXISTS (
  SELECT 1 FROM drivers d WHERE upper(d.username) = upper(x.username)
);

-- Responded By free-text (no UPPER constraint on this table historically)
INSERT INTO responded_by (id, name)
SELECT gen_random_uuid(), btrim(x.name)
FROM (
  SELECT DISTINCT btrim(response) AS name
  FROM _hist_jun26
  WHERE btrim(coalesce(response, '')) <> ''
) x
WHERE NOT EXISTS (
  SELECT 1 FROM responded_by rb WHERE lower(rb.name) = lower(x.name)
);

-- -----------------------------------------------------------------------------
-- Incidents
-- -----------------------------------------------------------------------------
INSERT INTO incidents (
  id,
  reference_no,
  date_received,
  time,
  email_received_time,
  type_id,
  driver_id,
  team_leader_id,
  response,
  reference_text,
  action_id,
  date_response,
  time_response,
  email_sender,
  email_subject,
  location_street,
  location_suburb,
  sender,
  marked,
  source,
  status,
  duplicate_exempt,
  updated_at
)
SELECT
  gen_random_uuid(),
  coalesce(h.reference_no, ''),
  h.date_received,
  coalesce(h.time_received, ''),
  nullif(h.time_received, ''),
  (
    SELECT t.id FROM incident_types t
    WHERE upper(t.name) = upper(btrim(h.type_name))
    LIMIT 1
  ),
  (
    SELECT d.id FROM drivers d
    WHERE upper(d.username) = upper(btrim(h.driver_username))
    LIMIT 1
  ),
  (
    SELECT tl.id FROM team_leaders tl
    WHERE upper(tl.name) = upper(btrim(h.team_leader))
    LIMIT 1
  ),
  coalesce(h.response, ''),
  coalesce(h.reference_text, ''),
  (
    SELECT a.id FROM incident_actions a
    WHERE btrim(h.action_canonical) <> ''
      AND upper(a.name) = upper(btrim(h.action_canonical))
    LIMIT 1
  ),
  h.date_response,
  nullif(h.time_response, ''),
  NULL,
  NULL,
  '',
  '',
  coalesce(h.sender, ''),
  coalesce(h.marked, ''),
  'import',
  'Open',
  false,
  now()
FROM _hist_jun26 h
WHERE NOT (
  btrim(coalesce(h.reference_no, '')) <> ''
  AND EXISTS (
    SELECT 1 FROM incidents i
    WHERE btrim(coalesce(i.reference_no, '')) = btrim(h.reference_no)
  )
);

-- Summary
SELECT
  (SELECT count(*) FROM _hist_jun26) AS staged_rows,
  (SELECT count(*) FROM _hist_jun26 WHERE btrim(coalesce(action_canonical,'')) <> '') AS staged_with_canonical_status,
  (SELECT count(*) FROM _hist_jun26 WHERE btrim(coalesce(action_canonical,'')) = '') AS staged_blank_status,
  (SELECT count(*) FROM incidents
     WHERE source = 'import'
       AND date_received >= DATE '2026-06-01'
       AND date_received <  DATE '2026-07-01'
       AND coalesce(btrim(email_sender), '') = ''
       AND coalesce(btrim(email_subject), '') = '') AS import_rows_jun2026_signature,
  (SELECT count(*) FROM incidents WHERE date_received >= DATE '2026-07-01') AS rows_jul2026_or_later;

COMMIT;
