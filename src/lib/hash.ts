/**
 * Browser-side SHA-256 digest computation for resume deduplication
 * and filename sanitization for private storage uploads.
 */
export async function computeFileSha256(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];
const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB

export function validateResumeFile(file: File): string | null {
  if (file.size > MAX_RESUME_BYTES) {
    return 'Resume file must be 10 MB or smaller.';
  }
  const lowerName = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!hasValidExt) {
    return 'Only PDF, DOC, and DOCX files are allowed.';
  }
  return null;
}

export function buildSafeResumeStoragePath(candidateId: string, originalFileName: string): string {
  const timestamp = Date.now();
  const safeName = originalFileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-100);
  return `${candidateId}/${timestamp}-${safeName}`;
}
