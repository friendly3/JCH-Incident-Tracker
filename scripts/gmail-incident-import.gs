/**
 * JCH Pham AusPost Incident Tracker — Gmail → Supabase importer
 * Google Apps Script (copy entire file into the Apps Script project)
 *
 * SETUP
 * 1. Script Properties (Project Settings → Script properties):
 *      XAI_API_KEY          = xAI API key for Grok
 *      SUPABASE_ANON_KEY    = Supabase anon (or service role) key
 * 2. Gmail labels (create if missing):
 *      "AusPost Incident"
 *      "AusPost Incident/Processed"
 * 3. Supabase: run add_email_received_time.sql so column email_received_time exists
 * 4. Run processNewIncidentEmails() (or attach a time-driven trigger)
 * 5. Optional: run ensureLabels_() once to create labels
 *
 * VERSION: 2026-07-12-v6
 */

// ============================================================
// CONFIG
// ============================================================

var SCRIPT_VERSION = '2026-07-12-v6';

var LABEL_NAME = 'AusPost Incident';
var PROCESSED_LABEL = 'AusPost Incident/Processed';

/** Your Supabase project URL (no trailing slash) */
var SUPABASE_URL = 'https://fejawkynrdalkcftjktn.supabase.co';

/** Grok model — change if your account uses a different id */
var GROK_MODEL = 'grok-2-latest';

var GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

/** Max threads per run */
var MAX_THREADS_PER_RUN = 10;

/** Timezone for Gmail received date/time written to Supabase */
var TZ = 'Australia/Sydney';

// ============================================================
// SCRIPT PROPERTIES
// ============================================================

function getXaiKey_() {
  return PropertiesService.getScriptProperties().getProperty('XAI_API_KEY');
}

function getSupabaseKey_() {
  return PropertiesService.getScriptProperties().getProperty('SUPABASE_ANON_KEY');
}

// ============================================================
// ENTRY POINTS
// ============================================================

/**
 * Main entry: process unprocessed threads under LABEL_NAME.
 * Safe to run manually or via trigger.
 */
function processNewIncidentEmails() {
  Logger.log('=== RUN START | version: ' + SCRIPT_VERSION + ' ===');

  if (!getXaiKey_()) {
    Logger.log('❌ Missing Script Property XAI_API_KEY');
    return;
  }
  if (!getSupabaseKey_()) {
    Logger.log('❌ Missing Script Property SUPABASE_ANON_KEY');
    return;
  }

  var label = GmailApp.getUserLabelByName(LABEL_NAME);
  var processed = GmailApp.getUserLabelByName(PROCESSED_LABEL);

  if (!label) {
    Logger.log('❌ Gmail label missing: "' + LABEL_NAME + '" — run ensureLabels_()');
    return;
  }
  if (!processed) {
    Logger.log('❌ Gmail label missing: "' + PROCESSED_LABEL + '" — run ensureLabels_()');
    return;
  }

  var threads = label.getThreads(0, MAX_THREADS_PER_RUN);
  Logger.log('📬 Threads under label: ' + threads.length);

  var okCount = 0;
  var skipCount = 0;
  var failCount = 0;

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    if (threadHasLabel_(thread, PROCESSED_LABEL)) {
      skipCount++;
      continue;
    }

    var messages = thread.getMessages();
    if (!messages || !messages.length) {
      Logger.log('⚠️ Thread has no messages, skipping');
      failCount++;
      continue;
    }

    // First message in thread (original incident email)
    var message = messages[0];
    var subject = message.getSubject() || '(no subject)';
    Logger.log('--- Processing: ' + subject);

    try {
      var ok = processAndStoreIncident_(message);
      if (ok) {
        thread.addLabel(processed);
        okCount++;
        Logger.log('🏷️ Marked processed: ' + subject);
      } else {
        failCount++;
        Logger.log('❌ Failed (not marked processed): ' + subject);
      }
    } catch (err) {
      failCount++;
      Logger.log('❌ Exception: ' + err + (err.stack ? '\n' + err.stack : ''));
    }
  }

  Logger.log(
    '=== RUN END | ok=' +
      okCount +
      ' skipAlreadyProcessed=' +
      skipCount +
      ' fail=' +
      failCount +
      ' ==='
  );
}

/** Create the Gmail labels if they do not exist. */
function ensureLabels_() {
  if (!GmailApp.getUserLabelByName(LABEL_NAME)) {
    GmailApp.createLabel(LABEL_NAME);
    Logger.log('Created label: ' + LABEL_NAME);
  }
  if (!GmailApp.getUserLabelByName(PROCESSED_LABEL)) {
    GmailApp.createLabel(PROCESSED_LABEL);
    Logger.log('Created label: ' + PROCESSED_LABEL);
  }
  Logger.log('Labels OK');
}

/**
 * Dry-run: parse the first unprocessed message and log JSON (no Supabase write, no label).
 */
function debugParseFirstUnprocessed_() {
  var label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) {
    Logger.log('Label missing');
    return;
  }
  var threads = label.getThreads(0, 20);
  for (var i = 0; i < threads.length; i++) {
    if (threadHasLabel_(threads[i], PROCESSED_LABEL)) continue;
    var msg = threads[i].getMessages()[0];
    var incident = parseIncidentFromMessage_(msg);
    Logger.log(JSON.stringify(incident, null, 2));
    return;
  }
  Logger.log('No unprocessed threads found');
}

// ============================================================
// ORCHESTRATION
// ============================================================

function processAndStoreIncident_(message) {
  var incident = parseIncidentFromMessage_(message);
  if (!incident || typeof incident !== 'object') {
    Logger.log('❌ Parse failed');
    return false;
  }
  return insertIncidentToSupabase_(incident);
}

function threadHasLabel_(thread, labelName) {
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].getName() === labelName) return true;
  }
  return false;
}

// ============================================================
// PARSE (Gmail metadata + Grok)
// ============================================================

/**
 * Build structured incident from a Gmail message.
 * Gmail received date/time always win over model guesses.
 */
function parseIncidentFromMessage_(message) {
  if (!message) return null;

  var emailSubject = message.getSubject() || '';
  var emailSender = message.getFrom() || '';
  var receivedDate = message.getDate();
  var dateReceived = Utilities.formatDate(receivedDate, TZ, 'yyyy-MM-dd');
  var emailReceivedTime = Utilities.formatDate(receivedDate, TZ, 'HH:mm');

  var emailBody = '';
  try {
    emailBody = message.getPlainBody() || '';
  } catch (e) {
    Logger.log('getPlainBody failed: ' + e);
    emailBody = '';
  }

  var attachmentText = extractAttachmentText_(message);

  var systemPrompt =
    'You extract structured Australia Post / courier incident data from emails. ' +
    'Return ONE valid JSON object only. No markdown, no code fences, no commentary.';

  var userPrompt =
    'METADATA — copy these values exactly into the matching JSON fields:\n' +
    '- emailSender: ' + emailSender + '\n' +
    '- emailSubject: ' + emailSubject + '\n' +
    '- dateReceived: ' + dateReceived + '  (YYYY-MM-DD)\n' +
    '- emailReceivedTime: ' + emailReceivedTime + '  (HH:mm)\n\n' +
    'EXTRACT from Body first, then Attachments, then Subject.\n\n' +
    'FIELD RULES:\n' +
    '- time: incident / event time from body or attachments as HH:mm, or null if not stated. ' +
    '  This is NOT the email received time.\n' +
    '- teamLeader: team leader full name if mentioned, else "".\n' +
    '- type: incident type name (e.g. "Disputed Delivery", "Missing item", "STOP DELIVERY"). ' +
    '  Prefer text before the first colon in the subject when present (ignore Re:/FW:/SOD prefixes).\n' +
    '- referenceNo: article / tracking number (often 6–14 digits). Prefer subject article number.\n' +
    '- referenceText: short free-text description if present, else "".\n' +
    '- driver: driver username/code (e.g. CHENGZ2, PHAMT60), not full legal name unless that is all that is given.\n' +
    '- response: who responded / responded-by name if stated, else "".\n' +
    '- dateResponse: YYYY-MM-DD if a response date is stated, else null.\n' +
    '- timeResponse: HH:mm if a response time is stated, else null.\n' +
    '- action: status such as NEW, LIT, LPO, Resolved, Ack, AP staff. Default "NEW" if unknown.\n' +
    '- locationStreet: street only if clearly stated, else "".\n' +
    '- locationSuburb: suburb if clearly stated (often in subject after facility code), else "".\n' +
    '- sender: customer / sender name if stated, else "".\n' +
    '- marked: priority Normal | High | Urgent; default "Normal".\n\n' +
    'INPUT:\n' +
    'Subject: ' + emailSubject + '\n' +
    'From: ' + emailSender + '\n' +
    'Received: ' + dateReceived + ' ' + emailReceivedTime + ' (' + TZ + ')\n\n' +
    'Body:\n' +
    truncate_(emailBody, 12000) +
    '\n\n' +
    'Attachments:\n' +
    (attachmentText || 'None') +
    '\n\n' +
    'OUTPUT shape (all keys required):\n' +
    '{"emailSender":"","emailSubject":"","dateReceived":"YYYY-MM-DD","emailReceivedTime":"HH:mm",' +
    '"time":null,"teamLeader":"","type":"","referenceNo":"","referenceText":"","driver":"",' +
    '"response":"","dateResponse":null,"timeResponse":null,"action":"NEW",' +
    '"locationStreet":"","locationSuburb":"","sender":"","marked":"Normal"}';

  var attempts = [
    { temperature: 0, max_tokens: 1200 },
    { temperature: 0.2, max_tokens: 1400 }
  ];

  for (var a = 0; a < attempts.length; a++) {
    Logger.log('Grok attempt ' + (a + 1) + '/' + attempts.length);
    var incident = callGrokAndParseJson_(systemPrompt, userPrompt, attempts[a]);
    if (incident) {
      // Force Gmail metadata (do not trust the model for these)
      incident.emailSender = emailSender;
      incident.emailSubject = emailSubject;
      incident.dateReceived = dateReceived;
      incident.emailReceivedTime = emailReceivedTime;

      incident = normalizeIncident_(incident);
      Logger.log(
        '✅ Parsed: ref=' +
          (incident.referenceNo || '(none)') +
          ' type=' +
          (incident.type || '(none)') +
          ' action=' +
          (incident.action || '(none)')
      );
      return incident;
    }
  }

  // Fallback: minimal record from Gmail only so import can still succeed
  Logger.log('⚠️ Grok failed — inserting minimal incident from Gmail metadata + subject heuristics');
  var fallback = normalizeIncident_({
    emailSender: emailSender,
    emailSubject: emailSubject,
    dateReceived: dateReceived,
    emailReceivedTime: emailReceivedTime,
    time: null,
    teamLeader: '',
    type: heuristicTypeFromSubject_(emailSubject),
    referenceNo: heuristicRefFromSubject_(emailSubject),
    referenceText: '',
    driver: heuristicDriverFromSubject_(emailSubject),
    response: '',
    dateResponse: null,
    timeResponse: null,
    action: 'NEW',
    locationStreet: '',
    locationSuburb: heuristicSuburbFromSubject_(emailSubject),
    sender: '',
    marked: 'Normal'
  });
  return fallback;
}

function normalizeIncident_(raw) {
  var o = raw || {};
  return {
    emailSender: str_(o.emailSender),
    emailSubject: str_(o.emailSubject),
    dateReceived: str_(o.dateReceived) || null,
    emailReceivedTime: normalizeTime_(o.emailReceivedTime),
    time: normalizeTime_(o.time),
    teamLeader: str_(o.teamLeader),
    type: str_(o.type),
    referenceNo: str_(o.referenceNo),
    referenceText: str_(o.referenceText),
    driver: str_(o.driver),
    response: str_(o.response),
    dateResponse: str_(o.dateResponse) || null,
    timeResponse: normalizeTime_(o.timeResponse),
    action: str_(o.action) || 'NEW',
    locationStreet: str_(o.locationStreet),
    locationSuburb: str_(o.locationSuburb),
    sender: str_(o.sender),
    marked: normalizePriority_(o.marked)
  };
}

function normalizePriority_(v) {
  var s = str_(v).toLowerCase();
  if (s === 'high') return 'High';
  if (s === 'urgent') return 'Urgent';
  return 'Normal';
}

function normalizeTime_(v) {
  if (v == null || v === '') return null;
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  var hh = ('0' + m[1]).slice(-2);
  var mm = m[2];
  return hh + ':' + mm;
}

function str_(v) {
  if (v == null) return '';
  return String(v).trim();
}

function truncate_(s, max) {
  s = s || '';
  if (s.length <= max) return s;
  return s.substring(0, max) + '\n…[truncated]';
}

// Light subject heuristics (SOD-style subjects)
function heuristicTypeFromSubject_(subject) {
  var s = stripSubjectNoise_(subject);
  var idx = s.indexOf(':');
  if (idx <= 0) return '';
  return s.substring(0, idx).replace(/^(SOD|AP|AUSPOST|JCH)\s+/i, '').trim();
}

function heuristicRefFromSubject_(subject) {
  var s = stripSubjectNoise_(subject);
  var m = s.match(/\b(\d{6,14})\b/);
  return m ? m[1] : '';
}

function heuristicDriverFromSubject_(subject) {
  var s = stripSubjectNoise_(subject);
  // tokens like CHENGZ2
  var parts = s.split(/[\s\-–—]+/);
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i];
    if (/^[A-Za-z][A-Za-z0-9]{2,24}$/.test(t) && /\d/.test(t) && !/^N\d+$/i.test(t)) {
      return t;
    }
  }
  return '';
}

function heuristicSuburbFromSubject_(subject) {
  // Best-effort: after facility N##### often comes suburb words
  var s = stripSubjectNoise_(subject);
  var m = s.match(/\bN\d{3,6}\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\s+[A-Z]{2,}[A-Z0-9]*\b|\s*[-–—]|$)/);
  if (m) return m[1].trim();
  return '';
}

function stripSubjectNoise_(subject) {
  return String(subject || '')
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// GROK (xAI)
// ============================================================

function callGrokAndParseJson_(systemPrompt, userPrompt, opts) {
  opts = opts || {};
  var temperature = opts.temperature != null ? opts.temperature : 0;
  var maxTokens = opts.max_tokens != null ? opts.max_tokens : 1200;

  var body = {
    model: GROK_MODEL,
    temperature: temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  var response;
  try {
    response = UrlFetchApp.fetch(GROK_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + getXaiKey_()
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('Grok fetch error: ' + err);
    return null;
  }

  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    Logger.log('Grok HTTP ' + code + ': ' + truncate_(text, 800));
    return null;
  }

  var content = null;
  try {
    var parsed = JSON.parse(text);
    content =
      parsed &&
      parsed.choices &&
      parsed.choices[0] &&
      parsed.choices[0].message &&
      parsed.choices[0].message.content;
  } catch (e) {
    Logger.log('Grok response JSON parse failed: ' + e);
    return null;
  }

  if (!content) {
    Logger.log('Grok empty content');
    return null;
  }

  return extractJsonObject_(content);
}

/**
 * Pull a JSON object from model output (handles accidental fences / prose).
 */
function extractJsonObject_(text) {
  if (!text) return null;
  var s = String(text).trim();

  // Strip ```json ... ```
  var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Direct parse
  try {
    var direct = JSON.parse(s);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  } catch (e1) {
    // fall through
  }

  // First {...} block
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      var slice = s.substring(start, end + 1);
      var obj = JSON.parse(slice);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch (e2) {
      Logger.log('extractJsonObject_ failed: ' + e2 + ' snippet=' + truncate_(s, 200));
    }
  }
  return null;
}

// ============================================================
// ATTACHMENTS
// ============================================================

/**
 * Extract useful text from message attachments for Grok context.
 * Never throws — returns '' on failure.
 */
function extractAttachmentText_(message) {
  if (!message) return '';
  try {
    var attachments = message.getAttachments({
      includeInlineImages: false,
      includeAttachments: true
    });
    if (!attachments || !attachments.length) return '';

    var parts = [];
    var maxTotal = 8000;
    var total = 0;

    for (var i = 0; i < attachments.length; i++) {
      if (total >= maxTotal) {
        parts.push('[further attachments skipped: size budget]');
        break;
      }

      var att = attachments[i];
      var name = att.getName() || 'attachment-' + (i + 1);
      var type = (att.getContentType() || '').toLowerCase();
      var size = 0;
      try {
        size = att.getSize();
      } catch (szErr) {
        size = 0;
      }

      if (size > 2 * 1024 * 1024) {
        parts.push('[' + name + ': skipped, too large (' + size + ' bytes)]');
        continue;
      }

      // Plain text-ish
      if (type.indexOf('text/') === 0 || /\.(txt|csv|log|json|xml|html?)$/i.test(name)) {
        try {
          var data = att.getDataAsString();
          if (data && data.length > 4000) data = data.substring(0, 4000) + '\n…[truncated]';
          var block = '--- ' + name + ' ---\n' + (data || '');
          parts.push(block);
          total += block.length;
        } catch (readErr) {
          parts.push('[' + name + ': could not read as text]');
        }
        continue;
      }

      // Binary: name only (PDF/Word OCR not implemented)
      parts.push(
        '[' + name + ' (' + (type || 'unknown') + ', ' + size + ' bytes): content not extracted]'
      );
    }

    return parts.join('\n\n');
  } catch (err) {
    Logger.log('extractAttachmentText_ warning: ' + err);
    return '';
  }
}

// ============================================================
// SUPABASE
// ============================================================

function supabaseHeaders_() {
  var key = getSupabaseKey_();
  return {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };
}

/**
 * Insert one incident row. Returns true on HTTP 201.
 */
function insertIncidentToSupabase_(incident) {
  var typeId = lookupId_('incident_types', 'name', incident.type);
  var actionId = lookupId_('incident_actions', 'name', incident.action || 'NEW');
  if (!actionId) {
    // Common default
    actionId = lookupId_('incident_actions', 'name', 'NEW');
  }
  var driverId = lookupId_('drivers', 'username', incident.driver);
  if (!driverId && incident.driver) {
    driverId = lookupId_('drivers', 'name', incident.driver);
  }
  var teamLeaderId = lookupId_('team_leaders', 'name', incident.teamLeader);

  // incident.time = event time from body; email_received_time = Gmail clock
  var eventTime = incident.time || '';
  var receivedTime = incident.emailReceivedTime || null;

  var payload = {
    reference_no: incident.referenceNo || '',
    date_received: incident.dateReceived || null,
    email_received_time: receivedTime,
    time: eventTime,
    type_id: typeId,
    action_id: actionId,
    driver_id: driverId,
    team_leader_id: teamLeaderId,
    response: incident.response || '',
    reference_text: incident.referenceText || '',
    email_sender: incident.emailSender || null,
    email_subject: incident.emailSubject || null,
    date_response: incident.dateResponse || null,
    time_response: incident.timeResponse || null,
    location_street: incident.locationStreet || '',
    location_suburb: incident.locationSuburb || '',
    sender: incident.sender || '',
    marked: incident.marked || 'Normal',
    status: 'Open',
    source: 'import',
    user_id: null
  };

  Logger.log(
    'Supabase insert: ref=' +
      payload.reference_no +
      ' date=' +
      payload.date_received +
      ' email_received_time=' +
      payload.email_received_time +
      ' time(event)=' +
      payload.time +
      ' type_id=' +
      payload.type_id +
      ' action_id=' +
      payload.action_id
  );

  var headers = supabaseHeaders_();
  headers['Prefer'] = 'return=minimal';

  var response;
  try {
    response = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/incidents', {
      method: 'post',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('❌ Supabase fetch error: ' + err);
    return false;
  }

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code === 201) {
    Logger.log('✅ Supabase insert OK');
    return true;
  }

  Logger.log('❌ Supabase insert failed HTTP ' + code + ': ' + body);

  // Helpful hint for missing column
  if (body && body.indexOf('email_received_time') !== -1) {
    Logger.log(
      'Hint: run migration add_email_received_time.sql in Supabase SQL editor, then NOTIFY pgrst, \'reload schema\';'
    );
  }

  return false;
}

/**
 * Lookup UUID by column value (case-insensitive).
 * table: incident_types | incident_actions | drivers | team_leaders
 */
function lookupId_(table, column, value) {
  if (!value) return null;
  var v = String(value).trim();
  if (!v) return null;

  // 1) Exact match
  var id = lookupIdExact_(table, column, v);
  if (id) return id;

  // 2) Case-insensitive (ilike) exact whole string
  id = lookupIdIlike_(table, column, v);
  if (id) return id;

  Logger.log('lookupId_ miss: ' + table + '.' + column + ' = ' + v);
  return null;
}

function lookupIdExact_(table, column, value) {
  var url =
    SUPABASE_URL +
    '/rest/v1/' +
    encodeURIComponent(table) +
    '?select=id&' +
    encodeURIComponent(column) +
    '=eq.' +
    encodeURIComponent(value) +
    '&limit=1';

  return fetchLookupId_(url);
}

function lookupIdIlike_(table, column, value) {
  // PostgREST: col=ilike.value  (use * wildcards only if needed; here exact via no wildcards)
  // For exact case-insensitive, some projects use: col=ilike.value
  var url =
    SUPABASE_URL +
    '/rest/v1/' +
    encodeURIComponent(table) +
    '?select=id&' +
    encodeURIComponent(column) +
    '=ilike.' +
    encodeURIComponent(value) +
    '&limit=1';

  return fetchLookupId_(url);
}

function fetchLookupId_(url) {
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: supabaseHeaders_(),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var text = response.getContentText();
    if (code < 200 || code >= 300) {
      Logger.log('lookup HTTP ' + code + ' url=' + url + ' body=' + truncate_(text, 300));
      return null;
    }
    var rows = JSON.parse(text);
    if (rows && rows.length && rows[0].id) return rows[0].id;
  } catch (err) {
    Logger.log('lookup error: ' + err);
  }
  return null;
}
