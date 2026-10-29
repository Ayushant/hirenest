import { supabase } from '../lib/supabase';

export type DocumentKind =
  | 'company_registration'
  | 'tax_identifier'
  | 'gst_certificate'
  | 'authorized_representative'
  | 'business_address'
  | 'nda_executed'
  | 'other_compliance';

export type DocumentReviewStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'more_info_requested'
  | 'not_applicable'
  | 'expired';

export type NdaStatus =
  | 'none'
  | 'pending_verification'
  | 'verified'
  | 'rejected'
  | 'revoked'
  | 'expired';

export interface OrganizationDocument {
  id: string;
  org_id: string;
  kind: DocumentKind;
  status: DocumentReviewStatus;
  storage_path: string | null;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  expires_at: string | null;
}

export interface OrganizationNdaStatus {
  org_id: string;
  status: NdaStatus;
  nda_version: string | null;
  executed_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  evidence_doc_id: string | null;
  revoked_at: string | null;
  notes: string | null;
  updated_at: string;
}

export interface OnboardingAuditEvent {
  id: number;
  org_id: string;
  subject_kind: 'document' | 'nda';
  subject_id: string | null;
  action: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  actor_id: string | null;
  actor_role: string | null;
  notes: string | null;
  occurred_at: string;
}

export interface OrganizationOnboarding {
  organization: Record<string, unknown> | null;
  documents: OrganizationDocument[];
  nda: OrganizationNdaStatus | null;
  audit: OnboardingAuditEvent[];
}

export async function fetchOrganizationOnboarding(
  orgId: string
): Promise<OrganizationOnboarding | null> {
  const { data, error } = await supabase.rpc('get_organization_onboarding', {
    p_org_id: orgId,
  });
  if (error) throw error;
  return (data as OrganizationOnboarding) || null;
}

export async function fetchAdminPendingDocuments(): Promise<OrganizationDocument[]> {
  const { data, error } = await supabase.rpc('admin_list_pending_documents');
  if (error) throw error;
  return (data as OrganizationDocument[]) || [];
}

export async function reviewOrganizationDocument(params: {
  documentId: string;
  decision: Exclude<DocumentReviewStatus, 'pending_review'>;
  notes?: string | null;
}): Promise<OrganizationDocument> {
  const { data, error } = await supabase.rpc('admin_review_document', {
    p_document_id: params.documentId,
    p_decision: params.decision,
    p_notes: params.notes ?? null,
  });
  if (error) throw error;
  return data as OrganizationDocument;
}

export async function updateOrganizationNdaStatus(params: {
  orgId: string;
  status: NdaStatus;
  ndaVersion?: string | null;
  executedAt?: string | null;
  evidenceDocId?: string | null;
  notes?: string | null;
}): Promise<OrganizationNdaStatus> {
  const { data, error } = await supabase.rpc('admin_update_nda_status', {
    p_org_id: params.orgId,
    p_status: params.status,
    p_nda_version: params.ndaVersion ?? null,
    p_executed_at: params.executedAt ?? null,
    p_evidence_doc_id: params.evidenceDocId ?? null,
    p_notes: params.notes ?? null,
  });
  if (error) throw error;
  return data as OrganizationNdaStatus;
}

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  company_registration: 'Company registration / incorporation',
  tax_identifier: 'PAN / tax identifier',
  gst_certificate: 'GST certificate',
  authorized_representative: 'Authorized representative',
  business_address: 'Registered / business address',
  nda_executed: 'Executed HireNest NDA',
  other_compliance: 'Other compliance document',
};

export const NDA_STATUS_LABELS: Record<NdaStatus, string> = {
  none: 'Not provided',
  pending_verification: 'Pending verification',
  verified: 'Verified',
  rejected: 'Rejected',
  revoked: 'Revoked',
  expired: 'Expired',
};

export const ORG_DOCUMENTS_BUCKET = 'org-documents';
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];

export async function uploadOrganizationDocument(params: {
  orgId: string;
  kind: DocumentKind;
  file: File;
}): Promise<OrganizationDocument> {
  if (params.file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File is larger than 25 MB.');
  }
  if (
    params.file.type &&
    !ACCEPTED_UPLOAD_MIME_TYPES.includes(params.file.type)
  ) {
    throw new Error(
      'Unsupported file type. Upload a PDF, PNG, JPEG, or WebP document.'
    );
  }
  const extensionMatch = params.file.name.match(/\.([a-z0-9]+)$/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'bin';
  const path = `${params.orgId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ORG_DOCUMENTS_BUCKET)
    .upload(path, params.file, {
      contentType: params.file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase.rpc('record_organization_document', {
    p_org_id: params.orgId,
    p_kind: params.kind,
    p_storage_path: path,
    p_original_name: params.file.name,
    p_mime_type: params.file.type || null,
    p_size_bytes: params.file.size,
  });
  if (error) {
    // Best-effort cleanup if metadata insert fails after upload
    await supabase.storage.from(ORG_DOCUMENTS_BUCKET).remove([path]);
    throw error;
  }
  // RPC returns the new document id; refetch the full row
  const { data: row, error: rowError } = await supabase
    .from('organization_documents')
    .select('*')
    .eq('id', data as string)
    .single();
  if (rowError) throw rowError;
  return row as OrganizationDocument;
}

export async function createSignedDocumentUrl(
  storagePath: string,
  expiresInSeconds = 300
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ORG_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
