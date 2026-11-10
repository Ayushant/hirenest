/**
 * Paste this into Extensions > Apps Script on the jobs Google Sheet.
 * Then run `setupTrigger` once (select it in the function dropdown, click
 * Run) to install the on-edit sync and kick off the first sync.
 *
 * Syncs 4 tabs: Remote C2C, Onsite FTE & Contract Onsite, C2H,
 * Public Active Requirements — every row with a "Role name" becomes
 * (or updates) one job on the platform.
 *
 * Phase 1 (fast): syncs all rows with JD link only (no doc fetching).
 * Phase 2 (automatic): fetches actual JD text from linked Google Docs,
 * 5 docs per run, auto-scheduling itself every minute until done.
 * You don't need to do anything — just run setupTrigger once.
 *
 * The account that authorizes this script must have view access to
 * every linked JD doc, or that doc's text will be skipped.
 */

var SERVER_URL = 'https://os.hirenestworkforce.com/api/sheet-sync/jobs';
var SYNC_SECRET = 'hn_sheet_7x9kP2qz4m';

var TABS = [
  { name: 'Remote C2C', defaultWorkMode: 'remote', defaultEmploymentType: 'contract' },
  { name: 'Onsite FTE & Contract Onsite', defaultWorkMode: 'onsite', defaultEmploymentType: 'full_time' },
  { name: 'C2H', defaultWorkMode: null, defaultEmploymentType: 'contract_to_hire' },
  { name: 'Public Active Requirements', defaultWorkMode: null, defaultEmploymentType: null },
];

var STATUS_MAP = {
  'on hold': 'on_hold',
  'sourcing paused': 'open',
  'got enough profiles': 'open',
  'closed': 'closed',
  'filled': 'filled',
  'open': 'open',
  'draft': 'draft'
};

var ENGAGEMENT_MAP = {
  'contract': 'contract',
  'fte': 'full_time',
  'full time': 'full_time',
  'contract to hire': 'contract_to_hire',
  'c2h': 'contract_to_hire',
  'part time': 'part_time'
};

var MAX_RUN_MS = 4.5 * 60 * 1000;
var BATCH_SIZE = 10;
var JD_BATCH_SIZE = 5;

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('syncQueue');
  props.deleteProperty('jdQueue');
  ScriptApp.newTrigger('syncSheetToServer')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  syncSheetToServer();
}

function findCol(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === name.toLowerCase()) return i;
  }
  return -1;
}

function parseExperience(text) {
  var s = String(text || '').toLowerCase();
  var m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = s.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (m) return { min: Number(m[1]), max: null };
  m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) return { min: Number(m[1]), max: null };
  return { min: null, max: null };
}

function parseBudget(text) {
  var m = String(text || '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function mapStatus(text) {
  var key = String(text || '').trim().toLowerCase();
  return STATUS_MAP[key] || 'open';
}

function mapEmploymentType(text, fallback) {
  var key = String(text || '').trim().toLowerCase();
  return ENGAGEMENT_MAP[key] || fallback || null;
}

function getJdLink(cell) {
  try {
    var url = String(cell.getValue() || '');
    if (/^https?:\/\//.test(url)) return url;
    var rich = cell.getRichTextValue();
    return (rich && rich.getLinkUrl()) || '';
  } catch (e) {
    return '';
  }
}

function fetchJdText(url) {
  try {
    if (!url) return '';
    var idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) return '';
    return DocumentApp.openById(idMatch[1]).getBody().getText().trim();
  } catch (e) {
    return '';
  }
}

function buildQueue() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queue = [];
  for (var t = 0; t < TABS.length; t++) {
    var tabConfig = TABS[t];
    var sheet = ss.getSheetByName(tabConfig.name);
    if (!sheet) continue;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    var colTitle = findCol(
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0],
      'Role name'
    );
    if (colTitle < 0) continue;
    var titles = sheet.getRange(2, colTitle + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < titles.length; i++) {
      if (String(titles[i][0] || '').trim()) {
        queue.push({ tabIndex: t, row: i + 2 });
      }
    }
  }
  return queue;
}

function buildRowPayload(sheet, tabConfig, rowNum, includeJdText) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  var colTitle = findCol(headers, 'Role name');
  var colJd = findCol(headers, 'Brief context about the role (JD)');
  var colExperience = findCol(headers, 'Experience');
  var colBudget = findCol(headers, 'Budget');
  var colOpenings = findCol(headers, 'No of Openings');
  var colLocation = findCol(headers, 'Location');
  var colStatus = findCol(headers, 'Status');
  var colEngagement = findCol(headers, 'Engagement');
  var colNotes = findCol(headers, 'Additional/Important information');

  var title = colTitle >= 0 ? String(values[colTitle] || '').trim() : '';
  var experienceText = colExperience >= 0 ? values[colExperience] : '';
  var budgetText = colBudget >= 0 ? values[colBudget] : '';
  var exp = parseExperience(experienceText);
  var budget = parseBudget(budgetText);
  var jdLink = colJd >= 0 ? getJdLink(sheet.getRange(rowNum, colJd + 1)) : '';

  var descriptionParts = [];
  if (includeJdText && jdLink) {
    var jdText = fetchJdText(jdLink);
    if (jdText) descriptionParts.push(jdText);
    if (!jdText) descriptionParts.push('JD: ' + jdLink);
  } else if (jdLink) {
    descriptionParts.push('JD: ' + jdLink);
  }
  if (experienceText) descriptionParts.push('Experience (as entered): ' + experienceText);
  if (budgetText) descriptionParts.push('Budget (as entered): ' + budgetText);
  var notes = colNotes >= 0 ? String(values[colNotes] || '').trim() : '';
  var description = descriptionParts.join('\n\n').trim();
  if (description.length < 20) {
    description = (description + '\n\n(Imported from "' + tabConfig.name + '" tab, row ' + rowNum + '.)').trim();
  }

  return {
    externalRef: sheet.getSheetId() + '-' + rowNum,
    title: title,
    description: description,
    notes: notes,
    minExperience: exp.min,
    maxExperience: exp.max,
    location: colLocation >= 0 ? String(values[colLocation] || '').trim() || null : null,
    workMode: tabConfig.defaultWorkMode,
    employmentType: mapEmploymentType(
      colEngagement >= 0 ? values[colEngagement] : '',
      tabConfig.defaultEmploymentType
    ),
    openings: colOpenings >= 0 && values[colOpenings] ? Number(values[colOpenings]) : 1,
    budget: budget,
    currency: 'INR',
    status: colStatus >= 0 ? mapStatus(values[colStatus]) : 'open'
  };
}

function postBatch(rows) {
  if (rows.length === 0) return;
  var response = UrlFetchApp.fetch(SERVER_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sheet-sync-secret': SYNC_SECRET },
    payload: JSON.stringify({ rows: rows }),
    muteHttpExceptions: true
  });
  console.log(response.getContentText());
}

function clearTimedTrigger(fnName) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === fnName && t.getEventType() === ScriptApp.EventType.CLOCK) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

// ============================================================
// PHASE 1: Fast sync (no JD text fetching, just links)
// ============================================================
function syncSheetToServer() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log('Another sync is already running, skipping.');
    return;
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var startTime = Date.now();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var queue;
    var stored = props.getProperty('syncQueue');
    if (stored) {
      queue = JSON.parse(stored);
    } else {
      queue = buildQueue();
      console.log('Phase 1 starting: ' + queue.length + ' rows to sync (without JD text).');
    }

    var buffer = [];
    var processed = 0;

    while (queue.length > 0) {
      if (Date.now() - startTime > MAX_RUN_MS) {
        postBatch(buffer);
        props.setProperty('syncQueue', JSON.stringify(queue));
        console.log('Phase 1: ' + processed + ' rows this run; ' + queue.length + ' remaining. Resuming in ~1 min.');
        clearTimedTrigger('syncSheetToServer');
        ScriptApp.newTrigger('syncSheetToServer').timeBased().after(60 * 1000).create();
        return;
      }

      var task = queue.shift();
      var tabConfig = TABS[task.tabIndex];
      var sheet = ss.getSheetByName(tabConfig.name);
      if (sheet) {
        buffer.push(buildRowPayload(sheet, tabConfig, task.row, false));
        processed++;
      }

      if (buffer.length >= BATCH_SIZE) {
        postBatch(buffer);
        buffer = [];
      }
    }

    postBatch(buffer);
    props.deleteProperty('syncQueue');
    clearTimedTrigger('syncSheetToServer');
    console.log('Phase 1 complete: ' + processed + ' rows synced. Starting Phase 2 (JD text enrichment)...');

    // Kick off Phase 2 automatically
    startJdEnrichment();
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// PHASE 2: JD text enrichment (fetches Google Docs in batches)
// ============================================================
function startJdEnrichment() {
  var props = PropertiesService.getScriptProperties();
  // Build a queue of rows that have a JD link
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var jdQueue = [];

  for (var t = 0; t < TABS.length; t++) {
    var tabConfig = TABS[t];
    var sheet = ss.getSheetByName(tabConfig.name);
    if (!sheet) continue;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) continue;
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colJd = findCol(headers, 'Brief context about the role (JD)');
    var colTitle = findCol(headers, 'Role name');
    if (colJd < 0 || colTitle < 0) continue;

    for (var i = 2; i <= lastRow; i++) {
      var title = String(sheet.getRange(i, colTitle + 1).getValue() || '').trim();
      if (!title) continue;
      var jdLink = getJdLink(sheet.getRange(i, colJd + 1));
      if (jdLink && jdLink.match(/\/d\/[a-zA-Z0-9_-]+/)) {
        jdQueue.push({ tabIndex: t, row: i });
      }
    }
  }

  if (jdQueue.length === 0) {
    console.log('Phase 2: No JD links found, nothing to enrich.');
    return;
  }

  props.setProperty('jdQueue', JSON.stringify(jdQueue));
  console.log('Phase 2: ' + jdQueue.length + ' rows with JD links to enrich. Starting...');
  enrichJdBatch();
}

function enrichJdBatch() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log('JD enrichment: another run in progress, skipping.');
    return;
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var stored = props.getProperty('jdQueue');
    if (!stored) {
      console.log('Phase 2 complete: no more JD docs to fetch.');
      clearTimedTrigger('enrichJdBatch');
      return;
    }

    var queue = JSON.parse(stored);
    if (queue.length === 0) {
      props.deleteProperty('jdQueue');
      clearTimedTrigger('enrichJdBatch');
      console.log('Phase 2 complete: all JD docs fetched.');
      return;
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var batch = queue.splice(0, JD_BATCH_SIZE);
    var rows = [];

    for (var i = 0; i < batch.length; i++) {
      var task = batch[i];
      var tabConfig = TABS[task.tabIndex];
      var sheet = ss.getSheetByName(tabConfig.name);
      if (!sheet) continue;
      rows.push(buildRowPayload(sheet, tabConfig, task.row, true));
    }

    postBatch(rows);

    if (queue.length > 0) {
      props.setProperty('jdQueue', JSON.stringify(queue));
      console.log('Phase 2: enriched ' + batch.length + ' rows; ' + queue.length + ' remaining. Next batch in ~1 min.');
      clearTimedTrigger('enrichJdBatch');
      ScriptApp.newTrigger('enrichJdBatch').timeBased().after(60 * 1000).create();
    } else {
      props.deleteProperty('jdQueue');
      clearTimedTrigger('enrichJdBatch');
      console.log('Phase 2 complete: all JD docs fetched and synced.');
    }
  } finally {
    lock.releaseLock();
  }
}
