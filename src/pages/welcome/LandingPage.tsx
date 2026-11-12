import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Check,
  Loader2,
  Menu,
  X,
  Building2,
  Handshake,
  UserSearch,
  Database,
  Lock,
  History,
} from 'lucide-react';
import {
  submitEarlyAccessApplication,
  MODULE_LABELS,
  BUSINESS_TYPE_LABELS,
  COMPANY_SIZE_LABELS,
  type EarlyAccessSubmitPayload,
  type HirenestModule,
  type BusinessType,
  type CompanySize,
} from '../../api/earlyAccess';

// Pull from the app's own semantic tokens (src/index.css) rather than raw hex,
// so the marketing site and the product stay one visual system and a token
// change here propagates everywhere else too.
const INK = 'var(--text-primary)'; // storm-900
const INK_SOFT = 'var(--text-secondary)'; // storm-600 — 6.7:1 on white
const INK_FAINT = 'var(--text-tertiary)'; // storm-500 — 4.5:1 on white (AA minimum for caption text)
const LINE = 'var(--border)'; // storm-200
const LINE_SOFT = 'var(--track)'; // storm-100
const PAPER = 'var(--bg-subtle)'; // storm-25
const BRAND = 'var(--primary-bg)'; // rich-blue-600
const NAVY = '#1B1A33'; // rich-blue-950 — a fixed dark panel, not theme-coupled, by design

type Role = 'hq' | 'client' | 'vendor' | 'candidate';

const ROLE_GROUPS: {
  role: Role;
  label: string;
  who: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  points: string[];
  footerLabel: string;
  footerValue: string;
}[] = [
  {
    role: 'hq',
    label: 'HireNest HQ',
    who: 'Admins & recruiters',
    icon: ShieldCheck,
    points: [
      'Deterministic skill-experience-domain match scoring on every candidate',
      'Vendor scorecards, SLA tiers and performance-based share allocation',
      'Assignment overrides, dispute resolution and platform configuration',
    ],
    footerLabel: 'Oversees',
    footerValue: 'All 4 roles',
  },
  {
    role: 'client',
    label: 'Hiring clients',
    who: 'Companies with open roles',
    icon: Building2,
    points: [
      'Author requirements once; HQ routes them to the right vendors',
      'Review HQ-forwarded candidates against a shared scoring rubric',
      'Schedule interviews and return structured feedback inside a 24-hour SLA',
    ],
    footerLabel: 'Requirement ownership',
    footerValue: 'One thread, start to close',
  },
  {
    role: 'vendor',
    label: 'Staffing vendors',
    who: 'Agencies & recruiters',
    icon: Handshake,
    points: [
      'See only the requirements assigned to you, not a blind blast list',
      'Candidate pool with SHA-256 resume de-duplication across your team',
      'A transparent 5-axis scorecard instead of a black-box ranking',
    ],
    footerLabel: 'Visibility',
    footerValue: 'Assigned requirements only',
  },
  {
    role: 'candidate',
    label: 'Candidates',
    who: 'People applying for work',
    icon: UserSearch,
    points: [
      'A "Jobs for me" shortlist, matched to your profile, not a keyword search',
      'One resume, reused across every submission a vendor makes on your behalf',
      'Real-time status instead of silence after you apply',
    ],
    footerLabel: 'Profile control',
    footerValue: 'Edit skills & resume anytime',
  },
];

const PIPELINE = [
  { n: '01', category: 'Intake', title: 'Requirement', sla: 'Logged once', detail: 'Client or HQ opens a requirement; it is scored and routed to eligible vendors automatically.', footerLabel: 'Trigger', footerValue: 'SLA clock starts on creation', accent: '#4F46D8' },
  { n: '02', category: 'Routing', title: 'Shortlist', sla: '48h SLA', detail: 'Vendors submit matched candidates; HQ forwards the ranked, deduplicated shortlist to the client.', footerLabel: 'Result', footerValue: 'Ranked by match score', accent: '#7C4EE0' },
  { n: '03', category: 'Review', title: 'Interview', sla: '24h feedback', detail: 'Client runs the loop against a shared rubric and returns structured feedback on the clock.', footerLabel: 'Enforcement', footerValue: 'Structured feedback, no email loop', accent: '#3A8EF0' },
  { n: '04', category: 'Close', title: 'Offer', sla: 'Audited', detail: 'Offer, onboarding and vendor share are recorded against the same requirement thread.', footerLabel: 'Record', footerValue: 'Logged to the audit trail', accent: '#0F9D6B' },
];

const COMPLIANCE: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    title: 'DPDP Act 2023',
    description: 'Candidate consent and data-principal rights built into onboarding and profile handling.',
    icon: ShieldCheck,
  },
  {
    title: 'Row level security',
    description: 'Database-level policies enforce who can read or write each row, not just the API layer.',
    icon: Database,
  },
  {
    title: 'Tenant isolation',
    description: 'Each client and vendor organization only ever sees the requirements routed to it.',
    icon: Lock,
  },
  {
    title: 'Audit logging',
    description: 'Every assignment, submission and stage change is recorded against the requirement thread.',
    icon: History,
  },
];

type DiagramNode = {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tag: string;
  title: string;
  subtitle: string;
  chips: string[];
  footerLabel: string;
  footerValue: string;
  accent: string;
};

const DIAGRAM_HQ: DiagramNode = {
  icon: ShieldCheck,
  tag: '',
  title: 'HireNest HQ',
  subtitle: 'Match engine & orchestrator',
  chips: ['SLA governor', 'Dispute hub'],
  footerLabel: '',
  footerValue: '',
  accent: '#4F46D8',
};

const DIAGRAM_CLIENT: DiagramNode = {
  icon: Building2,
  tag: 'Role: creator',
  title: 'Hiring client',
  subtitle: 'Publishes the role once, reviews the HQ shortlist.',
  chips: [],
  footerLabel: 'SLA target',
  footerValue: '< 24h review',
  accent: '#3A8EF0',
};

const DIAGRAM_VENDOR: DiagramNode = {
  icon: Handshake,
  tag: 'Role: agency',
  title: 'Staffing vendor',
  subtitle: 'Works only the requirements assigned to it.',
  chips: [],
  footerLabel: 'Dedup check',
  footerValue: 'SHA-256 resume hash',
  accent: '#7C4EE0',
};

const DIAGRAM_CANDIDATE: DiagramNode = {
  icon: UserSearch,
  tag: '',
  title: 'Candidate',
  subtitle: 'Applicant / talent',
  chips: ['One profile', 'Status updates'],
  footerLabel: '',
  footerValue: '',
  accent: '#4FC8F5',
};

/** A single node in the requirement-routing diagram — plain card, no glow, no fake stats. */
function DiagramCard({ node, compact = false }: { node: DiagramNode; compact?: boolean }) {
  const Icon = node.icon;
  return (
    <div
      className="rounded-lg border bg-[#171A38] p-4 text-left h-full flex flex-col"
      style={{ borderColor: 'rgba(255,255,255,0.08)' }}
    >
      {compact ? (
        <div className="flex items-center justify-between mb-2">
          <Icon className="h-5 w-5" style={{ color: node.accent }} />
          {node.tag && (
            <span
              className="font-mono text-[10px] px-2 py-0.5 rounded border"
              style={{ color: node.accent, borderColor: `${node.accent}40`, background: `${node.accent}14` }}
            >
              {node.tag}
            </span>
          )}
        </div>
      ) : (
        <Icon className="h-5 w-5 mb-2" style={{ color: node.accent }} />
      )}
      <div className="font-semibold text-white text-[15px]">{node.title}</div>
      <p className="text-[12px] mt-1 leading-relaxed" style={{ color: '#9099C2' }}>{node.subtitle}</p>
      {node.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {node.chips.map((c) => (
            <span
              key={c}
              className="px-2 py-0.5 rounded text-[10px] font-mono border"
              style={{ borderColor: `${node.accent}35`, color: node.accent, background: `${node.accent}12` }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
      {node.footerLabel && (
        <div className="mt-auto pt-3 border-t flex items-center justify-between text-[11px] font-mono" style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#7D86AD' }}>
          <span>{node.footerLabel}</span>
          <span style={{ color: node.accent }}>{node.footerValue}</span>
        </div>
      )}
    </div>
  );
}

/** The hero diagram: four roles as cards, connected by the flows the product actually runs. */
function RoleGraph() {
  return (
    <div className="rounded-[10px] p-5 sm:p-6" style={{ background: NAVY }}>
      <div className="flex items-center justify-between text-[11px] font-mono mb-5" style={{ color: '#7D86AD' }}>
        <span>requirement_7f21</span>
        <span>4 parties</span>
      </div>

      <div className="max-w-xs mx-auto mb-4">
        <DiagramCard node={DIAGRAM_HQ} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch mb-4">
        <DiagramCard node={DIAGRAM_CLIENT} compact />

        <div className="flex flex-col items-center justify-center gap-2 px-1 py-2 md:py-0 md:w-44">
          <div className="w-full flex items-center justify-between text-[10px] font-mono" style={{ color: '#7D86AD' }}>
            <span>Requirement →</span>
            <span>→ Assignment</span>
          </div>
          <div className="w-full rounded border px-3 py-2 text-center" style={{ borderColor: 'rgba(124,78,224,0.3)', background: 'rgba(124,78,224,0.08)' }}>
            <div className="font-mono text-[10px] font-semibold tracking-wide" style={{ color: '#9D8CF5' }}>
              DETERMINISTIC MATCHING
            </div>
            <div className="font-mono text-[9px] mt-1" style={{ color: '#7D86AD' }}>
              skills · experience · domain · seniority
            </div>
          </div>
          <div className="w-full flex items-center justify-between text-[10px] font-mono" style={{ color: '#7D86AD' }}>
            <span>↑ Match</span>
            <span>Submission ↓</span>
          </div>
        </div>

        <DiagramCard node={DIAGRAM_VENDOR} compact />
      </div>

      <div className="max-w-xs mx-auto">
        <DiagramCard node={DIAGRAM_CANDIDATE} />
      </div>

      <div className="mt-5 pt-4 border-t flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono" style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#7D86AD' }}>
        <span>Audit trail: every assignment &amp; submission logged</span>
        <span>Row-level security: strict tenant isolation</span>
      </div>
    </div>
  );
}

function EarlyAccessForm() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [appId, setAppId] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState<EarlyAccessSubmitPayload>({
    contactName: '',
    designation: '',
    businessEmail: '',
    phone: '',
    companyName: '',
    companyWebsite: '',
    businessType: 'staffing_agency',
    country: 'India',
    companySize: '11-50',
    recruitmentTeamSize: '',
    businessRequirements: '',
    interestedModules: [],
    currentChallenges: '',
    linkedinUrl: '',
    comments: '',
    privacyConsent: false,
  });

  const toggleModule = (m: HirenestModule) => {
    setForm((prev) => ({
      ...prev,
      interestedModules: prev.interestedModules.includes(m)
        ? prev.interestedModules.filter((x) => x !== m)
        : [...prev.interestedModules, m],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.privacyConsent) {
      setError('Please accept the privacy notice to continue.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitEarlyAccessApplication(form);
      setAppId(res.applicationId);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full flex items-center justify-center" style={{ background: '#E7F4EC' }}>
          <CheckCircle2 className="h-6 w-6" style={{ color: '#17734A' }} />
        </div>
        <h3 className="text-[20px] font-semibold" style={{ color: INK }}>Application submitted</h3>
        <p className="text-[14px] max-w-md mx-auto" style={{ color: INK_SOFT }}>
          Your application ID is{' '}
          <span className="font-mono font-semibold" style={{ color: INK }}>{appId}</span>. Our team will
          review your application and reach out within 48 hours.
        </p>
        <p className="text-[13px]" style={{ color: INK_FAINT }}>
          You will receive an invitation to register and set up your HireNestOS workspace once approved.
        </p>
      </div>
    );
  }

  const inputCls =
    'w-full h-9 px-3 rounded-[6px] border bg-white text-[13px] outline-none transition-colors focus:ring-[3px] focus:ring-[var(--focus-ring)] focus:border-[var(--focus-border)]';
  const inputStyle = { borderColor: LINE, color: INK } as React.CSSProperties;
  const labelCls = 'block text-[12px] font-medium mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-[6px] border px-3 py-2 text-[13px]" style={{ background: '#FBEAE8', borderColor: '#F3C5C1', color: '#B8322B' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>
            Contact name <span style={{ color: '#B8322B' }}>*</span>
          </label>
          <input
            type="text"
            required
            value={form.contactName}
            onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
            placeholder="Full name"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Designation</label>
          <input
            type="text"
            value={form.designation}
            onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
            placeholder="e.g. Head of Talent"
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>
            Business email <span style={{ color: '#B8322B' }}>*</span>
          </label>
          <input
            type="email"
            required
            value={form.businessEmail}
            onChange={(e) => setForm((f) => ({ ...f, businessEmail: e.target.value }))}
            placeholder="name@company.com"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+91 98765 43210"
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>
            Company name <span style={{ color: '#B8322B' }}>*</span>
          </label>
          <input
            type="text"
            required
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            placeholder="Company name"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Company website</label>
          <input
            type="url"
            value={form.companyWebsite}
            onChange={(e) => setForm((f) => ({ ...f, companyWebsite: e.target.value }))}
            placeholder="https://company.com"
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Business type</label>
          <select
            value={form.businessType}
            onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value as BusinessType }))}
            className={inputCls}
            style={inputStyle}
          >
            {Object.entries(BUSINESS_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Country</label>
          <input
            type="text"
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
            placeholder="India"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Company size</label>
          <select
            value={form.companySize}
            onChange={(e) => setForm((f) => ({ ...f, companySize: e.target.value as CompanySize }))}
            className={inputCls}
            style={inputStyle}
          >
            {Object.entries(COMPANY_SIZE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Recruitment team size</label>
          <input
            type="text"
            value={form.recruitmentTeamSize}
            onChange={(e) => setForm((f) => ({ ...f, recruitmentTeamSize: e.target.value }))}
            placeholder="e.g. 5-10 recruiters"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>LinkedIn / company profile</label>
          <input
            type="url"
            value={form.linkedinUrl}
            onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))}
            placeholder="https://linkedin.com/company/..."
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Business requirements</label>
        <textarea
          rows={2}
          value={form.businessRequirements}
          onChange={(e) => setForm((f) => ({ ...f, businessRequirements: e.target.value }))}
          placeholder="What are your primary hiring or staffing needs?"
          className={`${inputCls} h-auto py-2`}
          style={inputStyle}
        />
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Interested HireNestOS modules</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {(Object.entries(MODULE_LABELS) as [HirenestModule, string][]).map(([key, label]) => {
            const active = form.interestedModules.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleModule(key)}
                className="px-2.5 py-2 rounded-[6px] text-[12px] font-medium border transition-colors leading-none"
                style={active ? { background: BRAND, color: '#fff', borderColor: BRAND } : { background: '#fff', color: INK_SOFT, borderColor: LINE }}
              >
                {active && <Check className="inline h-3 w-3 mr-1" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Current recruitment challenges</label>
        <textarea
          rows={2}
          value={form.currentChallenges}
          onChange={(e) => setForm((f) => ({ ...f, currentChallenges: e.target.value }))}
          placeholder="What challenges are you facing with your current process?"
          className={`${inputCls} h-auto py-2`}
          style={inputStyle}
        />
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Additional comments</label>
        <textarea
          rows={2}
          value={form.comments}
          onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
          placeholder="Anything else you'd like us to know?"
          className={`${inputCls} h-auto py-2`}
          style={inputStyle}
        />
      </div>

      <div className="pt-2 border-t" style={{ borderColor: LINE_SOFT }}>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.privacyConsent}
            onChange={(e) => setForm((f) => ({ ...f, privacyConsent: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded"
            style={{ borderColor: LINE, accentColor: BRAND }}
          />
          <span className="text-[12px] leading-relaxed" style={{ color: INK_SOFT }}>
            I consent to HireNest Workforce Pvt Ltd collecting and processing my information as
            described in the{' '}
            <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: BRAND }}>
              Privacy Policy
            </a>
            . I understand my data will be used to evaluate my early access application and contact me
            about HireNestOS. <span style={{ color: '#B8322B' }}>*</span>
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="brand-gradient-bg w-full h-11 rounded-[6px] text-white disabled:opacity-60 text-[14px] font-medium transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            Request early access
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}

export const LandingPage: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white font-sans antialiased" style={{ color: INK }}>
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b" style={{ borderColor: LINE_SOFT }}>
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
                alt="HireNest"
                className="h-8 w-8 rounded-[6px] bg-white object-contain p-0.5 border"
                style={{ borderColor: LINE }}
              />
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold tracking-[-0.01em] leading-tight">
                  HireNest
                </span>
                <span className="text-[10px] leading-tight" style={{ color: INK_FAINT }}>
                  Workforce Pvt Ltd
                </span>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-6 text-[13px] font-medium" style={{ color: INK_SOFT }}>
              <a href="#platform" className="hover:text-current transition-colors" style={{ color: 'inherit' }}>
                Platform
              </a>
              <a href="#pipeline" className="hover:text-current transition-colors" style={{ color: 'inherit' }}>
                Pipeline
              </a>
              <Link to="/jobs" className="hover:text-current transition-colors" style={{ color: 'inherit' }}>
                Jobs
              </Link>
              <a href="#security" className="hover:text-current transition-colors" style={{ color: 'inherit' }}>
                Security
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/signin"
              className="hidden sm:inline text-[13px] font-medium transition-colors"
              style={{ color: INK_SOFT }}
            >
              Sign in
            </Link>
            <a
              href="#early-access"
              className="brand-gradient-bg hidden sm:inline-flex h-9 px-3.5 rounded-[6px] text-white text-[13px] font-medium transition-opacity hover:opacity-90 items-center gap-1.5"
            >
              Request early access
            </a>
            <button
              type="button"
              className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-[6px] border transition-colors"
              style={{ borderColor: LINE, color: INK_SOFT }}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t px-4 py-4 space-y-1 bg-white" style={{ borderColor: LINE_SOFT }}>
            <a href="#platform" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Platform</a>
            <a href="#pipeline" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Pipeline</a>
            <Link to="/jobs" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Jobs</Link>
            <a href="#security" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Security</a>
            <div className="pt-3 mt-2 border-t flex flex-col gap-2.5" style={{ borderColor: LINE_SOFT }}>
              <Link to="/signin" className="text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Sign in</Link>
              <a
                href="#early-access"
                onClick={() => setMobileMenuOpen(false)}
                className="brand-gradient-bg h-10 rounded-[6px] text-white text-[14px] font-medium transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-1.5"
              >
                Request early access
              </a>
            </div>
          </div>
        )}
      </header>

      {/* Hero — flat dark navy, no glow, left-set type */}
      <section className="pt-16 sm:pt-24 pb-20 px-4 sm:px-6" style={{ background: NAVY }}>
        <div className="max-w-[1180px] mx-auto grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-start">
          <div>
            <div className="font-mono text-[11px] tracking-[0.12em] text-indigo-300/80 uppercase mb-6">
              Enterprise recruitment orchestration · DPDP 2023 ready
            </div>

            <h1 className="text-[32px] sm:text-[42px] lg:text-[48px] font-bold tracking-[-0.025em] leading-[1.12] text-white max-w-xl">
              Four roles, one requirement, zero forwarded emails.
            </h1>
            <p className="text-slate-400 text-[16px] sm:text-[17px] leading-relaxed mt-5 max-w-lg">
              HireNestOS routes a requirement between hiring clients, staffing vendors, candidates and
              HireNest HQ with deterministic skill matching, SLA timers and a full audit trail, not a chain
              of CC'd emails.
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-8">
              <a
                href="#early-access"
                className="brand-gradient-bg text-white font-semibold text-[14px] px-6 py-3 rounded-lg inline-flex items-center gap-2 hover:opacity-90 transition-opacity"
              >
                Request early access
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#platform"
                className="text-[14px] font-medium text-slate-300 hover:text-white transition-colors inline-flex items-center gap-1.5"
              >
                See how it's structured
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="flex flex-wrap gap-x-8 gap-y-3 mt-12 pt-8 border-t border-white/10 text-[13px]">
              {[
                ['48h', 'to first shortlist'],
                ['SHA-256', 'resume de-duplication'],
                ['6-axis', 'scoring rubric'],
              ].map(([value, label]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="font-mono font-semibold text-white">{value}</span>
                  <span className="text-slate-500">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3 text-slate-400 text-[12px] font-mono uppercase tracking-wide">
              How a requirement moves
            </div>
            <RoleGraph />
          </div>
        </div>
      </section>

      {/* Platform, grouped by the role it serves — an editorial list, not a bento grid */}
      <section id="platform" className="py-16 sm:py-24 border-b" style={{ borderColor: LINE_SOFT }}>
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-[280px_1fr] gap-8 lg:gap-16">
            <div className="lg:sticky lg:top-20 lg:self-start">
              <h2 className="text-[26px] sm:text-[30px] font-semibold tracking-[-0.02em] leading-tight">
                Built for every seat
              </h2>
              <p className="text-[14px] leading-relaxed mt-3" style={{ color: INK_SOFT }}>
                Nobody logs in and sees "everything." Each party gets exactly the slice of the
                requirement that is theirs to act on.
              </p>
            </div>

            <div>
              {ROLE_GROUPS.map((g, i) => {
                const Icon = g.icon;
                return (
                  <div
                    key={g.role}
                    className={`grid sm:grid-cols-[auto_1fr] gap-x-5 gap-y-3 py-8 ${i > 0 ? 'border-t' : ''}`}
                    style={{ borderColor: LINE }}
                  >
                    <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2">
                      <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <Icon className="h-5 w-5" style={{ color: BRAND }} />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="font-semibold text-[17px]" style={{ color: INK }}>{g.label}</h3>
                        <span className="text-[12px]" style={{ color: INK_FAINT }}>{g.who}</span>
                      </div>
                      <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed" style={{ color: INK_SOFT }}>
                        {g.points.map((p) => (
                          <li key={p} className="pl-3.5 border-l" style={{ borderColor: LINE }}>
                            {p}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 text-[12px] font-mono" style={{ color: INK_FAINT }}>
                        {g.footerLabel} — <span style={{ color: INK_SOFT }}>{g.footerValue}</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Platform-wide capabilities that sit underneath every role */}
              <div className="pt-8 border-t text-[13px] space-y-2 sm:space-y-0" style={{ borderColor: LINE, color: INK_SOFT }}>
                <span className="font-medium block sm:inline sm:mr-4" style={{ color: INK }}>Underneath all four:</span>
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-x-8 sm:gap-y-3">
                  <span>AI copilot for JD drafting & screening</span>
                  <span>Server-side NDA gate before protected collaboration</span>
                  <span>Annual or monthly billing, GST-compliant invoicing</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pipeline — a real sequence, so it earns the numbering */}
      <section id="pipeline" className="py-14 sm:py-20 border-b" style={{ borderColor: LINE_SOFT }}>
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <h2 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight">
              The pipeline, with a clock on every handoff
            </h2>
            <p className="text-[15px] leading-relaxed" style={{ color: INK_SOFT }}>
              Four stages, each with an owner and an SLA, not a Kanban board anyone can quietly leave stale.
            </p>
          </div>

          <div className="relative">
            <div className="hidden lg:block absolute top-6 left-[12.5%] right-[12.5%] h-px" style={{ background: LINE }} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 relative">
              {PIPELINE.map((step) => (
                <div key={step.n} className="rounded-lg border p-5" style={{ borderColor: LINE, background: PAPER }}>
                  <div className="flex items-center gap-2.5 mb-4">
                    <span
                      className="w-7 h-7 rounded-full text-white font-mono font-semibold text-[12px] flex items-center justify-center shrink-0"
                      style={{ background: step.accent }}
                    >
                      {step.n}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-wide" style={{ color: step.accent }}>
                      {step.category}
                    </span>
                  </div>
                  <h3 className="text-[16px] font-semibold">{step.title}</h3>
                  <p className="text-[13px] leading-relaxed mt-1.5" style={{ color: INK_SOFT }}>{step.detail}</p>
                  <div className="mt-4 pt-3 border-t font-mono text-[11px]" style={{ borderColor: LINE }}>
                    <span style={{ color: INK_FAINT }}>{step.footerLabel}: </span>
                    <span style={{ color: step.accent }}>{step.footerValue}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Security & compliance — dark panel, matching the product's own badges */}
      <section id="security" className="py-16 px-4 sm:px-6" style={{ background: NAVY }}>
        <div className="max-w-[1180px] mx-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-400" />
              <h3 className="text-[22px] font-bold text-white tracking-tight">Enterprise security & compliance</h3>
            </div>
            <p className="text-[12px] text-slate-400 max-w-sm">
              Built for staffing operations that move candidate data across organizations under
              India's privacy law.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {COMPLIANCE.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.title} className="p-5 rounded-lg border" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                  <div className="w-9 h-9 rounded-md flex items-center justify-center mb-4" style={{ background: 'rgba(124,78,224,0.14)', color: '#9D8CF5' }}>
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <div className="font-semibold text-[14px] text-white mb-1.5">{c.title}</div>
                  <p className="text-[12.5px] text-slate-400 leading-relaxed">{c.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Early Access Form */}
      <section id="early-access" className="py-16 sm:py-24" style={{ background: PAPER }}>
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_1.3fr] gap-12">
          <div>
            <div className="font-mono text-[11px] tracking-[0.1em] uppercase mb-3" style={{ color: INK_FAINT }}>
              Limited enterprise cohort
            </div>
            <h2 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight">
              Apply for early access
            </h2>
            <p className="text-[14px] leading-relaxed mt-3 max-w-sm" style={{ color: INK_SOFT }}>
              We are onboarding staffing companies, IT recruitment agencies, independent recruiters and
              corporate hiring teams ahead of our commercial launch. Our team reviews every application
              within 48 hours.
            </p>
          </div>
          <div className="rounded-[10px] border bg-white p-6 sm:p-8" style={{ borderColor: LINE }}>
            <EarlyAccessForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="pt-14 pb-8 px-4 sm:px-6 text-white" style={{ background: NAVY }}>
        <div className="max-w-[1180px] mx-auto flex flex-col gap-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-8 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
                alt="HireNest"
                className="h-8 w-8 rounded-[6px] bg-white object-contain p-0.5"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-white text-[15px] tracking-tight">HireNestOS</span>
                <span className="text-[11px] text-slate-400">Hire Nest Workforce Pvt Ltd</span>
              </div>
            </div>
            <nav className="flex items-center gap-6 text-[13px] text-slate-300">
              <a href="#platform" className="hover:text-white transition-colors">Platform</a>
              <a href="#pipeline" className="hover:text-white transition-colors">Pipeline</a>
              <a href="#security" className="hover:text-white transition-colors">Security</a>
              <Link to="/privacy-policy" className="hover:text-white transition-colors">Privacy policy</Link>
            </nav>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-[12px] text-slate-500 font-mono">
            <span>© 2026 HireNest Workforce Pvt Ltd. All rights reserved.</span>
            <span>
              Built by{' '}
              <a
                href="https://atkind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-300 hover:text-white hover:underline transition-colors"
              >
                Atkind Pvt Ltd
              </a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
