import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CreditCard,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Receipt,
} from 'lucide-react';
import {
  PageHeader,
  MetricStrip,
  Button,
  Badge,
  Dialog,
  Input,
  Select,
  TableSkeleton,
  ErrorState,
} from '../../components/ui/kit';
import {
  fetchSubscriptionDashboard,
  createSubscriptionCheckoutOrder,
  verifySubscriptionPayment,
  type PaymentReceiptDto,
} from '../../api/subscriptions';
import {
  type BillingCycle,
  type PlanId,
  SUBSCRIPTION_PLANS,
  computePlanPricingWithTax,
} from '../../lib/enterpriseLifecycle';
import { formatLocalDate, formatLocalDateTime } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/ui/Toast';

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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const role = profile?.role || 'vendor_admin';
  const accountId = organization?.id || profile?.org_id || 'default_hirenest_account';
  const accountName = organization?.name || 'HireNest Workspace';

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [showBetaPricing, setShowBetaPricing] = useState(false);
  const [selectedPlanForCheckout, setSelectedPlanForCheckout] = useState<
    Exclude<PlanId, 'free_trial'> | null
  >(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('Corporate Card (Visa / Mastercard)');
  const [billingContactEmail, setBillingContactEmail] = useState<string>(
    profile?.email || 'billing@enterprise.in'
  );
  const [gstinInput, setGstinInput] = useState<string>('');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [latestReceipt, setLatestReceipt] = useState<PaymentReceiptDto | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['subscription_dashboard', accountId],
    queryFn: () => fetchSubscriptionDashboard({ accountId }),
  });

  if (isLoading || !data) {
    return <TableSkeleton rows={6} cols={4} />;
  }

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Could not load subscription status'}
        onRetry={() => refetch()}
      />
    );
  }

  const { subscription, daysRemaining, entitlements, receipts } = data;
  const isExpired = subscription.subscriptionStatus === 'expired';
  const isPaidActive = subscription.subscriptionStatus === 'active';

  const currentPlanLabel =
    subscription.planId === 'free_trial'
      ? 'Free Trial'
      : SUBSCRIPTION_PLANS.find((p) => p.id === subscription.planId)?.name || subscription.planId;

  const refreshSubscriptionState = () => {
    queryClient.invalidateQueries({ queryKey: ['subscription_dashboard'] });
  };

  const handleCompleteVerifiedCheckout = async () => {
    if (!selectedPlanForCheckout) return;
    setProcessingPayment(true);
    try {
      const orderRes = await createSubscriptionCheckoutOrder({
        accountId,
        accountName,
        planId: selectedPlanForCheckout,
        billingCycle,
      });

      const verifyRes = await verifySubscriptionPayment({
        accountId,
        accountName,
        orderId: orderRes.checkoutSession.orderId,
        paymentId: orderRes.checkoutSession.paymentId,
        signature: orderRes.checkoutSession.signature,
        paymentMethod,
      });

      setSelectedPlanForCheckout(null);
      setLatestReceipt(verifyRes.receipt);
      refreshSubscriptionState();

      toast({
        title: 'Payment verified & subscription activated',
        description: `${verifyRes.receipt.planName} Plan (${verifyRes.receipt.billingCycle}) is now active. Invoice ${verifyRes.receipt.invoiceNumber} generated.`,
        tone: 'success',
      });
    } catch (err) {
      toast({
        title: 'Payment verification failed',
        description: err instanceof Error ? err.message : 'Could not verify payment',
        tone: 'error',
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  const activeCheckoutPricing = selectedPlanForCheckout
    ? computePlanPricingWithTax(selectedPlanForCheckout, billingCycle)
    : null;

  const isVendor = role === 'vendor_admin' || role === 'vendor_recruiter';
  const isClient = role === 'client_manager' || role === 'client_member';
  const roleLabel = isVendor ? 'Vendor' : isClient ? 'Client' : 'Organisation';

  return (
    <div className="space-y-8">
      <PageHeader
        title="Plans & pricing"
        description={`Choose the right plan for your ${roleLabel.toLowerCase()} organisation. All prices exclude 18% GST.`}
        actions={
          <div className="flex items-center gap-2">
            {!isPaidActive && (
              <Button onClick={() => setSelectedPlanForCheckout('scale')}>
                <CreditCard className="h-3.5 w-3.5" />
                Upgrade Now
              </Button>
            )}
            {isPaidActive && (
              <Button variant="outline" onClick={() => setSelectedPlanForCheckout('enterprise')}>
                Change Plan
              </Button>
            )}
          </div>
        }
      />

      {/* Expiry Alert Banner */}
      {isExpired && (
        <div className="rounded-[10px] border border-[var(--status-danger)] bg-[var(--status-danger-bg)] p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2 text-[14px] leading-[20px] font-semibold text-[var(--status-danger)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Trial expired - Workspace is in restricted read-only state</span>
            </div>
            <p className="text-[13px] leading-[20px] text-[var(--text-primary)]">
              {entitlements.restrictionReason} All existing data remains safely preserved. Upgrade to restore full access.
            </p>
          </div>
          <Button onClick={() => setSelectedPlanForCheckout('scale')}>
            Upgrade Now
          </Button>
        </div>
      )}

      {/* Current Status Strip */}
      <MetricStrip
        items={[
          {
            label: 'Current plan',
            value: currentPlanLabel,
          },
          {
            label: 'Status',
            value: subscription.subscriptionStatus.toUpperCase(),
            tone: isPaidActive ? 'default' : isExpired ? 'danger' : 'warning',
          },
          {
            label: 'Days remaining',
            value: isPaidActive ? 'Active (Paid)' : `${daysRemaining}d`,
            tone: !isPaidActive && daysRemaining <= 5 ? 'danger' : 'default',
          },
          {
            label: 'Payment status',
            value: isPaidActive ? 'Paid' : 'Free trial',
          },
        ]}
      />

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
          <div className="rounded-[10px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 space-y-2">
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
            const isCurrentPaidPlan = isPaidActive && subscription.planId === plan.id;
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
                className={`rounded-[10px] border p-5 flex flex-col justify-between gap-6 ${
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
                    {isCurrentPaidPlan ? (
                      <Badge tone="emerald">Current Plan</Badge>
                    ) : isRecommended ? (
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
                  variant={isRecommended ? 'primary' : 'outline'}
                  disabled={isCurrentPaidPlan}
                  onClick={() => setSelectedPlanForCheckout(plan.id)}
                  className="w-full"
                >
                  {isCurrentPaidPlan
                    ? 'Current Plan'
                    : plan.id === 'enterprise'
                      ? 'Contact Sales'
                      : `Choose ${plan.name}`}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment Receipts */}
      {(receipts.length > 0 || latestReceipt) && (
        <div className="space-y-3">
          <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Payment history & GST invoices
          </h2>
          <div className="overflow-x-auto border-t border-[var(--border)] bg-[var(--surface)] rounded-[8px]">
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Plan & cycle</th>
                  <th className="text-right">Base amount</th>
                  <th className="text-right">GST (18%)</th>
                  <th className="text-right">Total paid</th>
                  <th>Paid at</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((rcpt) => (
                  <tr key={rcpt.receiptId}>
                    <td className="font-mono font-medium text-[var(--text-primary)]">
                      {rcpt.invoiceNumber}
                    </td>
                    <td className="capitalize">
                      {rcpt.planName} ({rcpt.billingCycle})
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {formatInr(rcpt.baseAmountInr)}
                    </td>
                    <td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {formatInr(rcpt.gstAmountInr)}
                    </td>
                    <td className="text-right font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                      {formatInr(rcpt.totalAmountInr)}
                    </td>
                    <td className="font-mono tabular-nums text-[12px] text-[var(--text-tertiary)]">
                      {formatLocalDateTime(rcpt.paidAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Checkout Modal */}
      <Dialog
        open={Boolean(selectedPlanForCheckout && activeCheckoutPricing)}
        onClose={() => setSelectedPlanForCheckout(null)}
        title="Complete plan purchase"
        description="Secure payment processed and verified server-side."
        maxWidth="max-w-[520px]"
      >
        {activeCheckoutPricing && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {activeCheckoutPricing.plan.name} Plan ({activeCheckoutPricing.billingCycle})
                </span>
                {showBetaPricing && <Badge tone="sky">Beta Partner</Badge>}
              </div>
              <div className="divide-y divide-[var(--border)] text-[13px] pt-1">
                <div className="py-1.5 flex justify-between">
                  <span className="text-[var(--text-secondary)]">Base price</span>
                  <span className="font-mono tabular-nums text-[var(--text-primary)]">
                    {formatInr(activeCheckoutPricing.baseAmountInr)}
                  </span>
                </div>
                <div className="py-1.5 flex justify-between">
                  <span className="text-[var(--text-secondary)]">
                    GST ({activeCheckoutPricing.gstPercent}%)
                  </span>
                  <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                    {formatInr(activeCheckoutPricing.gstAmountInr)}
                  </span>
                </div>
                <div className="py-2 flex justify-between font-semibold text-[14px]">
                  <span className="text-[var(--text-primary)]">Total payable</span>
                  <span className="font-mono tabular-nums text-[var(--text-primary)]">
                    {formatInr(activeCheckoutPricing.totalAmountInr)}
                  </span>
                </div>
              </div>
            </div>

            <Select
              label="Payment method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              options={[
                {
                  value: 'Corporate Card (Visa / Mastercard)',
                  label: 'Corporate Card (Visa / Mastercard)',
                },
                { value: 'UPI / NEFT', label: 'UPI / NEFT' },
                { value: 'NetBanking', label: 'NetBanking' },
              ]}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Billing email"
                type="email"
                value={billingContactEmail}
                onChange={(e) => setBillingContactEmail(e.target.value)}
              />
              <Input
                label="Company GSTIN (optional)"
                value={gstinInput}
                onChange={(e) => setGstinInput(e.target.value)}
                placeholder="e.g. 29AABCH9876F1Z5"
              />
            </div>

            <div className="rounded-[6px] border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text-secondary)] flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--status-success)] shrink-0" />
              <span>
                Payment is securely processed and verified server-side before activating your subscription.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="outline" onClick={() => setSelectedPlanForCheckout(null)}>
                Cancel
              </Button>
              <Button onClick={handleCompleteVerifiedCheckout} loading={processingPayment}>
                Pay {formatInr(activeCheckoutPricing.totalAmountInr)}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Payment Confirmation Receipt Dialog */}
      <Dialog
        open={Boolean(latestReceipt)}
        onClose={() => setLatestReceipt(null)}
        title="Payment confirmed"
        description="Your subscription is now active."
      >
        {latestReceipt && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-2 text-[13px]">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Receipt className="h-4 w-4 text-[var(--status-success)]" />
                  Invoice {latestReceipt.invoiceNumber}
                </span>
                <Badge tone="emerald">PAID</Badge>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--text-secondary)]">Account</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {latestReceipt.accountName}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--text-secondary)]">Plan & billing cycle</span>
                <span className="font-medium capitalize text-[var(--text-primary)]">
                  {latestReceipt.planName} ({latestReceipt.billingCycle})
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--text-secondary)]">Base amount</span>
                <span className="font-mono tabular-nums">
                  {formatInr(latestReceipt.baseAmountInr)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--text-secondary)]">
                  GST ({latestReceipt.gstPercent}%)
                </span>
                <span className="font-mono tabular-nums">
                  {formatInr(latestReceipt.gstAmountInr)}
                </span>
              </div>
              <div className="flex justify-between py-1 font-semibold border-t border-[var(--border)] pt-2">
                <span className="text-[var(--text-primary)]">Total paid</span>
                <span className="font-mono tabular-nums">
                  {formatInr(latestReceipt.totalAmountInr)}
                </span>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setLatestReceipt(null)}>Done</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
