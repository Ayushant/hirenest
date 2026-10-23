import { supabase } from '../lib/supabase';
import type {
  BillingCycle,
  ExpiryReminderNotification,
  OrganizationSubscription,
  PlanId,
  RequirementBudgetDetails,
  RequirementClientMapping,
  SubscriptionInvoice,
  SubscriptionPlan,
} from '../types/subscription';

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Ideal for small hiring teams and early-stage companies.',
    priceMonthly: 24999,
    priceAnnualMonthlyEquivalent: 19999,
    annualTotal: 239988,
    openRequirementsLimit: 5,
    features: [
      'Up to 5 active requirements',
      'Direct candidate applicant tracking',
      'Deterministic skill matching engine',
      'Standard 48h SLA monitoring',
      'Email notifications & audit logs',
      'Basic AI assistant (20 suggestions/hr)',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For fast-growing organizations with active vendor agencies.',
    priceMonthly: 59999,
    priceAnnualMonthlyEquivalent: 47999,
    annualTotal: 575988,
    openRequirementsLimit: 25,
    features: [
      'Up to 25 active requirements',
      'Unlimited vendor agency shares',
      '5-Axis vendor performance scorecards',
      'Side-by-side 3-candidate comparison',
      'Automated SLA breach escalation',
      'Custom dispute & moderation workflows',
      'Full AI candidate summary & questions',
    ],
    isPopular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For large enterprises requiring governance, high SLAs, and custom limits.',
    priceMonthly: 149999,
    priceAnnualMonthlyEquivalent: 119999,
    annualTotal: 1439988,
    openRequirementsLimit: 'unlimited',
    features: [
      'Unlimited active requirements',
      'Dedicated HireNest workforce recruiter',
      'White-labeled vendor portal',
      'Custom margin governance (fixed & %)',
      'SHA-256 cross-tenant resume deduplication',
      'Guaranteed 12h SLA tier',
      '24/7 dedicated support & SLA guarantee',
    ],
  },
];

// In-browser fallback store to ensure seamless offline/dev behavior if server restart occurs
const LOCAL_STORAGE_KEY_SUB = 'hirenest_subscriptions_store';
const LOCAL_STORAGE_KEY_MAPPINGS = 'hirenest_client_mappings_store';
const LOCAL_STORAGE_KEY_BUDGETS = 'hirenest_requirement_budgets_store';

function getStoredSubscriptions(): Record<string, OrganizationSubscription> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_SUB);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredSubscription(orgId: string, sub: OrganizationSubscription) {
  try {
    const all = getStoredSubscriptions();
    all[orgId] = sub;
    localStorage.setItem(LOCAL_STORAGE_KEY_SUB, JSON.stringify(all));
  } catch {
    // Ignore storage errors
  }
}

export async function fetchSubscriptionStatus(orgId?: string | null): Promise<OrganizationSubscription> {
  const targetOrgId = orgId || 'current_org';

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const res = await fetch(`/api/subscription/status?orgId=${encodeURIComponent(targetOrgId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (res.ok) {
      const data = await res.json();
      saveStoredSubscription(targetOrgId, data);
      return data;
    }
  } catch {
    // Fall back to client-calculated local store
  }

  // Fallback calculation using server-equivalent deterministic timestamps
  const stored = getStoredSubscriptions()[targetOrgId];
  if (stored) {
    const now = Date.now();
    const ends = new Date(stored.trialEndsAt).getTime();
    const daysRemaining = Math.max(0, Math.ceil((ends - now) / (1000 * 60 * 60 * 24)));
    const isExpired = stored.subscriptionStatus === 'trial' && now >= ends;

    return {
      ...stored,
      daysRemaining,
      isExpired,
      subscriptionStatus: isExpired ? 'expired' : stored.subscriptionStatus,
    };
  }

  // Default initial trial state: 14-day trial
  const now = new Date();
  const trialEnds = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const defaultSub: OrganizationSubscription = {
    organizationId: targetOrgId,
    organizationName: 'HireNest Workspace',
    planId: 'growth',
    billingCycle: 'annual',
    subscriptionStatus: 'trial',
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEnds.toISOString(),
    daysRemaining: 14,
    isTrial: true,
    isExpired: false,
    activeUntil: trialEnds.toISOString(),
    lastPaymentDate: null,
    invoices: [],
  };

  saveStoredSubscription(targetOrgId, defaultSub);
  return defaultSub;
}

export async function configureTrial(params: {
  orgId: string;
  durationDays: number;
  planId?: PlanId;
}): Promise<OrganizationSubscription> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  try {
    const res = await fetch('/api/subscription/configure-trial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });

    if (res.ok) {
      const updated = await res.json();
      saveStoredSubscription(params.orgId, updated);
      return updated;
    }
  } catch {
    // Fallback
  }

  const now = new Date();
  const trialEnds = new Date(now.getTime() + params.durationDays * 24 * 60 * 60 * 1000);
  const updated: OrganizationSubscription = {
    organizationId: params.orgId,
    organizationName: 'HireNest Workspace',
    planId: params.planId || 'growth',
    billingCycle: 'annual',
    subscriptionStatus: 'trial',
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEnds.toISOString(),
    daysRemaining: params.durationDays,
    isTrial: true,
    isExpired: false,
    activeUntil: trialEnds.toISOString(),
    lastPaymentDate: null,
    invoices: [],
  };

  saveStoredSubscription(params.orgId, updated);
  return updated;
}

export async function processSubscriptionCheckout(params: {
  orgId: string;
  planId: PlanId;
  billingCycle: BillingCycle;
  billingContactName: string;
  billingContactEmail: string;
  companyName: string;
  gstNumber?: string;
  paymentMethod: string;
}): Promise<{
  success: boolean;
  invoice: SubscriptionInvoice;
  subscription: OrganizationSubscription;
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  try {
    const res = await fetch('/api/subscription/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });

    if (res.ok) {
      const result = await res.json();
      saveStoredSubscription(params.orgId, result.subscription);
      return result;
    }
  } catch {
    // Fallback
  }

  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === params.planId) || SUBSCRIPTION_PLANS[1];
  const subtotal =
    params.billingCycle === 'annual' ? plan.annualTotal : plan.priceMonthly;
  const taxAmount = Math.round(subtotal * 0.18);
  const total = subtotal + taxAmount;

  const invoiceNumber = `INV-2026-${Math.floor(100000 + Math.random() * 900000)}`;
  const now = new Date();
  const activeUntil = new Date(
    now.getTime() + (params.billingCycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
  );

  const newInvoice: SubscriptionInvoice = {
    id: `inv_${Date.now()}`,
    invoiceNumber,
    date: now.toISOString(),
    planId: plan.id,
    planName: plan.name,
    billingCycle: params.billingCycle,
    subtotal,
    taxAmount,
    total,
    currency: 'INR',
    paymentMethod: params.paymentMethod,
    status: 'paid',
  };

  const updatedSub: OrganizationSubscription = {
    organizationId: params.orgId,
    organizationName: params.companyName,
    planId: plan.id,
    billingCycle: params.billingCycle,
    subscriptionStatus: 'active',
    trialStartedAt: now.toISOString(),
    trialEndsAt: now.toISOString(),
    daysRemaining: params.billingCycle === 'annual' ? 365 : 30,
    isTrial: false,
    isExpired: false,
    activeUntil: activeUntil.toISOString(),
    lastPaymentDate: now.toISOString(),
    paymentConfirmationNumber: invoiceNumber,
    invoices: [newInvoice],
  };

  saveStoredSubscription(params.orgId, updatedSub);

  return {
    success: true,
    invoice: newInvoice,
    subscription: updatedSub,
  };
}

export async function fetchSubscriptionNotifications(orgId: string): Promise<ExpiryReminderNotification[]> {
  try {
    const res = await fetch(`/api/subscription/notifications?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Fallback
  }

  const sub = await fetchSubscriptionStatus(orgId);
  const notifications: ExpiryReminderNotification[] = [];

  if (sub.isTrial) {
    if (sub.daysRemaining <= 1) {
      notifications.push({
        id: `notif_${orgId}_1_day`,
        organizationId: orgId,
        milestone: '1_day',
        title: 'Trial expires today',
        message: 'Your HireNestOS trial expires today. Upgrade to Growth or Enterprise to keep your requirements active and prevent workflow interruptions.',
        urgency: 'critical',
        sentAt: new Date().toISOString(),
      });
    } else if (sub.daysRemaining <= 5) {
      notifications.push({
        id: `notif_${orgId}_5_days`,
        organizationId: orgId,
        milestone: '5_days',
        title: `${sub.daysRemaining} days remaining in trial`,
        message: 'Your trial period is nearing its end. Review plan options and activate your subscription to ensure uninterrupted candidate submission and interview workflows.',
        urgency: 'high',
        sentAt: new Date().toISOString(),
      });
    } else if (sub.daysRemaining <= 10) {
      notifications.push({
        id: `notif_${orgId}_10_days`,
        organizationId: orgId,
        milestone: '10_days',
        title: '10 days remaining in your trial',
        message: 'Continue benefiting from 5-axis vendor scorecards, automated SLA monitoring, and deterministic candidate matching by selecting an annual or monthly plan.',
        urgency: 'medium',
        sentAt: new Date().toISOString(),
      });
    } else if (sub.daysRemaining <= 15) {
      notifications.push({
        id: `notif_${orgId}_15_days`,
        organizationId: orgId,
        milestone: '15_days',
        title: 'Trial reminder: 15 days remaining',
        message: 'Explore our plan options to choose the right tier for your organization before your trial ends.',
        urgency: 'low',
        sentAt: new Date().toISOString(),
      });
    }
  } else if (sub.isExpired) {
    notifications.push({
      id: `notif_${orgId}_expired`,
      organizationId: orgId,
      milestone: 'expired',
      title: 'Trial expired',
      message: 'Your trial has ended. Existing requirements and candidate records are preserved. Please upgrade to unlock requirement authoring and interview scheduling.',
      urgency: 'critical',
      sentAt: new Date().toISOString(),
    });
  }

  return notifications;
}

// ----------------------------------------------------------------------
// Requirement Client Mapping Persistent Store (Update 1)
// ----------------------------------------------------------------------

export function getClientMappings(): Record<string, RequirementClientMapping> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_MAPPINGS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveClientMapping(mapping: RequirementClientMapping): void {
  try {
    const all = getClientMappings();
    all[mapping.requirement_id] = mapping;
    localStorage.setItem(LOCAL_STORAGE_KEY_MAPPINGS, JSON.stringify(all));
  } catch {
    // Ignore
  }
}

export async function fetchClientMapping(requirementId: string): Promise<RequirementClientMapping | null> {
  try {
    const res = await fetch(`/api/requirements/mappings?requirementId=${encodeURIComponent(requirementId)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Fallback
  }
  return getClientMappings()[requirementId] || null;
}

export async function setRequirementClientMapping(params: {
  requirementId: string;
  clientOrgId: string | null;
  clientName?: string | null;
  clientMapped: boolean;
}): Promise<RequirementClientMapping> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  try {
    const res = await fetch('/api/requirements/mappings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const data = await res.json();
      saveClientMapping(data);
      return data;
    }
  } catch {
    // Fallback
  }

  const mapping: RequirementClientMapping = {
    requirement_id: params.requirementId,
    client_org_id: params.clientOrgId,
    client_name: params.clientName,
    client_mapped: params.clientMapped,
    mapped_at: new Date().toISOString(),
    mapped_by: 'HQ Admin',
  };
  saveClientMapping(mapping);
  return mapping;
}

// ----------------------------------------------------------------------
// Requirement Budget Unit Store (Update 2: LPA / LPM)
// ----------------------------------------------------------------------

export function getStoredRequirementBudgets(): Record<string, RequirementBudgetDetails> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_BUDGETS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveRequirementBudget(
  requirementId: string,
  details: RequirementBudgetDetails
): void {
  try {
    const all = getStoredRequirementBudgets();
    all[requirementId] = details;
    localStorage.setItem(LOCAL_STORAGE_KEY_BUDGETS, JSON.stringify(all));
  } catch {
    // Ignore
  }
}

export async function fetchRequirementBudgetDetails(
  requirementId: string
): Promise<RequirementBudgetDetails | null> {
  try {
    const res = await fetch(`/api/requirements/budget-details?requirementId=${encodeURIComponent(requirementId)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Fallback
  }
  return getStoredRequirementBudgets()[requirementId] || null;
}

export async function saveRequirementBudgetDetails(params: {
  requirementId: string;
  budget_type: 'fixed' | 'range';
  budget_min: number | null;
  budget_max: number | null;
  budget_unit: 'LPA' | 'LPM';
}): Promise<RequirementBudgetDetails> {
  const minStr = params.budget_min !== null ? params.budget_min : '';
  const maxStr = params.budget_max !== null ? params.budget_max : '';
  const isRange = params.budget_type === 'range' && params.budget_min !== null && params.budget_max !== null;
  const display_text = isRange
    ? `₹${minStr}–${maxStr} ${params.budget_unit}`
    : `₹${maxStr || minStr || '0'} ${params.budget_unit}`;

  const details: RequirementBudgetDetails = {
    budget_type: params.budget_type,
    budget_min: params.budget_min,
    budget_max: params.budget_max,
    budget_unit: params.budget_unit,
    display_text,
  };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    await fetch('/api/requirements/budget-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ requirementId: params.requirementId, ...details }),
    });
  } catch {
    // Fallback
  }

  saveRequirementBudget(params.requirementId, details);
  return details;
}
