import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Clock,
  CreditCard,
  ShieldCheck,
  AlertTriangle,
  BellRing,
  Sparkles,
  Receipt,
  RefreshCw,
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
  activateOrConfigureTrial,
  triggerExpiryRemindersJob,
  createSubscriptionCheckoutOrder,
  verifySubscriptionPayment,
  type PaymentReceiptDto,
} from '../../api/subscriptions';
import {
  type BillingCycle,
  type PlanId,
  REMINDER_MILESTONE_SPECS,
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

export const SubscriptionPage: React.FC = () => {
  const { profile, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const role = profile?.role || 'admin';
  const isAdmin = role === 'admin';
  const accountId = organization?.id || profile?.org_id || 'default_hirenest_account';
  const accountName = organization?.name || 'HireNest Enterprise Workspace';

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual');
  const [selectedPlanForCheckout, setSelectedPlanForCheckout] = useState<
    Exclude<PlanId, 'free_trial'> | null
  >(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('Corporate Card (Visa / Mastercard)');
  const [billingContactEmail, setBillingContactEmail] = useState<string>(
    profile?.email || 'billing@enterprise.in'
  );
  const [gstinInput, setGstinInput] = useState<string>('29AABCH9876F1Z5');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [latestReceipt, setLatestReceipt] = useState<PaymentReceiptDto | null>(null);

  // Admin Trial Configuration state
  const [trialDurationInput, setTrialDurationInput] = useState<number>(15);
  const [configuringTrial, setConfiguringTrial] = useState(false);
  const [runningReminderJob, setRunningReminderJob] = useState(false);

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

  const { subscription, daysRemaining, entitlements, reminders, receipts, plans } = data;
  const isTrialing = subscription.subscriptionStatus === 'trialing';
  const isExpired = subscription.subscriptionStatus === 'expired';
  const isPaidActive = subscription.subscriptionStatus === 'active';

  const currentPlanLabel =
    subscription.planId === 'free_trial'
      ? 'Free Trial (15-Day Enterprise Evaluation)'
      : plans.find((p) => p.id === subscription.planId)?.name || subscription.planId;

  const refreshSubscriptionState = () => {
    queryClient.invalidateQueries({ queryKey: ['subscription_dashboard'] });
  };

  const handleActivateOrSimulateTrial = async (simulateDaysRemaining?: number) => {
    setConfiguringTrial(true);
    try {
      const res = await activateOrConfigureTrial({
        accountId,
        accountName,
        trialDurationDays: trialDurationInput,
        simulateDaysRemaining,
      });
      refreshSubscriptionState();
      const triggered = res.newlyTriggeredReminders?.[0];
      toast({
        title:
          simulateDaysRemaining === 0
            ? 'Trial expired state enforced'
            : simulateDaysRemaining !== undefined
              ? `Trial clock set to ${simulateDaysRemaining} day(s) remaining`
              : `Trial activated (${trialDurationInput} days)`,
        description: triggered
          ? `Automated alert dispatched: "${triggered.title}"`
          : `Status: ${res.subscription.subscriptionStatus.toUpperCase()}`,
        tone: simulateDaysRemaining === 0 ? 'error' : 'success',
      });
    } catch (err) {
      toast({
        title: 'Trial configuration failed',
        description: err instanceof Error ? err.message : 'Error updating trial',
        tone: 'error',
      });
    } finally {
      setConfiguringTrial(false);
    }
  };

  const handleRunReminderScheduler = async () => {
    setRunningReminderJob(true);
    try {
      const res = await triggerExpiryRemindersJob({ accountId });
      refreshSubscriptionState();
      toast({
        title:
          res.triggeredCount > 0
            ? `Dispatched ${res.triggeredCount} expiry reminder(s)`
            : 'Idempotent check complete (0 duplicates sent)',
        description:
          res.triggeredCount > 0
            ? res.triggered.map((t) => t.title).join(' · ')
            : 'Milestone reminder for current remaining-day window was already delivered or not due today.',
        tone: 'info',
      });
    } catch (err) {
      toast({
        title: 'Reminder check failed',
        description: err instanceof Error ? err.message : 'Error running reminder job',
        tone: 'error',
      });
    } finally {
      setRunningReminderJob(false);
    }
  };

  const handleCompleteVerifiedCheckout = async () => {
    if (!selectedPlanForCheckout) return;
    setProcessingPayment(true);
    try {
      // Step 1: Create server-side order with 18% GST calculation
      const orderRes = await createSubscriptionCheckoutOrder({
        accountId,
        accountName,
        planId: selectedPlanForCheckout,
        billingCycle,
      });

      // Step 2: Verify payment server-side using HMAC-SHA256 before marking subscription as paid
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
        title: 'Payment verified & subscription upgraded',
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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Subscription, trial lifecycle & billing"
        description="Server-authoritative trial countdown, automated expiry notifications (15, 10, 5, and 1 day), and verified plan upgrades."
        actions={
          <div className="flex items-center gap-2">
            {!isPaidActive && (
              <Button onClick={() => setSelectedPlanForCheckout('scale')}>
                <CreditCard className="h-3.5 w-3.5" />
                Purchase Plan / Upgrade Now
              </Button>
            )}
            {isPaidActive && (
              <Button variant="outline" onClick={() => setSelectedPlanForCheckout('enterprise')}>
                Change / Upgrade Plan
              </Button>
            )}
          </div>
        }
      />

      {/* Expiry / Restricted State Alert Banner (Update 3.D) */}
      {isExpired && (
        <div className="rounded-[10px] border border-[var(--status-danger)] bg-[var(--status-danger-bg)] p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2 text-[14px] leading-[20px] font-semibold text-[var(--status-danger)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Trial expired - Workspace is in restricted read-only state</span>
            </div>
            <p className="text-[13px] leading-[20px] text-[var(--text-primary)]">
              {entitlements.restrictionReason} All existing requirements, candidates, and audit logs
              remain safely preserved.
            </p>
          </div>
          <Button onClick={() => setSelectedPlanForCheckout('scale')}>
            Purchase Plan / Upgrade Now
          </Button>
        </div>
      )}

      {/* E. Subscription Dashboard Metric Strip */}
      <MetricStrip
        items={[
          {
            label: 'Current plan',
            value: currentPlanLabel,
          },
          {
            label: 'Subscription status',
            value: subscription.subscriptionStatus.toUpperCase(),
            tone: isPaidActive ? 'default' : isExpired ? 'danger' : 'warning',
          },
          {
            label: 'Days remaining (server)',
            value: isPaidActive ? 'Active (Paid)' : `${daysRemaining}d`,
            tone: !isPaidActive && daysRemaining <= 5 ? 'danger' : 'default',
          },
          {
            label: 'Payment status',
            value: isPaidActive ? 'Verified · Paid' : 'Unpaid (Trial)',
          },
        ]}
      />

      {/* Detailed Subscription Lifecycle Card */}
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div>
            <h2 className="text-[15px] leading-[22px] font-semibold text-[var(--text-primary)]">
              Account subscription overview ({subscription.accountName})
            </h2>
            <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
              Remaining days are computed from authoritative server UTC timestamps; backend entitlement checks govern write access.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              tone={
                isPaidActive
                  ? 'emerald'
                  : isExpired
                    ? 'danger'
                    : daysRemaining <= 5
                      ? 'warning'
                      : 'neutral'
              }
            >
              {isPaidActive
                ? `Paid · ${subscription.billingCycle}`
                : isExpired
                  ? 'Expired - Read-only mode'
                  : `Trialing · ${daysRemaining} days left`}
            </Badge>
            {!isPaidActive && (
              <Button size="sm" onClick={() => setSelectedPlanForCheckout('scale')}>
                Purchase Plan / Upgrade Now
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px] leading-[20px]">
          <div>
            <span className="text-[12px] text-[var(--text-tertiary)] block">Trial start date</span>
            <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
              {formatLocalDate(subscription.trialStartedAt)}
            </span>
          </div>
          <div>
            <span className="text-[12px] text-[var(--text-tertiary)] block">Trial expiry date</span>
            <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
              {formatLocalDate(subscription.trialEndsAt)}
            </span>
          </div>
          <div>
            <span className="text-[12px] text-[var(--text-tertiary)] block">
               Paid activation date
            </span>
            <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
              {subscription.paidActivatedAt
                ? formatLocalDateTime(subscription.paidActivatedAt)
                : '-'}
            </span>
          </div>
          <div>
            <span className="text-[12px] text-[var(--text-tertiary)] block">Write entitlements</span>
            <span className="font-medium text-[var(--text-primary)]">
              {entitlements.isReadOnlyRestricted
                ? 'Restricted (Read-only)'
                : 'Full access enabled'}
            </span>
          </div>
        </div>
      </div>

      {/* B. Automated Expiry Notifications (15d, 10d, 5d, Last day) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              Automated trial expiry notifications
            </h2>
            <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
              Scheduled backend job dispatches idempotent email & in-app alerts at 15, 10, 5, and 1 day remaining without duplicates.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            loading={runningReminderJob}
            onClick={handleRunReminderScheduler}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Run scheduled reminder check now
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(['15d', '10d', '5d', '1d'] as const).map((mKey) => {
            const spec = REMINDER_MILESTONE_SPECS[mKey];
            const deliveredRecord = reminders.find((r) => r.milestone === mKey);
            const isCurrentWindow = !isPaidActive && !isExpired && daysRemaining === spec.daysRemaining;

            return (
              <div
                key={mKey}
                className={`rounded-[10px] border p-4 flex flex-col justify-between gap-3 ${
                  isCurrentWindow
                    ? 'border-[var(--accent)] bg-[var(--surface)] shadow-2xs'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      tone={
                        spec.urgency === 'danger'
                          ? 'danger'
                          : spec.urgency === 'warning'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {spec.badgeLabel}
                    </Badge>
                    {deliveredRecord ? (
                      <span className="text-[11px] font-mono tabular-nums text-[var(--status-success)] font-medium">
                        Delivered
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
                        Scheduled
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] leading-[18px] font-semibold text-[var(--text-primary)]">
                    {spec.title}
                  </div>
                  <p className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
                    {spec.message}
                  </p>
                </div>

                <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
                  {deliveredRecord ? (
                    <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)] truncate">
                      Sent {formatLocalDateTime(deliveredRecord.deliveredAt)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      Triggers at {spec.daysRemaining}d left
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedPlanForCheckout('scale')}
                    className="text-[12px] font-medium text-[var(--accent)] hover:underline shrink-0 cursor-pointer"
                  >
                    Upgrade Now →
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Idempotent Reminder Delivery Log */}
        {reminders.length > 0 && (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-between">
              <span className="text-[12px] leading-[16px] font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                <BellRing className="h-3.5 w-3.5 text-[var(--accent)]" />
                Idempotent notification delivery log ({reminders.length})
              </span>
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                Timezone-safe UTC deduplication active
              </span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {reminders.slice(0, 6).map((rem) => (
                <div
                  key={rem.id}
                  className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[13px]"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          rem.urgency === 'danger'
                            ? 'danger'
                            : rem.urgency === 'warning'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {rem.daysRemaining === 1 ? 'Last day' : `${rem.daysRemaining} days remaining`}
                      </Badge>
                      <span className="font-medium text-[var(--text-primary)]">{rem.title}</span>
                    </div>
                    <p className="text-[12px] text-[var(--text-secondary)]">{rem.message}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
                      Key: {rem.dedupeKey} · {formatLocalDateTime(rem.deliveredAt)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedPlanForCheckout('scale')}
                    >
                      Purchase Plan
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* C. Upgrade & Purchase Experience (Plans, Billing Frequency, Price, Features, 18% GST) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              Available plans & transparent pricing
            </h2>
            <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
              Select a plan to proceed through server-verified checkout. Applicable 18% GST is calculated at checkout.
            </p>
          </div>

          {/* Billing Frequency Toggle */}
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
              Monthly billing
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
              Annual billing (Save 16%)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const pricing = computePlanPricingWithTax(plan.id, billingCycle);
            const isCurrentPaidPlan = isPaidActive && subscription.planId === plan.id;
            const isRecommended = plan.id === 'scale';

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
                      <Badge tone="emerald">Current Active Plan</Badge>
                    ) : isRecommended ? (
                      <Badge tone="sky">Recommended</Badge>
                    ) : null}
                  </div>
                  <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                    {plan.tagline}
                  </p>

                  <div className="pt-2 border-t border-[var(--border)]">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono tabular-nums text-[24px] leading-[32px] font-semibold text-[var(--text-primary)]">
                        {formatInr(pricing.baseAmountInr)}
                      </span>
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        / {billingCycle === 'annual' ? 'year' : 'month'} + {pricing.gstPercent}% GST
                      </span>
                    </div>
                    <div className="text-[12px] font-mono tabular-nums text-[var(--text-tertiary)] mt-0.5">
                      Total incl. GST: {formatInr(pricing.totalAmountInr)}
                      {billingCycle === 'annual' &&
                        ` · Saves ${formatInr(pricing.annualSavingsInr)}/yr`}
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
                    ? 'Active Plan'
                    : `Purchase ${plan.name} Plan`}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Verified Payment Receipts Ledger */}
      {(receipts.length > 0 || latestReceipt) && (
        <div className="space-y-3">
          <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Verified payment confirmations & GST invoices
          </h2>
          <div className="overflow-x-auto border-t border-[var(--border)] bg-[var(--surface)] rounded-[8px]">
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Plan & cycle</th>
                  <th>Payment ID</th>
                  <th className="text-right">Base amount</th>
                  <th className="text-right">GST (18%)</th>
                  <th className="text-right">Total paid</th>
                  <th>Server signature</th>
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
                    <td className="font-mono text-[12px] text-[var(--text-secondary)]">
                      {rcpt.paymentId}
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
                    <td>
                      <Badge tone="emerald">HMAC · {rcpt.verifiedSignaturePrefix}…</Badge>
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

      {/* A. Admin Trial Configuration & Lifecycle Simulator */}
      {isAdmin && (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-subtle)] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--accent)]" />
                Admin trial configuration & lifecycle testing controls
              </h3>
              <p className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
                Configure trial duration or test server-side milestone alerts (15d, 10d, 5d, Last day) and expiry enforcement.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Input
                label="Trial duration (days)"
                type="number"
                min={1}
                max={90}
                value={trialDurationInput}
                onChange={(e) => setTrialDurationInput(Number(e.target.value) || 15)}
              />
            </div>
            <Button
              size="sm"
              loading={configuringTrial}
              onClick={() => handleActivateOrSimulateTrial(undefined)}
            >
              Activate new {trialDurationInput}-day trial
            </Button>
          </div>

          <div className="pt-3 border-t border-[var(--border)] space-y-2">
            <span className="text-[12px] font-medium text-[var(--text-secondary)] block">
              Simulate server trial clock milestone (triggers automated alert & entitlement check):
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={configuringTrial}
                onClick={() => handleActivateOrSimulateTrial(15)}
              >
                Set 15 days remaining
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={configuringTrial}
                onClick={() => handleActivateOrSimulateTrial(10)}
              >
                Set 10 days remaining
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={configuringTrial}
                onClick={() => handleActivateOrSimulateTrial(5)}
              >
                Set 5 days remaining
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={configuringTrial}
                onClick={() => handleActivateOrSimulateTrial(1)}
              >
                Set Last day (1d remaining)
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={configuringTrial}
                onClick={() => handleActivateOrSimulateTrial(0)}
              >
                Simulate Trial Expiry (0d · Enforce Read-Only)
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Secure Payment Checkout Modal */}
      <Dialog
        open={Boolean(selectedPlanForCheckout && activeCheckoutPricing)}
        onClose={() => setSelectedPlanForCheckout(null)}
        title="Complete plan purchase & server verification"
        description="Payment signature is verified server-side before activating subscription entitlements."
        maxWidth="max-w-[520px]"
      >
        {activeCheckoutPricing && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {activeCheckoutPricing.plan.name} Plan ({activeCheckoutPricing.billingCycle})
                </span>
                <Badge tone="sky">Server-verified checkout</Badge>
              </div>
              <div className="divide-y divide-[var(--border)] text-[13px] pt-1">
                <div className="py-1.5 flex justify-between">
                  <span className="text-[var(--text-secondary)]">Base subscription price</span>
                  <span className="font-mono tabular-nums text-[var(--text-primary)]">
                    {formatInr(activeCheckoutPricing.baseAmountInr)}
                  </span>
                </div>
                <div className="py-1.5 flex justify-between">
                  <span className="text-[var(--text-secondary)]">
                    Applicable tax (GST {activeCheckoutPricing.gstPercent}%)
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
                { value: 'Enterprise UPI / NEFT', label: 'Enterprise UPI / NEFT' },
                { value: 'NetBanking Corporate Mandate', label: 'NetBanking Corporate Mandate' },
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
              />
            </div>

            <div className="rounded-[6px] border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text-secondary)] flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--status-success)] shrink-0" />
              <span>
                Payment gateway credentials and HMAC-SHA256 verification keys remain strictly on the server.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="outline" onClick={() => setSelectedPlanForCheckout(null)}>
                Cancel
              </Button>
              <Button onClick={handleCompleteVerifiedCheckout} loading={processingPayment}>
                Pay {formatInr(activeCheckoutPricing.totalAmountInr)} & Verify
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Payment Confirmation Receipt Dialog */}
      <Dialog
        open={Boolean(latestReceipt)}
        onClose={() => setLatestReceipt(null)}
        title="Payment confirmed & subscription active"
        description="Your payment was verified server-side and paid entitlements are now active."
      >
        {latestReceipt && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4 space-y-2 text-[13px]">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Receipt className="h-4 w-4 text-[var(--status-success)]" />
                  Invoice {latestReceipt.invoiceNumber}
                </span>
                <Badge tone="emerald">PAID · VERIFIED</Badge>
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
              <div className="flex justify-between py-1 text-[12px] text-[var(--text-tertiary)]">
                <span>Payment ID: {latestReceipt.paymentId}</span>
                <span>HMAC: {latestReceipt.verifiedSignaturePrefix}…</span>
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
