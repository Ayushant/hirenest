import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Layers,
  Search,
  Command,
  UserCheck,
  TrendingUp,
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

const FEATURES = [
  {
    icon: Search,
    title: 'Deterministic candidate matching',
    description:
      'Algorithmic skill-experience-domain-notice matching engine with transparent scoring across every submission.',
  },
  {
    icon: Layers,
    title: 'Multi-vendor governance',
    description:
      'Three-pillar vendor scorecards, SLA tracking, and performance-based share allocation across all your agencies.',
  },
  {
    icon: Command,
    title: 'AI copilot for staffing',
    description:
      'JD editor, skill extractor, interview question architect and screening evaluator - with honest offline fallbacks.',
  },
  {
    icon: UserCheck,
    title: 'Structured interview loops',
    description:
      'Standardized evaluation rubrics, automated scheduling, and 24-hour feedback SLAs for consistent hiring decisions.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance & NDA verification',
    description:
      'Server-side NDA gate blocks protected collaboration until verified. Document upload, review queue, and audit trail.',
  },
  {
    icon: TrendingUp,
    title: 'Subscription & trial management',
    description:
      '14-day free trial with 7/3/1 day reminders. Annual and monthly billing with GST-compliant invoicing.',
  },
];

const STATS = [
  { value: '48h', label: 'SLA to first shortlist' },
  { value: '6D', label: 'Candidate scoring rubric' },
  { value: '14 days', label: 'Free trial for every org' },
];

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
        <div className="mx-auto h-12 w-12 rounded-full bg-[#DCFCE7] flex items-center justify-center">
          <CheckCircle2 className="h-6 w-6 text-[#166534]" />
        </div>
        <h3 className="text-[20px] font-semibold text-[#0F172A]">Application submitted</h3>
        <p className="text-[14px] text-[#64748B] max-w-md mx-auto">
          Your application ID is{' '}
          <span className="font-mono font-semibold text-[#0F172A]">{appId}</span>. Our team will
          review your application and reach out within 48 hours.
        </p>
        <p className="text-[13px] text-[#94A3B8]">
          You will receive an invitation to register and set up your HireNestOS workspace once approved.
        </p>
      </div>
    );
  }

  const inputCls =
    'w-full h-9 px-3 rounded-[6px] border border-[#E2E8F0] bg-white text-[#0F172A] text-[13px] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#1D4ED8] focus:ring-[3px] focus:ring-[#1D4ED8]/10';
  const labelCls = 'block text-[12px] font-medium text-[#475569] mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-[6px] bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-[13px] text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>
            Contact name <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="text"
            required
            value={form.contactName}
            onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
            placeholder="Full name"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Designation</label>
          <input
            type="text"
            value={form.designation}
            onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
            placeholder="e.g. Head of Talent"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>
            Business email <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="email"
            required
            value={form.businessEmail}
            onChange={(e) => setForm((f) => ({ ...f, businessEmail: e.target.value }))}
            placeholder="name@company.com"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+91 98765 43210"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>
            Company name <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="text"
            required
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            placeholder="Company name"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Company website</label>
          <input
            type="url"
            value={form.companyWebsite}
            onChange={(e) => setForm((f) => ({ ...f, companyWebsite: e.target.value }))}
            placeholder="https://company.com"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Business type</label>
          <select
            value={form.businessType}
            onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value as BusinessType }))}
            className={inputCls}
          >
            {Object.entries(BUSINESS_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Country</label>
          <input
            type="text"
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
            placeholder="India"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Company size</label>
          <select
            value={form.companySize}
            onChange={(e) => setForm((f) => ({ ...f, companySize: e.target.value as CompanySize }))}
            className={inputCls}
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
          <label className={labelCls}>Recruitment team size</label>
          <input
            type="text"
            value={form.recruitmentTeamSize}
            onChange={(e) => setForm((f) => ({ ...f, recruitmentTeamSize: e.target.value }))}
            placeholder="e.g. 5-10 recruiters"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>LinkedIn / company profile</label>
          <input
            type="url"
            value={form.linkedinUrl}
            onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))}
            placeholder="https://linkedin.com/company/..."
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Business requirements</label>
        <textarea
          rows={2}
          value={form.businessRequirements}
          onChange={(e) => setForm((f) => ({ ...f, businessRequirements: e.target.value }))}
          placeholder="What are your primary hiring or staffing needs?"
          className={`${inputCls} h-auto py-2`}
        />
      </div>

      <div>
        <label className={labelCls}>Interested HireNestOS modules</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {(Object.entries(MODULE_LABELS) as [HirenestModule, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleModule(key)}
              className={`px-2.5 py-1 rounded-[6px] text-[12px] font-medium border transition-colors ${
                form.interestedModules.includes(key)
                  ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]'
                  : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#94A3B8]'
              }`}
            >
              {form.interestedModules.includes(key) && <Check className="inline h-3 w-3 mr-1" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Current recruitment challenges</label>
        <textarea
          rows={2}
          value={form.currentChallenges}
          onChange={(e) => setForm((f) => ({ ...f, currentChallenges: e.target.value }))}
          placeholder="What challenges are you facing with your current process?"
          className={`${inputCls} h-auto py-2`}
        />
      </div>

      <div>
        <label className={labelCls}>Additional comments</label>
        <textarea
          rows={2}
          value={form.comments}
          onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
          placeholder="Anything else you'd like us to know?"
          className={`${inputCls} h-auto py-2`}
        />
      </div>

      <div className="pt-2 border-t border-[#F1F5F9]">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.privacyConsent}
            onChange={(e) => setForm((f) => ({ ...f, privacyConsent: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#1D4ED8] focus:ring-[#1D4ED8]/20"
          />
          <span className="text-[12px] text-[#64748B] leading-relaxed">
            I consent to HireNest Workforce Pvt Ltd collecting and processing my information as
            described in the{' '}
            <a href="#" className="text-[#1D4ED8] hover:underline">
              Privacy Policy
            </a>
            . I understand my data will be used to evaluate my early access application and contact me
            about HireNestOS. <span className="text-[#DC2626]">*</span>
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-10 rounded-[6px] bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-60 text-[14px] font-medium transition-colors shadow-sm flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            Request Early Access
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white text-[#0F172A] font-sans antialiased">
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0]">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
                alt="HireNest"
                className="h-8 w-8 rounded-[6px] bg-white object-contain p-0.5 shadow-xs border border-[#E2E8F0]"
              />
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold tracking-[-0.01em] leading-tight">
                  HireNest
                </span>
                <span className="text-[10px] text-[#94A3B8] leading-tight">
                  Workforce Pvt Ltd
                </span>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-6 text-[13px] font-medium text-[#64748B]">
              <a href="#platform" className="hover:text-[#0F172A] transition-colors">
                Platform
              </a>
              <a href="#early-access" className="hover:text-[#0F172A] transition-colors">
                Early Access
              </a>
              <a href="#security" className="hover:text-[#0F172A] transition-colors">
                Security
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/signin"
              className="text-[13px] font-medium text-[#64748B] hover:text-[#0F172A] transition-colors"
            >
              Sign in
            </Link>
            <a
              href="#early-access"
              className="h-8 px-3.5 rounded-[6px] bg-[#1D4ED8] text-white hover:bg-[#1E40AF] text-[13px] font-medium transition-colors shadow-sm inline-flex items-center gap-1.5"
            >
              Request Early Access
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-16 pb-20 border-b border-[#F1F5F9]">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl space-y-5">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] text-[12px] font-medium text-[#1D4ED8]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1D4ED8] animate-pulse" />
              Early access now open
            </div>
            <h1 className="text-[40px] sm:text-[48px] lg:text-[52px] font-bold tracking-[-0.025em] text-[#0F172A] leading-[1.08]">
              The operating system for modern staffing
            </h1>
            <p className="text-[17px] leading-[1.6] text-[#64748B] max-w-2xl">
              HireNestOS brings requirement management, candidate matching, vendor governance,
              interview scheduling and compliance into one platform - built for staffing companies,
              recruitment agencies and corporate hiring teams.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a
                href="#early-access"
                className="h-10 px-5 rounded-[6px] bg-[#1D4ED8] text-white hover:bg-[#1E40AF] text-[14px] font-medium transition-colors shadow-sm inline-flex items-center gap-2"
              >
                Request Early Access
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                to="/signin"
                className="h-10 px-4 rounded-[6px] border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[14px] font-medium transition-colors inline-flex items-center text-[#475569]"
              >
                Sign in to existing workspace
              </Link>
            </div>
          </div>

          {/* Stats strip */}
          <div className="mt-12 grid grid-cols-3 gap-6 max-w-lg">
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="text-[24px] font-bold font-mono tracking-tight text-[#0F172A]">
                  {s.value}
                </div>
                <div className="text-[12px] text-[#94A3B8] mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform features */}
      <section id="platform" className="py-20 border-b border-[#F1F5F9] bg-[#FAFBFC]">
        <div className="max-w-[1200px] mx-auto px-6 space-y-12">
          <div className="max-w-xl space-y-3">
            <div className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#1D4ED8]">
              Platform
            </div>
            <h2 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight text-[#0F172A]">
              Everything your hiring operation needs
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-[10px] border border-[#E2E8F0] bg-white p-5 space-y-3"
                >
                  <div className="h-8 w-8 rounded-[6px] bg-[#EFF6FF] flex items-center justify-center">
                    <Icon className="h-4 w-4 text-[#1D4ED8]" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-[#0F172A]">{f.title}</h3>
                  <p className="text-[13px] text-[#64748B] leading-relaxed">{f.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Security badges */}
      <section id="security" className="py-10 border-b border-[#F1F5F9]">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#1D4ED8]" />
            <span className="text-[13px] font-semibold text-[#0F172A]">
              Enterprise security & compliance
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-[4px] border border-[#E2E8F0] text-[11px] font-mono text-[#64748B]">
              DPDP Act 2023
            </span>
            <span className="px-2.5 py-1 rounded-[4px] border border-[#E2E8F0] text-[11px] font-mono text-[#64748B]">
              Row Level Security
            </span>
            <span className="px-2.5 py-1 rounded-[4px] border border-[#E2E8F0] text-[11px] font-mono text-[#64748B]">
              Tenant isolation
            </span>
            <span className="px-2.5 py-1 rounded-[4px] border border-[#E2E8F0] text-[11px] font-mono text-[#64748B]">
              Audit logging
            </span>
          </div>
        </div>
      </section>

      {/* Early Access Form */}
      <section id="early-access" className="py-20 bg-[#FAFBFC]">
        <div className="max-w-[720px] mx-auto px-6">
          <div className="text-center space-y-3 mb-10">
            <div className="text-[12px] font-mono font-semibold uppercase tracking-wider text-[#1D4ED8]">
              Early Access
            </div>
            <h2 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight text-[#0F172A]">
              Get early access to HireNestOS
            </h2>
            <p className="text-[14px] text-[#64748B] max-w-lg mx-auto">
              We are onboarding staffing companies, IT recruitment agencies, independent recruiters and
              corporate hiring teams ahead of our commercial launch. Fill in the form below and our team
              will review your application within 48 hours.
            </p>
          </div>

          <div className="rounded-[10px] border border-[#E2E8F0] bg-white p-6 sm:p-8 shadow-sm">
            <EarlyAccessForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 border-t border-[#E2E8F0] bg-white">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[12px] text-[#94A3B8]">
          <div className="flex items-center gap-2">
            <img
              src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
              alt="HireNest"
              className="h-5 w-5 rounded-[4px] bg-white object-contain p-0.5 border border-[#E2E8F0]"
            />
            <span>HireNestOS - Hire Nest Workforce Private Limited</span>
          </div>
          <span>
            Built by{' '}
            <a
              href="https://atkind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#64748B] hover:underline"
            >
              Atkind Pvt Ltd
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
};
