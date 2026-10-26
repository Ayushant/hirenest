import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  FileText,
  Scale,
  Clock,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Play,
  Search,
  UserCheck,
  Eye,
  Trash2,
} from 'lucide-react';
import {
  PageHeader,
  Button,
  Input,
  Select,
  Textarea,
  Badge,
  Card,
  MetricStrip,
  Tabs,
  TableSkeleton,
  EmptyState,
  ErrorState,
  Dialog,
} from '../../components/ui/kit';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/ui/Toast';
import { formatLocalDate } from '../../lib/format';
import {
  type PrivacyRequestType,
  type PrivacyRequestRecord,
  type PrivacyIncidentRecord,
  type LegalBasisType,
  fetchPrivacyDashboard,
  publishPrivacyNoticeApi,
  recordPrivacyAcknowledgementApi,
  createPrivacyRequestApi,
  updatePrivacyRequestApi,
  toggleRetentionLegalHoldApi,
  runDeletionJobApi,
  evaluateCandidateSharingGuardApi,
  createOrUpdatePrivacyIncidentApi,
} from '../../lib/dpdpPrivacy';

const LEGAL_BASIS_LABELS: Record<LegalBasisType, string> = {
  consent: 'Explicit Consent (DPDP s.6)',
  voluntary_employment_use: 'Voluntary / Employment Purpose (DPDP s.7)',
  contractual_processor_instruction: 'Client Processor Instruction',
  legal_obligation: 'Statutory / Legal Obligation',
};

const REQUEST_TYPE_LABELS: Record<PrivacyRequestType, string> = {
  access: 'Right to Access & Summary',
  correction: 'Right to Correction / Updating',
  erasure: 'Right to Erasure',
  grievance: 'Grievance Redressal',
  consent_withdrawal: 'Consent Withdrawal',
};

export const PrivacyGovernancePage: React.FC = () => {
  const { profile, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const role = profile?.role || 'admin';
  const isCandidateRole = role === 'candidate';
  const tenantId = organization?.id || profile?.org_id || 'hirenest_hq';

  const [activeTab, setActiveTab] = useState<string>(
    isCandidateRole ? 'candidate_center' : 'overview'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & interactive form states
  const [noticeModalOpen, setNoticeModalOpen] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState(
    'HireNestOS Candidate & Workforce Personal Data Protection Notice'
  );
  const [noticeVersion, setNoticeVersion] = useState('2.5.0');
  const [noticeLocale, setNoticeLocale] = useState('en-IN');
  const [noticePurposes, setNoticePurposes] = useState(
    'Candidate profile creation & SHA-256 deduplication, 4-dimension JD matching, Authorised client submission, Interview scheduling'
  );
  const [noticeSummary, setNoticeSummary] = useState(
    'Updated notice covering candidate resume parsing, explainable matching, human-approved client sharing, and Data Principal rights under the DPDP Act, 2023.'
  );

  // Consent / Acknowledgement simulation modal
  const [ackModalOpen, setAckModalOpen] = useState(false);
  const [ackSubjectRef, setAckSubjectRef] = useState(
    profile?.id ? `cand_${profile.id.slice(0, 8)}` : 'cand_vikram_singh'
  );
  const [ackSubjectName, setAckSubjectName] = useState(
    profile?.full_name || 'Vikram Singh'
  );
  const [ackAction, setAckAction] = useState<
    'consented' | 'acknowledged' | 'withdrawn' | 'preference_updated'
  >('consented');
  const [ackBasis, setAckBasis] = useState<LegalBasisType>('consent');
  const [prefEmail, setPrefEmail] = useState(true);
  const [prefWhatsapp, setPrefWhatsapp] = useState(true);
  const [prefSms, setPrefSms] = useState(false);

  // Rights & Grievance Request creation modal
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reqName, setReqName] = useState(profile?.full_name || 'Meera Krishnan');
  const [reqEmail, setReqEmail] = useState(profile?.email || 'meera.k@example.in');
  const [reqRef, setReqRef] = useState(
    profile?.id ? `cand_${profile.id.slice(0, 8)}` : 'cand_meera_krishnan'
  );
  const [reqType, setReqType] = useState<PrivacyRequestType>('access');
  const [reqSummary, setReqSummary] = useState(
    'Requesting a summary of personal data processed and list of client organisations with whom my profile has been shared.'
  );

  // Rights Request Review / Resolution modal
  const [selectedRequest, setSelectedRequest] = useState<PrivacyRequestRecord | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<PrivacyRequestRecord['status']>('completed');
  const [resolutionDecision, setResolutionDecision] = useState('');
  const [triggerErasureOnResolve, setTriggerErasureOnResolve] = useState(false);

  // Incident modal
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  const [incTitle, setIncTitle] = useState('');
  const [incSeverity, setIncSeverity] = useState<PrivacyIncidentRecord['severity']>('medium');
  const [incSystems, setIncSystems] = useState('Server-Side Sharing Guard, Candidate Export API');
  const [incAssessment, setIncAssessment] = useState('');
  const [incContainment, setIncContainment] = useState('');
  const [incNotifStatus, setIncNotifStatus] =
    useState<PrivacyIncidentRecord['notificationStatus']>('assessing');

  // Sharing & Export Guard Simulator State
  const [guardActorRole, setGuardActorRole] = useState<string>('recruiter');
  const [guardCallerTenant, setGuardCallerTenant] = useState<string>('hirenest_hq');
  const [guardTargetTenant, setGuardTargetTenant] = useState<string>('hirenest_hq');
  const [guardCandidateRef, setGuardCandidateRef] = useState<string>('cand_aarav_mehta');
  const [guardCandidateName, setGuardCandidateName] = useState<string>('Aarav Mehta');
  const [guardActionType, setGuardActionType] = useState<
    'share_with_client' | 'export_csv' | 'download_resume'
  >('share_with_client');
  const [guardHumanApproved, setGuardHumanApproved] = useState<boolean>(true);
  const [guardResult, setGuardResult] = useState<Awaited<
    ReturnType<typeof evaluateCandidateSharingGuardApi>
  > | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dpdp_privacy_dashboard', tenantId],
    queryFn: () =>
      fetchPrivacyDashboard({
        tenantId,
        role,
        userId: profile?.id || 'workspace_user',
      }),
  });

  const publishNoticeMutation = useMutation({
    mutationFn: () =>
      publishPrivacyNoticeApi({
        title: noticeTitle,
        version: noticeVersion,
        locale: noticeLocale,
        purposes: noticePurposes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        contentSummary: noticeSummary,
        publishedBy: `${profile?.full_name || 'HQ Admin'} (${role})`,
      }),
    onSuccess: (res) => {
      toast({
        title: `Published Notice ${res.notice.noticeId} (v${res.notice.version})`,
        description: 'Versioned notice is now active and logged in the DPDP audit ledger.',
        tone: 'success',
      });
      setNoticeModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not publish notice', description: err.message, tone: 'error' });
    },
  });

  const recordAckMutation = useMutation({
    mutationFn: () =>
      recordPrivacyAcknowledgementApi({
        subjectRef: ackSubjectRef,
        subjectName: ackSubjectName,
        tenantId,
        noticeId: data?.notices[0]?.noticeId || 'HN-DPDP-NOTICE-2026-V2',
        version: data?.notices[0]?.version || '2.4.0',
        purpose:
          ackAction === 'withdrawn'
            ? 'Data Principal withdrew recruitment processing consent'
            : 'Candidate profile creation, AI matching & authorised client submission',
        processingBasis: ackBasis,
        action: ackAction,
        communicationPreferences: {
          email: prefEmail,
          whatsapp: prefWhatsapp,
          sms: prefSms,
        },
        captureSource: isCandidateRole ? 'privacy_center' : 'candidate_portal',
      }),
    onSuccess: (res) => {
      toast({
        title: `Recorded ${res.acknowledgement.action.replace(/_/g, ' ')}`,
        description: `Evidence digest ${res.acknowledgement.evidenceRef} stored in Consent Registry.`,
        tone: 'success',
      });
      setAckModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not record acknowledgement', description: err.message, tone: 'error' });
    },
  });

  const createRequestMutation = useMutation({
    mutationFn: () =>
      createPrivacyRequestApi({
        tenantId,
        requesterRef: reqRef,
        requesterName: reqName,
        requesterEmail: reqEmail,
        requestType: reqType,
        summary: reqSummary,
      }),
    onSuccess: (res) => {
      toast({
        title: `Request ${res.request.requestId} logged`,
        description: `Assigned to ${res.request.assignedTo} with 7-day operational SLA.`,
        tone: 'success',
      });
      setRequestModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not submit request', description: err.message, tone: 'error' });
    },
  });

  const resolveRequestMutation = useMutation({
    mutationFn: () => {
      if (!selectedRequest) throw new Error('No request selected');
      return updatePrivacyRequestApi({
        requestId: selectedRequest.requestId,
        status: resolutionStatus,
        decision:
          resolutionDecision.trim() ||
          `Resolved ${selectedRequest.requestType} request in accordance with DPDP Act guidelines.`,
        triggerDeletionJob: triggerErasureOnResolve,
      });
    },
    onSuccess: (res) => {
      toast({
        title: `Updated ${res.request.requestId} (${res.request.status})`,
        description: res.deletionJob
          ? `Multi-system deletion job ${res.deletionJob.jobId} executed and verified.`
          : 'Decision and audit event recorded.',
        tone: 'success',
      });
      setSelectedRequest(null);
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not update request', description: err.message, tone: 'error' });
    },
  });

  const toggleHoldMutation = useMutation({
    mutationFn: (params: { policyId: string; legalHoldException: boolean }) =>
      toggleRetentionLegalHoldApi(params),
    onSuccess: (res) => {
      toast({
        title: `Updated ${res.policy.policyId}`,
        description: res.policy.legalHoldException
          ? 'Legal/Dispute hold exception enabled; erasure jobs will preserve commercial dispute evidence.'
          : 'Legal hold released; standard retention schedule active.',
        tone: 'info',
      });
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
  });

  const runDeletionMutation = useMutation({
    mutationFn: (params: {
      jobId?: string;
      subjectRef?: string;
      subjectLabel?: string;
      scope?: 'full_erasure' | 'resume_and_storage' | 'expired_retention_purge' | 'ai_cache_and_index';
    }) => runDeletionJobApi({ ...params, tenantId }),
    onSuccess: (res) => {
      toast({
        title: `Deletion Job ${res.job.jobId} Verified`,
        description: `Purged across PostgreSQL, Storage, Search Indexes & Caches for ${res.job.subjectRef}.`,
        tone: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
  });

  const runGuardMutation = useMutation({
    mutationFn: () =>
      evaluateCandidateSharingGuardApi({
        actorRef: profile?.id || 'usr_recruiter_01',
        actorRole: guardActorRole,
        callerTenantId: guardCallerTenant,
        targetTenantId: guardTargetTenant,
        candidateRef: guardCandidateRef,
        candidateName: guardCandidateName,
        candidateEmail: `${guardCandidateRef.replace('cand_', '')}@example.in`,
        candidatePhone: '+91 98201 44510',
        requirementId: 'REQ-2026-101',
        actionType: guardActionType,
        humanRecruiterApproved: guardHumanApproved,
      }),
    onSuccess: (res) => {
      setGuardResult(res);
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
  });

  const createIncidentMutation = useMutation({
    mutationFn: () =>
      createOrUpdatePrivacyIncidentApi({
        tenantId,
        title: incTitle,
        severity: incSeverity,
        affectedSystems: incSystems
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        affectedRecordsEstimate: 0,
        assessment: incAssessment,
        containment: incContainment,
        notificationStatus: incNotifStatus,
        accountableOwner: `${profile?.full_name || 'Security Officer'} (AIKIND & HireNest DPO)`,
      }),
    onSuccess: (res) => {
      toast({
        title: `Incident ${res.incident.incidentId} recorded`,
        description: 'Logged in Incident & Breach Desk with immutable audit correlation.',
        tone: 'success',
      });
      setIncidentModalOpen(false);
      setIncTitle('');
      setIncAssessment('');
      setIncContainment('');
      queryClient.invalidateQueries({ queryKey: ['dpdp_privacy_dashboard'] });
    },
  });

  if (isLoading) return <TableSkeleton rows={6} cols={5} />;
  if (error || !data) {
    return (
      <ErrorState
        message="Could not load DPDP Privacy & Data Governance workspace."
        onRetry={() => refetch()}
      />
    );
  }

  const openRequestsCount = data.requests.filter(
    (r) => r.status === 'open' || r.status === 'in_review'
  ).length;
  const activeConsentsCount = data.acknowledgements.filter(
    (a) => a.action === 'consented' || a.action === 'acknowledged'
  ).length;
  const completedDeletionsCount = data.deletionJobs.filter(
    (j) => j.status === 'completed'
  ).length;
  const blockedSharesCount = data.auditEvents.filter(
    (e) =>
      e.outcome === 'denied_cross_tenant' ||
      e.outcome === 'denied_consent_withdrawn' ||
      e.outcome === 'denied_unverified_ownership'
  ).length;

  const tabsList = isCandidateRole
    ? [
        { id: 'candidate_center', label: 'My Privacy & Rights Center' },
        { id: 'notices', label: 'Active Notices & Consent History', count: data.notices.length },
        { id: 'requests', label: 'My Data Requests & Grievances', count: data.requests.length },
      ]
    : [
        { id: 'overview', label: 'P0–P4 Readiness & Roles' },
        {
          id: 'notices',
          label: 'Consent & Notice Registry',
          count: data.acknowledgements.length,
        },
        {
          id: 'processing',
          label: 'Purpose, Flows & Processors',
          count: data.processingRecords.length,
        },
        {
          id: 'requests',
          label: 'Rights & Grievance Desk',
          count: data.requests.length,
        },
        {
          id: 'retention',
          label: 'Retention & Erasure Engine',
          count: data.deletionJobs.length,
        },
        {
          id: 'sharing_guard',
          label: 'Sharing Guard & Audit Ledger',
          count: data.auditEvents.length,
        },
        {
          id: 'incidents',
          label: 'Incident & Breach Desk',
          count: data.incidents.length,
        },
        {
          id: 'candidate_center',
          label: 'Candidate Privacy Center',
        },
      ];

  const q = searchQuery.trim().toLowerCase();

  return (
    <div className="space-y-6">
      {/* Top Document Governance Banner */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-[6px] bg-[#1F4CC4]/10 text-[#1F4CC4] flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] leading-[16px] font-mono uppercase tracking-[0.05em] text-[var(--text-tertiary)]">
              AIKIND PRIVATE LIMITED · HIRENESTOS · DPDP ACT, 2023 &amp; RULES, 2025
            </div>
            <div className="text-[13px] leading-[18px] font-medium text-[var(--text-primary)] truncate">
              Privacy &amp; Data Governance Operating System — Incremental Controls on Supabase &amp; AI Gateway
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone="teal">System of Record: Supabase PostgreSQL</Badge>
          <Badge tone="rich_blue">AI Gateway PII Scrubbing: Active</Badge>
        </div>
      </div>

      <PageHeader
        title={
          isCandidateRole
            ? 'My Privacy, Consent & Data Principal Rights'
            : 'Privacy & Data Governance (DPDP Act, 2023)'
        }
        description={
          isCandidateRole
            ? 'Review versioned privacy notices, manage communication preferences, or exercise access, correction, erasure, and grievance rights.'
            : 'Incremental DPDP readiness across consent notices, RoPA data flows, Data Principal rights, multi-system erasure, server-side sharing guards, and audit evidence.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAckModalOpen(true)}
            >
              <UserCheck className="h-3.5 w-3.5" />
              {isCandidateRole ? 'Update Consent / Preferences' : 'Record Consent / Notice Ack'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setRequestModalOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {isCandidateRole ? 'Submit Rights / Grievance Request' : 'Log Rights / Grievance Request'}
            </Button>
          </div>
        }
      />

      {/* Top Metric Strip */}
      <MetricStrip
        items={[
          {
            label: 'Active Notices & Consents',
            value: activeConsentsCount,
            sublabel: `${data.notices.length} published notice versions (v${data.notices[0]?.version || '2.4.0'})`,
            onClick: () => setActiveTab('notices'),
          },
          {
            label: 'Open Rights / Grievances',
            value: openRequestsCount,
            sublabel: `${data.requests.length} total Data Principal requests tracked`,
            onClick: () => setActiveTab('requests'),
          },
          {
            label: 'Verified Erasure Jobs',
            value: completedDeletionsCount,
            sublabel: `${data.retentionPolicies.length} active retention & legal-hold rules`,
            onClick: () => setActiveTab('retention'),
          },
          {
            label: 'Blocked Unauthorised Shares',
            value: blockedSharesCount,
            sublabel: `${data.auditEvents.length} immutable non-PII audit events`,
            onClick: () => setActiveTab('sharing_guard'),
          },
        ]}
      />

      {/* Navigation Tabs */}
      <Tabs tabs={tabsList} activeTab={activeTab} onChange={setActiveTab} />

      {/* =====================================================================
          TAB 1: OVERVIEW, P0-P4 READINESS MATRIX & AIKIND / HIRENEST SPLIT
      ===================================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Phased Implementation Plan (P0 - P4) */}
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 bg-[var(--bg-subtle)]">
              <div>
                <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                  Phased DPDP Implementation Plan &amp; Acceptance Criteria (P0 – P4)
                </h2>
                <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
                  Incremental architectural controls preserving Supabase PostgreSQL, tenant isolation, RBAC/ABAC, candidate ownership locks, and human submission approval.
                </p>
              </div>
              <Badge tone="emerald">All 5 Phases Operational</Badge>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Focus Area</th>
                    <th>Key Engineering &amp; Operational Deliverables</th>
                    <th>Acceptance Criteria</th>
                    <th>Partner Ownership</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.roadmapPhases.map((item) => (
                    <tr key={item.phase}>
                      <td className="font-mono tabular-nums font-semibold text-[#1F4CC4]">
                        {item.phase}
                      </td>
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">{item.title}</div>
                        <div className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                          {item.focus}
                        </div>
                      </td>
                      <td>
                        <ul className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                          {item.keyDeliverables.map((d, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="font-mono text-[var(--text-tertiary)]">·</span>
                              <span>{d}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="text-[12px] text-[var(--text-primary)] max-w-[240px]">
                        {item.acceptanceCriteria}
                      </td>
                      <td className="text-[12px] text-[var(--text-secondary)] max-w-[220px]">
                        {item.ownerSplit}
                      </td>
                      <td>
                        <Badge tone="emerald">
                          {item.status === 'active_enforcement' ? 'Active Enforcement' : 'Implemented'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* AIKIND vs HireNest Workforce Responsibility Split & Target Architecture */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <div>
                  <h3 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                    AIKIND Private Limited — Technical &amp; Engineering Responsibilities
                  </h3>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    Platform engineering, server-side enforcement, deletion automation &amp; audit logging
                  </p>
                </div>
                <Badge tone="rich_blue">Technical Partner</Badge>
              </div>
              <ul className="space-y-2 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#2A9D8F] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Schema &amp; Notice UI:</strong> Maintain versioned{' '}
                    <span className="font-mono text-[12px]">privacyNotices</span> and{' '}
                    <span className="font-mono text-[12px]">privacyAcknowledgements</span> capture at candidate onboarding and resume upload.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#2A9D8F] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Server-Side Sharing &amp; Export Guard:</strong> Enforce tenant isolation, candidate ownership checks, contact PII masking prior to approval, and immutable{' '}
                    <span className="font-mono text-[12px]">privacyAuditEvents</span> logging.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#2A9D8F] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Multi-System Erasure Engine:</strong> Execute and verify deletion jobs across PostgreSQL, Supabase Storage, search indexes, AI caches, and operational logs while respecting legal holds.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#2A9D8F] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">AI Gateway Data Minimisation:</strong> Scrub emails, phone numbers, URLs, and identifiers before Gemini API calls; enforce zero model training on customer data.
                  </span>
                </li>
              </ul>
            </Card>

            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <div>
                  <h3 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                    HireNest Workforce — Business, Legal &amp; Operational Responsibilities
                  </h3>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    Data Fiduciary / Processor determination, notice approval, grievance desk &amp; counsel sign-off
                  </p>
                </div>
                <Badge tone="teal">Platform Operator</Badge>
              </div>
              <ul className="space-y-2 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#1F4CC4] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Legal Role &amp; Notice Sign-Off:</strong> Confirm Data Fiduciary vs. Client Data Processor roles per workflow with Indian privacy counsel and approve final notice copy.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#1F4CC4] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Grievance Officer &amp; DSR Decisions:</strong> Designate the Grievance Officer (<span className="font-mono text-[12px]">dpo-grievance@hirenestworkforce.com</span>), verify requester identity, and approve access/correction/erasure outcomes within SLA.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#1F4CC4] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Retention &amp; Legal Hold Governance:</strong> Define statutory retention windows and authorise legal/commercial dispute holds on submission records.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#1F4CC4] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[var(--text-primary)]">Vendor &amp; Client DPAs:</strong> Execute data processing clauses with clients, staffing vendors, and sub-processors; lead regulatory notification if a reportable breach occurs.
                  </span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: CONSENT & NOTICE REGISTRY
      ===================================================================== */}
      {activeTab === 'notices' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-subtle)]">
              <div>
                <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                  Versioned Privacy Notices (<span className="font-mono">privacyNotices</span>)
                </h2>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Purpose-specific notices presented at candidate registration, resume upload, and vendor submission.
                </p>
              </div>
              {!isCandidateRole && (
                <Button size="sm" onClick={() => setNoticeModalOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Publish New Notice Version
                </Button>
              )}
            </div>
            <div className="divide-y divide-[var(--border)]">
              {data.notices.map((n) => (
                <div key={n.noticeId} className="p-5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono tabular-nums text-[12px] font-semibold text-[#1F4CC4]">
                        {n.noticeId}
                      </span>
                      <Badge tone="rich_blue">v{n.version}</Badge>
                      <Badge tone="neutral">{n.locale}</Badge>
                      <Badge tone={n.status === 'active' ? 'emerald' : 'slate'}>
                        {n.status}
                      </Badge>
                    </div>
                    <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      Effective: {formatLocalDate(n.effectiveAt)} · {n.publishedBy}
                    </span>
                  </div>
                  <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                    {n.title}
                  </h3>
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    {n.contentSummary}
                  </p>
                  <div className="pt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">Purposes:</span>
                    {n.purposes.map((p, idx) => (
                      <span
                        key={idx}
                        className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px]"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                  <div className="text-[12px] text-[var(--text-tertiary)] flex flex-wrap gap-4">
                    <span>Fiduciary: {n.fiduciaryEntity}</span>
                    <span className="font-mono">Grievance Officer: {n.grievanceOfficerContact}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-subtle)]">
              <div>
                <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                  Subject Consent &amp; Notice Acknowledgements (<span className="font-mono">privacyAcknowledgements</span>)
                </h2>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Auditable record of consent grants, notice acknowledgements, withdrawals, and channel preferences.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Filter by subject or notice..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-56"
                />
                <Button size="sm" variant="outline" onClick={() => setAckModalOpen(true)}>
                  Record Consent / Withdrawal
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Ack ID</th>
                    <th>Data Principal</th>
                    <th>Notice &amp; Version</th>
                    <th>Legal Basis</th>
                    <th>Action / Status</th>
                    <th>Channels (Email / WA / SMS)</th>
                    <th>Source &amp; Evidence</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {data.acknowledgements
                    .filter(
                      (a) =>
                        !q ||
                        a.subjectName.toLowerCase().includes(q) ||
                        a.subjectRef.toLowerCase().includes(q) ||
                        a.noticeId.toLowerCase().includes(q)
                    )
                    .map((ack) => (
                      <tr key={ack.id}>
                        <td className="font-mono tabular-nums text-[12px] text-[var(--text-primary)]">
                          {ack.id}
                        </td>
                        <td>
                          <div className="font-medium text-[var(--text-primary)]">
                            {ack.subjectName}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--text-tertiary)]">
                            {ack.subjectRef}
                          </div>
                        </td>
                        <td className="font-mono tabular-nums text-[12px]">
                          {ack.noticeId} (v{ack.version})
                        </td>
                        <td className="text-[12px] text-[var(--text-secondary)]">
                          {LEGAL_BASIS_LABELS[ack.processingBasis] || ack.processingBasis}
                        </td>
                        <td>
                          <Badge
                            tone={
                              ack.action === 'withdrawn'
                                ? 'danger'
                                : ack.action === 'consented'
                                  ? 'emerald'
                                  : 'sky'
                            }
                          >
                            {ack.action.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                          {ack.communicationPreferences.email ? 'Email:ON' : 'Email:OFF'} ·{' '}
                          {ack.communicationPreferences.whatsapp ? 'WA:ON' : 'WA:OFF'} ·{' '}
                          {ack.communicationPreferences.sms ? 'SMS:ON' : 'SMS:OFF'}
                        </td>
                        <td>
                          <div className="text-[12px] text-[var(--text-secondary)]">
                            {ack.captureSource.replace(/_/g, ' ')}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--text-tertiary)]">
                            {ack.evidenceRef}
                          </div>
                        </td>
                        <td className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                          {formatLocalDate(ack.timestamp)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 3: PURPOSE, DATA FLOWS & SUB-PROCESSOR REGISTRY
      ===================================================================== */}
      {activeTab === 'processing' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 bg-[var(--bg-subtle)]">
              <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                Record of Processing Activities (<span className="font-mono">dataProcessingRecords</span>)
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Maps every HireNestOS workflow to personal data categories, purpose, Data Fiduciary/Processor role, legal basis, and retention policy.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>ID &amp; Workflow</th>
                    <th>Personal Data Categories</th>
                    <th>Purpose of Processing</th>
                    <th>Entity &amp; Legal Role</th>
                    <th>Processing Basis</th>
                    <th>Systems &amp; Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {data.processingRecords.map((rec) => (
                    <tr key={rec.id}>
                      <td>
                        <div className="font-mono tabular-nums text-[12px] font-semibold text-[#1F4CC4]">
                          {rec.id}
                        </div>
                        <div className="font-medium text-[var(--text-primary)]">
                          {rec.workflow}
                        </div>
                      </td>
                      <td>
                        <ul className="space-y-0.5 text-[12px] text-[var(--text-secondary)]">
                          {rec.dataCategories.map((c, idx) => (
                            <li key={idx}>· {c}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="text-[12px] text-[var(--text-primary)] max-w-[240px]">
                        {rec.purpose}
                      </td>
                      <td>
                        <div className="font-medium text-[12px] text-[var(--text-primary)]">
                          {rec.responsibleEntity}
                        </div>
                        <Badge
                          tone={
                            rec.legalRole === 'Data Fiduciary'
                              ? 'rich_blue'
                              : rec.legalRole === 'Data Processor'
                                ? 'teal'
                                : 'sky'
                          }
                          className="mt-1"
                        >
                          {rec.legalRole}
                        </Badge>
                      </td>
                      <td className="text-[12px] text-[var(--text-secondary)]">
                        {LEGAL_BASIS_LABELS[rec.processingBasis]}
                      </td>
                      <td>
                        <div className="text-[12px] text-[var(--text-secondary)]">
                          {rec.systems.join(', ')}
                        </div>
                        <div className="font-mono text-[11px] text-[#1F4CC4] mt-0.5">
                          Policy: {rec.retentionPolicyId}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 bg-[var(--bg-subtle)]">
              <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                AI &amp; External Sub-Processor Governance Inventory
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Verifies PII redaction, model training opt-out, data residency, and deletion hooks across external processors.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Processor</th>
                    <th>Category</th>
                    <th>Data Shared</th>
                    <th>PII Scrubbing</th>
                    <th>Zero Training Guarantee</th>
                    <th>Region</th>
                    <th>DPA Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subProcessors.map((sp) => (
                    <tr key={sp.id}>
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">{sp.name}</div>
                        <div className="text-[12px] text-[var(--text-secondary)]">{sp.purpose}</div>
                      </td>
                      <td>
                        <Badge tone="neutral">{sp.category}</Badge>
                      </td>
                      <td className="text-[12px] text-[var(--text-secondary)]">
                        {sp.dataCategoriesShared.join(', ')}
                      </td>
                      <td>
                        <Badge tone={sp.piiScrubbingEnabled ? 'emerald' : 'slate'}>
                          {sp.piiScrubbingEnabled ? 'Redacted Before Call' : 'Encrypted Storage'}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone="emerald">
                          {sp.modelTrainingOptOut ? 'No Training Opt-Out Verified' : 'Standard'}
                        </Badge>
                      </td>
                      <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                        {sp.region}
                      </td>
                      <td>
                        <Badge tone={sp.dpaStatus === 'executed' ? 'emerald' : 'amber'}>
                          {sp.dpaStatus}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 4: RIGHTS & GRIEVANCE DESK
      ===================================================================== */}
      {activeTab === 'requests' && (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-subtle)]">
            <div>
              <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                Data Principal Rights &amp; Grievance Redressal Desk (<span className="font-mono">privacyRequests</span>)
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                End-to-end intake, identity verification, owner assignment, SLA tracking, and resolution for Access, Correction, Erasure, and Grievance requests.
              </p>
            </div>
            <Button size="sm" onClick={() => setRequestModalOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Rights / Grievance Request
            </Button>
          </div>
          {!data.requests.length ? (
            <EmptyState
              title="No privacy requests logged"
              description="Data Principal requests for access, correction, erasure, or grievance redressal will appear here."
              actionLabel="Log First Request"
              onAction={() => setRequestModalOpen(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Request ID</th>
                    <th>Data Principal</th>
                    <th>Type</th>
                    <th>Request Summary &amp; Decision</th>
                    <th>Identity Verification</th>
                    <th>Status</th>
                    <th>Received / SLA Due</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((reqItem) => (
                    <tr key={reqItem.requestId}>
                      <td className="font-mono tabular-nums font-semibold text-[#1F4CC4]">
                        {reqItem.requestId}
                      </td>
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {reqItem.requesterName}
                        </div>
                        <div className="font-mono text-[11px] text-[var(--text-tertiary)]">
                          {reqItem.requesterEmail}
                        </div>
                      </td>
                      <td>
                        <Badge
                          tone={
                            reqItem.requestType === 'erasure'
                              ? 'danger'
                              : reqItem.requestType === 'grievance'
                                ? 'amber'
                                : 'rich_blue'
                          }
                        >
                          {REQUEST_TYPE_LABELS[reqItem.requestType]}
                        </Badge>
                      </td>
                      <td className="max-w-[300px]">
                        <div className="text-[13px] text-[var(--text-primary)]">
                          {reqItem.summary}
                        </div>
                        {reqItem.decision && (
                          <div className="mt-1 text-[12px] text-[#2A9D8F] font-medium">
                            Decision: {reqItem.decision}
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                          Owner: {reqItem.assignedTo}
                        </div>
                      </td>
                      <td>
                        <Badge
                          tone={reqItem.verificationStatus === 'verified' ? 'emerald' : 'amber'}
                        >
                          {reqItem.verificationStatus}
                        </Badge>
                      </td>
                      <td>
                        <Badge
                          tone={
                            reqItem.status === 'completed'
                              ? 'emerald'
                              : reqItem.status === 'rejected'
                                ? 'danger'
                                : 'amber'
                          }
                        >
                          {reqItem.status.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                        <div>In: {formatLocalDate(reqItem.receivedAt)}</div>
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          Due: {formatLocalDate(reqItem.slaDueAt)}
                        </div>
                      </td>
                      <td className="text-right">
                        {!isCandidateRole ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedRequest(reqItem);
                              setResolutionStatus('completed');
                              setResolutionDecision(reqItem.decision || '');
                              setTriggerErasureOnResolve(reqItem.requestType === 'erasure');
                            }}
                          >
                            Review / Resolve
                          </Button>
                        ) : (
                          <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
                            {reqItem.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* =====================================================================
          TAB 5: RETENTION & ERASURE ENGINE
      ===================================================================== */}
      {activeTab === 'retention' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 bg-[var(--bg-subtle)]">
              <div>
                <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                  Retention Policies &amp; Legal Hold Exceptions (<span className="font-mono">retentionPolicies</span>)
                </h2>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Defines retention duration by data category and enforces legal/commercial dispute holds before deletion.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Policy ID</th>
                    <th>Data Category &amp; Purpose</th>
                    <th>Trigger &amp; Duration Rule</th>
                    <th>Days</th>
                    <th>Legal / Dispute Hold</th>
                    <th>Owner</th>
                    <th className="text-right">Control</th>
                  </tr>
                </thead>
                <tbody>
                  {data.retentionPolicies.map((pol) => (
                    <tr key={pol.policyId}>
                      <td className="font-mono tabular-nums font-semibold text-[#1F4CC4]">
                        {pol.policyId}
                      </td>
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {pol.dataCategory}
                        </div>
                        <div className="text-[12px] text-[var(--text-secondary)]">
                          {pol.purpose}
                        </div>
                      </td>
                      <td>
                        <div className="text-[12px] text-[var(--text-primary)]">
                          {pol.durationRule}
                        </div>
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          Trigger: {pol.trigger}
                        </div>
                      </td>
                      <td className="font-mono tabular-nums text-[13px] font-semibold">
                        {pol.durationDays}d
                      </td>
                      <td>
                        {pol.legalHoldException ? (
                          <div>
                            <Badge tone="amber">Legal Hold Active</Badge>
                            {pol.legalHoldReason && (
                              <div className="text-[11px] text-[var(--text-secondary)] mt-1 max-w-[220px]">
                                {pol.legalHoldReason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Badge tone="emerald">Standard Schedule</Badge>
                        )}
                      </td>
                      <td className="text-[12px] text-[var(--text-secondary)]">
                        {pol.owner} (v{pol.version})
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          loading={toggleHoldMutation.isPending}
                          onClick={() =>
                            toggleHoldMutation.mutate({
                              policyId: pol.policyId,
                              legalHoldException: !pol.legalHoldException,
                            })
                          }
                        >
                          {pol.legalHoldException ? 'Release Hold' : 'Apply Legal Hold'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-subtle)]">
              <div>
                <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                  Multi-System Erasure &amp; Deletion Jobs (<span className="font-mono">deletionJobs</span>)
                </h2>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Tracks deletion across PostgreSQL, Supabase Storage, Search Indexes, AI Caches, Operational Logs (minimal non-PII audit retained), and External Processors.
                </p>
              </div>
              <Button
                size="sm"
                loading={runDeletionMutation.isPending}
                onClick={() =>
                  runDeletionMutation.mutate({
                    subjectRef: `cand_expired_${Math.floor(100 + Math.random() * 899)}`,
                    scope: 'expired_retention_purge',
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                Run Scheduled Retention Purge Job
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Subject &amp; Scope</th>
                    <th>PostgreSQL &amp; Storage</th>
                    <th>Indexes &amp; AI Caches</th>
                    <th>Logs &amp; Processors</th>
                    <th>Status &amp; Verification</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deletionJobs.map((job) => (
                    <tr key={job.jobId}>
                      <td className="font-mono tabular-nums font-semibold text-[#1F4CC4]">
                        {job.jobId}
                      </td>
                      <td>
                        <div className="font-medium text-[var(--text-primary)]">
                          {job.subjectLabel}
                        </div>
                        <div className="font-mono text-[11px] text-[var(--text-tertiary)]">
                          Scope: {job.scope} · Attempts: {job.attempts}
                        </div>
                      </td>
                      <td className="font-mono text-[12px]">
                        <div>DB: {job.targetSystems.postgresql_db}</div>
                        <div>Storage: {job.targetSystems.supabase_storage}</div>
                      </td>
                      <td className="font-mono text-[12px]">
                        <div>Index: {job.targetSystems.search_indexes}</div>
                        <div>AI Cache: {job.targetSystems.ai_caches}</div>
                      </td>
                      <td className="font-mono text-[12px]">
                        <div>Logs: {job.targetSystems.operational_logs}</div>
                        <div>Ext: {job.targetSystems.external_processors}</div>
                      </td>
                      <td>
                        <Badge tone={job.status === 'completed' ? 'emerald' : 'amber'}>
                          {job.status}
                        </Badge>
                        {job.verifiedAt && (
                          <div className="font-mono tabular-nums text-[11px] text-[var(--text-tertiary)] mt-0.5">
                            Verified: {formatLocalDate(job.verifiedAt)}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        {job.status !== 'completed' ? (
                          <Button
                            size="sm"
                            variant="primary"
                            loading={runDeletionMutation.isPending}
                            onClick={() => runDeletionMutation.mutate({ jobId: job.jobId })}
                          >
                            Execute &amp; Verify
                          </Button>
                        ) : (
                          <span className="font-mono text-[12px] text-[#2A9D8F]">
                            Purge Verified
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 6: SHARING & EXPORT GUARD + IMMUTABLE AUDIT LEDGER
      ===================================================================== */}
      {activeTab === 'sharing_guard' && (
        <div className="space-y-6">
          {/* Interactive Server-Side Candidate Sharing & Export Guard Simulator */}
          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                  Server-Side Candidate Sharing &amp; Export Guard (Live Verification Bench)
                </h2>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Tests server-side enforcement of tenant isolation, consent withdrawal blocks, and contact PII masking before human recruiter approval.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setGuardActorRole('recruiter');
                    setGuardCallerTenant('hirenest_hq');
                    setGuardTargetTenant('hirenest_hq');
                    setGuardCandidateRef('cand_aarav_mehta');
                    setGuardCandidateName('Aarav Mehta');
                    setGuardHumanApproved(true);
                  }}
                >
                  Preset 1: Authorised Share
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setGuardActorRole('recruiter');
                    setGuardCallerTenant('hirenest_hq');
                    setGuardTargetTenant('hirenest_hq');
                    setGuardCandidateRef('cand_aarav_mehta');
                    setGuardCandidateName('Aarav Mehta');
                    setGuardHumanApproved(false);
                  }}
                >
                  Preset 2: Unapproved (Mask PII)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setGuardActorRole('vendor_recruiter');
                    setGuardCallerTenant('vendor_global_staffing');
                    setGuardTargetTenant('vendor_apex_talent');
                    setGuardCandidateRef('cand_aarav_mehta');
                    setGuardCandidateName('Aarav Mehta');
                    setGuardHumanApproved(true);
                  }}
                >
                  Preset 3: Cross-Tenant Breach Attempt
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setGuardActorRole('recruiter');
                    setGuardCallerTenant('hirenest_hq');
                    setGuardTargetTenant('hirenest_hq');
                    setGuardCandidateRef('cand_rohan_kulkarni');
                    setGuardCandidateName('Rohan Kulkarni');
                    setGuardHumanApproved(true);
                  }}
                >
                  Preset 4: Withdrawn Consent Subject
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
              <Select
                label="Caller Role"
                value={guardActorRole}
                onChange={(e) => setGuardActorRole(e.target.value)}
                options={[
                  { value: 'recruiter', label: 'HQ Recruiter' },
                  { value: 'admin', label: 'HQ Admin' },
                  { value: 'vendor_recruiter', label: 'Vendor Recruiter' },
                  { value: 'client_manager', label: 'Client Hiring Manager' },
                ]}
              />
              <Input
                label="Caller Tenant ID"
                value={guardCallerTenant}
                onChange={(e) => setGuardCallerTenant(e.target.value)}
              />
              <Input
                label="Record Owner Tenant ID"
                value={guardTargetTenant}
                onChange={(e) => setGuardTargetTenant(e.target.value)}
              />
              <Select
                label="Candidate Subject"
                value={guardCandidateRef}
                onChange={(e) => {
                  const val = e.target.value;
                  setGuardCandidateRef(val);
                  setGuardCandidateName(
                    val === 'cand_rohan_kulkarni'
                      ? 'Rohan Kulkarni'
                      : val === 'cand_divya_nair'
                        ? 'Divya Nair'
                        : 'Aarav Mehta'
                  );
                }}
                options={[
                  { value: 'cand_aarav_mehta', label: 'Aarav Mehta (Consented)' },
                  { value: 'cand_divya_nair', label: 'Divya Nair (Acknowledged)' },
                  { value: 'cand_rohan_kulkarni', label: 'Rohan Kulkarni (Withdrawn)' },
                ]}
              />
              <Select
                label="Operation"
                value={guardActionType}
                onChange={(e) =>
                  setGuardActionType(
                    e.target.value as 'share_with_client' | 'export_csv' | 'download_resume'
                  )
                }
                options={[
                  { value: 'share_with_client', label: 'Share Packet with Client' },
                  { value: 'export_csv', label: 'Export Candidate CSV' },
                  { value: 'download_resume', label: 'Download Resume File' },
                ]}
              />
              <div>
                <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)] mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={guardHumanApproved}
                    onChange={(e) => setGuardHumanApproved(e.target.checked)}
                    className="rounded border-[var(--border)]"
                  />
                  <span>Human Recruiter Approved</span>
                </label>
                <Button
                  className="w-full"
                  loading={runGuardMutation.isPending}
                  onClick={() => runGuardMutation.mutate()}
                >
                  <Play className="h-3.5 w-3.5" />
                  Evaluate Guard
                </Button>
              </div>
            </div>

            {guardResult && (
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        !guardResult.allowed
                          ? 'danger'
                          : guardResult.outcome === 'masked_pii'
                            ? 'amber'
                            : 'emerald'
                      }
                    >
                      Outcome: {guardResult.outcome}
                    </Badge>
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      {guardResult.reason}
                    </span>
                  </div>
                  <span className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                    Audit Event: {guardResult.auditEvent.eventId} · {guardResult.auditEvent.correlationId}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1 font-mono text-[12px]">
                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <span className="text-[var(--text-tertiary)] block text-[11px]">Subject</span>
                    <span className="text-[var(--text-primary)]">{guardResult.maskedPayload.candidateName}</span>
                  </div>
                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <span className="text-[var(--text-tertiary)] block text-[11px]">Email Payload</span>
                    <span className="text-[var(--text-primary)]">{guardResult.maskedPayload.email}</span>
                  </div>
                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <span className="text-[var(--text-tertiary)] block text-[11px]">Phone Payload</span>
                    <span className="text-[var(--text-primary)]">{guardResult.maskedPayload.phone}</span>
                  </div>
                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <span className="text-[var(--text-tertiary)] block text-[11px]">PII Masking</span>
                    <span className="text-[var(--text-primary)]">
                      {guardResult.maskedPayload.contactMasked ? 'MASKED / PROTECTED' : 'UNMASKED (APPROVED)'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Immutable Minimal Privacy Audit Events Ledger */}
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 bg-[var(--bg-subtle)]">
              <div>
                <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                  Immutable Privacy Audit Ledger (<span className="font-mono">privacyAuditEvents</span>)
                </h2>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Records actorRef, tenantId, action, resourceRef, purpose, outcome, and correlationId. Strictly zero raw resume text or unmasked PII stored in logs.
                </p>
              </div>
              <Badge tone="neutral">Zero Raw PII in Logs</Badge>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Actor &amp; Role</th>
                    <th>Tenant</th>
                    <th>Action</th>
                    <th>Resource Ref</th>
                    <th>Documented Purpose</th>
                    <th>Outcome</th>
                    <th>Correlation ID &amp; Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditEvents.map((evt) => (
                    <tr key={evt.eventId}>
                      <td className="font-mono tabular-nums text-[12px] font-medium text-[#1F4CC4]">
                        {evt.eventId}
                      </td>
                      <td>
                        <div className="font-mono text-[12px] text-[var(--text-primary)]">
                          {evt.actorRef}
                        </div>
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          {evt.actorRole}
                        </div>
                      </td>
                      <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                        {evt.tenantId}
                      </td>
                      <td className="font-mono text-[12px] text-[var(--text-primary)]">
                        {evt.action}
                      </td>
                      <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                        {evt.resourceType}: {evt.resourceRef}
                      </td>
                      <td className="text-[12px] text-[var(--text-secondary)] max-w-[260px]">
                        {evt.purpose}
                      </td>
                      <td>
                        <Badge
                          tone={
                            evt.outcome.startsWith('denied')
                              ? 'danger'
                              : evt.outcome === 'masked_pii'
                                ? 'amber'
                                : 'emerald'
                          }
                        >
                          {evt.outcome}
                        </Badge>
                      </td>
                      <td className="font-mono tabular-nums text-[11px] text-[var(--text-tertiary)]">
                        <div>{evt.correlationId}</div>
                        <div>{formatLocalDate(evt.timestamp)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 7: INCIDENT & BREACH DESK
      ===================================================================== */}
      {activeTab === 'incidents' && (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-subtle)]">
            <div>
              <h2 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
                Privacy &amp; Security Incident Desk (<span className="font-mono">privacyIncidents</span>)
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Tracks incident severity, affected systems, containment, Data Protection Board of India &amp; Data Principal notification status, and closure evidence.
              </p>
            </div>
            <Button size="sm" onClick={() => setIncidentModalOpen(true)}>
              <AlertTriangle className="h-3.5 w-3.5" />
              Log Incident / Run Breach Drill
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Incident ID</th>
                  <th>Title &amp; Affected Systems</th>
                  <th>Severity</th>
                  <th>Assessment &amp; Containment</th>
                  <th>Notification Status</th>
                  <th>Owner &amp; Closure Evidence</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {data.incidents.map((inc) => (
                  <tr key={inc.incidentId}>
                    <td className="font-mono tabular-nums font-semibold text-[#1F4CC4]">
                      {inc.incidentId}
                    </td>
                    <td className="max-w-[240px]">
                      <div className="font-medium text-[var(--text-primary)]">{inc.title}</div>
                      <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                        Systems: {inc.affectedSystems.join(', ')}
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          inc.severity === 'critical' || inc.severity === 'high'
                            ? 'danger'
                            : inc.severity === 'medium'
                              ? 'amber'
                              : 'neutral'
                        }
                      >
                        {inc.severity}
                      </Badge>
                    </td>
                    <td className="max-w-[320px] text-[12px] text-[var(--text-secondary)] space-y-1">
                      <div>
                        <strong className="text-[var(--text-primary)]">Assessment:</strong>{' '}
                        {inc.assessment}
                      </div>
                      <div>
                        <strong className="text-[var(--text-primary)]">Containment:</strong>{' '}
                        {inc.containment}
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          inc.notificationStatus === 'not_required' ||
                          inc.notificationStatus === 'closed'
                            ? 'emerald'
                            : 'amber'
                        }
                      >
                        {inc.notificationStatus.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="text-[12px] text-[var(--text-secondary)] max-w-[220px]">
                      <div className="font-medium text-[var(--text-primary)]">
                        {inc.accountableOwner}
                      </div>
                      {inc.closureEvidence && (
                        <div className="font-mono text-[11px] text-[var(--text-tertiary)] mt-0.5">
                          {inc.closureEvidence}
                        </div>
                      )}
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)]">
                      {formatLocalDate(inc.detectedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* =====================================================================
          TAB 8: CANDIDATE PRIVACY & RIGHTS CENTER
      ===================================================================== */}
      {activeTab === 'candidate_center' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  Active Candidate Data Protection Notice ({data.notices[0]?.noticeId} · v
                  {data.notices[0]?.version})
                </h2>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Presented transparently prior to resume upload, profile indexing, and client submission.
                </p>
              </div>
              <Badge tone="emerald">DPDP Act, 2023 Compliant Notice</Badge>
            </div>

            <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
              {data.notices[0]?.contentSummary}
            </p>

            <div className="space-y-2">
              <div className="text-[12px] font-semibold text-[var(--text-primary)]">
                Specific Recruitment Purposes Covered:
              </div>
              <ul className="space-y-1.5 text-[13px] text-[var(--text-secondary)]">
                {(data.notices[0]?.purposes || []).map((p, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#2A9D8F] shrink-0 mt-0.5" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-3 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
              <div className="text-[12px] text-[var(--text-tertiary)]">
                Grievance Officer:{' '}
                <span className="font-mono text-[var(--text-primary)]">
                  {data.notices[0]?.grievanceOfficerContact}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAckAction('withdrawn');
                    setAckModalOpen(true);
                  }}
                >
                  Withdraw Consent
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setAckAction('consented');
                    setAckModalOpen(true);
                  }}
                >
                  Acknowledge &amp; Save Preferences
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="border-b border-[var(--border)] pb-3">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                Exercise Data Principal Rights
              </h3>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Submit a verified request to the HireNestOS Privacy &amp; Grievance Desk.
              </p>
            </div>
            <div className="space-y-2">
              {(
                [
                  {
                    type: 'access',
                    label: 'Request Summary of Personal Data & Recipients',
                    desc: 'Obtain a structured export of your profile, resume digest, and client submissions.',
                  },
                  {
                    type: 'correction',
                    label: 'Request Correction or Profile Update',
                    desc: 'Correct inaccurate employment, skill, or contact records across active pipelines.',
                  },
                  {
                    type: 'erasure',
                    label: 'Request Erasure of Personal Data',
                    desc: 'Trigger multi-system deletion of your resume and profile where no legal hold applies.',
                  },
                  {
                    type: 'grievance',
                    label: 'Register a Privacy Grievance',
                    desc: 'Escalate a concern directly to the Data Protection & Grievance Officer.',
                  },
                ] as const
              ).map((item) => (
                <div
                  key={item.type}
                  className="p-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="text-[13px] font-medium text-[var(--text-primary)]">
                      {item.label}
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                      {item.desc}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReqType(item.type);
                      setRequestModalOpen(true);
                    }}
                  >
                    Start
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Footer Disclaimer from Brief */}
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2.5 text-[12px] leading-[18px] text-[var(--text-tertiary)] flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>Governance Note:</strong> This module implements technical and operational DPDP Act, 2023 readiness controls for HireNestOS and AIKIND Private Limited. Parties should validate exact legal roles, commencement dates, notices, and retention windows with qualified Indian privacy counsel.
        </span>
        <span className="font-mono tabular-nums">DPDP-OS v2.4</span>
      </div>

      {/* =====================================================================
          MODALS
      ===================================================================== */}

      {/* 1. Publish Privacy Notice Modal */}
      <Dialog
        open={noticeModalOpen}
        onClose={() => setNoticeModalOpen(false)}
        title="Publish Versioned DPDP Privacy Notice"
        description="Creates an immutable notice version in privacyNotices and logs an audit event."
        maxWidth="max-w-[560px]"
      >
        <div className="space-y-3">
          <Input
            label="Notice Title"
            value={noticeTitle}
            onChange={(e) => setNoticeTitle(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Version (SemVer)"
              value={noticeVersion}
              onChange={(e) => setNoticeVersion(e.target.value)}
            />
            <Input
              label="Locale"
              value={noticeLocale}
              onChange={(e) => setNoticeLocale(e.target.value)}
            />
          </div>
          <Input
            label="Purposes (comma-separated)"
            value={noticePurposes}
            onChange={(e) => setNoticePurposes(e.target.value)}
          />
          <Textarea
            label="Plain-Language Notice Summary"
            rows={4}
            value={noticeSummary}
            onChange={(e) => setNoticeSummary(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNoticeModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={publishNoticeMutation.isPending}
              onClick={() => publishNoticeMutation.mutate()}
            >
              Publish Notice
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 2. Record Consent / Notice Acknowledgement Modal */}
      <Dialog
        open={ackModalOpen}
        onClose={() => setAckModalOpen(false)}
        title="Record DPDP Notice Acknowledgement & Preferences"
        description="Logs verifiable consent, voluntary submission acknowledgement, or consent withdrawal."
        maxWidth="max-w-[520px]"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Subject Reference ID"
              value={ackSubjectRef}
              onChange={(e) => setAckSubjectRef(e.target.value)}
            />
            <Input
              label="Data Principal Name"
              value={ackSubjectName}
              onChange={(e) => setAckSubjectName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Action"
              value={ackAction}
              onChange={(e) =>
                setAckAction(
                  e.target.value as
                    | 'consented'
                    | 'acknowledged'
                    | 'withdrawn'
                    | 'preference_updated'
                )
              }
              options={[
                { value: 'consented', label: 'Grant Consent' },
                { value: 'acknowledged', label: 'Acknowledge Notice' },
                { value: 'preference_updated', label: 'Update Channel Preferences' },
                { value: 'withdrawn', label: 'Withdraw Consent (Halts Sharing)' },
              ]}
            />
            <Select
              label="Applicable Legal Basis"
              value={ackBasis}
              onChange={(e) => setAckBasis(e.target.value as LegalBasisType)}
              options={[
                { value: 'consent', label: 'Explicit Consent (DPDP s.6)' },
                { value: 'voluntary_employment_use', label: 'Voluntary / Employment Use' },
                { value: 'contractual_processor_instruction', label: 'Processor Instruction' },
              ]}
            />
          </div>

          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2">
            <div className="text-[12px] font-medium text-[var(--text-primary)]">
              Communication Channel Preferences
            </div>
            <div className="flex flex-wrap gap-4 text-[13px] text-[var(--text-secondary)]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefEmail}
                  onChange={(e) => setPrefEmail(e.target.checked)}
                />
                <span>Email Invites &amp; Updates</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefWhatsapp}
                  onChange={(e) => setPrefWhatsapp(e.target.checked)}
                />
                <span>WhatsApp Interview Alerts</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefSms}
                  onChange={(e) => setPrefSms(e.target.checked)}
                />
                <span>SMS Notifications</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAckModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={recordAckMutation.isPending}
              onClick={() => recordAckMutation.mutate()}
            >
              Save Record
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 3. Create Rights / Grievance Request Modal */}
      <Dialog
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        title="Submit Data Principal Rights / Grievance Request"
        description="Creates a tracked case in privacyRequests with a 7-day operational SLA."
        maxWidth="max-w-[520px]"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Data Principal Name"
              value={reqName}
              onChange={(e) => setReqName(e.target.value)}
            />
            <Input
              label="Verified Email"
              value={reqEmail}
              onChange={(e) => setReqEmail(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Subject Reference"
              value={reqRef}
              onChange={(e) => setReqRef(e.target.value)}
            />
            <Select
              label="Request Category"
              value={reqType}
              onChange={(e) => setReqType(e.target.value as PrivacyRequestType)}
              options={[
                { value: 'access', label: 'Access & Processing Summary' },
                { value: 'correction', label: 'Correction / Profile Update' },
                { value: 'erasure', label: 'Erasure / Right to be Forgotten' },
                { value: 'consent_withdrawal', label: 'Consent Withdrawal' },
                { value: 'grievance', label: 'Grievance Redressal' },
              ]}
            />
          </div>
          <Textarea
            label="Request Details"
            rows={4}
            value={reqSummary}
            onChange={(e) => setReqSummary(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRequestModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createRequestMutation.isPending}
              onClick={() => createRequestMutation.mutate()}
            >
              Submit Request
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 4. Review / Resolve Request Modal */}
      <Dialog
        open={Boolean(selectedRequest)}
        onClose={() => setSelectedRequest(null)}
        title={`Resolve Request ${selectedRequest?.requestId || ''}`}
        description="Record identity verification decision, resolution notes, and optional multi-system erasure."
        maxWidth="max-w-[520px]"
      >
        {selectedRequest && (
          <div className="space-y-3">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] space-y-1">
              <div className="font-medium text-[var(--text-primary)]">
                {selectedRequest.requesterName} ({selectedRequest.requesterEmail})
              </div>
              <div className="text-[var(--text-secondary)]">{selectedRequest.summary}</div>
            </div>
            <Select
              label="Resolution Status"
              value={resolutionStatus}
              onChange={(e) =>
                setResolutionStatus(e.target.value as PrivacyRequestRecord['status'])
              }
              options={[
                { value: 'in_review', label: 'In Review' },
                { value: 'approved', label: 'Approved (Pending Execution)' },
                { value: 'completed', label: 'Completed & Closed' },
                { value: 'rejected', label: 'Rejected (With Documented Legal Reason)' },
              ]}
            />
            <Textarea
              label="Formal Decision & Evidence Summary"
              rows={3}
              value={resolutionDecision}
              onChange={(e) => setResolutionDecision(e.target.value)}
              placeholder="Document the action taken or legal hold exception applied..."
            />
            {(selectedRequest.requestType === 'erasure' ||
              selectedRequest.requestType === 'consent_withdrawal') && (
              <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={triggerErasureOnResolve}
                  onChange={(e) => setTriggerErasureOnResolve(e.target.checked)}
                />
                <span>
                  Automatically execute &amp; verify multi-system deletion job (PostgreSQL, Storage, Indexes, Caches)
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSelectedRequest(null)}>
                Cancel
              </Button>
              <Button
                loading={resolveRequestMutation.isPending}
                onClick={() => resolveRequestMutation.mutate()}
              >
                Save Decision
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* 5. Log Privacy Incident Modal */}
      <Dialog
        open={incidentModalOpen}
        onClose={() => setIncidentModalOpen(false)}
        title="Log Privacy / Security Incident"
        description="Records incident classification, containment, and DPB / Data Principal notification readiness."
        maxWidth="max-w-[540px]"
      >
        <div className="space-y-3">
          <Input
            label="Incident Title"
            placeholder="e.g. Unauthorised export attempt blocked by ABAC guard"
            value={incTitle}
            onChange={(e) => setIncTitle(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Severity"
              value={incSeverity}
              onChange={(e) =>
                setIncSeverity(e.target.value as PrivacyIncidentRecord['severity'])
              }
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
            <Select
              label="Notification Status"
              value={incNotifStatus}
              onChange={(e) =>
                setIncNotifStatus(
                  e.target.value as PrivacyIncidentRecord['notificationStatus']
                )
              }
              options={[
                { value: 'assessing', label: 'Assessing Impact' },
                { value: 'not_required', label: 'Not Required (No Exfiltration)' },
                {
                  value: 'ready_for_dpb_and_principals',
                  label: 'Ready for DPB & Data Principals',
                },
                { value: 'notified', label: 'Notified' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
          </div>
          <Input
            label="Affected Systems (comma-separated)"
            value={incSystems}
            onChange={(e) => setIncSystems(e.target.value)}
          />
          <Textarea
            label="Impact Assessment"
            rows={3}
            value={incAssessment}
            onChange={(e) => setIncAssessment(e.target.value)}
          />
          <Textarea
            label="Containment & Remediation Steps"
            rows={2}
            value={incContainment}
            onChange={(e) => setIncContainment(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIncidentModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createIncidentMutation.isPending}
              onClick={() => createIncidentMutation.mutate()}
            >
              Record Incident
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
