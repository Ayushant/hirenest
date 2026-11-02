import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';

/*
 * Welcome / Workspace Gateway Page
 *
 * This is the pre-signin landing page for HireNest Workforce.
 * Visitors see this page before reaching the authentication form.
 *
 * Layout: 45/55 split — deep storm-slate branding panel on the left,
 * clean light surface with workspace selection card on the right.
 *
 * Design: Matches the existing AuthSplitLayout language but acts
 * as a gateway entry point rather than a form page.
 */

const WORKSPACES = [
  {
    id: 'admin',
    label: 'HQ Admin',
    initials: 'HQ',
    description: 'Manage operations, approvals & SLAs',
    bgTint: 'bg-[#EEF4FF]',
    borderTint: 'border-[#B6CCFD]',
    textTint: 'text-[#1F4CC4]',
  },
  {
    id: 'client',
    label: 'Client Portal',
    initials: 'CP',
    description: 'Review candidates & track positions',
    bgTint: 'bg-[#E3F5F2]',
    borderTint: 'border-[#A3E4DB]',
    textTint: 'text-[#176B60]',
  },
  {
    id: 'vendor',
    label: 'Vendor Agency',
    initials: 'VA',
    description: 'Submit candidates & manage pool',
    bgTint: 'bg-[#FDF1DC]',
    borderTint: 'border-[#F5D78E]',
    textTint: 'text-[#8F5A0A]',
  },
  {
    id: 'candidate',
    label: 'Candidate',
    initials: 'CA',
    description: 'Browse jobs & track applications',
    bgTint: 'bg-[#E3F0FD]',
    borderTint: 'border-[#BDDDFC]',
    textTint: 'text-[#1F5F99]',
  },
] as const;

const FEATURE_PILLS = [
  { label: 'AI Matching', dotColor: '#88BDF2' },
  { label: 'Vendor SLAs', dotColor: '#2A9D8F' },
  { label: '6D Quality Score', dotColor: '#D99A2B' },
] as const;

export const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  // If user is already authenticated, redirect them away
  if (!loading && session) {
    navigate('/', { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--app-bg)] text-[var(--text-primary)]">

      {/* ───── LEFT PANEL: Deep Storm-Slate Branding ───── */}
      <div
        style={{
          backgroundImage:
            'radial-gradient(ellipse at top, rgba(136, 189, 242, 0.14), transparent 68%)',
        }}
        className="lg:w-[45%] bg-[#1E2A36] text-[#D6E1EC] p-8 sm:p-12 lg:p-14 flex flex-col justify-between shrink-0 min-h-[320px] lg:min-h-screen"
      >
        {/* Top: Logo + Wordmark */}
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
            alt="HireNest Workforce Logo"
            className="h-10 w-10 rounded-[8px] bg-white object-contain p-0.5 shrink-0"
          />
          <div className="flex flex-col">
            <span className="text-[15px] leading-[20px] font-semibold text-white">
              HireNest
            </span>
            <span className="text-[11px] leading-[14px] text-[#8FA6BC]">
              Hire Nest Workforce Pvt Ltd
            </span>
          </div>
        </div>

        {/* Center: Headline + Accent Bar + Subtext + Feature Pills */}
        <div className="my-10 lg:my-0 max-w-[480px] space-y-4">
          <h1 className="text-[28px] leading-[36px] font-semibold tracking-[-0.01em] text-white">
            Enterprise Workforce Operations
          </h1>

          {/* Section accent bar */}
          <div className="h-[3px] w-4 rounded-full bg-[#88BDF2]" />

          <p className="text-[14px] leading-[22px] text-[#D6E1EC]">
            AI-powered staffing pipeline — from requirement to placement —
            governed by SLAs, quality scoring, and structured interviews.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap items-center gap-2 pt-4">
            {FEATURE_PILLS.map((pill) => (
              <span
                key={pill.label}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#273747] border border-[#34485D] text-[12px] text-[#D6E1EC] font-medium"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: pill.dotColor }}
                />
                {pill.label}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom: Operations credit + Atkind attribution */}
        <div className="space-y-1 pt-6 border-t border-[#2A3949]/60 text-[12px] leading-[16px] text-[#8FA6BC]">
          <div className="font-mono tabular-nums">HireNest Workforce Operations</div>
          <div>
            Built by{' '}
            <a
              href="https://atkind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#88BDF2] hover:text-white hover:underline transition-colors"
            >
              Atkind Pvt Ltd
            </a>
          </div>
        </div>
      </div>

      {/* ───── RIGHT PANEL: Clean Light Surface ───── */}
      <div className="flex-1 lg:w-[55%] flex flex-col items-center justify-center p-6 sm:p-10 bg-[var(--app-bg)]">
        <div className="w-full max-w-[400px]">

          {/* Top: App brand header */}
          <div className="flex items-center gap-3 pb-4 mb-5 border-b border-[var(--border)]">
            <img
              src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
              alt="HireNest Workforce Private Limited"
              className="h-8 w-auto rounded-[6px] bg-white object-contain shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-[18px] font-semibold text-[var(--text-primary)]">
                HireNestOS
              </div>
              <div className="text-[11px] leading-[15px] text-[var(--text-tertiary)] truncate">
                Hire Nest Workforce Private Limited
              </div>
            </div>
            <span className="text-[10px] font-mono tabular-nums px-2 py-0.5 rounded-[4px] bg-[var(--bg-subtle)] text-[var(--text-tertiary)] font-medium border border-[var(--border)]">
              v2.4.0
            </span>
          </div>

          {/* Main gateway card */}
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5 text-left">

            {/* Card heading */}
            <div className="space-y-1">
              <h2 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                Welcome
              </h2>
              <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                Select your workspace to continue
              </p>
            </div>

            {/* Workspace entry buttons */}
            <div className="space-y-2">
              {WORKSPACES.map((ws) => (
                <Link
                  key={ws.id}
                  to="/signin"
                  className="w-full h-auto min-h-[52px] py-2.5 px-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors flex items-center text-left group no-underline"
                >
                  {/* Colored square monogram */}
                  <span
                    className={`w-8 h-8 rounded-[6px] ${ws.bgTint} border ${ws.borderTint} ${ws.textTint} flex items-center justify-center font-bold text-[11px] shrink-0 mr-3`}
                  >
                    {ws.initials}
                  </span>

                  <span className="flex-1 min-w-0 pr-2">
                    <span className="block text-[14px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors leading-tight">
                      {ws.label}
                    </span>
                    <span className="block text-[12px] text-[var(--text-tertiary)] leading-tight mt-0.5 truncate">
                      {ws.description}
                    </span>
                  </span>

                  <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all shrink-0" />
                </Link>
              ))}
            </div>

            {/* Direct sign-in link */}
            <div className="pt-4 border-t border-[var(--border)] text-center">
              <Link
                to="/signin"
                className="inline-flex items-center text-[13px] text-[var(--accent)] font-medium hover:underline"
              >
                Sign in to your account →
              </Link>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 text-center text-[12px] leading-[16px] text-[var(--text-tertiary)]">
            Built by{' '}
            <a
              href="https://atkind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--accent)] hover:underline"
            >
              Atkind Pvt Ltd
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

