import React, { useState } from 'react';
import {
  Check,
  CreditCard,
  Building2,
  Users,
  Clock,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import {
  PageHeader,
  MetricStrip,
  Button,
  Badge,
} from '../../components/ui/kit';
import {
  type BillingCycle,
  SUBSCRIPTION_PLANS,
  computePlanPricingWithTax,
} from '../../lib/enterpriseLifecycle';

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

export const AdminSubscriptionPage: React.FC = () => {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [showBetaPricing, setShowBetaPricing] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Subscription management"
        description="Manage subscription plans for vendor and client organisations. You control all billing centrally."
      />

      {/* Overview Metrics */}
      <MetricStrip
        items={[
          {
            label: 'Total organisations',
            value: '—',
          },
          {
            label: 'Active subscriptions',
            value: '0',
          },
          {
            label: 'On free trial',
            value: '—',
          },
          {
            label: 'Revenue (MTD)',
            value: '—',
          },
        ]}
      />

      {/* Info Banner */}
      <div className="rounded-[10px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 flex items-start gap-3">
        <CreditCard className="h-5 w-5 text-[var(--accent)] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
            Centralised billing control
          </p>
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
            As the platform owner, you manage all subscriptions. Vendors and clients can view pricing but cannot purchase directly.
            When payment gateway integration is live, you'll activate subscriptions for organisations from this page.
          </p>
        </div>
      </div>

      {/* Organisation Subscription Table (placeholder) */}
      <div className="space-y-3">
        <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Organisation subscriptions
        </h2>
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Type</th>
                <th>Current plan</th>
                <th>Status</th>
                <th>Trial ends</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} className="text-center py-8 text-[var(--text-tertiary)]">
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="h-8 w-8 text-[var(--border)]" />
                    <p className="text-[13px]">
                      Organisation subscription data will populate here once organisations are onboarded.
                    </p>
                    <p className="text-[12px]">
                      Go to <span className="font-medium text-[var(--text-secondary)]">Governance &gt; Organizations</span> to manage organisations.
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Plan Reference Cards */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              Plan catalogue
            </h2>
            <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
              Reference pricing for all plans. Prices exclude 18% GST.
            </p>
          </div>

          <div className="flex items-center gap-3">
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

        {showBetaPricing && (
          <div className="rounded-[10px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
              Beta Partner Programme
            </div>
            <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
              Founding-partner pricing for the first batch of vendors and clients. Includes a 30-day beta evaluation period.
              Beta pricing is locked for 12 months after paid conversion.
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
                className={`rounded-[10px] border p-5 flex flex-col gap-4 ${
                  isRecommended
                    ? 'border-[var(--accent)] bg-[var(--surface)] shadow-2xs'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[16px] leading-[24px] font-semibold text-[var(--text-primary)]">
                    {plan.name}
                  </h3>
                  {isRecommended && <Badge tone="sky">Most Popular</Badge>}
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
            );
          })}
        </div>
      </div>
    </div>
  );
};
