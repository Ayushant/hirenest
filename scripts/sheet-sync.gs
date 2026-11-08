/**
 * Paste this into Extensions > Apps Script on the jobs Google Sheet.
 * Then run `setupTrigger` once (select it in the function dropdown, click
 * Run) to install the on-edit sync and kick off the first sync.
 *
 * Syncs 4 tabs: Remote C2C, Onsite FTE & Contract Onsite, C2H,
 * Public Active Requirements — every row with a "Role name" becomes
 * (or updates) one job on the platform.
 *
 * Column headers must exist in row 1 of each tab (order doesn't matter,
 * extra columns are ignored): "Role name", "Brief context about the role
 * (JD)", "Experience", "Budget", "No of Openings", "Location", "Status",
 * "Engagement".
 *
 * The JD column is a link to a Google Doc — this script opens that doc and
 * pulls its text in automatically. The account that authorizes this script
 * must have view access to every linked JD doc, or that doc's text will be
 * skipped (title/experience/budget/location still sync either way).
 *
 * Experience and Budget are typed as free text in the sheet ("5-8 yoe",
 * "1.4 LPM", "Best Budget"). This script extracts the first number it finds
 * as a clean numeric value for filtering, and also keeps the original text
 * in the job description so nothing is lost. Entries with no number at all
 * (e.g. "Best Budget") sync with budget left blank.
 *
 * With many rows + Google Doc fetches, one run can exceed Apps Script's
 * ~6-minute execution limit. To handle that, this script processes rows in
 * small batches, posts each batch to the server as it goes, and — if time
 * runs out before finishing — automatically schedules itself to resume a
 * minute later. You don't need to do anything; just let it keep running
 * (check View > Executions to watch progress across runs).
 */

const SERVER_URL = 'https://os.hirenestworkforce.com/api/sheet-sync/jobs';
const SYNC_SECRET = 'hn_sheet_7x9kP2qz4m';

const TABS = [
  { name: 'Remote C2C', defaultWorkMode: 'remote', defaultEmploymentType: 'contract' },
  { name: 'Onsite FTE & Contract Onsite', defaultWorkMode: 'onsite', defaultEmploymentType: 'full_time' },
  { name: 'C2H', defaultWorkMode: null, defaultEmploymentType: 'contract_to_hire' },
  { name: 'Public Active Requirements', defaultWorkMode: null, defaultEmploymentType: null },
];

// Sheet status text -> our platform's status values. Add more mappings here
// if the sheet uses a status word that isn't listed.
const STATUS_MAP = {
  'on hold': 'on_hold',
  'sourcing paused': 'open',
  'got enough profiles': 'open',
  closed: 'closed',
  filled: 'filled',
  open: 'open',
  draft: 'draft',
};

const ENGAGEMENT_MAP = {
  contract: 'contract',
  fte: 'full_time',
  'full time': 'full_time',
  'contract to hire': 'contract_to_hire',
  c2h: 'contract_to_hire',
  'part time': 'part_time',
};

const MAX_RUN_MS = 4.5 * 60 * 1000; // stop well before the ~6 min platform limit
const BATCH_SIZE = 10; // rows per POST to the server
const RESUME_FN = 'syncSheetToServer';

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().deleteProperty('syncQueue');
  ScriptApp.newTrigger(RESUME_FN).forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  syncSheetToServer();
}

function findCol(headers, name) {
  return headers.findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase());
}

function parseExperience(text) {
  const s = String(text || '').toLowerCase();
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = s.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (m) return { min: Number(m[1]), max: null };
  m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) return { min: Number(m[1]), max: null };
  return { min: null, max: null };
}

function parseBudget(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function mapStatus(text) {
  const key = String(text || '').trim().toLowerCase();
  return STATUS_MAP[key] || 'open';
}

function mapEmploymentType(text, fallback) {
  const key = String(text || '').trim().toLowerCase();
  return ENGAGEMENT_MAP[key] || fallback || null;
}

function getJdLink(cell) {
  try {
    let url = String(cell.getValue() || '');
    if (/^https?:\/\//.test(url)) return url;
    const rich = cell.getRichTextValue();
    return (rich && rich.getLinkUrl()) || '';
  } catch (e) {
    return '';
  }
}

// Builds the full list of (tab, row) tasks to process, skipping blank rows.
function buildQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const queue = [];
  TABS.forEach((tabConfig, tabIndex) => {
    const sheet = ss.getSheetByName(tabConfig.name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const colTitle = findCol(
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0],
      'Role name',
    );
    if (colTitle < 0) return;
    const titles = sheet.getRange(2, colTitle + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < titles.length; i++) {
      if (String(titles[i][0] || '').trim()) {
        queue.push({ tabIndex, row: i + 2 });
      }
    }
  });
  return queue;
}

function buildRowPayload(sheet, tabConfig, rowNum) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  const colTitle = findCol(headers, 'Role name');
  const colJd = findCol(headers, 'Brief context about the role (JD)');
  const colExperience = findCol(headers, 'Experience');
  const colBudget = findCol(headers, 'Budget');
  const colOpenings = findCol(headers, 'No of Openings');
  const colLocation = findCol(headers, 'Location');
  const colStatus = findCol(headers, 'Status');
  const colEngagement = findCol(headers, 'Engagement');

  const title = colTitle >= 0 ? String(values[colTitle] || '').trim() : '';
  const experienceText = colExperience >= 0 ? values[colExperience] : '';
  const budgetText = colBudget >= 0 ? values[colBudget] : '';
  const { min: minExperience, max: maxExperience } = parseExperience(experienceText);
  const budget = parseBudget(budgetText);
  const jdLink = colJd >= 0 ? getJdLink(sheet.getRange(rowNum, colJd + 1)) : '';

  const descriptionParts = [];
  if (jdLink) descriptionParts.push(`JD: ${jdLink}`);
  if (experienceText) descriptionParts.push(`Experience (as entered): ${experienceText}`);
  if (budgetText) descriptionParts.push(`Budget (as entered): ${budgetText}`);
  let description = descriptionParts.join('\n\n').trim();
  if (description.length < 20) {
    description = `${description}\n\n(Imported from "${tabConfig.name}" tab, row ${rowNum}.)`.trim();
  }

  return {
    externalRef: `${sheet.getSheetId()}-${rowNum}`,
    title,
    description,
    minExperience,
    maxExperience,
    location: colLocation >= 0 ? String(values[colLocation] || '').trim() || null : null,
    workMode: tabConfig.defaultWorkMode,
    employmentType: mapEmploymentType(
      colEngagement >= 0 ? values[colEngagement] : '',
      tabConfig.defaultEmploymentType,
    ),
    openings: colOpenings >= 0 && values[colOpenings] ? Number(values[colOpenings]) : 1,
    budget,
    currency: 'INR',
    status: colStatus >= 0 ? mapStatus(values[colStatus]) : 'open',
  };
}

function postBatch(rows) {
  if (rows.length === 0) return;
  const response = UrlFetchApp.fetch(SERVER_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sheet-sync-secret': SYNC_SECRET },
    payload: JSON.stringify({ rows }),
    muteHttpExceptions: true,
  });
  console.log(response.getContentText());
}

function scheduleResume() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === RESUME_FN && t.getEventType() === ScriptApp.EventType.CLOCK)
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(RESUME_FN).timeBased().after(60 * 1000).create();
}

function syncSheetToServer() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log('Another sync is already running, skipping this trigger.');
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const startTime = Date.now();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    let queue;
    const stored = props.getProperty('syncQueue');
    if (stored) {
      queue = JSON.parse(stored);
    } else {
      queue = buildQueue();
      console.log(`Starting new sync: ${queue.length} rows to process.`);
    }

    let buffer = [];
    let processed = 0;

    while (queue.length > 0) {
      if (Date.now() - startTime > MAX_RUN_MS) {
        postBatch(buffer);
        props.setProperty('syncQueue', JSON.stringify(queue));
        console.log(`Processed ${processed} rows this run; ${queue.length} remaining. Resuming in ~1 min.`);
        scheduleResume();
        return;
      }

      const task = queue.shift();
      const tabConfig = TABS[task.tabIndex];
      const sheet = ss.getSheetByName(tabConfig.name);
      if (sheet) {
        buffer.push(buildRowPayload(sheet, tabConfig, task.row));
        processed++;
      }

      if (buffer.length >= BATCH_SIZE) {
        postBatch(buffer);
        buffer = [];
      }
    }

    postBatch(buffer);
    props.deleteProperty('syncQueue');
    ScriptApp.getProjectTriggers()
      .filter((t) => t.getHandlerFunction() === RESUME_FN && t.getEventType() === ScriptApp.EventType.CLOCK)
      .forEach((t) => ScriptApp.deleteTrigger(t));
    console.log(`Sync complete: ${processed} rows processed.`);
  } finally {
    lock.releaseLock();
  }
}
