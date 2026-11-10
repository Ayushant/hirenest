const NOTES_MARKER = /\n*Additional information:\s*/;
const GDOC_RE = /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)[^\s]*/;

export interface ParsedDescription {
  body: string;
  notes: string;
  docUrl: string | null;
  docId: string | null;
}

export function parseJobDescription(description: string | null | undefined): ParsedDescription {
  const raw = String(description || '');
  const parts = raw.split(NOTES_MARKER);
  const withoutNotes = parts[0] || '';
  const notes = parts.slice(1).join('\n').trim();
  const doc = withoutNotes.match(GDOC_RE);
  const body = withoutNotes
    .replace(/(^|\n)JD:\s*(?=\n|$)/g, '$1')
    .replace(new RegExp(`JD:\\s*${GDOC_RE.source}`, 'g'), '')
    .replace(GDOC_RE, '')
    .trim();
  return {
    body,
    notes,
    docUrl: doc ? doc[0] : null,
    docId: doc ? doc[1] : null,
  };
}
