import { format, formatDistanceToNow, differenceInMinutes, parseISO } from 'date-fns';
import type { SubmissionStage, InterviewRound, RequirementStatus, AppRole } from '../types/db';

export function formatLocalDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    return format(parseISO(isoString), 'dd MMM yyyy, HH:mm');
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
    return formatDistanceToNow(parseISO(isoString), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function formatCurrency(amount: number | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
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
  if (!dueAtIso) return { label: 'No SLA', tone: 'emerald' };
  try {
    const mins = differenceInMinutes(parseISO(dueAtIso), new Date());
    if (mins < 0) {
      const overdueHours = Math.abs(Math.round(mins / 60));
      return { label: `Overdue by ${overdueHours}h`, tone: 'red' };
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 4) {
      return { label: `${hours}h ${remMins}m left`, tone: 'amber' };
    }
    return { label: `${hours}h ${remMins}m left`, tone: 'emerald' };
  } catch {
    return { label: '—', tone: 'emerald' };
  }
}

export const STAGE_LABELS: Record<SubmissionStage, string> = {
  applied: 'Applied',
  recruiter_review: 'Recruiter Review',
  client_review: 'Client Review',
  interviewing: 'Interviewing',
  offered: 'Offered',
  offer_accepted: 'Offer Accepted',
  offer_declined: 'Offer Declined',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  onboarded: 'Onboarded',
};

export const CANDIDATE_STAGE_LABELS: Record<SubmissionStage, string> = {
  applied: 'Application Received',
  recruiter_review: 'Under HireNest Review',
  client_review: 'Shared with Hiring Team',
  interviewing: 'Interview Stage',
  offered: 'Offer Extended',
  offer_accepted: 'Offer Accepted',
  offer_declined: 'Offer Declined',
  rejected: 'Not Selected',
  withdrawn: 'Withdrawn by You',
  onboarded: 'Onboarded',
};

export const ROUND_LABELS: Record<InterviewRound, string> = {
  initial_screening: 'Initial Screening',
  technical: 'Technical Round',
  managerial: 'Managerial Round',
  final: 'Final Round',
  ai_screening: 'AI Screening (Phase 2)',
};

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  open: 'Open',
  on_hold: 'On Hold',
  closed: 'Closed',
  filled: 'Filled',
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'HQ Admin',
  recruiter: 'HQ Recruiter',
  client_manager: 'Client Hiring Manager',
  client_member: 'Client Interview Panel',
  vendor_admin: 'Vendor Agency Admin',
  vendor_recruiter: 'Vendor Recruiter',
  candidate: 'Direct Candidate',
  pending: 'Pending Approval',
};
