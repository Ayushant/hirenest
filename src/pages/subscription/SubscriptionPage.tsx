import React, { useState, useEffect } from 'react';
import {
  Check,
  Sparkles,
  Mail,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import {
  PageHeader,
  MetricStrip,
  Button,
  Badge,
  TableSkeleton,
} from '../../components/ui/kit';
import {
  type BillingCycle,
  SUBSCRIPTION_PLANS,
  computePlanPricingWithTax,
} from '../../lib/enterpriseLifecycle';
import { useAuth } from '../../auth/AuthProvider';
import { supabase } from '../../lib/supabase';

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const BETA_PARTNER_PRICES: Record<string, { monthly: number; annual: number }> = {
  growth: { monthly: 2999, annual: 35988 },
  scale: { monthly: 5999, annual: 71988 },
  enterprise: { monthly: 19999, annual: 199990 },
};

export const SubscriptionPage: React.FC = () => {
  const { profile, organization } = useAuth();
  const role = profile?.role || 'vendor_admin';
  const orgId = organization?.id || profile?.org_id || 'default_hirenest_account';

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [showBetaPricing, setShowBetaPricing] = useState(false);
  const [trialInfo, setTrialInfo] = useState<{ daysRemaining: number; isExpired: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const DEFAULT_TRIAL_DAYS = 14;

  useEffect(() => {
    async function loadTrialStatus() {
      try {
        const { data } = await supabase
          .from('organizations')
          .select('created_at, trial_ends_at')
          .eq('id', orgId)
          .maybeSingle();

        if (data) {
          const now = Date.now();
          const createdAt = new Date(data.created_at).getTime();
          const trialEnd = data.trial_ends_at
            ? new Date(data.trial_ends_at).getTime()
            : createdAt + DEFAULT_TRIAL_DAYS * 86_400_000;
          const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / 86_400_000));
          setTrialInfo({ daysRemaining, isExpired: daysRemaining === 0 });
        } else {
          setTrialInfo({ daysRemaining: DEFAULT_TRIAL_DAYS, isExpired: false });
        }
      } catch {
        setTrialInfo({ daysRemaining: DEFAULT_TRIAL_DAYS, isExpired: false });
      } finally {
        setLoading(false);
      }
    }
    loadTrialStatus();
  }, [orgId]);

  const isVendor = role === 'vendor_admin' || role === 'vendor_recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const roleLabel = isVendor ? 'Vendor' : isClient ? 'Client' : 'Organisation';

  const daysRemaining = trialInfo?.daysRemaining ?? DEFAULT_TRIAL_DAYS;
  const isExpired = trialInfo?.isExpired ?? false;
  const statusLabel = isExpired ? 'EXPIRED' : 'TRIALING';
  const statusTone = isExpired ? 'danger' : daysRemaining <= 5 ? 'danger' : 'warning';

  if (loading) return <TableSkeleton rows={4} cols={3} />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Plans & pricing"
        description={`Explore plans for your ${roleLabel.toLowerCase()} organisation. Contact admin to activate or upgrade your subscription.`}
      />

      {/* Expiry Alert */}
      {isExpired && (
        <div className="rounded-[12px] border border-[var(--status-danger)] bg-[var(--status-danger-bg)] p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-[var(--status-danger)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[14px] leading-[20px] font-semibold text-[var(--status-danger)]">
              Trial expired: workspace is in restricted read-only state
            </p>
            <p className="text-[13px] leading-[20px] text-[var(--text-primary)]">
              Contact your platform admin to activate a paid subscription and restore full access.
            </p>
          </div>
        </div>
      )}

      {/* Current Status Strip */}
      <MetricStrip
        items={[
          {
            label: 'Current plan',
            value: 'Free Trial',
          },
          {
            label: 'Status',
            value: statusLabel,
            tone: statusTone as 'default' | 'danger' | 'warning',
          },
          {
            label: 'Days remaining',
            value: isExpired ? '0 days' : `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`,
            tone: isExpired ? 'danger' : daysRemaining <= 5 ? 'danger' : daysRemaining <= 7 ? 'warning' : 'default',
          },
          {
            label: 'Managed by',
            value: 'Platform Admin',
          },
        ]}
      />

      {/* Admin-controlled notice */}
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 flex items-start gap-3">
        <Mail className="h-5 w-5 text-[var(--accent)] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
            Subscriptions are managed by the platform admin
          </p>
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
            To upgrade your plan, contact your HireNestOS admin. They will activate the subscription for your organisation.
            Direct purchases are not available. All billing is handled centrally.
          </p>
        </div>
      </div>

      {/* Plans Section */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              Available plans
            </h2>
            <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
              Prices exclude 18% GST. Annual billing is paid upfront for 12 months.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Beta Partner Toggle */}
            <button
              type="button"
              onClick={() => setShowBetaPricing(!showBetaPricing)}
              className={`px-3 py-1.5 rounded-[6px] text-[12px] leading-[16px] font-medium border transition-colors cursor-pointer ${
                showBetaPricing
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sparkles className="h-3 w-3 inline-block mr-1 -mt-0.5" />
              Beta Partner Pricing
            </button>

            {/* Billing Cycle Toggle */}
            <div className="inline-flex rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`px-3 py-1.5 rounded-[6px] text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                  billingCycle === 'monthly'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('annual')}
                className={`px-3 py-1.5 rounded-[6px] text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                  billingCycle === 'annual'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Annual (Save ~20%)
              </button>
            </div>
          </div>
        </div>

        {/* Beta Partner Info Banner */}
        {showBetaPricing && (
          <div className="rounded-[12px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
              Beta Partner Programme
            </div>
            <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
              Founding-partner pricing for the first batch of vendors and clients. Includes a 30-day beta evaluation period.
              Beta pricing is locked for 12 months after paid conversion. Feedback and product improvement participation expected.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const pricing = computePlanPricingWithTax(plan.id, billingCycle);
            const isRecommended = plan.id === 'scale';
            const betaPrices = BETA_PARTNER_PRICES[plan.id];

            const displayPrice = showBetaPricing && betaPrices
              ? billingCycle === 'annual' ? betaPrices.annual : betaPrices.monthly
              : pricing.baseAmountInr;
            const displayGst = Math.round((displayPrice * 18) / 100);
            const displayTotal = displayPrice + displayGst;

            const normalPrice = pricing.baseAmountInr;
            const hasDiscount = showBetaPricing && betaPrices && displayPrice < normalPrice;

            return (
              <div
                key={plan.id}
                className={`rounded-[12px] border p-5 flex flex-col justify-between gap-6 ${
                  isRecommended
                    ? 'border-[var(--accent)] bg-[var(--surface)] shadow-2xs'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[16px] leading-[24px] font-semibold text-[var(--text-primary)]">
                      {plan.name}
                    </h3>
                    {isRecommended ? (
                      <Badge tone="sky">Most Popular</Badge>
                    ) : null}
                  </div>
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    {plan.tagline}
                  </p>

                  <div className="pt-2 border-t border-[var(--border)]">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono tabular-nums text-[24px] leading-[32px] font-semibold text-[var(--text-primary)]">
                        {formatInr(displayPrice)}
                      </span>
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        / {billingCycle === 'annual' ? 'year' : 'month'}
                      </span>
                    </div>
                    {hasDiscount && (
                      <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5 line-through">
                        Standard: {formatInr(normalPrice)} / {billingCycle === 'annual' ? 'year' : 'month'}
                      </div>
                    )}
                    <div className="text-[12px] font-mono tabular-nums text-[var(--text-tertiary)] mt-0.5">
                      + 18% GST = {formatInr(displayTotal)} total
                      {billingCycle === 'annual' && (
                        <span> · {formatInr(Math.round(displayPrice / 12))}/mo equiv.</span>
                      )}
                    </div>
                  </div>

                  <ul className="space-y-2 pt-2">
                    {plan.features.map((feat) => (
                      <li
                        key={feat}
                        className="flex items-start gap-2 text-[13px] leading-[18px] text-[var(--text-primary)]"
                      >
                        <Check className="h-4 w-4 text-[var(--status-success)] shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  disabled
                >
                  <Mail className="h-3.5 w-3.5" />
                  Contact Admin to Upgrade
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
