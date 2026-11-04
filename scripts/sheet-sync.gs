/**
 * Paste this into Extensions > Apps Script on the jobs Google Sheet.
 * Then set SERVER_URL and SYNC_SECRET below, save, and run `setupTrigger`
 * once from the Apps Script editor (Run button) to install the on-edit sync.
 *
 * Expected sheet columns, in order, starting at column A, with a header row:
 * Title | Description | Skills | Min Experience | Max Experience | Location |
 * Work Mode (onsite/hybrid/remote) | Employment Type (full_time/contract/
 * contract_to_hire/part_time) | Openings | Budget | Currency | Status
 * (draft/pending_approval/open/on_hold/closed/filled)
 */

const SERVER_URL = 'https://YOUR-DEPLOYED-DOMAIN/api/sheet-sync/jobs';
const SYNC_SECRET = 'PASTE-THE-SAME-SECRET-SET-IN-SHEET_SYNC_SECRET-ENV-VAR';

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncSheetToServer')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  syncSheetToServer();
}

function syncSheetToServer() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  const values = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[0]) continue; // skip blank rows
    rows.push({
      externalRef: `${sheet.getSheetId()}-${i + 1}`,
      title: r[0],
      description: r[1],
      skills: String(r[2] || '').split(',').map((s) => s.trim()).filter(Boolean),
      minExperience: r[3] || null,
      maxExperience: r[4] || null,
      location: r[5] || null,
      workMode: r[6] || null,
      employmentType: r[7] || null,
      openings: r[8] || 1,
      budget: r[9] || null,
      currency: r[10] || 'INR',
      status: r[11] || 'draft',
    });
  }

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
