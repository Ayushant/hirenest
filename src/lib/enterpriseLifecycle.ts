import type { AppRole, Requirement } from '../types/db';

// ============================================================================
// UPDATE 1 & UPDATE 2: Requirement Client Mapping & LPA/LPM Budget Schema
// ============================================================================

export type BudgetUnit = 'LPA' | 'LPM';
export type BudgetMode = 'range' | 'fixed';

export interface RequirementExtendedMeta {
  baseCurrency: string;
  budgetUnit: BudgetUnit | null; // null for legacy records that predate LPA/LPM
  budgetMode: BudgetMode;
  budgetMin: number | null;
  budgetMax: number | null;
  isClientMapped: boolean;
  mappedClientOrgId: string | null;
}

export const BUDGET_UNIT_METADATA: Record<
  BudgetUnit,
  {
    code: BudgetUnit;
    selectorLabel: string;
    fullLabel: string;
    shortSuffix: string;
  }
> = {
  LPA: {
    code: 'LPA',
    selectorLabel: 'LPA — annual',
    fullLabel: 'Lakhs per annum',
    shortSuffix: 'LPA',
  },
  LPM: {
    code: 'LPM',
    selectorLabel: 'LPM — monthly',
    fullLabel: 'Lakhs per month',
    shortSuffix: 'LPM',
  },
};

/**
 * Encodes structured budget (budgetMin, budgetMax, budgetUnit, budgetMode)
 * and explicit client mapping state into the requirement currency field
 * while keeping legacy plain currency strings ('INR', 'USD') 100% supported.
 *
 * Format: "<BASE_CURRENCY>|unit=<LPA|LPM>|mode=<range|fixed>|min=<num>|max=<num>|map=<1|0>:<clientOrgId>"
 */
export function encodeRequirementMetaToCurrency(params: {
  baseCurrency?: string;
  budgetUnit?: BudgetUnit | null;
  budgetMode?: BudgetMode;
  budgetMin?: number | null;
  budgetMax?: number | null;
  isClientMapped: boolean;
  mappedClientOrgId?: string | null;
}): string {
  const base = (params.baseCurrency || 'INR').split('|')[0].trim() || 'INR';
  const unit = params.budgetUnit || 'LPA';
  const mode = params.budgetMode || 'range';
  const minStr =
    params.budgetMin !== null && params.budgetMin !== undefined && !Number.isNaN(params.budgetMin)
      ? String(params.budgetMin)
      : '';
  const maxStr =
    params.budgetMax !== null && params.budgetMax !== undefined && !Number.isNaN(params.budgetMax)
      ? String(params.budgetMax)
      : '';
  const mapFlag = params.isClientMapped ? '1' : '0';
  const mapOrg = params.isClientMapped && params.mappedClientOrgId ? params.mappedClientOrgId : '';

  return `${base}|unit=${unit}|mode=${mode}|min=${minStr}|max=${maxStr}|map=${mapFlag}:${mapOrg}`;
}

/**
 * Parses a requirement's currency & budget fields into structured LPA/LPM budget
 * and explicit client mapping metadata.
 * Supports legacy records that lack the new unit or mapping fields without
 * silently converting LPA <-> LPM.
 */
export function parseRequirementMeta(
  reqOrCurrency:
    | Pick<Requirement, 'currency' | 'vendor_visible_budget' | 'client_org_id'>
    | string
    | null
    | undefined,
  fallbackAmount?: number | null,
  fallbackClientOrgId?: string | null
): RequirementExtendedMeta {
  const rawCurrency =
    typeof reqOrCurrency === 'string'
      ? reqOrCurrency
      : reqOrCurrency?.currency || 'INR';
  const vendorBudget =
    typeof reqOrCurrency === 'object' && reqOrCurrency !== null
      ? reqOrCurrency.vendor_visible_budget
      : fallbackAmount ?? null;
  const recordClientOrgId =
    typeof reqOrCurrency === 'object' && reqOrCurrency !== null
      ? reqOrCurrency.client_org_id
      : fallbackClientOrgId ?? null;

  if (!rawCurrency || !rawCurrency.includes('|')) {
    // Legacy record without unit metadata: preserve raw amount & currency, do not fabricate LPA/LPM conversion
    return {
      baseCurrency: (rawCurrency || 'INR').trim() || 'INR',
      budgetUnit: null,
      budgetMode: 'fixed',
      budgetMin: vendorBudget ?? null,
      budgetMax: vendorBudget ?? null,
      isClientMapped: Boolean(recordClientOrgId),
      mappedClientOrgId: recordClientOrgId || null,
    };
  }

  const parts = rawCurrency.split('|');
  const baseCurrency = parts[0]?.trim() || 'INR';
  const kv: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=');
    if (eqIdx > 0) {
      const k = parts[i].slice(0, eqIdx).trim();
      const v = parts[i].slice(eqIdx + 1).trim();
      kv[k] = v;
    }
  }

  const unitRaw = kv.unit?.toUpperCase();
  const budgetUnit: BudgetUnit | null =
    unitRaw === 'LPA' || unitRaw === 'LPM' ? unitRaw : null;

  const budgetMode: BudgetMode = kv.mode === 'fixed' ? 'fixed' : 'range';

  const parsedMin =
    kv.min !== undefined && kv.min !== '' && !Number.isNaN(Number(kv.min))
      ? Number(kv.min)
      : vendorBudget ?? null;
  const parsedMax =
    kv.max !== undefined && kv.max !== '' && !Number.isNaN(Number(kv.max))
      ? Number(kv.max)
      : parsedMin ?? vendorBudget ?? null;

  let isClientMapped = Boolean(recordClientOrgId);
  let mappedClientOrgId = recordClientOrgId || null;

  if (kv.map !== undefined) {
    const [flag, orgPart] = kv.map.split(':');
    isClientMapped = flag === '1';
    mappedClientOrgId = isClientMapped ? orgPart || recordClientOrgId || null : null;
  }

  return {
    baseCurrency,
    budgetUnit,
    budgetMode,
    budgetMin: parsedMin,
    budgetMax: parsedMax,
    isClientMapped,
    mappedClientOrgId,
  };
}

export function validateBudgetValues(params: {
  budgetMode: BudgetMode;
  budgetUnit: BudgetUnit;
  budgetMin?: number | null;
  budgetMax?: number | null;
}): { valid: boolean; error?: string } {
  const { budgetMode, budgetUnit, budgetMin, budgetMax } = params;
  if (budgetUnit !== 'LPA' && budgetUnit !== 'LPM') {
    return { valid: false, error: 'Select a valid budget unit (LPA or LPM).' };
  }

  const hasMin = budgetMin !== null && budgetMin !== undefined && !Number.isNaN(budgetMin);
  const hasMax = budgetMax !== null && budgetMax !== undefined && !Number.isNaN(budgetMax);

  if (!hasMin && !hasMax) {
    return { valid: true }; // Optional vendor-visible budget
  }

  if (budgetMode === 'fixed') {
    const val = hasMin ? budgetMin! : budgetMax!;
    if (val <= 0) {
      return { valid: false, error: 'Budget amount must be greater than 0.' };
    }
    return { valid: true };
  }

  if (!hasMin || !hasMax) {
    return {
      valid: false,
      error: 'Enter both minimum and maximum budget for a budget range.',
    };
  }

  if (budgetMin! <= 0 || budgetMax! <= 0) {
    return { valid: false, error: 'Minimum and maximum budget must be greater than 0.' };
  }

  if (budgetMax! < budgetMin!) {
    return {
      valid: false,
      error: 'Maximum budget must be greater than or equal to minimum budget.',
    };
  }

  return { valid: true };
}

function formatCleanNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Number(n.toFixed(2)).toString();
}

export function formatBudgetDisplay(params: {
  budgetMode: BudgetMode;
  budgetUnit: BudgetUnit | null;
  budgetMin: number | null;
  budgetMax: number | null;
  baseCurrency?: string;
}): {
  formatted: string;
  subtitle: string | null;
  unit: BudgetUnit | null;
} {
  const { budgetMode, budgetUnit, budgetMin, budgetMax, baseCurrency = 'INR' } = params;
  const symbol = baseCurrency.toUpperCase() === 'USD' ? '$' : '₹';

  // Legacy record without LPA/LPM unit: render standard currency without assuming/converting unit
  if (!budgetUnit) {
    const rawAmount = budgetMax ?? budgetMin;
    if (rawAmount === null || rawAmount === undefined) {
      return { formatted: '—', subtitle: null, unit: null };
    }
    try {
      const legacyFormatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: baseCurrency || 'INR',
        maximumFractionDigits: 0,
      }).format(rawAmount);
      return { formatted: legacyFormatted, subtitle: 'Legacy numeric budget', unit: null };
    } catch {
      return {
        formatted: `${symbol}${rawAmount.toLocaleString()}`,
        subtitle: 'Legacy numeric budget',
        unit: null,
      };
    }
  }

  const unitInfo = BUDGET_UNIT_METADATA[budgetUnit];
  const hasMin = budgetMin !== null && budgetMin !== undefined && !Number.isNaN(budgetMin);
  const hasMax = budgetMax !== null && budgetMax !== undefined && !Number.isNaN(budgetMax);

  if (!hasMin && !hasMax) {
    return { formatted: '—', subtitle: unitInfo.fullLabel, unit: budgetUnit };
  }

  if (
    budgetMode === 'fixed' ||
    (hasMin && hasMax && budgetMin === budgetMax) ||
    (hasMin && !hasMax) ||
    (!hasMin && hasMax)
  ) {
    const singleVal = hasMax ? budgetMax! : budgetMin!;
    return {
      formatted: `${symbol}${formatCleanNumber(singleVal)} ${unitInfo.shortSuffix}`,
      subtitle: unitInfo.fullLabel,
      unit: budgetUnit,
    };
  }

  return {
    formatted: `${symbol}${formatCleanNumber(budgetMin!)}–${formatCleanNumber(budgetMax!)} ${unitInfo.shortSuffix}`,
    subtitle: unitInfo.fullLabel,
    unit: budgetUnit,
  };
}

/**
 * Authoritative visibility & mapping policy for Update 1:
 * - Admin / Recruiter: full access to mapped and unmapped requirements.
 * - Client: ONLY sees requirements explicitly mapped to their client org (isClientMapped === true && mappedClientOrgId === viewerOrgId).
 *   Unmapped requirements never appear in client lists, search, counts, exports, or direct API access.
 * - Vendor: sees active ('open') requirements shared with their vendor org (or eligible for vendor sourcing).
 *   Client mapping (isClientMapped === false) NEVER restricts eligible vendor visibility.
 */
export function evaluateRequirementAccess(params: {
  requirement: Pick<Requirement, 'id' | 'status' | 'is_public' | 'currency' | 'vendor_visible_budget' | 'client_org_id'>;
  viewerRole: AppRole;
  viewerOrgId?: string | null;
  sharedVendorOrgIds?: string[];
}): { allowed: boolean; reason: string; isClientMapped: boolean; mappedClientOrgId: string | null } {
  const { requirement, viewerRole, viewerOrgId, sharedVendorOrgIds } = params;
  const meta = parseRequirementMeta(requirement);

  if (viewerRole === 'admin' || viewerRole === 'recruiter') {
    return {
      allowed: true,
      reason: 'HQ role has full visibility across internal/unmapped and client-mapped requirements.',
      isClientMapped: meta.isClientMapped,
      mappedClientOrgId: meta.mappedClientOrgId,
    };
  }

  if (viewerRole === 'client_manager' || viewerRole === 'client_member') {
    if (!meta.isClientMapped || !meta.mappedClientOrgId) {
      return {
        allowed: false,
        reason: 'Requirement is internal/unmapped and hidden from client portals.',
        isClientMapped: false,
        mappedClientOrgId: null,
      };
    }
    if (!viewerOrgId || meta.mappedClientOrgId !== viewerOrgId) {
      return {
        allowed: false,
        reason: 'Requirement is mapped to a different client organization.',
        isClientMapped: meta.isClientMapped,
        mappedClientOrgId: meta.mappedClientOrgId,
      };
    }
    return {
      allowed: true,
      reason: 'Requirement is explicitly mapped to caller client organization.',
      isClientMapped: true,
      mappedClientOrgId: meta.mappedClientOrgId,
    };
  }

  if (viewerRole === 'vendor_admin' || viewerRole === 'vendor_recruiter') {
    // Vendors see eligible, active ('open'), published/shared requirements permitted for vendor sourcing.
    // Client mapping must NOT restrict eligible vendor visibility.
    const isActiveForSourcing = requirement.status === 'open';
    const isPermittedForVendor =
      !sharedVendorOrgIds ||
      (viewerOrgId ? sharedVendorOrgIds.includes(viewerOrgId) : false);

    if (isActiveForSourcing && isPermittedForVendor) {
      return {
        allowed: true,
        reason: 'Requirement is open and permitted for vendor sourcing (independent of client mapping).',
        isClientMapped: meta.isClientMapped,
        mappedClientOrgId: meta.mappedClientOrgId,
      };
    }
    return {
      allowed: false,
      reason: 'Requirement is not open or not shared with this vendor organization.',
      isClientMapped: meta.isClientMapped,
      mappedClientOrgId: meta.mappedClientOrgId,
    };
  }

  if (viewerRole === 'candidate') {
    const allowed = requirement.status === 'open' && Boolean(requirement.is_public);
    return {
      allowed,
      reason: allowed ? 'Public open job.' : 'Not published to public job board.',
      isClientMapped: meta.isClientMapped,
      mappedClientOrgId: meta.mappedClientOrgId,
    };
  }

  return {
    allowed: false,
    reason: 'Pending or unauthorized role.',
    isClientMapped: meta.isClientMapped,
    mappedClientOrgId: meta.mappedClientOrgId,
  };
}

// ============================================================================
// UPDATE 3: Trial Period, Expiry Alerts (15d, 10d, 5d, 1d) & Purchase Flow
// ============================================================================

export type SubscriptionStatus = 'trialing' | 'active' | 'expired' | 'past_due' | 'canceled';
export type PlanId = 'free_trial' | 'growth' | 'scale' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type ReminderMilestone = '15d' | '10d' | '5d' | '1d';

export interface SubscriptionPlanDefinition {
  id: Exclude<PlanId, 'free_trial'>;
  name: string;
  tagline: string;
  monthlyPriceInr: number;
  annualPriceInr: number;
  gstPercent: number;
  features: string[];
}

export const SUBSCRIPTION_PLANS: SubscriptionPlanDefinition[] = [
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For growing staffing teams and mid-market hiring organizations.',
    monthlyPriceInr: 24000,
    annualPriceInr: 240000,
    gstPercent: 18,
    features: [
      'Up to 25 active requirements with LPA & LPM budget governance',
      'Explicit client mapping & vendor SLA countdown tracking',
      'Deterministic skill & experience matching engine',
      'Standard email & in-app notification alerts',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'Full multi-vendor governance, 6D quality scorecards, and AI copilot.',
    monthlyPriceInr: 49000,
    annualPriceInr: 490000,
    gstPercent: 18,
    features: [
      'Unlimited active requirements, vendor shares & pipeline submissions',
      'Three-pillar vendor scorecards & 6-dimension candidate quality rubrics',
      'Guarded AI JD editor, skill extractor & interview question architect',
      'Rating dispute workflow & recruiter match score overrides',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Multi-entity staffing governance with custom margins and audit exports.',
    monthlyPriceInr: 95000,
    annualPriceInr: 950000,
    gstPercent: 18,
    features: [
      'Everything in Scale plus platform margin governance (fixed & %)',
      'Cross-tenant compliance controls & full JSON audit trail inspection',
      'Dedicated enterprise SLA tier & priority onboarding',
      'Custom billing terms & GST invoice ledger',
    ],
  },
];

export const REMINDER_MILESTONE_SPECS: Record<
  ReminderMilestone,
  {
    milestone: ReminderMilestone;
    daysRemaining: number;
    badgeLabel: string;
    title: string;
    message: string;
    urgency: 'info' | 'warning' | 'danger';
  }
> = {
  '15d': {
    milestone: '15d',
    daysRemaining: 15,
    badgeLabel: '15 days remaining',
    title: '15 days remaining in your HireNestOS trial',
    message: 'Early reminder to review plans and upgrade before your trial period concludes.',
    urgency: 'info',
  },
  '10d': {
    milestone: '10d',
    daysRemaining: 10,
    badgeLabel: '10 days remaining',
    title: '10 days remaining — continue with a paid plan',
    message:
      'Continue uninterrupted access to deterministic candidate matching, vendor SLA tracking, and structured interview rubrics with a paid plan.',
    urgency: 'info',
  },
  '5d': {
    milestone: '5d',
    daysRemaining: 5,
    badgeLabel: '5 days remaining',
    title: 'Urgent: 5 days remaining in your trial',
    message:
      'Your workspace trial ends in 5 days. Upgrade now to avoid restrictions on creating new requirements and submitting candidates.',
    urgency: 'warning',
  },
  '1d': {
    milestone: '1d',
    daysRemaining: 1,
    badgeLabel: 'Last day',
    title: 'Action required: Your HireNestOS trial expires today',
    message:
      'Your trial expires today. Complete your plan purchase now so your team retains uninterrupted write access.',
    urgency: 'danger',
  },
};

/**
 * Timezone-safe UTC calendar-day calculation from authoritative server timestamps.
 * Never relies on browser local timezone offset.
 */
export function computeServerTrialDaysRemaining(
  serverNowIso: string,
  trialEndsAtIso: string | null | undefined
): number {
  if (!trialEndsAtIso) return 0;
  const nowMs = Date.parse(serverNowIso);
  const endMs = Date.parse(trialEndsAtIso);
  if (Number.isNaN(nowMs) || Number.isNaN(endMs)) return 0;
  if (nowMs >= endMs) return 0;

  const nowDate = new Date(nowMs);
  const endDate = new Date(endMs);
  const utcNowDay = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate()
  );
  const utcEndDay = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate()
  );

  const diffDays = Math.round((utcEndDay - utcNowDay) / 86_400_000);
  // If expires later today (diffDays === 0 but nowMs < endMs), treat as 1 (Last day)
  return Math.max(1, diffDays);
}

export function getMilestoneForDaysRemaining(daysRemaining: number): ReminderMilestone | null {
  if (daysRemaining === 15) return '15d';
  if (daysRemaining === 10) return '10d';
  if (daysRemaining === 5) return '5d';
  if (daysRemaining === 1) return '1d';
  return null;
}

export function computePlanPricingWithTax(
  planId: Exclude<PlanId, 'free_trial'>,
  billingCycle: BillingCycle
): {
  plan: SubscriptionPlanDefinition;
  billingCycle: BillingCycle;
  baseAmountInr: number;
  gstPercent: number;
  gstAmountInr: number;
  totalAmountInr: number;
  annualSavingsInr: number;
} {
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId) || SUBSCRIPTION_PLANS[0];
  const baseAmountInr =
    billingCycle === 'annual' ? plan.annualPriceInr : plan.monthlyPriceInr;
  const gstAmountInr = Math.round((baseAmountInr * plan.gstPercent) / 100);
  const totalAmountInr = baseAmountInr + gstAmountInr;
  const annualSavingsInr = plan.monthlyPriceInr * 12 - plan.annualPriceInr;

  return {
    plan,
    billingCycle,
    baseAmountInr,
    gstPercent: plan.gstPercent,
    gstAmountInr,
    totalAmountInr,
    annualSavingsInr,
  };
}
