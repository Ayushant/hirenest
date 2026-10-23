import { supabase } from '../lib/supabase';
import type {
  BillingCycle,
  PlanId,
  ReminderMilestone,
  SubscriptionPlanDefinition,
  SubscriptionStatus,
} from '../lib/enterpriseLifecycle';

export interface AccountSubscriptionDto {
  accountId: string;
  accountName: string;
  planId: PlanId;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  trialDurationDays: number;
  trialStartedAt: string;
  trialEndsAt: string;
  paidActivatedAt: string | null;
  currentPeriodEndsAt: string | null;
  updatedAt: string;
}

export interface SubscriptionEntitlementsDto {
  canWriteRequirements: boolean;
  canSubmitCandidates: boolean;
  canScheduleInterviews: boolean;
  canExportReports: boolean;
  isReadOnlyRestricted: boolean;
  restrictionReason: string | null;
}

export interface ReminderDeliveryDto {
  id: string;
  accountId: string;
  milestone: ReminderMilestone;
  daysRemaining: number;
  dedupeKey: string;
  title: string;
  message: string;
  urgency: 'info' | 'warning' | 'danger';
  channels: Array<'in_app' | 'email'>;
  deliveredAt: string;
  acknowledgedAt: string | null;
}

export interface PaymentReceiptDto {
  receiptId: string;
  invoiceNumber: string;
  orderId: string;
  paymentId: string;
  accountId: string;
  accountName: string;
  planId: Exclude<PlanId, 'free_trial'>;
  planName: string;
  billingCycle: BillingCycle;
  baseAmountInr: number;
  gstPercent: number;
  gstAmountInr: number;
  totalAmountInr: number;
  currency: 'INR';
  paymentMethod: string;
  verifiedSignaturePrefix: string;
  paidAt: string;
}

export interface SubscriptionDashboardResponse {
  serverNow: string;
  subscription: AccountSubscriptionDto;
  daysRemaining: number;
  entitlements: SubscriptionEntitlementsDto;
  reminders: ReminderDeliveryDto[];
  receipts: PaymentReceiptDto[];
  plans: SubscriptionPlanDefinition[];
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchSubscriptionDashboard(params?: {
  accountId?: string | null;
}): Promise<SubscriptionDashboardResponse> {
  const headers = await getAuthHeaders();
  const qs = params?.accountId ? `?accountId=${encodeURIComponent(params.accountId)}` : '';
  const res = await fetch(`/api/subscriptions/status${qs}`, {
    method: 'GET',
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load subscription status.');
  }
  return res.json();
}

export async function activateOrConfigureTrial(params: {
  accountId?: string | null;
  accountName?: string;
  trialDurationDays: number;
  simulateDaysRemaining?: number;
}): Promise<{
  ok: boolean;
  serverNow: string;
  subscription: AccountSubscriptionDto;
  daysRemaining: number;
  entitlements: SubscriptionEntitlementsDto;
  newlyTriggeredReminders: ReminderDeliveryDto[];
  reminders: ReminderDeliveryDto[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/subscriptions/trial/activate', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to configure trial.');
  }
  return res.json();
}

export async function triggerExpiryRemindersJob(params?: {
  accountId?: string | null;
  simulatedServerNow?: string;
}): Promise<{
  ok: boolean;
  serverNow: string;
  checkedAccounts: number;
  triggeredCount: number;
  triggered: ReminderDeliveryDto[];
  reminders: ReminderDeliveryDto[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/subscriptions/reminders/run', {
    method: 'POST',
    headers,
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to run expiry reminder check.');
  }
  return res.json();
}

export async function createSubscriptionCheckoutOrder(params: {
  accountId?: string | null;
  accountName?: string;
  planId: Exclude<PlanId, 'free_trial'>;
  billingCycle: BillingCycle;
}): Promise<{
  order: {
    orderId: string;
    accountId: string;
    planId: Exclude<PlanId, 'free_trial'>;
    billingCycle: BillingCycle;
    baseAmountInr: number;
    gstPercent: number;
    gstAmountInr: number;
    totalAmountInr: number;
    currency: 'INR';
    status: string;
    createdAt: string;
  };
  checkoutSession: {
    orderId: string;
    paymentId: string;
    signature: string;
    merchantName: string;
  };
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/subscriptions/checkout/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not initiate checkout order.');
  }
  return res.json();
}

export async function verifySubscriptionPayment(params: {
  accountId?: string | null;
  accountName?: string;
  orderId: string;
  paymentId: string;
  signature: string;
  paymentMethod: string;
}): Promise<{
  verified: boolean;
  receipt: PaymentReceiptDto;
  subscription: AccountSubscriptionDto;
  entitlements: SubscriptionEntitlementsDto;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/subscriptions/checkout/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.verified) {
    throw new Error(data.error || 'Payment verification failed on server.');
  }
  return data;
}
