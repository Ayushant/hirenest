import { format, differenceInMinutes, differenceInHours, parseISO } from 'date-fns';
import type { SubmissionStage, InterviewRound, RequirementStatus, AppRole, Requirement } from '../types/db';
import {
  parseRequirementMeta,
  formatBudgetDisplay,
  BUDGET_UNIT_METADATA,
} from './enterpriseLifecycle';

export function formatLocalDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    return format(parseISO(isoString), 'dd MMM, HH:mm');
  } catch {
    return '—';
  }
}

export function formatLocalDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    return format(parseISO(isoString), 'dd MMM yyyy');
  } catch {
    return '—';
  }
}

export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const date = parseISO(isoString);
    const now = new Date();
    const mins = Math.max(0, differenceInMinutes(now, date));
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = differenceInHours(now, date);
    if (hours < 24) return `${hours}h ago`;
    return format(date, 'dd MMM');
  } catch {
    return '—';
  }
}

/**
 * Formats a budget or financial amount.
 * - When `currency` carries structured LPA/LPM metadata (`INR|unit=LPA|mode=range|min=12|max=15...`),
 *   Wait: if `amount` is the requirement's `vendor_visible_budget` (which equals `budgetMax` or `budgetMin`),
 *   it renders the full range or fixed LPA/LPM string (e.g. `₹12–15 LPA` or `₹1.5–2 LPM`).
 *   If `amount` is a distinct figure (such as `actual_client_budget` or `platform_margin`),
 *   it preserves the requirement's LPA/LPM unit without silently converting LPA <-> LPM.
 * - For legacy records without a unit field, it renders standard currency formatting.
 */
export function formatCurrency(amount: number | null | undefined, currency = 'INR'): string {
  const rawCurrency = currency || 'INR';
  if (rawCurrency.includes('|')) {
    const meta = parseRequirementMeta(rawCurrency, amount ?? null);
    if (meta.budgetUnit) {
      const unitInfo = BUDGET_UNIT_METADATA[meta.budgetUnit];
      const symbol = meta.baseCurrency.toUpperCase() === 'USD' ? '$' : '₹';

      // If caller passed a specific distinct numeric value (e.g. internal client budget or fixed margin)
      const matchesVendorBudget =
        amount === null ||
        amount === undefined ||
        amount === meta.budgetMax ||
        amount === meta.budgetMin;

      if (!matchesVendorBudget && amount !== null && amount !== undefined) {
        const clean = Number.isInteger(amount) ? String(amount) : Number(amount.toFixed(2)).toString();
        return `${symbol}${clean} ${unitInfo.shortSuffix}`;
      }

      return formatBudgetDisplay({
        budgetMode: meta.budgetMode,
        budgetUnit: meta.budgetUnit,
        budgetMin: meta.budgetMin,
        budgetMax: meta.budgetMax,
        baseCurrency: meta.baseCurrency,
      }).formatted;
    }
  }

  if (amount === null || amount === undefined) return '—';
  const baseCurr = rawCurrency.split('|')[0]?.trim() || 'INR';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: baseCurr,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${baseCurr} ${amount.toLocaleString()}`;
  }
}

export function formatRequirementBudgetWithSubtitle(
  req: Pick<Requirement, 'currency' | 'vendor_visible_budget' | 'client_org_id'>
): {
  formatted: string;
  subtitle: string | null;
  unit: 'LPA' | 'LPM' | null;
  isClientMapped: boolean;
  mappedClientOrgId: string | null;
} {
  const meta = parseRequirementMeta(req);
  const display = formatBudgetDisplay({
    budgetMode: meta.budgetMode,
    budgetUnit: meta.budgetUnit,
    budgetMin: meta.budgetMin,
    budgetMax: meta.budgetMax,
    baseCurrency: meta.baseCurrency,
  });
  return {
    formatted: display.formatted,
    subtitle: display.subtitle,
    unit: display.unit,
    isClientMapped: meta.isClientMapped,
    mappedClientOrgId: meta.mappedClientOrgId,
  };
}

/**
 * Masks email in list views (e.g. ra***@gmail.com) per Section 10.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

/**
 * Masks phone in list views (e.g. +91 ******3210) per Section 10.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const clean = phone.trim();
  if (clean.length <= 4) return '****';
  const last4 = clean.slice(-4);
  const countryPrefix = clean.startsWith('+') ? clean.slice(0, 3) + ' ' : '';
  return `${countryPrefix}******${last4}`;
}

export function formatSlaCountdown(dueAtIso: string | null | undefined): {
  label: string;
  tone: 'emerald' | 'amber' | 'red';
} {
  if (!dueAtIso) return { label: 'On time', tone: 'emerald' };
  try {
    const mins = differenceInMinutes(parseISO(dueAtIso), new Date());
    if (mins < 0) {
      const overdueHours = Math.max(1, Math.abs(Math.round(mins / 60)));
      return { label: `Overdue by ${overdueHours}h`, tone: 'red' };
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 4) {
      return { label: `Due in ${hours}h ${remMins}m`, tone: 'amber' };
    }
    return { label: `Due in ${hours}h ${remMins}m`, tone: 'emerald' };
  } catch {
    return { label: '—', tone: 'emerald' };
  }
}

export const STAGE_LABELS: Record<SubmissionStage, string> = {
  applied: 'Applied',
  recruiter_review: 'Recruiter review',
  client_review: 'Client review',
  interviewing: 'Interviewing',
  offered: 'Offered',
  offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  onboarded: 'Onboarded',
};

export const CANDIDATE_STAGE_LABELS: Record<SubmissionStage, string> = {
  applied: 'Application received',
  recruiter_review: 'Under HireNest review',
  client_review: 'Shared with hiring team',
  interviewing: 'Interview stage',
  offered: 'Offer extended',
  offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn by you',
  onboarded: 'Onboarded',
};

export const ROUND_LABELS: Record<InterviewRound, string> = {
  initial_screening: 'Initial screening',
  technical: 'Technical round',
  managerial: 'Managerial round',
  final: 'Final round',
  ai_screening: 'Automated screening (Phase 2)',
};

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
  filled: 'Filled',
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'HQ admin',
  recruiter: 'HQ recruiter',
  client_manager: 'Client hiring manager',
  client_member: 'Client interview panel',
  vendor_admin: 'Vendor agency admin',
  vendor_recruiter: 'Vendor recruiter',
  candidate: 'Direct candidate',
  pending: 'Pending approval',
};
