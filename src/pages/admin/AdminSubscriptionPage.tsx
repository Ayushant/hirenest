import { PricingOffers } from '../../components/domain/PricingOffers';
import { TrialExtensionRequests } from '../../components/domain/TrialExtensionRequests';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CreditCard,
  Building2,
  Clock,
  Sparkles,
  AlertTriangle,
  CalendarPlus,
  ShieldCheck,
} from 'lucide-react';
import {
  Input,
  PageHeader,
  MetricStrip,
  Button,
  Badge,
  Dialog,
  Select,
  TableSkeleton,
  ErrorState,
} from '../../components/ui/kit';
import {
  type BillingCycle,
  SUBSCRIPTION_PLANS,
  computePlanPricingWithTax,
} from '../../lib/enterpriseLifecycle';
import { supabase } from '../../lib/supabase';
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

const DEFAULT_TRIAL_DAYS = 14;

interface OrgRow {
  id: string;
  name: string;
  type: 'vendor' | 'client' | 'internal';
  status: string;
  created_at: string;
  trial_ends_at: string | null;
  plan_id: string;
  subscription_status: string;
}

function computeTrialInfo(org: OrgRow) {
  const now = Date.now();
  const createdAt = new Date(org.created_at).getTime();
  const defaultTrialEnd = createdAt + DEFAULT_TRIAL_DAYS * 86_400_000;
  const trialEnd = org.trial_ends_at
    ? new Date(org.trial_ends_at).getTime()
    : defaultTrialEnd;

  const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / 86_400_000));
  const isExpired = daysRemaining === 0;
  const trialDuration = Math.ceil((trialEnd - createdAt) / 86_400_000);

  return { daysRemaining, isExpired, trialEnd, trialDuration };
}

async function fetchOrgs(): Promise<OrgRow[]> {
  const {data,error}=await supabase.rpc('admin_subscription_organizations');
  if(error)throw error;return (data||[]) as OrgRow[];
}

export const AdminSubscriptionPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [showBetaPricing, setShowBetaPricing] = useState(false);
  const [extendOrgId, setExtendOrgId] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState<string>('14');
  const [extensionReason,setExtensionReason]=useState('');
  const [assignOrgId, setAssignOrgId] = useState<string | null>(null);
  const [assignPlan, setAssignPlan] = useState<string>('growth');
  const [assignReason,setAssignReason]=useState('');
  const [assignCycle, setAssignCycle] = useState<string>('annual');

  const { data: orgs, isLoading, error, refetch } = useQuery({
    queryKey: ['admin_org_subscriptions'],
    queryFn: fetchOrgs,
  });

  const extendMutation = useMutation({
    mutationFn: async ({ orgId, days }: { orgId: string; days: number }) => {
      const {error}=await supabase.rpc('request_trial_extension',{p_org_id:orgId,p_days:days,p_reason:extensionReason});if(error)throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin_org_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['admin_org_plans'] });
      queryClient.invalidateQueries({ queryKey: ['subscription_dashboard'] });
      setExtendOrgId(null);
      queryClient.invalidateQueries({queryKey:['trial_requests']});
      toast({ title: 'Extension request created', description: `Review the request below before adding ${variables.days} days.`, tone: 'success' });
    },
    onError: (err) => {
      toast({ title: 'Failed to extend trial', description: err instanceof Error ? err.message : 'Unknown error', tone: 'error' });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ orgId, planId, billingCycle }: { orgId: string; planId: string; billingCycle: string }) => {
      const {error}=await supabase.rpc('admin_assign_subscription_plan',{p_org_id:orgId,p_plan_id:planId,p_billing_cycle:billingCycle,p_reason:assignReason});if(error)throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin_org_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['admin_org_plans'] });
      setAssignOrgId(null);
      const planLabel = variables.planId === 'free_trial' ? 'Free Trial'
        : variables.planId.charAt(0).toUpperCase() + variables.planId.slice(1);
      toast({ title: `Plan assigned: ${planLabel}`, tone: 'success' });
    },
    onError: (err) => {
      toast({ title: 'Failed to assign plan', description: err instanceof Error ? err.message : 'Unknown error', tone: 'error' });
    },
  });

  const orgPlanMap = new Map((orgs||[]).map(o=>[o.id,{planId:o.plan_id,planName:o.plan_id==='free_trial'?'Free Trial':o.plan_id,subscriptionStatus:o.subscription_status}]));

  const totalOrgs = orgs?.length ?? 0;
  const trialOrgs = orgs?.filter((o) => o.plan_id==='free_trial'&&!computeTrialInfo(o).isExpired).length ?? 0;
  const expiredOrgs = orgs?.filter((o) => o.plan_id==='free_trial'&&computeTrialInfo(o).isExpired).length ?? 0;
  const extendOrg = orgs?.find((o) => o.id === extendOrgId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Subscription management"
        description="Manage subscription plans and trial periods for vendor and client organisations."
      />

      {/* Overview Metrics */}
      <MetricStrip
        items={[
          { label: 'Total organisations', value: isLoading ? '...' : String(totalOrgs) },
          { label: 'Active trials', value: isLoading ? '...' : String(trialOrgs) },
          { label: 'Expired trials', value: isLoading ? '...' : String(expiredOrgs), tone: expiredOrgs > 0 ? 'danger' : 'default' },
          { label: 'Paid subscriptions', value: String(orgs?.filter(o=>o.subscription_status==='active').length||0) },
        ]}
      />

      {/* Info Banner */}
      <div className="rounded-[12px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 flex items-start gap-3">
        <CreditCard className="h-5 w-5 text-[var(--accent)] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
            Centralised billing control
          </p>
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
            Vendors and clients cannot purchase directly. You manage all subscriptions centrally.
            Default trial is {DEFAULT_TRIAL_DAYS} days from signup. You can extend trials to 30, 60, or 90 days.
          </p>
        </div>
      </div>

      {/* Organisation Subscription Table */}
      <div className="space-y-3">
        <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Organisation trials & subscriptions
        </h2>

        {isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : 'Could not load organisations'}
            onRetry={() => refetch()}
          />
        ) : orgs && orgs.length > 0 ? (
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Organisation</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Trial duration</th>
                  <th>Days remaining</th>
                  <th>Active plan</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => {
                  const trial = computeTrialInfo(org);
                  return (
                    <tr key={org.id}>
                      <td className="font-medium text-[var(--text-primary)]">{org.name}</td>
                      <td>
                        <Badge tone={org.type === 'vendor' ? 'sky' : 'indigo'}>
                          {org.type === 'vendor' ? 'Vendor' : 'Client'}
                        </Badge>
                      </td>
                      <td>
                        {org.subscription_status==='active' ? <Badge tone="emerald">Paid active</Badge> : trial.isExpired ? (
                          <Badge tone="red">Expired</Badge>
                        ) : trial.daysRemaining <= 5 ? (
                          <Badge tone="amber">Expiring soon</Badge>
                        ) : (
                          <Badge tone="emerald">Trialing</Badge>
                        )}
                      </td>
                      <td className="font-mono tabular-nums text-[13px]">
                        {trial.trialDuration} days
                      </td>
                      <td>
                        <span
                          className={`font-mono tabular-nums text-[14px] font-semibold ${
                            trial.isExpired
                              ? 'text-[var(--status-danger)]'
                              : trial.daysRemaining <= 5
                                ? 'text-[var(--status-danger)]'
                                : trial.daysRemaining <= 7
                                  ? 'text-[var(--status-warning)]'
                                  : 'text-[var(--text-primary)]'
                          }`}
                        >
                          {org.subscription_status==='active'?'—':`${trial.daysRemaining}d`}
                        </span>
                      </td>
                      <td>
                        {(() => {
                          const plan = orgPlanMap.get(org.id);
                          const planId = plan?.planId || 'free_trial';
                          const planName = plan?.planName || 'Free Trial';
                          const tone = planId === 'free_trial' ? 'slate'
                            : planId === 'growth' ? 'sky'
                            : planId === 'scale' ? 'rich_blue'
                            : 'teal';
                          return <Badge tone={tone}>{planName}</Badge>;
                        })()}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setExtendOrgId(org.id);
                              setExtendDays('14');
                              setExtensionReason('');
                            }}
                          >
                            <CalendarPlus className="h-3.5 w-3.5" />
                            Extend
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setAssignOrgId(org.id);
                              const existing = orgPlanMap.get(org.id);
                              setAssignPlan(existing?.planId || 'growth');
                            }}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Assign Plan
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <Building2 className="h-8 w-8 text-[var(--border)] mx-auto mb-2" />
            <p className="text-[13px] text-[var(--text-tertiary)]">
              No vendor or client organisations onboarded yet.
            </p>
            <p className="text-[12px] text-[var(--text-tertiary)] mt-1">
              Go to <span className="font-medium text-[var(--text-secondary)]">Governance &gt; Organizations</span> to approve organisations.
            </p>
          </div>
        )}
      </div>

      <TrialExtensionRequests admin />
      <PricingOffers orgs={orgs || []} />

      {/* Extend Trial Dialog */}
      <Dialog
        open={Boolean(extendOrgId && extendOrg)}
        onClose={() => setExtendOrgId(null)}
        title="Extend trial period"
        description={extendOrg ? `Request additional trial days for ${extendOrg.name}` : ''}
        maxWidth="max-w-[420px]"
      >
        {extendOrg && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[13px] space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Organisation</span>
                <span className="font-medium text-[var(--text-primary)]">{extendOrg.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Current days remaining</span>
                <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                  {computeTrialInfo(extendOrg).daysRemaining}d
                </span>
              </div>
            </div>

            <Select
              label="Additional days from current expiry"
              value={extendDays}
              onChange={(e) => setExtendDays(e.target.value)}
              options={[14,21,30].map(n=>({value:String(n),label:`${n} additional days`}))}
            />

            <Input label="Reason for extension request" value={extensionReason} onChange={e=>setExtensionReason(e.target.value)} />
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="outline" onClick={() => setExtendOrgId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  extendMutation.mutate({ orgId: extendOrg.id, days: Number(extendDays) })
                }
                loading={extendMutation.isPending} disabled={extensionReason.trim().length<3}
              >
                <CalendarPlus className="h-3.5 w-3.5" />
                Request +{extendDays} days
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Assign Plan Dialog */}
      <Dialog
        open={Boolean(assignOrgId)}
        onClose={() => setAssignOrgId(null)}
        title="Assign subscription plan"
        description={assignOrgId ? `Assign a plan to ${orgs?.find((o) => o.id === assignOrgId)?.name || 'this organisation'}` : ''}
        maxWidth="max-w-[420px]"
      >
        {assignOrgId && (
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[13px] space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Organisation</span>
                <span className="font-medium text-[var(--text-primary)]">{orgs?.find((o) => o.id === assignOrgId)?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Current plan</span>
                <span className="font-medium text-[var(--text-primary)]">{orgPlanMap.get(assignOrgId)?.planName || 'Free Trial'}</span>
              </div>
            </div>

            <Select
              label="Plan"
              value={assignPlan}
              onChange={(e) => setAssignPlan(e.target.value)}
              options={[
                { value: 'free_trial', label: 'Free Trial' },
                { value: 'growth', label: 'Growth' },
                { value: 'scale', label: 'Scale' },
                { value: 'enterprise', label: 'Enterprise' },
              ]}
            />

            {assignPlan !== 'free_trial' && (
              <Select
                label="Billing cycle"
                value={assignCycle}
                onChange={(e) => setAssignCycle(e.target.value)}
                options={[
                  { value: 'annual', label: 'Annual' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
              />
            )}

            <Input label="Reason for manual plan assignment" value={assignReason} onChange={e=>setAssignReason(e.target.value)} />
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="outline" onClick={() => setAssignOrgId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  assignMutation.mutate({
                    orgId: assignOrgId,
                    planId: assignPlan,
                    billingCycle: assignCycle,
                  })
                }
                loading={assignMutation.isPending} disabled={assignReason.trim().length<3}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Assign {assignPlan === 'free_trial' ? 'Free Trial' : assignPlan.charAt(0).toUpperCase() + assignPlan.slice(1)}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

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
          <div className="rounded-[12px] border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 space-y-2">
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
                className={`rounded-[12px] border p-5 flex flex-col gap-4 ${
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
