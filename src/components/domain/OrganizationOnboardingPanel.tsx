import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Dialog, Textarea, Select } from '../ui/kit';
import { useToast } from '../ui/Toast';
import {
  DOCUMENT_KIND_LABELS,
  NDA_STATUS_LABELS,
  ACCEPTED_UPLOAD_MIME_TYPES,
  type DocumentKind,
  type DocumentReviewStatus,
  type NdaStatus,
  type OrganizationDocument,
  fetchOrganizationOnboarding,
  reviewOrganizationDocument,
  updateOrganizationNdaStatus,
  uploadOrganizationDocument,
  createSignedDocumentUrl,
} from '../../api/onboarding';
import { mapSupabaseError } from '../../lib/errors';

const REQUIRED_DOCUMENT_KINDS: DocumentKind[] = [
  'company_registration',
  'tax_identifier',
  'gst_certificate',
  'authorized_representative',
  'business_address',
  'nda_executed',
];

const DOC_DECISION_OPTIONS: Array<{
  value: Exclude<DocumentReviewStatus, 'pending_review'>;
  label: string;
}> = [
  { value: 'approved', label: 'Approve' },
  { value: 'rejected', label: 'Reject' },
  { value: 'more_info_requested', label: 'Request more info' },
  { value: 'not_applicable', label: 'Mark not applicable' },
  { value: 'expired', label: 'Mark expired' },
];

const NDA_TRANSITION_OPTIONS: Array<{ value: NdaStatus; label: string }> = [
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'expired', label: 'Expired' },
  { value: 'none', label: 'Clear (none)' },
];

function docStatusTone(s: DocumentReviewStatus) {
  switch (s) {
    case 'approved':
      return 'emerald' as const;
    case 'rejected':
    case 'expired':
      return 'red' as const;
    case 'more_info_requested':
      return 'amber' as const;
    case 'not_applicable':
      return 'slate' as const;
    default:
      return 'info' as const;
  }
}

function ndaStatusTone(s: NdaStatus) {
  switch (s) {
    case 'verified':
      return 'emerald' as const;
    case 'rejected':
    case 'revoked':
    case 'expired':
      return 'red' as const;
    case 'pending_verification':
      return 'amber' as const;
    default:
      return 'slate' as const;
  }
}

export const OrganizationOnboardingPanel: React.FC<{
  orgId: string;
  isAdmin: boolean;
  allowUpload?: boolean;
}> = ({ orgId, isAdmin, allowUpload = false }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['organization_onboarding', orgId],
    queryFn: () => fetchOrganizationOnboarding(orgId),
  });

  const [reviewing, setReviewing] = useState<OrganizationDocument | null>(null);
  const [reviewDecision, setReviewDecision] =
    useState<Exclude<DocumentReviewStatus, 'pending_review'>>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);

  const [ndaOpen, setNdaOpen] = useState(false);
  const [ndaStatusDraft, setNdaStatusDraft] = useState<NdaStatus>('verified');
  const [ndaVersion, setNdaVersion] = useState('');
  const [ndaExecutedAt, setNdaExecutedAt] = useState('');
  const [ndaNotes, setNdaNotes] = useState('');
  const [ndaSaving, setNdaSaving] = useState(false);

  const [uploadingKind, setUploadingKind] = useState<DocumentKind | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-3">
        Loading onboarding record…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-3">
        Could not load onboarding record: {mapSupabaseError(error)}
      </p>
    );
  }
  const docs = data?.documents || [];
  const nda = data?.nda || null;

  const submitReview = async () => {
    if (!reviewing) return;
    setReviewSaving(true);
    try {
      await reviewOrganizationDocument({
        documentId: reviewing.id,
        decision: reviewDecision,
        notes: reviewNotes || null,
      });
      toast({ tone: 'success', title: 'Document review recorded.' });
      setReviewing(null);
      setReviewNotes('');
      await queryClient.invalidateQueries({ queryKey: ['organization_onboarding', orgId] });
    } catch (err) {
      toast({ tone: 'error', title: mapSupabaseError(err) });
    } finally {
      setReviewSaving(false);
    }
  };

  const handleUpload = async (kind: DocumentKind, file: File) => {
    setUploadingKind(kind);
    try {
      await uploadOrganizationDocument({ orgId, kind, file });
      toast({
        tone: 'success',
        title: 'Document uploaded.',
        description: 'An admin will review it shortly.',
      });
      await queryClient.invalidateQueries({ queryKey: ['organization_onboarding', orgId] });
    } catch (err) {
      toast({ tone: 'error', title: mapSupabaseError(err) });
    } finally {
      setUploadingKind(null);
    }
  };

  const handleOpen = async (doc: OrganizationDocument) => {
    if (!doc.storage_path) {
      toast({ tone: 'error', title: 'No file is attached to this document record.' });
      return;
    }
    setOpeningDocId(doc.id);
    try {
      const url = await createSignedDocumentUrl(doc.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({ tone: 'error', title: mapSupabaseError(err) });
    } finally {
      setOpeningDocId(null);
    }
  };

  const submitNda = async () => {
    setNdaSaving(true);
    try {
      await updateOrganizationNdaStatus({
        orgId,
        status: ndaStatusDraft,
        ndaVersion: ndaVersion || null,
        executedAt: ndaExecutedAt ? new Date(ndaExecutedAt).toISOString() : null,
        notes: ndaNotes || null,
      });
      toast({ tone: 'success', title: 'NDA status updated.' });
      setNdaOpen(false);
      setNdaVersion('');
      setNdaExecutedAt('');
      setNdaNotes('');
      await queryClient.invalidateQueries({ queryKey: ['organization_onboarding', orgId] });
    } catch (err) {
      toast({ tone: 'error', title: mapSupabaseError(err) });
    } finally {
      setNdaSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Onboarding review
          </h2>
          <p className="text-[12px] leading-[16px] text-[var(--text-tertiary)] mt-0.5">
            Documents and NDA status. Protected collaboration (vendor shares) is blocked
            server-side until the NDA is verified.
          </p>
        </div>
        {isAdmin && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setNdaStatusDraft(nda?.status === 'verified' ? 'revoked' : 'verified');
              setNdaVersion(nda?.nda_version || '');
              setNdaExecutedAt(nda?.executed_at ? nda.executed_at.slice(0, 10) : '');
              setNdaNotes('');
              setNdaOpen(true);
            }}
          >
            Update NDA status
          </Button>
        )}
      </div>

      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex flex-wrap items-center gap-3">
        <span className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
          NDA
        </span>
        <Badge tone={ndaStatusTone(nda?.status || 'none')}>
          {NDA_STATUS_LABELS[nda?.status || 'none']}
        </Badge>
        {nda?.nda_version && (
          <span className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
            Version: <span className="font-mono">{nda.nda_version}</span>
          </span>
        )}
        {nda?.executed_at && (
          <span className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
            Executed: {new Date(nda.executed_at).toLocaleDateString()}
          </span>
        )}
        {nda?.verified_at && (
          <span className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
            Verified: {new Date(nda.verified_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {allowUpload && (
        <div className="space-y-2">
          <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
            Required documents
          </h3>
          <p className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
            Accepted file types: PDF, PNG, JPEG, WebP. Maximum 25 MB per file. Admins review
            every submission before protected collaboration is enabled.
          </p>
          <ul className="divide-y divide-[var(--border)] border-t border-b border-[var(--border)]">
            {REQUIRED_DOCUMENT_KINDS.map((kind) => {
              const existing = docs
                .filter((d) => d.kind === kind)
                .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0];
              return (
                <li key={kind} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] leading-[20px] font-medium text-[var(--text-primary)]">
                      {DOCUMENT_KIND_LABELS[kind]}
                    </div>
                    <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                      {existing ? (
                        <>
                          Current:&nbsp;
                          <Badge tone={docStatusTone(existing.status)}>
                            {existing.status.replace(/_/g, ' ')}
                          </Badge>
                          {existing.review_notes ? ` · ${existing.review_notes}` : ''}
                        </>
                      ) : (
                        'Not uploaded yet.'
                      )}
                    </div>
                  </div>
                  <label className="shrink-0 inline-flex items-center">
                    <input
                      type="file"
                      accept={ACCEPTED_UPLOAD_MIME_TYPES.join(',')}
                      className="sr-only"
                      disabled={uploadingKind !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(kind, file);
                        e.target.value = '';
                      }}
                    />
                    <span
                      role="button"
                      className={`cursor-pointer rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 h-8 inline-flex items-center text-[13px] leading-[20px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${
                        uploadingKind === kind ? 'opacity-60' : ''
                      }`}
                    >
                      {uploadingKind === kind
                        ? 'Uploading…'
                        : existing
                          ? 'Replace'
                          : 'Upload'}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
          Documents ({docs.length})
        </h3>
        {docs.length === 0 ? (
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-3 border-y border-[var(--border)]">
            No documents on record for this organization.
          </p>
        ) : (
          <div className="border-t border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                  <th>Reviewed</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">
                      {DOCUMENT_KIND_LABELS[d.kind]}
                      {d.original_name && (
                        <div className="font-mono text-[12px] text-[var(--text-tertiary)]">
                          {d.original_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge tone={docStatusTone(d.status)}>
                        {d.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="text-[12px] text-[var(--text-secondary)]">
                      {new Date(d.uploaded_at).toLocaleDateString()}
                    </td>
                    <td className="text-[12px] text-[var(--text-secondary)]">
                      {d.reviewed_at ? new Date(d.reviewed_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="text-[12px] text-[var(--text-secondary)] max-w-xs truncate">
                      {d.review_notes || '-'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        {d.storage_path && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            loading={openingDocId === d.id}
                            onClick={() => handleOpen(d)}
                          >
                            View
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReviewing(d);
                              setReviewDecision(
                                d.status === 'pending_review'
                                  ? 'approved'
                                  : (d.status as Exclude<
                                      DocumentReviewStatus,
                                      'pending_review'
                                    >)
                              );
                              setReviewNotes(d.review_notes || '');
                            }}
                          >
                            Review
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title={
          reviewing
            ? `Review: ${DOCUMENT_KIND_LABELS[reviewing.kind]}`
            : 'Review document'
        }
      >
        <div className="space-y-3">
          <Select
            label="Decision"
            value={reviewDecision}
            onChange={(e) =>
              setReviewDecision(
                e.target.value as Exclude<DocumentReviewStatus, 'pending_review'>
              )
            }
            options={DOC_DECISION_OPTIONS}
          />
          <Textarea
            label="Notes (visible to the organization)"
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            rows={3}
            placeholder="Reason, missing fields, or follow-up ask."
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={reviewSaving} onClick={submitReview}>
              Record decision
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={ndaOpen} onClose={() => setNdaOpen(false)} title="Update NDA status">
        <div className="space-y-3">
          <Select
            label="Status"
            value={ndaStatusDraft}
            onChange={(e) => setNdaStatusDraft(e.target.value as NdaStatus)}
            options={NDA_TRANSITION_OPTIONS}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1">
                NDA version
              </label>
              <input
                type="text"
                value={ndaVersion}
                onChange={(e) => setNdaVersion(e.target.value)}
                placeholder="e.g. v2.1 (2026-01)"
                className="w-full h-[34px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[14px]"
              />
            </div>
            <div>
              <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1">
                Executed on
              </label>
              <input
                type="date"
                value={ndaExecutedAt}
                onChange={(e) => setNdaExecutedAt(e.target.value)}
                className="w-full h-[34px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[14px]"
              />
            </div>
          </div>
          <Textarea
            label="Notes (audit trail)"
            value={ndaNotes}
            onChange={(e) => setNdaNotes(e.target.value)}
            rows={3}
            placeholder="Verification evidence, reviewer, revocation reason, etc."
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setNdaOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={ndaSaving} onClick={submitNda}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
};
