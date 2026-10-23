export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'past_due' | 'cancelled';
export type PlanId = 'starter' | 'growth' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type BudgetUnit = 'LPA' | 'LPM';
export type BudgetType = 'fixed' | 'range';

export interface PlanFeature {
  name: string;
  included: boolean;
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  tagline: string;
  priceMonthly: number; // in INR
  priceAnnualMonthlyEquivalent: number; // in INR
  annualTotal: number;
  openRequirementsLimit: number | 'unlimited';
  features: string[];
  isPopular?: boolean;
}

export interface SubscriptionInvoice {
  id: string;
  invoiceNumber: string;
  date: string;
  planId: PlanId;
  planName: string;
  billingCycle: BillingCycle;
  subtotal: number;
  taxAmount: number; // 18% GST
  total: number;
  currency: string;
  paymentMethod: string;
  status: 'paid' | 'failed' | 'refunded';
  receiptUrl?: string;
}

export interface OrganizationSubscription {
  organizationId: string;
  organizationName: string;
  planId: PlanId;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  trialStartedAt: string;
  trialEndsAt: string;
  daysRemaining: number;
  isTrial: boolean;
  isExpired: boolean;
  activeUntil: string;
  lastPaymentDate: string | null;
  invoices: SubscriptionInvoice[];
  paymentConfirmationNumber?: string | null;
}

export interface ExpiryReminderNotification {
  id: string;
  organizationId: string;
  milestone: '15_days' | '10_days' | '5_days' | '1_day' | 'expired';
  title: string;
  message: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  sentAt: string;
  readAt?: string | null;
}

export interface RequirementBudgetDetails {
  budget_type: BudgetType;
  budget_min: number | null;
  budget_max: number | null;
  budget_unit: BudgetUnit;
  display_text: string;
}

export interface RequirementClientMapping {
  requirement_id: string;
  client_org_id: string | null;
  client_name?: string | null;
  client_mapped: boolean;
  mapped_at: string | null;
  mapped_by: string | null;
}
