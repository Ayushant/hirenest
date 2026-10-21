/**
 * Maps Supabase / Postgres errors to friendly user-facing messages per Section 5.6.
 * Never logs payloads or PII; never exposes raw SQL or stack traces.
 */
export function mapSupabaseError(err: unknown): string {
  if (!err) return 'An unexpected error occurred.';

  if (typeof err === 'string') {
    return formatErrorMessageString(err);
  }

  const errorObj = err as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };

  const code = errorObj.code ? String(errorObj.code) : '';
  const msg = errorObj.message ? String(errorObj.message) : '';

  // Log only error code (never payload or PII)
  if (code) {
    console.warn(`[HireNestOS DB Error Code]: ${code}`);
  }

  if (code === '42501' || msg.toUpperCase().startsWith('FORBIDDEN')) {
    return "You don't have permission to do this.";
  }

  if (msg.toLowerCase().includes('row-level security')) {
    return "This action isn't allowed for your role.";
  }

  if (code === '23505') {
    return 'This already exists.';
  }

  if (code === '23514') {
    return formatCheckConstraintMessage(msg);
  }

  if (
    msg.includes('Invalid transition') ||
    msg.includes('A reason is required')
  ) {
    return msg;
  }

  return formatErrorMessageString(msg);
}

function formatCheckConstraintMessage(msg: string): string {
  if (msg.includes('feedback')) return 'Feedback must be at least 10 characters.';
  if (msg.includes('reason')) return 'Reason must be at least 20 characters.';
  if (msg.includes('weights')) return 'Timing, quality, and compliance weights must sum to 100.';
  if (msg.includes('rating')) return 'Ratings must be between 1 and 5.';
  return 'One or more fields did not pass validation requirements.';
}

function formatErrorMessageString(msg: string): string {
  if (!msg) return 'Operation could not be completed. Please try again.';
  if (msg.toUpperCase().startsWith('FORBIDDEN')) {
    return "You don't have permission to do this.";
  }
  if (msg.toLowerCase().includes('row-level security')) {
    return "This action isn't allowed for your role.";
  }
  if (msg.includes('Invalid transition') || msg.includes('A reason is required')) {
    return msg;
  }
  // Strip raw SQL / Postgres internal prefixes if present
  if (msg.includes('SELECT ') || msg.includes('INSERT INTO ') || msg.includes('pg_')) {
    return 'Database operation failed. Please verify your inputs and try again.';
  }
  return msg;
}
