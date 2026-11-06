import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Check,
  Loader2,
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
const BRAND_DEEP = 'var(--primary-hover)'; // rich-blue-700
const BRAND_SOFT = 'var(--row-selected-bg)'; // rich-blue-50
const BRAND_TINT = 'var(--focus-ring)'; // rich-blue-100
const NAVY = '#111D40'; // rich-blue-950 — a fixed dark panel, not theme-coupled, by design
const TEAL = 'var(--chip-teal-dot)';
const SKY = 'var(--marker-new)';
const STORM_BLUE = 'var(--chip-storm-blue-dot)';

type Role = 'hq' | 'client' | 'vendor' | 'candidate';

const ROLE_COLOR: Record<Role, string> = {
  hq: BRAND,
  client: SKY,
  vendor: STORM_BLUE,
  candidate: TEAL,
};

const ROLE_GROUPS: {
  role: Role;
  label: string;
  who: string;
  points: string[];
}[] = [
  {
    role: 'hq',
    label: 'HireNest HQ',
    who: 'Admins & recruiters',
    points: [
      'Deterministic skill-experience-domain match scoring on every candidate',
      'Vendor scorecards, SLA tiers and performance-based share allocation',
      'Assignment overrides, dispute resolution and platform configuration',
    ],
  },
  {
    role: 'client',
    label: 'Hiring clients',
    who: 'Companies with open roles',
    points: [
      'Author requirements once; HQ routes them to the right vendors',
      'Review HQ-forwarded candidates against a shared scoring rubric',
      'Schedule interviews and return structured feedback inside a 24-hour SLA',
    ],
  },
  {
    role: 'vendor',
    label: 'Staffing vendors',
    who: 'Agencies & recruiters',
    points: [
      'See only the requirements assigned to you, not a blind blast list',
      'Candidate pool with SHA-256 resume de-duplication across your team',
      'A transparent 5-axis scorecard instead of a black-box ranking',
    ],
  },
  {
    role: 'candidate',
    label: 'Candidates',
    who: 'People applying for work',
    points: [
      'A "Jobs for me" shortlist, matched to your profile, not a keyword search',
      'One resume, reused across every submission a vendor makes on your behalf',
      'Real-time status instead of silence after you apply',
    ],
  },
];

const PIPELINE = [
  { n: '01', title: 'Requirement', sla: 'Logged once', detail: 'Client or HQ opens a requirement; it is scored and routed to eligible vendors automatically.' },
  { n: '02', title: 'Shortlist', sla: '48h SLA', detail: 'Vendors submit matched candidates; HQ forwards the ranked shortlist to the client.' },
  { n: '03', title: 'Interview', sla: '24h feedback', detail: 'Client runs the loop against a shared rubric and returns structured feedback on the clock.' },
  { n: '04', title: 'Offer', sla: 'Audited', detail: 'Offer, onboarding and vendor share are recorded against the same requirement thread.' },
];

const COMPLIANCE = ['DPDP Act 2023', 'Row Level Security', 'Tenant isolation', 'Audit logging'];

/** The hero diagram: four roles as nodes, connected by the flows the product actually runs. */
function RoleGraph() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Viewbox 0..360 x 0..300. Nodes: HQ top-center, Client left, Vendor right, Candidate bottom-center.
  const nodes = {
    hq: { x: 180, y: 56 },
    client: { x: 56, y: 170 },
    vendor: { x: 304, y: 170 },
    candidate: { x: 180, y: 258 },
  };

  const edges: { from: keyof typeof nodes; to: keyof typeof nodes; label: string; delay: number }[] = [
    { from: 'client', to: 'hq', label: 'Requirement', delay: 0 },
    { from: 'hq', to: 'vendor', label: 'Assignment', delay: 140 },
    { from: 'vendor', to: 'candidate', label: 'Submission', delay: 280 },
    { from: 'hq', to: 'candidate', label: 'Match', delay: 420 },
  ];

  return (
    <div
      className="relative overflow-hidden rounded-[10px] p-6 sm:p-8"
      style={{ background: NAVY }}
    >
      <div className="flex items-center justify-between text-[12px] font-mono mb-4" style={{ color: '#88A3D1' }}>
        <span>requirement_7f21 · live</span>
        <span>4 parties</span>
      </div>
      <svg viewBox="0 0 360 300" className="w-full h-auto" role="img" aria-label="HireNestOS routes a requirement between HQ, hiring clients, staffing vendors and candidates">
        {edges.map((e, i) => {
          const a = nodes[e.from];
          const b = nodes[e.to];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          return (
            <g key={i}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#3A4F7A"
                strokeWidth={1.5}
                strokeDasharray={len}
                strokeDashoffset={armed ? 0 : len}
                style={{ transition: `stroke-dashoffset 640ms ease-out ${e.delay}ms` }}
              />
              <rect x={mx - 30} y={my - 9} width={60} height={16} rx={3} fill={NAVY} opacity={armed ? 1 : 0} style={{ transition: `opacity 300ms ease-out ${e.delay + 400}ms` }} />
              <text x={mx} y={my + 3} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="#9FB4DE" opacity={armed ? 1 : 0} style={{ transition: `opacity 300ms ease-out ${e.delay + 400}ms` }}>
                {e.label}
              </text>
            </g>
          );
        })}
        {(Object.entries(nodes) as [Role, { x: number; y: number }][]).map(([role, pos]) => (
          <g key={role}>
            <circle cx={pos.x} cy={pos.y} r={7} fill={ROLE_COLOR[role]} />
            <circle cx={pos.x} cy={pos.y} r={13} fill="none" stroke={ROLE_COLOR[role]} strokeOpacity={0.35} strokeWidth={1.5} />
          </g>
        ))}
        <text x={nodes.hq.x} y={nodes.hq.y - 22} textAnchor="middle" fontSize="11" fontWeight={600} fill="#F3F6FB">HQ</text>
        <text x={nodes.client.x - 4} y={nodes.client.y + 4} textAnchor="end" fontSize="11" fontWeight={600} fill="#F3F6FB">Client</text>
        <text x={nodes.vendor.x + 4} y={nodes.vendor.y + 4} textAnchor="start" fontSize="11" fontWeight={600} fill="#F3F6FB">Vendor</text>
        <text x={nodes.candidate.x} y={nodes.candidate.y + 26} textAnchor="middle" fontSize="11" fontWeight={600} fill="#F3F6FB">Candidate</text>
      </svg>
      <p className="text-[12px] leading-relaxed mt-2" style={{ color: '#8FA3CC' }}>
        Every arrow is a row in the audit log: who assigned it, who submitted it, who signed off.
      </p>
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
        className="w-full h-11 rounded-[6px] text-white disabled:opacity-60 text-[14px] font-medium transition-colors flex items-center justify-center gap-2"
        style={{ background: BRAND }}
        onMouseEnter={(e) => (e.currentTarget.style.background = BRAND_DEEP)}
        onMouseLeave={(e) => (e.currentTarget.style.background = BRAND)}
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
  return (
    <div className="min-h-screen bg-white font-sans antialiased" style={{ color: INK }}>
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b" style={{ borderColor: LINE_SOFT }}>
        <div className="max-w-[1180px] mx-auto px-6 h-14 flex items-center justify-between">
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
              className="text-[13px] font-medium transition-colors"
              style={{ color: INK_SOFT }}
            >
              Sign in
            </Link>
            <a
              href="#early-access"
              className="h-9 px-3.5 rounded-[6px] text-white text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
              style={{ background: BRAND }}
            >
              Request early access
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-14 pb-20 border-b" style={{ borderColor: LINE_SOFT }}>
        <div className="max-w-[1180px] mx-auto px-6 grid lg:grid-cols-[1.08fr_1fr] gap-14 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[3px] border text-[12px] font-medium" style={{ background: BRAND_SOFT, borderColor: BRAND_TINT, color: BRAND_DEEP }}>
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: BRAND }} />
              Reviewing early-access applications now
            </div>
            <h1 className="text-[36px] sm:text-[44px] lg:text-[48px] font-bold tracking-[-0.025em] leading-[1.08]">
              Every requirement, submission and scorecard: one ledger, not six inboxes.
            </h1>
            <p className="text-[17px] leading-[1.6] max-w-xl" style={{ color: INK_SOFT }}>
              HireNestOS is the system of record for staffing work that moves through four different
              organizations (your HQ, the hiring client, the vendor agency, and the candidate) so
              nothing gets lost in a forwarded email thread.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <a
                href="#early-access"
                className="h-11 px-5 rounded-[6px] text-white text-[14px] font-medium transition-colors inline-flex items-center gap-2"
                style={{ background: BRAND }}
              >
                Request early access
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                to="/signin"
                className="h-11 px-4 rounded-[6px] border text-[14px] font-medium transition-colors inline-flex items-center"
                style={{ borderColor: LINE, color: INK_SOFT }}
              >
                Sign in
              </Link>
            </div>

            {/* Data strip — real numbers, set in mono, divided not boxed */}
            <div className="flex items-stretch gap-6 pt-6">
              {[
                { value: '48h', label: 'SLA to first shortlist' },
                { value: '6-axis', label: 'Candidate scoring rubric' },
                { value: '14 days', label: 'Free trial, every org' },
              ].map((s, i) => (
                <div key={s.label} className={i > 0 ? 'pl-6 border-l' : ''} style={i > 0 ? { borderColor: LINE } : undefined}>
                  <div className="text-[22px] font-semibold font-mono tracking-tight">{s.value}</div>
                  <div className="text-[12px] mt-0.5" style={{ color: INK_FAINT }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <RoleGraph />
        </div>
      </section>

      {/* Platform, grouped by the role it serves */}
      <section id="platform" className="py-20 border-b" style={{ borderColor: LINE_SOFT, background: PAPER }}>
        <div className="max-w-[1180px] mx-auto px-6 space-y-12">
          <div className="max-w-xl space-y-3">
            <h2 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight">
              One platform, four different jobs to do
            </h2>
            <p className="text-[15px] leading-relaxed" style={{ color: INK_SOFT }}>
              Nobody logs in and sees "everything." Each party gets exactly the slice of the
              requirement that is theirs to act on.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
            {ROLE_GROUPS.map((g) => (
              <div key={g.role} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: ROLE_COLOR[g.role] }} />
                  <h3 className="text-[14px] font-semibold">{g.label}</h3>
                </div>
                <p className="text-[12px]" style={{ color: INK_FAINT }}>{g.who}</p>
                <ul className="space-y-2.5">
                  {g.points.map((p) => (
                    <li key={p} className="text-[13px] leading-relaxed pl-3 border-l" style={{ color: INK_SOFT, borderColor: LINE }}>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Platform-wide capabilities that sit underneath every role */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-8 border-t text-[13px]" style={{ borderColor: LINE, color: INK_SOFT }}>
            <span className="font-medium" style={{ color: INK }}>Underneath all four:</span>
            <span>AI copilot for JD drafting & screening</span>
            <span>Server-side NDA gate before protected collaboration</span>
            <span>Annual or monthly billing, GST-compliant invoicing</span>
          </div>
        </div>
      </section>

      {/* Pipeline — a real sequence, so it earns the numbering */}
      <section id="pipeline" className="py-20 border-b" style={{ borderColor: LINE_SOFT }}>
        <div className="max-w-[1180px] mx-auto px-6 space-y-10">
          <div className="max-w-xl space-y-3">
            <h2 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight">
              The pipeline, with a clock on every handoff
            </h2>
            <p className="text-[15px] leading-relaxed" style={{ color: INK_SOFT }}>
              Four stages, each with an owner and an SLA, not a Kanban board anyone can quietly leave stale.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PIPELINE.map((step, i) => (
              <div key={step.n} className="relative pt-9">
                <span className="absolute top-0 left-0 text-[13px] font-mono" style={{ color: INK_FAINT }}>{step.n}</span>
                <span
                  className="absolute top-0 right-0 text-[12px] font-mono px-1.5 py-0.5 rounded-[4px]"
                  style={{ background: BRAND_SOFT, color: BRAND_DEEP }}
                >
                  {step.sla}
                </span>
                <div className="pt-3 border-t-2" style={{ borderColor: i === 0 ? BRAND : LINE }}>
                  <h3 className="text-[15px] font-semibold mt-3">{step.title}</h3>
                  <p className="text-[13px] leading-relaxed mt-1.5" style={{ color: INK_SOFT }}>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-10 border-b" style={{ borderColor: LINE_SOFT }}>
        <div className="max-w-[1180px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" style={{ color: BRAND }} />
            <span className="text-[13px] font-semibold">
              Enterprise security & compliance
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {COMPLIANCE.map((c) => (
              <span
                key={c}
                className="px-2.5 py-1 rounded-[4px] border text-[12px] font-mono"
                style={{ borderColor: LINE, color: INK_SOFT }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Early Access Form */}
      <section id="early-access" className="py-20" style={{ background: PAPER }}>
        <div className="max-w-[720px] mx-auto px-6">
          <div className="text-center space-y-3 mb-10">
            <h2 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight">
              Get early access to HireNestOS
            </h2>
            <p className="text-[14px] max-w-lg mx-auto" style={{ color: INK_SOFT }}>
              We are onboarding staffing companies, IT recruitment agencies, independent recruiters and
              corporate hiring teams ahead of our commercial launch. Fill in the form below and our team
              will review your application within 48 hours.
            </p>
          </div>

          <div className="rounded-[10px] border bg-white p-6 sm:p-8" style={{ borderColor: LINE }}>
            <EarlyAccessForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 border-t bg-white" style={{ borderColor: LINE }}>
        <div className="max-w-[1180px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[12px]" style={{ color: INK_FAINT }}>
          <div className="flex items-center gap-2">
            <img
              src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
              alt="HireNest"
              className="h-5 w-5 rounded-[4px] bg-white object-contain p-0.5 border"
              style={{ borderColor: LINE }}
            />
            <span>HireNestOS · Hire Nest Workforce Private Limited</span>
          </div>
          <span>
            Built by{' '}
            <a
              href="https://atkind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
              style={{ color: INK_SOFT }}
            >
              Atkind Pvt Ltd
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
};
