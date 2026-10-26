import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  MessageSquare,
  RefreshCw,
  Send,
  Share2,
  Users,
} from 'lucide-react';
import { Badge, Button, Dialog, Input, Textarea } from '../ui/kit';
import {
  buildSanitizedWhatsAppMessage,
  buildTrackedRequirementShareUrl,
  buildWhatsAppFollowUpMessage,
  computeRequirementSharingFunnelSummary,
  evaluateDirectCandidateShareEligibility,
  formatPhoneForWhatsAppUrl,
  recordRequirementShareActivity,
  recordShareFollowUp,
  updateShareActivityResponseStatus,
  type RequirementShareActivity,
  type SharingAudienceType,
  type SharingMethodType,
} from '../../lib/requirementSharing';
import {
  publishAndShareRequirementWithAllVendors,
  setRequirementPublic,
  setRequirementStatus,
  shareRequirementWithVendors,
} from '../../api/requirements';
import { formatLocalDateTime } from '../../lib/format';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../ui/Toast';
import type {
  Organization,
  Requirement,
  RequirementVendorShare,
  Submission,
} from '../../types/db';

export interface ShareRequirementModalProps {
  open: boolean;
  onClose: () => void;
  requirement: Requirement | null;
  approvedVendors: Organization[];
  existingShares?: RequirementVendorShare[];
  sharedByName?: string;
  sharedByRole?: string;
  onShared?: () => void;
}

export const ShareRequirementModal: React.FC<ShareRequirementModalProps> = ({
  open,
  onClose,
  requirement,
  approvedVendors,
  existingShares = [],
  sharedByName = 'HireNest HQ',
  sharedByRole = 'admin',
  onShared,
}) => {
  const { toast } = useToast();

  const [audienceType, setAudienceType] = useState<SharingAudienceType>('vendor');
  const [sharingMethod, setSharingMethod] = useState<SharingMethodType>('whatsapp');
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [slaHours, setSlaHours] = useState<number>(48);
  const [recipientCustomName, setRecipientCustomName] = useState<string>('');
  const [recipientWhatsAppPhone, setRecipientWhatsAppPhone] = useState<string>('');
  const [enableDirectCandidateFeed, setEnableDirectCandidateFeed] = useState<boolean>(true);
  const [shareToken, setShareToken] = useState<string>('');
  const [customMessage, setCustomMessage] = useState<string>('');
  const [isMessageEdited, setIsMessageEdited] = useState<boolean>(false);
  const [approvingReq, setApprovingReq] = useState<boolean>(false);
  const [sharingSubmitting, setSharingSubmitting] = useState<boolean>(false);
  const [copiedState, setCopiedState] = useState<'none' | 'whatsapp' | 'link'>('none');

  // Initialize modal state whenever a requirement opens
  useEffect(() => {
    if (!open || !requirement) return;
    const newToken = `shr_${requirement.id.replace(/-/g, '').slice(0, 6)}_${Date.now()
      .toString(36)
      .slice(-4)}`;
    setShareToken(newToken);
    setSlaHours(requirement.submission_sla_hours || 48);
    setAudienceType('vendor');
    setSharingMethod('whatsapp');
    setRecipientCustomName('');
    setRecipientWhatsAppPhone('');
    setEnableDirectCandidateFeed(true);
    setIsMessageEdited(false);
    setCopiedState('none');

    // Pre-select approved vendors if available
    if (approvedVendors.length > 0) {
      setSelectedVendorIds(approvedVendors.map((v) => v.id));
    } else {
      setSelectedVendorIds([]);
    }
  }, [open, requirement?.id, approvedVendors.length]);

  const dcEligibility = useMemo(() => {
    if (!requirement) {
      return { eligible: true, label: 'Eligible', reason: '' };
    }
    return evaluateDirectCandidateShareEligibility(requirement);
  }, [requirement]);

  const selectedVendorNames = useMemo(() => {
    if (audienceType !== 'vendor') return [];
    const chosen = approvedVendors
      .filter((v) => selectedVendorIds.includes(v.id))
      .map((v) => v.name);
    if (recipientCustomName.trim()) {
      chosen.push(recipientCustomName.trim());
    }
    return chosen;
  }, [audienceType, approvedVendors, selectedVendorIds, recipientCustomName]);

  const effectiveRecipientLabel = useMemo(() => {
    if (audienceType === 'vendor') {
      if (recipientCustomName.trim() && selectedVendorIds.length === 0) {
        return recipientCustomName.trim();
      }
      if (selectedVendorNames.length === 1) return selectedVendorNames[0];
      if (selectedVendorNames.length > 1) {
        return `${selectedVendorNames[0]} + ${selectedVendorNames.length - 1} vendor(s)`;
      }
      return 'Approved Vendors';
    }
    return recipientCustomName.trim() || 'Direct Candidates (FTE / Onsite Pool)';
  }, [audienceType, recipientCustomName, selectedVendorIds.length, selectedVendorNames]);

  const shareUrl = useMemo(() => {
    if (!requirement) return '';
    return buildTrackedRequirementShareUrl({
      requirementId: requirement.id,
      audienceType,
      shareToken: shareToken || 'hn_share',
    });
  }, [requirement, audienceType, shareToken]);

  const autoWhatsAppMessage = useMemo(() => {
    if (!requirement) return '';
    return buildSanitizedWhatsAppMessage({
      requirement,
      audienceType,
      recipientName:
        audienceType === 'vendor'
          ? selectedVendorNames.length === 1
            ? selectedVendorNames[0]
            : recipientCustomName.trim() || undefined
          : recipientCustomName.trim() || undefined,
      shareUrl,
      slaHours,
    });
  }, [
    requirement,
    audienceType,
    selectedVendorNames,
    recipientCustomName,
    shareUrl,
    slaHours,
  ]);

  useEffect(() => {
    if (!isMessageEdited) {
      setCustomMessage(autoWhatsAppMessage);
    }
  }, [autoWhatsAppMessage, isMessageEdited]);

  if (!requirement) return null;

  const isRequirementApprovedOpen =
    requirement.status === 'open' || requirement.status === 'filled';

  const handleApproveRequirementFirst = async () => {
    setApprovingReq(true);
    try {
      await setRequirementStatus({
        p_requirement_id: requirement.id,
        p_status: 'open',
        p_reason: 'Requirement checked and approved for sharing',
      });
      toast({
        title: 'Requirement approved & opened for sharing',
        description: `"${requirement.title}" is now Open and ready to share.`,
        tone: 'success',
      });
      onShared?.();
    } catch (err) {
      toast({
        title: 'Could not approve requirement',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setApprovingReq(false);
    }
  };

  const executeShareAndRecord = async (methodToRecord: SharingMethodType) => {
    setSharingSubmitting(true);
    try {
      // Ensure requirement is open if sharing with vendors or candidates
      if (requirement.status === 'draft' || requirement.status === 'pending_approval') {
        await setRequirementStatus({
          p_requirement_id: requirement.id,
          p_status: 'open',
          p_reason: 'Approved and opened during requirement sharing',
        }).catch(() => undefined);
      }

      if (audienceType === 'vendor') {
        // Share in-app with selected vendor orgs so vendor portals receive the requirement
        if (selectedVendorIds.length > 0) {
          await shareRequirementWithVendors({
            p_requirement_id: requirement.id,
            p_vendor_org_ids: selectedVendorIds,
            p_sla_hours: slaHours || requirement.submission_sla_hours || 48,
          }).catch(() => undefined);
        } else {
          await publishAndShareRequirementWithAllVendors({
            requirementId: requirement.id,
            slaHours: slaHours || requirement.submission_sla_hours || 48,
          }).catch(() => undefined);
        }

        // Record individual share activity per selected vendor (or custom vendor recipient)
        const targetVendors = approvedVendors.filter((v) =>
          selectedVendorIds.includes(v.id)
        );

        if (targetVendors.length > 0 && !recipientCustomName.trim()) {
          for (const v of targetVendors) {
            await recordRequirementShareActivity({
              requirementId: requirement.id,
              requirementTitle: requirement.title,
              audienceType: 'vendor',
              recipientOrgId: v.id,
              recipientName: v.name,
              recipientContact: recipientWhatsAppPhone.trim() || null,
              sharingMethod: methodToRecord,
              shareToken,
              shareUrl,
              whatsappMessage: customMessage || autoWhatsAppMessage,
              slaHours,
              sharedByName,
              sharedByRole,
            });
          }
        } else {
          await recordRequirementShareActivity({
            requirementId: requirement.id,
            requirementTitle: requirement.title,
            audienceType: 'vendor',
            recipientOrgId: targetVendors[0]?.id || null,
            recipientName: effectiveRecipientLabel,
            recipientContact: recipientWhatsAppPhone.trim() || null,
            sharingMethod: methodToRecord,
            shareToken,
            shareUrl,
            whatsappMessage: customMessage || autoWhatsAppMessage,
            slaHours,
            sharedByName,
            sharedByRole,
          });
        }
      } else {
        // Direct Candidate sharing: publish to Direct Candidate job board if enabled
        if (enableDirectCandidateFeed && !requirement.is_public) {
          await setRequirementPublic({
            p_requirement_id: requirement.id,
            p_is_public: true,
          }).catch(() => undefined);
        }

        await recordRequirementShareActivity({
          requirementId: requirement.id,
          requirementTitle: requirement.title,
          audienceType: 'direct_candidate',
          recipientOrgId: null,
          recipientName: effectiveRecipientLabel,
          recipientContact: recipientWhatsAppPhone.trim() || null,
          sharingMethod: methodToRecord,
          shareToken,
          shareUrl,
          whatsappMessage: customMessage || autoWhatsAppMessage,
          slaHours: null,
          sharedByName,
          sharedByRole,
        });
      }

      if (methodToRecord === 'whatsapp') {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard
            .writeText(customMessage || autoWhatsAppMessage)
            .catch(() => undefined);
        }
        setCopiedState('whatsapp');
        toast({
          title: 'WhatsApp message copied & share recorded',
          description: `Shared "${requirement.title}" with ${effectiveRecipientLabel}. Message is copied to your clipboard and tracked in HireNestOS.`,
          tone: 'success',
        });
      } else if (methodToRecord === 'copy_link') {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl).catch(() => undefined);
        }
        setCopiedState('link');
        toast({
          title: 'Tracked link copied & share recorded',
          description: `Link for "${requirement.title}" copied and logged for ${effectiveRecipientLabel}.`,
          tone: 'success',
        });
      } else {
        toast({
          title: 'Requirement shared to In-app Feed',
          description: `"${requirement.title}" is now live for ${effectiveRecipientLabel} and tracked in HireNestOS.`,
          tone: 'success',
        });
      }

      onShared?.();
    } catch (err) {
      toast({
        title: 'Could not complete requirement share',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSharingSubmitting(false);
    }
  };

  const formattedPhone = formatPhoneForWhatsAppUrl(recipientWhatsAppPhone);
  const whatsappDeepLink = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(
    customMessage || autoWhatsAppMessage
  )}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Share Requirement — ${requirement.title}`}
      description="Every shared requirement originates from HireNestOS, recipients respond through the platform, and your team can track what was shared, with whom, and what happened next."
      maxWidth="max-w-[760px]"
    >
      <div className="space-y-5">
        {/* Step 1 & Step 2 Readiness Strip */}
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] leading-[16px]">
            <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#1F4CC4]/10 text-[#1F4CC4] px-2 py-1 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              1. Client Requirement Received
            </span>
            <span className="text-[var(--text-tertiary)]">→</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 font-medium ${
                isRequirementApprovedOpen
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              2. Requirement {isRequirementApprovedOpen ? 'Approved (Open)' : `Status: ${requirement.status}`}
            </span>
          </div>

          {!isRequirementApprovedOpen && (
            <Button
              size="sm"
              loading={approvingReq}
              onClick={handleApproveRequirementFirst}
            >
              Approve &amp; Open for Sharing
            </Button>
          )}
        </div>

        {/* Step 3: Select How and With Whom to Share (Vendor Sharing vs Direct Candidates) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-[16px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              3. Select how and with whom to share
            </span>
            <span className="text-[12px] text-[var(--text-tertiary)]">
              Choose Vendor Sharing or Direct Candidates
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Vendor Sharing Card (Matches green card in diagram) */}
            <button
              type="button"
              onClick={() => {
                setAudienceType('vendor');
                setIsMessageEdited(false);
              }}
              className={`text-left rounded-[10px] border p-4 transition-all cursor-pointer ${
                audienceType === 'vendor'
                  ? 'border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/20'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="h-8 w-8 rounded-[8px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Building2 className="h-4 w-4" />
                </div>
                {audienceType === 'vendor' && (
                  <Badge tone="emerald">Selected</Badge>
                )}
              </div>
              <div className="mt-2.5 text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                Vendor Sharing
              </div>
              <div className="mt-0.5 text-[12px] leading-[18px] text-[var(--text-secondary)]">
                Select approved vendors · Track SLA &amp; submitted candidate profiles
              </div>
            </button>

            {/* Direct Candidates Card (Matches warm amber/cream card in diagram) */}
            <button
              type="button"
              onClick={() => {
                setAudienceType('direct_candidate');
                setIsMessageEdited(false);
              }}
              className={`text-left rounded-[10px] border p-4 transition-all cursor-pointer ${
                audienceType === 'direct_candidate'
                  ? 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/20'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="h-8 w-8 rounded-[8px] bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Users className="h-4 w-4" />
                </div>
                <Badge tone={dcEligibility.eligible ? 'emerald' : 'amber'}>
                  {dcEligibility.eligible ? 'Eligible FTE / Onsite' : 'Vendor-first role'}
                </Badge>
              </div>
              <div className="mt-2.5 text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                Direct Candidates
              </div>
              <div className="mt-0.5 text-[12px] leading-[18px] text-[var(--text-secondary)]">
                Eligible FTE / onsite roles · Candidates apply directly on HireNestOS
              </div>
            </button>
          </div>

          {/* Audience-Specific Recipient Configuration */}
          {audienceType === 'vendor' ? (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--text-primary)]">
                  Approved Vendors ({selectedVendorIds.length} of {approvedVendors.length} selected)
                </span>
                {approvedVendors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedVendorIds.length === approvedVendors.length) {
                        setSelectedVendorIds([]);
                      } else {
                        setSelectedVendorIds(approvedVendors.map((v) => v.id));
                      }
                    }}
                    className="text-[12px] font-medium text-[#1F4CC4] hover:underline cursor-pointer"
                  >
                    {selectedVendorIds.length === approvedVendors.length
                      ? 'Clear selection'
                      : 'Select all approved vendors'}
                  </button>
                )}
              </div>

              {approvedVendors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {approvedVendors.map((v) => {
                    const isSelected = selectedVendorIds.includes(v.id);
                    const alreadyShared = existingShares.some(
                      (s) => s.vendor_org_id === v.id && !s.revoked_at
                    );
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setSelectedVendorIds((prev) =>
                            isSelected
                              ? prev.filter((id) => id !== v.id)
                              : [...prev, v.id]
                          )
                        }
                        className={`h-7 px-2.5 rounded-[6px] border text-[12px] leading-[16px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-[#1F4CC4] bg-[#1F4CC4] text-white'
                            : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                        <span>{v.name}</span>
                        {alreadyShared && (
                          <span
                            className={`text-[10px] font-mono ${
                              isSelected ? 'text-white/80' : 'text-emerald-600'
                            }`}
                          >
                            · Shared
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <Input
                  label="Vendor contact / agency name (optional)"
                  placeholder="e.g. Apex Staffing Desk"
                  value={recipientCustomName}
                  onChange={(e) => setRecipientCustomName(e.target.value)}
                />
                <Input
                  label="Vendor WhatsApp number (optional)"
                  placeholder="e.g. +91 98765 43210"
                  value={recipientWhatsAppPhone}
                  onChange={(e) => setRecipientWhatsAppPhone(e.target.value)}
                />
                <Input
                  label="Submission SLA (hours)"
                  type="number"
                  min={1}
                  max={720}
                  value={slaHours}
                  onChange={(e) => setSlaHours(Number(e.target.value) || 48)}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)]">{dcEligibility.label}:</strong>{' '}
                  {dcEligibility.reason}
                </div>
                <label className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableDirectCandidateFeed}
                    onChange={(e) => setEnableDirectCandidateFeed(e.target.checked)}
                    className="accent-[#1F4CC4]"
                  />
                  <span>Publish to Direct Candidate In-app Job Feed</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Candidate name or group label (optional)"
                  placeholder="e.g. Rahul Sharma or LinkedIn / Naukri FTE Pool"
                  value={recipientCustomName}
                  onChange={(e) => setRecipientCustomName(e.target.value)}
                />
                <Input
                  label="Candidate WhatsApp number (optional)"
                  placeholder="e.g. +91 98765 43210"
                  value={recipientWhatsAppPhone}
                  onChange={(e) => setRecipientWhatsAppPhone(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Step 4: Choose Sharing Method (WhatsApp · Copy Link · In-app Feed) */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] leading-[16px] font-semibold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
              4. Choose sharing method
            </span>
            <div className="inline-flex rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-1 gap-1">
              <button
                type="button"
                onClick={() => setSharingMethod('whatsapp')}
                className={`px-3 py-1.5 rounded-[6px] text-[12px] leading-[16px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  sharingMethod === 'whatsapp'
                    ? 'bg-[#1F4CC4] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={() => setSharingMethod('copy_link')}
                className={`px-3 py-1.5 rounded-[6px] text-[12px] leading-[16px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  sharingMethod === 'copy_link'
                    ? 'bg-[#1F4CC4] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>Copy Link</span>
              </button>
              <button
                type="button"
                onClick={() => setSharingMethod('in_app')}
                className={`px-3 py-1.5 rounded-[6px] text-[12px] leading-[16px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  sharingMethod === 'in_app'
                    ? 'bg-[#1F4CC4] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>In-app Feed</span>
              </button>
            </div>
          </div>

          {sharingMethod === 'whatsapp' && (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-medium text-[var(--text-primary)]">
                  Sanitized WhatsApp Requirement Message (Client name masked · Includes tracked HireNestOS link)
                </div>
                {isMessageEdited && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMessageEdited(false);
                      setCustomMessage(autoWhatsAppMessage);
                    }}
                    className="text-[11px] text-[#1F4CC4] hover:underline cursor-pointer"
                  >
                    Reset to default template
                  </button>
                )}
              </div>

              <Textarea
                rows={9}
                value={customMessage}
                onChange={(e) => {
                  setIsMessageEdited(true);
                  setCustomMessage(e.target.value);
                }}
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-[var(--text-tertiary)] font-mono truncate max-w-[360px]">
                  Tracked link: {shareUrl}
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={whatsappDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      void executeShareAndRecord('whatsapp');
                    }}
                    className="h-8 px-3 rounded-[6px] bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open WhatsApp &amp; Record Share</span>
                  </a>

                  <Button
                    size="sm"
                    loading={sharingSubmitting}
                    onClick={() => executeShareAndRecord('whatsapp')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedState === 'whatsapp'
                      ? 'Copied & Recorded!'
                      : 'Copy WhatsApp Text & Record Share'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {sharingMethod === 'copy_link' && (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <div className="text-[12px] font-medium text-[var(--text-primary)]">
                Tracked HireNestOS Requirement Link for {effectiveRecipientLabel}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 h-9 rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 font-mono text-[12px] text-[var(--text-primary)]"
                />
                <Button
                  loading={sharingSubmitting}
                  onClick={() => executeShareAndRecord('copy_link')}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedState === 'link' ? 'Link Copied & Logged!' : 'Copy Link & Record Share'}
                </Button>
              </div>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Recipients opening this link are routed directly into HireNestOS to{' '}
                {audienceType === 'vendor'
                  ? 'acknowledge the requirement and submit candidate profiles'
                  : 'view the role and submit their direct application'}
                .
              </p>
            </div>
          )}

          {sharingMethod === 'in_app' && (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Publish directly to {effectiveRecipientLabel} In-app Feed
                  </div>
                  <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                    {audienceType === 'vendor'
                      ? `Immediately distributes this requirement to ${
                          selectedVendorIds.length || approvedVendors.length || 'all'
                        } approved vendor workspace(s) with a ${slaHours}h submission SLA.`
                      : 'Publishes this requirement to the Direct Candidate job board so eligible candidates can apply in-app.'}
                  </p>
                </div>
                <Button
                  loading={sharingSubmitting}
                  onClick={() => executeShareAndRecord('in_app')}
                >
                  <Send className="h-3.5 w-3.5" />
                  Share to In-app Feed
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Summary: Step 5, 6 & 7 Flow Preview */}
        <div className="pt-3 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--text-secondary)]">
          <span>
            <strong>Next in HireNestOS:</strong> 5. Requirement Shared → 6. Track Responses (Submissions &amp; Applications) → 7. Screening → Interview → Placement
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

// ============================================================================
// 7-STEP SHARING & RESPONSE TRACKING PANEL (Steps 1 -> 7 Visual Flow & Ledger)
// ============================================================================

export const RequirementSharingFlowPanel: React.FC<{
  requirement: Requirement;
  shares: RequirementVendorShare[];
  submissions: Submission[];
  activities: RequirementShareActivity[];
  onOpenShareModal: (defaultAudience?: SharingAudienceType) => void;
  onRefresh: () => void;
}> = ({
  requirement,
  shares,
  submissions,
  activities,
  onOpenShareModal,
  onRefresh,
}) => {
  const { toast } = useToast();

  const acknowledgedCount = useMemo(
    () => shares.filter((s) => Boolean(s.acknowledged_at) && !s.revoked_at).length,
    [shares]
  );

  const summary = useMemo(
    () =>
      computeRequirementSharingFunnelSummary({
        requirement,
        activities,
        vendorSharesCount: shares.filter((s) => !s.revoked_at).length,
        acknowledgedVendorsCount: acknowledgedCount,
        submissions,
      }),
    [requirement, activities, shares, acknowledgedCount, submissions]
  );

  const handleCopyFollowUp = async (act: RequirementShareActivity) => {
    const msg = buildWhatsAppFollowUpMessage(act);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(msg).catch(() => undefined);
    }
    await recordShareFollowUp(act.id);
    toast({
      title: 'Follow-up message copied & logged',
      description: `Follow-up #${(act.followUpCount || 0) + 1} recorded for ${act.recipientName}.`,
      tone: 'success',
    });
    onRefresh();
  };

  const handleMarkStatus = async (
    act: RequirementShareActivity,
    nextStatus: 'acknowledged' | 'responded'
  ) => {
    await updateShareActivityResponseStatus({
      activityId: act.id,
      status: nextStatus,
      incrementResponse: nextStatus === 'responded',
    });
    toast({
      title:
        nextStatus === 'acknowledged'
          ? `Marked acknowledged by ${act.recipientName}`
          : `Recorded response from ${act.recipientName}`,
      tone: 'success',
    });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Visual 7-Step Requirement Sharing & Response Architecture (Matches User Flowchart) */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
              Requirement Sharing &amp; Response Flow (Steps 1–7)
            </h3>
            <p className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
              Every shared requirement originates from HireNestOS, recipients respond through the platform, and your team tracks what was shared, with whom, and what happened next.
            </p>
          </div>
          <Button size="sm" onClick={() => onOpenShareModal('vendor')}>
            <Share2 className="h-3.5 w-3.5" />
            Share Requirement
          </Button>
        </div>

        {/* 7-Step Flow Grid */}
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2.5 text-[12px]">
          {/* Step 1 */}
          <div className="rounded-[8px] border border-[#1F4CC4]/30 bg-[#1F4CC4]/10 p-3 flex flex-col justify-between">
            <div className="font-semibold text-[var(--text-primary)]">
              1. Requirement Received
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Added to HireNestOS
            </div>
            <div className="mt-2 font-mono text-[11px] text-[#1F4CC4] font-semibold">
              ✓ Recorded
            </div>
          </div>

          {/* Step 2 */}
          <div
            className={`rounded-[8px] border p-3 flex flex-col justify-between ${
              summary.step2Approved
                ? 'border-[#1F4CC4]/30 bg-[#1F4CC4]/10'
                : 'border-amber-500/35 bg-amber-500/10'
            }`}
          >
            <div className="font-semibold text-[var(--text-primary)]">
              2. Requirement Approved
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Checked &amp; opened for sharing
            </div>
            <div className="mt-2 font-mono text-[11px] font-semibold">
              {summary.step2Approved ? '✓ Open' : `Status: ${requirement.status}`}
            </div>
          </div>

          {/* Step 3 */}
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex flex-col justify-between">
            <div className="font-semibold text-[var(--text-primary)]">
              3. Share Audience
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)] space-y-0.5">
              <div>• Vendors: <strong className="font-mono">{summary.vendorShareCount}</strong></div>
              <div>• Direct Cand.: <strong className="font-mono">{summary.directCandidateShareCount}</strong></div>
            </div>
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                onClick={() => onOpenShareModal('vendor')}
                className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                +Vendor
              </button>
              <span className="text-[var(--text-tertiary)]">·</span>
              <button
                type="button"
                onClick={() => onOpenShareModal('direct_candidate')}
                className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                +Candidate
              </button>
            </div>
          </div>

          {/* Step 4 */}
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex flex-col justify-between">
            <div className="font-semibold text-[var(--text-primary)]">
              4. Sharing Method
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)] space-y-0.5 font-mono tabular-nums">
              <div>WhatsApp: <strong>{summary.whatsappShareCount}</strong></div>
              <div>Copy Link: <strong>{summary.copyLinkShareCount}</strong></div>
              <div>In-app: <strong>{summary.inAppShareCount}</strong></div>
            </div>
            <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
              Multi-channel
            </div>
          </div>

          {/* Step 5 */}
          <div className="rounded-[8px] border border-purple-500/30 bg-purple-500/10 p-3 flex flex-col justify-between">
            <div className="font-semibold text-[var(--text-primary)]">
              5. Requirement Shared
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Recipients &amp; activity logged
            </div>
            <div className="mt-2 font-mono tabular-nums text-[12px] font-semibold text-[var(--text-primary)]">
              {summary.step5SharedCount} share(s)
            </div>
          </div>

          {/* Step 6 */}
          <div className="rounded-[8px] border border-[#1F4CC4]/30 bg-[#1F4CC4]/10 p-3 flex flex-col justify-between">
            <div className="font-semibold text-[var(--text-primary)]">
              6. Track Responses
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)] space-y-0.5 font-mono tabular-nums">
              <div>Vendor subs: <strong>{summary.vendorResponsesCount}</strong></div>
              <div>Cand. apps: <strong>{summary.candidateResponsesCount}</strong></div>
              <div>Follow-ups: <strong>{summary.totalFollowUpsCount}</strong></div>
            </div>
            <div className="mt-2 text-[10px] text-[#1F4CC4] font-medium">
              Live in HireNestOS
            </div>
          </div>

          {/* Step 7 */}
          <div className="rounded-[8px] border border-emerald-500/35 bg-emerald-500/10 p-3 flex flex-col justify-between">
            <div className="font-semibold text-[var(--text-primary)]">
              7. Hiring Outcome
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)] space-y-0.5 font-mono tabular-nums">
              <div>Screening: <strong>{summary.screeningCount}</strong></div>
              <div>Interview: <strong>{summary.interviewCount}</strong></div>
              <div>Placement: <strong>{summary.placementCount}</strong></div>
            </div>
            <div className="mt-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              Pipeline linked
            </div>
          </div>
        </div>

        {/* Two-Column Response Split: Vendor Response vs Candidate Response */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="rounded-[8px] border border-emerald-500/30 bg-emerald-500/5 p-3.5 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <FileText className="h-4 w-4 text-emerald-600" />
                <span>Vendor Response — Submit Candidate Profiles</span>
              </div>
              <div className="text-[12px] text-[var(--text-secondary)]">
                <span className="font-mono font-semibold">{summary.vendorShareCount}</span> vendor(s) shared ·{' '}
                <span className="font-mono font-semibold">{acknowledgedCount}</span> acknowledged ·{' '}
                <span className="font-mono font-semibold">{summary.vendorResponsesCount}</span> candidate submission(s)
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenShareModal('vendor')}
            >
              Share with Vendors
            </Button>
          </div>

          <div className="rounded-[8px] border border-amber-500/30 bg-amber-500/5 p-3.5 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <Users className="h-4 w-4 text-amber-600" />
                <span>Candidate Response — Apply for Requirement</span>
              </div>
              <div className="text-[12px] text-[var(--text-secondary)]">
                Job board: <strong>{requirement.is_public ? 'Public (Active)' : 'Private'}</strong> ·{' '}
                <span className="font-mono font-semibold">{summary.directCandidateShareCount}</span> share(s) ·{' '}
                <span className="font-mono font-semibold">{summary.candidateResponsesCount}</span> direct application(s)
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenShareModal('direct_candidate')}
            >
              Share with Candidates
            </Button>
          </div>
        </div>
      </div>

      {/* Recorded Sharing Activity Ledger (What was shared, with whom, method, and what happened next) */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-[13px] leading-[18px] font-semibold text-[var(--text-primary)]">
              Recorded Sharing Activity &amp; Recipient Responses ({activities.length})
            </h4>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Tracks every WhatsApp alert, copied link, and in-app share along with recipient acknowledgements, submissions, and follow-ups.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onOpenShareModal('vendor')}>
            <MessageSquare className="h-3.5 w-3.5" />
            Share via WhatsApp / Link
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Audience</th>
                <th>Sharing method</th>
                <th>Shared at</th>
                <th>Status &amp; responses</th>
                <th>Follow-ups</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-[var(--text-secondary)] py-6 text-center">
                    No WhatsApp or link sharing activity logged yet for this requirement. Click{' '}
                    <strong>Share Requirement</strong> above to share via WhatsApp, Copy Link, or In-app Feed.
                  </td>
                </tr>
              ) : (
                activities.map((act) => (
                  <tr key={act.id}>
                    <td>
                      <div className="font-medium text-[var(--text-primary)]">
                        {act.recipientName}
                      </div>
                      {act.recipientContact && (
                        <div className="text-[11px] font-mono text-[var(--text-tertiary)]">
                          {act.recipientContact}
                        </div>
                      )}
                    </td>
                    <td>
                      {act.audienceType === 'vendor' ? (
                        <Badge tone="emerald">Vendor Sharing</Badge>
                      ) : (
                        <Badge tone="amber">Direct Candidate</Badge>
                      )}
                    </td>
                    <td>
                      <span className="font-mono text-[12px] uppercase text-[var(--text-secondary)]">
                        {act.sharingMethod === 'whatsapp'
                          ? 'WhatsApp'
                          : act.sharingMethod === 'copy_link'
                            ? 'Copy Link'
                            : 'In-app Feed'}
                      </span>
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      {formatLocalDateTime(act.sharedAt)}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            act.status === 'responded' ||
                            act.status === 'placement' ||
                            act.responseCount > 0
                              ? 'emerald'
                              : act.status === 'acknowledged'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {act.responseCount > 0
                            ? `${act.responseCount} response(s)`
                            : act.status}
                        </Badge>
                      </div>
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                      {act.followUpCount || 0} sent
                      {act.lastFollowUpAt && (
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          Last: {formatLocalDateTime(act.lastFollowUpAt)}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopyFollowUp(act)}
                        >
                          <MessageSquare className="h-3 w-3" />
                          Follow-up
                        </Button>
                        {act.status === 'shared' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleMarkStatus(act, 'acknowledged')}
                          >
                            Ack
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMarkStatus(act, 'responded')}
                        >
                          +Response
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
