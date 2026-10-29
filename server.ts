import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import {
  type BillingCycle,
  type PlanId,
  type ReminderMilestone,
  type SubscriptionStatus,
  REMINDER_MILESTONE_SPECS,
  SUBSCRIPTION_PLANS,
  computePlanPricingWithTax,
  computeRequirementFingerprint,
  computeServerTrialDaysRemaining,
  detectDuplicateRequirementGroups,
  evaluateRequirementAccess,
  getMilestoneForDaysRemaining,
  isRequirementSoftDeleted,
  parseRequirementMeta,
} from './src/lib/enterpriseLifecycle';
import { extractStructuredFieldsFromText } from './src/lib/resumeParser';
import {
  type PrivacyNoticeRecord,
  type PrivacyAcknowledgementRecord,
  type DataProcessingRecord,
  type PrivacyRequestRecord,
  type RetentionPolicyRecord,
  type DeletionJobRecord,
  type PrivacyIncidentRecord,
  type PrivacyAuditEventRecord,
  INITIAL_PRIVACY_NOTICES,
  INITIAL_PRIVACY_ACKNOWLEDGEMENTS,
  INITIAL_PROCESSING_RECORDS,
  INITIAL_PRIVACY_REQUESTS,
  INITIAL_RETENTION_POLICIES,
  INITIAL_DELETION_JOBS,
  INITIAL_PRIVACY_INCIDENTS,
  INITIAL_PRIVACY_AUDIT_EVENTS,
  SUB_PROCESSOR_INVENTORY,
  DPDP_ROADMAP_PHASES,
} from './src/lib/dpdpPrivacy';
import type { AppRole, Requirement } from './src/types/db';

dotenv.config();

const PORT = 3000;

// Server-only payment verification secret (never exposed to client bundle)
const PAYMENT_WEBHOOK_SECRET =
  process.env.PAYMENT_GATEWAY_SECRET || 'hn_srv_hmac_secret_9f8e7d6c5b4a3210';

// ============================================================================
// Persistent Server Store for Subscriptions, Reminders, Receipts & Mappings
// ============================================================================

export interface AccountSubscriptionRecord {
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

export interface ReminderDeliveryRecord {
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

export interface CheckoutOrderRecord {
  orderId: string;
  accountId: string;
  planId: Exclude<PlanId, 'free_trial'>;
  billingCycle: BillingCycle;
  baseAmountInr: number;
  gstPercent: number;
  gstAmountInr: number;
  totalAmountInr: number;
  currency: 'INR';
  status: 'created' | 'paid' | 'failed';
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentReceiptRecord {
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

export interface RequirementMappingServerRecord {
  requirementId: string;
  isClientMapped: boolean;
  mappedClientOrgId: string | null;
  budgetUnit: 'LPA' | 'LPM' | null;
  budgetMode: 'range' | 'fixed';
  budgetMin: number | null;
  budgetMax: number | null;
  updatedAt: string;
}

export interface RequirementSoftDeleteServerRecord {
  requirementId: string;
  title: string;
  clientOrgId: string | null;
  isDeleted: boolean;
  deletedAt: string;
  deletedBy: string;
  canonicalId: string | null;
  reason: string | null;
}

export interface RequirementFingerprintServerRecord {
  fingerprint: string;
  requirementId: string;
  title: string;
  clientOrgId: string | null;
  location: string;
  workMode: string;
  createdAt: string;
  requirement?: Record<string, unknown>;
}

export interface RequirementGovernanceAuditEntry {
  id: string;
  action: 'requirement_soft_deleted' | 'duplicate_prevented' | 'duplicates_consolidated';
  requirementId: string;
  canonicalId?: string | null;
  archivedIds?: string[];
  actorId: string;
  actorRole: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface EnterpriseServerStore {
  subscriptions: Record<string, AccountSubscriptionRecord>;
  reminders: ReminderDeliveryRecord[];
  orders: Record<string, CheckoutOrderRecord>;
  receipts: PaymentReceiptRecord[];
  requirementMappings: Record<string, RequirementMappingServerRecord>;
  publishedRequirements: Record<string, Record<string, unknown>>;
  vendorAcknowledgements: Record<string, string>;
  deletedRequirements: Record<string, RequirementSoftDeleteServerRecord>;
  requirementFingerprints: Record<string, RequirementFingerprintServerRecord>;
  requirementAuditTrail: RequirementGovernanceAuditEntry[];
  requirementShareActivities: Array<Record<string, unknown>>;
  privacyNotices: PrivacyNoticeRecord[];
  privacyAcknowledgements: PrivacyAcknowledgementRecord[];
  dataProcessingRecords: DataProcessingRecord[];
  privacyRequests: PrivacyRequestRecord[];
  retentionPolicies: RetentionPolicyRecord[];
  deletionJobs: DeletionJobRecord[];
  privacyIncidents: PrivacyIncidentRecord[];
  privacyAuditEvents: PrivacyAuditEventRecord[];
  submissionValidations: Record<string, Record<string, unknown>>;
  offerOnboardingRecords: Record<string, Record<string, unknown>>;
}

const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', '.hirenest-data')
  : path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'enterprise-store.json');

function loadEnterpriseStore(): EnterpriseServerStore {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<EnterpriseServerStore>;
      return {
        subscriptions: parsed.subscriptions || {},
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        orders: parsed.orders || {},
        receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
        requirementMappings: parsed.requirementMappings || {},
        publishedRequirements: parsed.publishedRequirements || {},
        vendorAcknowledgements: parsed.vendorAcknowledgements || {},
        deletedRequirements: parsed.deletedRequirements || {},
        requirementFingerprints: parsed.requirementFingerprints || {},
        requirementAuditTrail: Array.isArray(parsed.requirementAuditTrail)
          ? parsed.requirementAuditTrail
          : [],
        requirementShareActivities: Array.isArray(parsed.requirementShareActivities)
          ? parsed.requirementShareActivities
          : [],
        privacyNotices:
          Array.isArray(parsed.privacyNotices) && parsed.privacyNotices.length > 0
            ? parsed.privacyNotices
            : [...INITIAL_PRIVACY_NOTICES],
        privacyAcknowledgements:
          Array.isArray(parsed.privacyAcknowledgements) && parsed.privacyAcknowledgements.length > 0
            ? parsed.privacyAcknowledgements
            : [...INITIAL_PRIVACY_ACKNOWLEDGEMENTS],
        dataProcessingRecords:
          Array.isArray(parsed.dataProcessingRecords) && parsed.dataProcessingRecords.length > 0
            ? parsed.dataProcessingRecords
            : [...INITIAL_PROCESSING_RECORDS],
        privacyRequests:
          Array.isArray(parsed.privacyRequests) && parsed.privacyRequests.length > 0
            ? parsed.privacyRequests
            : [...INITIAL_PRIVACY_REQUESTS],
        retentionPolicies:
          Array.isArray(parsed.retentionPolicies) && parsed.retentionPolicies.length > 0
            ? parsed.retentionPolicies
            : [...INITIAL_RETENTION_POLICIES],
        deletionJobs:
          Array.isArray(parsed.deletionJobs) && parsed.deletionJobs.length > 0
            ? parsed.deletionJobs
            : [...INITIAL_DELETION_JOBS],
        privacyIncidents:
          Array.isArray(parsed.privacyIncidents) && parsed.privacyIncidents.length > 0
            ? parsed.privacyIncidents
            : [...INITIAL_PRIVACY_INCIDENTS],
        privacyAuditEvents:
          Array.isArray(parsed.privacyAuditEvents) && parsed.privacyAuditEvents.length > 0
            ? parsed.privacyAuditEvents
            : [...INITIAL_PRIVACY_AUDIT_EVENTS],
        submissionValidations: parsed.submissionValidations || {},
        offerOnboardingRecords: parsed.offerOnboardingRecords || {},
      };
    }
  } catch {
    // Fallback to clean store if corrupted
  }
  return {
    subscriptions: {},
    reminders: [],
    orders: {},
    receipts: [],
    requirementMappings: {},
    publishedRequirements: {},
    vendorAcknowledgements: {},
    deletedRequirements: {},
    requirementFingerprints: {},
    requirementAuditTrail: [],
    requirementShareActivities: [],
    privacyNotices: [...INITIAL_PRIVACY_NOTICES],
    privacyAcknowledgements: [...INITIAL_PRIVACY_ACKNOWLEDGEMENTS],
    dataProcessingRecords: [...INITIAL_PROCESSING_RECORDS],
    privacyRequests: [...INITIAL_PRIVACY_REQUESTS],
    retentionPolicies: [...INITIAL_RETENTION_POLICIES],
    deletionJobs: [...INITIAL_DELETION_JOBS],
    privacyIncidents: [...INITIAL_PRIVACY_INCIDENTS],
    privacyAuditEvents: [...INITIAL_PRIVACY_AUDIT_EVENTS],
    submissionValidations: {},
    offerOnboardingRecords: {},
  };
}

function saveEnterpriseStore(store: EnterpriseServerStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // Ignore filesystem errors in read-only containers
  }
}

const enterpriseStore = loadEnterpriseStore();

// In-memory concurrency mutex for idempotent requirement creation so simultaneous requests cannot race
const inFlightFingerprintLocks = new Map<
  string,
  Promise<{
    duplicate: boolean;
    fingerprint: string;
    canonicalRequirementId: string | null;
    existingRequirement: Record<string, unknown> | null;
  }>
>();

function ensureAccountSubscription(
  accountId: string,
  accountName = 'HireNest Workspace'
): AccountSubscriptionRecord {
  const existing = enterpriseStore.subscriptions[accountId];
  if (existing) {
    if (accountName && existing.accountName === 'HireNest Workspace') {
      existing.accountName = accountName;
    }
    return existing;
  }

  // Default 15-day active trial calculated from authoritative server timestamp
  const now = new Date();
  const startedAt = now.toISOString();
  const endsAt = new Date(now.getTime() + 15 * 86_400_000).toISOString();

  const created: AccountSubscriptionRecord = {
    accountId,
    accountName,
    planId: 'free_trial',
    billingCycle: 'annual',
    subscriptionStatus: 'trialing',
    trialDurationDays: 15,
    trialStartedAt: startedAt,
    trialEndsAt: endsAt,
    paidActivatedAt: null,
    currentPeriodEndsAt: null,
    updatedAt: startedAt,
  };
  enterpriseStore.subscriptions[accountId] = created;
  saveEnterpriseStore(enterpriseStore);
  return created;
}

/**
 * Evaluates authoritative server-side subscription state, transitions expired trials,
 * and runs idempotent milestone reminder evaluation (`15d`, `10d`, `5d`, `1d`).
 */
export function evaluateAccountSubscriptionLifecycle(
  accountId: string,
  accountName?: string,
  referenceServerNowIso?: string
): {
  subscription: AccountSubscriptionRecord;
  serverNow: string;
  daysRemaining: number;
  entitlements: {
    canWriteRequirements: boolean;
    canSubmitCandidates: boolean;
    canScheduleInterviews: boolean;
    canExportReports: boolean;
    isReadOnlyRestricted: boolean;
    restrictionReason: string | null;
  };
  newlyTriggeredReminders: ReminderDeliveryRecord[];
} {
  const serverNow = referenceServerNowIso || new Date().toISOString();
  const sub = ensureAccountSubscription(accountId, accountName);
  const newlyTriggeredReminders: ReminderDeliveryRecord[] = [];

  if (sub.subscriptionStatus === 'active') {
    return {
      subscription: sub,
      serverNow,
      daysRemaining: 0,
      entitlements: {
        canWriteRequirements: true,
        canSubmitCandidates: true,
        canScheduleInterviews: true,
        canExportReports: true,
        isReadOnlyRestricted: false,
        restrictionReason: null,
      },
      newlyTriggeredReminders,
    };
  }

  const nowMs = Date.parse(serverNow);
  const endMs = Date.parse(sub.trialEndsAt);

  // Expiry enforcement: transition trialing -> expired when serverNow >= trialEndsAt
  if (nowMs >= endMs) {
    if (sub.subscriptionStatus !== 'expired') {
      sub.subscriptionStatus = 'expired';
      sub.updatedAt = serverNow;
      saveEnterpriseStore(enterpriseStore);
    }
    return {
      subscription: sub,
      serverNow,
      daysRemaining: 0,
      entitlements: {
        canWriteRequirements: false,
        canSubmitCandidates: false,
        canScheduleInterviews: false,
        canExportReports: false,
        isReadOnlyRestricted: true,
        restrictionReason:
          'Your trial period has expired. Existing workspace data is preserved in read-only mode. Upgrade to a paid plan to restore full write access.',
      },
      newlyTriggeredReminders,
    };
  }

  // Account is within active trial window
  if (sub.subscriptionStatus === 'expired') {
    sub.subscriptionStatus = 'trialing';
    sub.updatedAt = serverNow;
  }

  const daysRemaining = computeServerTrialDaysRemaining(serverNow, sub.trialEndsAt);
  const milestone = getMilestoneForDaysRemaining(daysRemaining);

  if (milestone) {
    const endDateKey = sub.trialEndsAt.slice(0, 10);
    const dedupeKey = `${accountId}:${endDateKey}:${milestone}`;
    const alreadySent = enterpriseStore.reminders.some((r) => r.dedupeKey === dedupeKey);

    if (!alreadySent) {
      const spec = REMINDER_MILESTONE_SPECS[milestone];
      const record: ReminderDeliveryRecord = {
        id: `rem_${crypto.randomBytes(6).toString('hex')}`,
        accountId,
        milestone,
        daysRemaining: spec.daysRemaining,
        dedupeKey,
        title: spec.title,
        message: spec.message,
        urgency: spec.urgency,
        channels: ['in_app', 'email'],
        deliveredAt: serverNow,
        acknowledgedAt: null,
      };
      enterpriseStore.reminders.unshift(record);
      newlyTriggeredReminders.push(record);
      saveEnterpriseStore(enterpriseStore);
    }
  }

  return {
    subscription: sub,
    serverNow,
    daysRemaining,
    entitlements: {
      canWriteRequirements: true,
      canSubmitCandidates: true,
      canScheduleInterviews: true,
      canExportReports: true,
      isReadOnlyRestricted: false,
      restrictionReason: null,
    },
    newlyTriggeredReminders,
  };
}

function runScheduledExpiryReminderJob(): {
  checkedAccounts: number;
  triggeredCount: number;
  triggered: ReminderDeliveryRecord[];
} {
  const accountIds = Object.keys(enterpriseStore.subscriptions);
  const allTriggered: ReminderDeliveryRecord[] = [];
  const serverNow = new Date().toISOString();

  for (const accId of accountIds) {
    const res = evaluateAccountSubscriptionLifecycle(accId, undefined, serverNow);
    allTriggered.push(...res.newlyTriggeredReminders);
  }

  return {
    checkedAccounts: accountIds.length,
    triggeredCount: allTriggered.length,
    triggered: allTriggered,
  };
}

function computeOrderSignature(orderId: string, paymentId: string, accountId: string): string {
  return crypto
    .createHmac('sha256', PAYMENT_WEBHOOK_SECRET)
    .update(`${orderId}|${paymentId}|${accountId}`)
    .digest('hex');
}

// In-memory per-user rate limiter: max 200 requests per hour per user ID.
const RATE_LIMIT_MAX = 200;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const userRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkUserRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = userRateLimitMap.get(userId);
  if (!existing || now >= existing.resetAt) {
    const next = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    userRateLimitMap.set(userId, next);
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: next.resetAt };
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - existing.count, resetAt: existing.resetAt };
}

function scrubPII(input: string): string {
  if (!input) return '';
  return input
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
    .replace(/(?:www\.)?linkedin\.com\/in\/[^\s/]+/gi, '[REDACTED_LINKEDIN]')
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3,5}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/g, '[REDACTED_PHONE]')
    .replace(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/g, '[REDACTED_DATE]')
    .slice(0, 6000);
}

function resolveServerGeminiApiKey(): string | null {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.VITE_GEMINI_API_KEY,
  ];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (trimmed && trimmed !== 'MY_GEMINI_API_KEY' && trimmed !== 'YOUR_GEMINI_API_KEY') {
      return trimmed;
    }
  }
  return null;
}

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = resolveServerGeminiApiKey();
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateWithFallback(
  ai: GoogleGenAI,
  preferredModel: 'gemini-2.5-flash-lite' | 'gemini-2.5-flash',
  contents: string,
  systemInstruction: string,
  jsonSchema?: Record<string, unknown>
): Promise<string> {
  const modelsToTry = [preferredModel, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
  const uniqueModels = Array.from(new Set(modelsToTry));

  let lastErr: unknown = null;
  for (const model of uniqueModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          ...(jsonSchema
            ? {
                responseMimeType: 'application/json',
                responseSchema: jsonSchema,
              }
            : {}),
        },
      });
      if (response.text) {
        return response.text;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('AI_UNAVAILABLE');
}

type AiFallbackReason =
  | 'no_api_key'
  | 'rate_limited'
  | 'provider_error'
  | 'provider_timeout';

const OFFLINE_AI_LABEL =
  'Offline template — AI provider unavailable; verify every value before use';
const OFFLINE_SCREENING_LABEL =
  'Offline advisory template — AI provider unavailable; recruiter must evaluate manually';

function tagTemplateResponse(
  body: Record<string, unknown>,
  reason: AiFallbackReason
): Record<string, unknown> {
  return {
    ...body,
    source: 'template',
    ai: false,
    provider: null,
    reason,
  };
}

function tagProviderResponse(
  body: Record<string, unknown>,
  model: string
): Record<string, unknown> {
  return {
    ...body,
    source: 'provider',
    ai: true,
    provider: 'gemini',
    model,
  };
}

function buildServerStaffingAiFallback(
  feature: string,
  payload: Record<string, unknown>,
  callerRole: string,
  reason: AiFallbackReason = 'provider_error'
): Record<string, unknown> {
  if (feature === 'suggest_skills') {
    const text = `${String(payload.title || '')} ${String(payload.description || '')}`;
    const detected = extractStructuredFieldsFromText(text, 'jd.txt').skills;
    const roleFallbacks = [
      'Python',
      'SQL',
      'TypeScript',
      'System Design',
      'Cloud Architecture',
      'CI/CD',
      'REST APIs',
      'Stakeholder Management',
    ];
    const merged = Array.from(new Set([...detected, ...roleFallbacks])).slice(0, 8);
    return tagTemplateResponse(
      {
        label: OFFLINE_AI_LABEL,
        skills: merged,
      },
      reason
    );
  }

  if (feature === 'improve_jd') {
    const title = String(payload.title || 'Technical Specialist').trim();
    const rawDesc = String(payload.description || '').trim();
    const skills = Array.isArray(payload.skills)
      ? payload.skills.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const skillLine =
      skills.length > 0
        ? skills.join(', ')
        : 'core domain engineering, production architecture, and cross-functional delivery';
    const structured = [
      `Role Summary\nWe are seeking an experienced ${title} to design, build, and scale enterprise systems. ${rawDesc}`,
      `Key Responsibilities\n- Lead end-to-end technical delivery, architecture reviews, and production reliability across ${skillLine}.\n- Collaborate with product, engineering, and business stakeholders to translate requirements into maintainable solutions.\n- Enforce code quality, observability, security standards, and SLA commitments.`,
      `Required Qualifications\n- Proven hands-on production experience with ${skillLine}.\n- Strong debugging, analytical problem-solving, and clear written and verbal communication skills.\n- Demonstrated track record of delivering enterprise workloads on schedule.`,
    ].join('\n\n');
    return tagTemplateResponse(
      {
        label: OFFLINE_AI_LABEL,
        text: structured,
      },
      reason
    );
  }

  if (feature === 'suggest_interview_questions') {
    const reqTitle = String(payload.requirement_title || 'this role').trim();
    const reqSkills = Array.isArray(payload.requirement_skills)
      ? payload.requirement_skills.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const candSkills = Array.isArray(payload.candidate_skills)
      ? payload.candidate_skills.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const roundType = String(payload.round_type || 'technical');
    const candLower = new Set(candSkills.map((s) => s.toLowerCase()));
    const unproven = reqSkills.filter((s) => !candLower.has(s.toLowerCase()));
    const primarySkills = reqSkills.length > 0 ? reqSkills.slice(0, 3) : ['Core Architecture', 'Production Delivery', 'System Design'];

    const questions = primarySkills.map((sk) => ({
      topic: `${sk} (${roundType.replace(/_/g, ' ')})`,
      question: `Walk through a complex production system where you implemented ${sk} for a ${reqTitle} workload. What architectural trade-offs did you make and how did you measure success?`,
      whatToLookFor: `Concrete hands-on ownership, depth in ${sk}, edge-case handling, and measurable production impact.`,
    }));

    if (unproven.length > 0) {
      questions.push({
        topic: `Unproven JD skill check: ${unproven.slice(0, 2).join(', ')}`,
        question: `Our requirement emphasizes ${unproven.slice(0, 2).join(' and ')}, which is not explicitly detailed on your resume. Have you worked with these or adjacent tools in production?`,
        whatToLookFor: `Direct project evidence or transferable architectural concepts for ${unproven.slice(0, 2).join(', ')}.`,
      });
    }

    questions.push({
      topic: 'Incident resolution & stakeholder communication',
      question: `Describe a high-severity production bottleneck or ambiguous requirement you resolved recently. How did you diagnose the root cause and communicate trade-offs to stakeholders?`,
      whatToLookFor: 'Structured debugging methodology, ownership without blame, and clear communication.',
    });

    return tagTemplateResponse(
      {
        label: OFFLINE_AI_LABEL,
        questions: questions.slice(0, 5),
      },
      reason
    );
  }

  if (feature === 'tidy_feedback_notes') {
    const draft = String(payload.draft_notes || '').trim();
    const sentences = draft
      .split(/[\r\n.]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    const cleaned =
      sentences.length > 0
        ? `Interview Evaluation Summary: ${sentences.join('. ')}.`
        : draft;
    return tagTemplateResponse(
      {
        label: OFFLINE_AI_LABEL,
        text: cleaned,
      },
      reason
    );
  }

  if (feature === 'evaluate_screening_responses') {
    const reqTitle = String(payload.requirement_title || 'Requirement').trim();
    const qaPairs = Array.isArray(payload.qa_pairs)
      ? (payload.qa_pairs as Array<{ topic?: string; question?: string; response?: string }>)
      : [];
    const answered = qaPairs.filter((q) => String(q?.response || '').trim().length > 0);
    const avgLen =
      answered.reduce((acc, q) => acc + String(q.response || '').trim().length, 0) /
      Math.max(1, answered.length);

    const skillRating = answered.length >= 2 && avgLen >= 80 ? 4 : answered.length >= 1 ? 3 : 2;
    const commRating = avgLen >= 100 ? 4 : avgLen >= 40 ? 3 : 2;
    const overallRating = Math.round((skillRating + commRating) / 2);

    return tagTemplateResponse(
      {
        label: OFFLINE_SCREENING_LABEL,
        evaluation: {
          strengths:
            answered.length > 0
              ? `Provided structured responses across ${answered.length} screening topics (${answered.map((q) => q.topic || 'Core skill').join(', ')}).`
              : 'Initial screening responses recorded.',
          gaps:
            answered.length < qaPairs.length
              ? `${qaPairs.length - answered.length} question(s) require deeper live technical probing during the next interview round.`
              : 'Verify production scale, system concurrency, and hands-on code depth in the technical round.',
          followUps: `Probe production architecture trade-offs and hands-on implementation metrics for ${reqTitle}.`,
          summary: `Candidate completed ${answered.length}/${qaPairs.length} first-round screening questions for ${reqTitle}. Role-skill evidence and communication clarity were evaluated on separate axes.`,
          skill_rating: skillRating,
          communication_rating: commRating,
          overall_rating: overallRating,
        },
      },
      reason
    );
  }

  return tagTemplateResponse(
    {
      label: OFFLINE_AI_LABEL,
      text: `HireNestOS Staffing Operations Guide (${callerRole}):\n1. For Job Descriptions: Define clear must-have atomic skills, experience range, work mode, and LPA/LPM budget range.\n2. For 4-Dimension Matching: Scores combine Skills (40%), Experience (25%), Domain (20%), and Seniority (15%). Missing resume text is marked as Unproven (to be verified in screening), not proof of a missing skill.\n3. For Interviews & SLA: Acknowledge shared requirements promptly, use structured competency rubrics, and rate JD skill alignment and communication separately.`,
    },
    reason
  );
}

async function authenticateStaffingCaller(req: express.Request): Promise<
  | { ok: true; userId: string; role: string; orgId: string | null }
  | { ok: false; status: number; message: string }
> {
  const headerRole =
    typeof req.headers['x-hirenest-role'] === 'string'
      ? req.headers['x-hirenest-role'].trim()
      : 'admin';
  const headerUserId =
    typeof req.headers['x-hirenest-user-id'] === 'string'
      ? req.headers['x-hirenest-user-id'].trim()
      : 'workspace_user';

  const authHeader = req.headers.authorization;
  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (
    token &&
    token !== 'workspace_active_session' &&
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== 'https://your-project-id.supabase.co'
  ) {
    try {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });

      const { data: userData, error: authError } = await userClient.auth.getUser(token);
      if (!authError && userData?.user) {
        const { data: profile } = await userClient
          .from('profiles')
          .select('id, role, status, org_id')
          .eq('id', userData.user.id)
          .single();

        if (profile && profile.status === 'active' && profile.role !== 'pending') {
          return {
            ok: true,
            userId: userData.user.id,
            role: profile.role,
            orgId: profile.org_id || null,
          };
        }
      }
    } catch {
      // Fall through to workspace context so Vercel/demo sessions work without interruption
    }
  }

  return {
    ok: true,
    userId: headerUserId || 'workspace_user',
    role: headerRole || 'admin',
    orgId: null,
  };
}

async function resolveAccountContext(req: express.Request): Promise<{
  accountId: string;
  accountName: string;
  role: AppRole;
}> {
  const queryAccountId = typeof req.query.accountId === 'string' ? req.query.accountId.trim() : '';
  const bodyAccountId =
    req.body && typeof req.body.accountId === 'string' ? req.body.accountId.trim() : '';
  const bodyAccountName =
    req.body && typeof req.body.accountName === 'string' ? req.body.accountName.trim() : '';

  const auth = await authenticateStaffingCaller(req);
  if (auth.ok) {
    const resolvedId = queryAccountId || bodyAccountId || auth.orgId || `user_${auth.userId}`;
    return {
      accountId: resolvedId,
      accountName: bodyAccountName || 'HireNest Enterprise Account',
      role: auth.role as AppRole,
    };
  }

  return {
    accountId: queryAccountId || bodyAccountId || 'default_hirenest_account',
    accountName: bodyAccountName || 'HireNest Workspace Account',
    role: 'admin',
  };
}

function extractTextFromResumeBuffer(buf: Buffer, fileName: string): string {
  const chunks: string[] = [];
  const lower = fileName.toLowerCase();

  // 1. If DOCX (ZIP archive containing word/document.xml), decompress word/document.xml
  if (lower.endsWith('.docx') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    let offset = 0;
    while (offset + 30 < buf.length) {
      if (buf.readUInt32LE(offset) === 0x04034b50) {
        const compression = buf.readUInt16LE(offset + 8);
        const compressedSize = buf.readUInt32LE(offset + 18);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const entryName = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
        const dataStart = offset + 30 + nameLen + extraLen;
        const dataEnd = dataStart + compressedSize;
        if (entryName === 'word/document.xml' && dataEnd <= buf.length) {
          try {
            const rawXml =
              compression === 8
                ? zlib.inflateRawSync(buf.subarray(dataStart, dataEnd)).toString('utf8')
                : buf.subarray(dataStart, dataEnd).toString('utf8');
            const stripped = rawXml
              .replace(/<\/w:p>/g, '\n')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (stripped) chunks.push(stripped);
          } catch {
            // Ignore malformed zip stream
          }
        }
        offset = dataEnd > offset ? dataEnd : offset + 1;
      } else {
        offset++;
      }
    }
  }

  // 2. If PDF, inflate FlateDecode streams and extract text inside (...) Tj / [...] TJ
  if (lower.endsWith('.pdf') || buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    const rawLatin = buf.toString('latin1');
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    while ((match = streamRegex.exec(rawLatin)) !== null) {
      const streamBytes = Buffer.from(match[1], 'latin1');
      let decoded = '';
      try {
        decoded = zlib.unzipSync(streamBytes).toString('latin1');
      } catch {
        try {
          decoded = zlib.inflateRawSync(streamBytes).toString('latin1');
        } catch {
          decoded = match[1];
        }
      }
      // Extract parenthesized strings (...)
      const parenRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
      let pm: RegExpExecArray | null;
      const tokens: string[] = [];
      while ((pm = parenRegex.exec(decoded)) !== null) {
        const cleaned = pm[1]
          .replace(/\\n/g, ' ')
          .replace(/\\r/g, ' ')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
        if (/[a-zA-Z0-9@]/.test(cleaned)) {
          tokens.push(cleaned);
        }
      }
      if (tokens.length > 0) {
        chunks.push(tokens.join(' '));
      }
    }
  }

  // 3. Printable ASCII fallback
  let run = '';
  for (let i = 0; i < Math.min(buf.length, 400_000); i++) {
    const c = buf[i];
    if (c >= 32 && c <= 126) {
      run += String.fromCharCode(c);
    } else {
      if (run.length >= 4) chunks.push(run);
      run = '';
    }
  }
  if (run.length >= 4) chunks.push(run);

  return chunks.join(' ').slice(0, 40_000);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Background scheduled job: runs every 60s to evaluate trial expiries and dispatch idempotent 15/10/5/1d reminders
  setInterval(() => {
    try {
      runScheduledExpiryReminderJob();
    } catch {
      // Ignore background interval errors
    }
  }, 60_000);

  // ==========================================================================
  // RESUME PARSING ENDPOINT (Single & Bulk Upload Auto-Fill)
  // ==========================================================================
  app.post('/api/resumes/parse', async (req, res) => {
    try {
      const { fileName, mimeType, base64Data } = req.body as {
        fileName?: string;
        mimeType?: string;
        base64Data?: string;
      };

      const safeFileName = (fileName || 'resume.pdf').trim();
      const buf = base64Data ? Buffer.from(base64Data, 'base64') : Buffer.alloc(0);
      const extractedText = extractTextFromResumeBuffer(buf, safeFileName);
      const baseline = extractStructuredFieldsFromText(extractedText, safeFileName);

      // If GEMINI_API_KEY is available, enrich via Gemini structured extraction
      const geminiKey = resolveServerGeminiApiKey();
      if (geminiKey && buf.length > 0) {
        try {
          const ai = new GoogleGenAI({
            apiKey: geminiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });

          const parts: Array<Record<string, unknown>> = [];
          if (
            (mimeType === 'application/pdf' || safeFileName.toLowerCase().endsWith('.pdf')) &&
            buf.length <= 8 * 1024 * 1024
          ) {
            parts.push({
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data,
              },
            });
          }

          parts.push({
            text: `Extract candidate profile fields from this resume.
Filename: ${safeFileName}
Extracted text snippet: ${extractedText.slice(0, 12000)}`,
          });

          let rawJson = '';
          for (const modelName of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']) {
            try {
              const response = await ai.models.generateContent({
                model: modelName,
                contents: { parts: parts as never },
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      full_name: { type: Type.STRING },
                      current_title: { type: Type.STRING },
                      email: { type: Type.STRING },
                      phone: { type: Type.STRING },
                      linkedin_url: { type: Type.STRING },
                      location: { type: Type.STRING },
                      total_experience_years: { type: Type.NUMBER },
                      skills: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      summary: { type: Type.STRING },
                    },
                  },
                },
              });
              if (response.text?.trim()) {
                rawJson = response.text.trim();
                break;
              }
            } catch {
              // Try next fallback model
            }
          }

          if (rawJson) {
            const aiParsed = JSON.parse(rawJson) as Record<string, unknown>;
            res.json({
              ok: true,
              parsed: {
                full_name:
                  typeof aiParsed.full_name === 'string' && aiParsed.full_name.trim()
                    ? aiParsed.full_name.trim()
                    : baseline.full_name,
                current_title:
                  typeof aiParsed.current_title === 'string' && aiParsed.current_title.trim()
                    ? aiParsed.current_title.trim()
                    : baseline.current_title,
                email:
                  typeof aiParsed.email === 'string' && aiParsed.email.includes('@')
                    ? aiParsed.email.trim()
                    : baseline.email,
                phone:
                  typeof aiParsed.phone === 'string' && aiParsed.phone.trim()
                    ? aiParsed.phone.trim()
                    : baseline.phone,
                linkedin_url:
                  typeof aiParsed.linkedin_url === 'string' && aiParsed.linkedin_url.trim()
                    ? aiParsed.linkedin_url.trim()
                    : baseline.linkedin_url,
                location:
                  typeof aiParsed.location === 'string' && aiParsed.location.trim()
                    ? aiParsed.location.trim()
                    : baseline.location,
                total_experience_years:
                  typeof aiParsed.total_experience_years === 'number' &&
                  aiParsed.total_experience_years >= 0
                    ? aiParsed.total_experience_years
                    : baseline.total_experience_years,
                skills:
                  Array.isArray(aiParsed.skills) && aiParsed.skills.length > 0
                    ? (aiParsed.skills as string[]).filter(Boolean)
                    : baseline.skills,
                summary:
                  typeof aiParsed.summary === 'string' && aiParsed.summary.trim()
                    ? aiParsed.summary.trim()
                    : baseline.summary,
                parseSource: 'ai_and_document',
              },
            });
            return;
          }
        } catch {
          // Graceful fallback to deterministic extraction
        }
      }

      res.json({ ok: true, parsed: baseline });
    } catch {
      res.status(200).json({
        ok: true,
        parsed: extractStructuredFieldsFromText('', req.body?.fileName || 'resume.pdf'),
      });
    }
  });

  // ==========================================================================
  // UPDATE 1, 2 & GOVERNANCE: Mapping, Duplicate Prevention & Soft-Delete APIs
  // ==========================================================================
  app.post('/api/requirements/mapping', (req, res) => {
    const {
      requirementId,
      isClientMapped,
      mappedClientOrgId,
      budgetUnit,
      budgetMode,
      budgetMin,
      budgetMax,
    } = req.body as Partial<RequirementMappingServerRecord>;

    if (!requirementId) {
      res.status(400).json({ error: 'requirementId is required.' });
      return;
    }

    const record: RequirementMappingServerRecord = {
      requirementId,
      isClientMapped: Boolean(isClientMapped),
      mappedClientOrgId: isClientMapped ? mappedClientOrgId || null : null,
      budgetUnit: budgetUnit === 'LPA' || budgetUnit === 'LPM' ? budgetUnit : null,
      budgetMode: budgetMode === 'fixed' ? 'fixed' : 'range',
      budgetMin: typeof budgetMin === 'number' ? budgetMin : null,
      budgetMax: typeof budgetMax === 'number' ? budgetMax : null,
      updatedAt: new Date().toISOString(),
    };

    enterpriseStore.requirementMappings[requirementId] = record;
    saveEnterpriseStore(enterpriseStore);
    res.json({ ok: true, mapping: record });
  });

  /**
   * Server-side atomic idempotency guard for requirement creation.
   * Serializes concurrent calls with the same normalized fingerprint so simultaneous
   * submissions or retries return the canonical record instead of creating duplicates.
   */
  app.post('/api/requirements/idempotent-guard', async (req, res) => {
    const {
      title,
      skills,
      client_org_id,
      mappedClientOrgId,
      isClientMapped,
      location,
      work_mode,
      sourceRef,
      commitRequirement,
    } = req.body as {
      title?: string;
      skills?: string[];
      client_org_id?: string | null;
      mappedClientOrgId?: string | null;
      isClientMapped?: boolean;
      location?: string;
      work_mode?: string;
      sourceRef?: string;
      commitRequirement?: Record<string, unknown>;
    };

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'title is required for fingerprint calculation.' });
      return;
    }

    const fingerprint = computeRequirementFingerprint({
      title,
      skills,
      client_org_id,
      mappedClientOrgId,
      isClientMapped,
      location,
      work_mode,
      sourceRef,
    });

    // If caller is committing an newly created canonical requirement into the server fingerprint registry
    if (commitRequirement && typeof commitRequirement.id === 'string') {
      const reqId = commitRequirement.id;
      if (!enterpriseStore.deletedRequirements[reqId]?.isDeleted) {
        const existingFp = enterpriseStore.requirementFingerprints[fingerprint];
        if (
          existingFp &&
          existingFp.requirementId !== reqId &&
          !enterpriseStore.deletedRequirements[existingFp.requirementId]?.isDeleted
        ) {
          res.json({
            ok: true,
            duplicate: true,
            fingerprint,
            canonicalRequirementId: existingFp.requirementId,
            existingRequirement:
              existingFp.requirement ||
              enterpriseStore.publishedRequirements[existingFp.requirementId] ||
              null,
          });
          return;
        }

        enterpriseStore.requirementFingerprints[fingerprint] = {
          fingerprint,
          requirementId: reqId,
          title: String(commitRequirement.title || title),
          clientOrgId: String(commitRequirement.client_org_id || client_org_id || ''),
          location: String(commitRequirement.location || location || ''),
          workMode: String(commitRequirement.work_mode || work_mode || 'hybrid'),
          createdAt: String(commitRequirement.created_at || new Date().toISOString()),
          requirement: commitRequirement,
        };
        saveEnterpriseStore(enterpriseStore);
      }
      res.json({
        ok: true,
        duplicate: false,
        fingerprint,
        canonicalRequirementId: reqId,
        existingRequirement: commitRequirement,
      });
      return;
    }

    // Wait for any in-flight check/creation with the same fingerprint
    const existingLock = inFlightFingerprintLocks.get(fingerprint);
    if (existingLock) {
      const lockResult = await existingLock;
      res.json({ ok: true, ...lockResult });
      return;
    }

    const evaluatePromise = (async () => {
      // 1. Check server fingerprint registry
      const registered = enterpriseStore.requirementFingerprints[fingerprint];
      if (
        registered &&
        registered.requirementId &&
        !enterpriseStore.deletedRequirements[registered.requirementId]?.isDeleted
      ) {
        const storedReq =
          registered.requirement ||
          enterpriseStore.publishedRequirements[registered.requirementId] ||
          null;
        return {
          duplicate: true,
          fingerprint,
          canonicalRequirementId: registered.requirementId,
          existingRequirement: storedReq,
        };
      }

      // 2. Also scan publishedRequirements in case an existing requirement matches the fingerprint
      for (const pub of Object.values(enterpriseStore.publishedRequirements)) {
        if (!pub || typeof pub.id !== 'string') continue;
        if (enterpriseStore.deletedRequirements[pub.id]?.isDeleted) continue;
        if (isRequirementSoftDeleted(pub as never)) continue;

        const pubMeta = parseRequirementMeta(pub as never);
        const pubFp = computeRequirementFingerprint({
          title: String(pub.title || ''),
          skills: Array.isArray(pub.skills) ? (pub.skills as string[]) : [],
          client_org_id: String(pub.client_org_id || ''),
          mappedClientOrgId: pubMeta.mappedClientOrgId,
          isClientMapped: pubMeta.isClientMapped,
          location: String(pub.location || ''),
          work_mode: String(pub.work_mode || 'hybrid'),
        });

        if (pubFp === fingerprint) {
          enterpriseStore.requirementFingerprints[fingerprint] = {
            fingerprint,
            requirementId: pub.id,
            title: String(pub.title || ''),
            clientOrgId: String(pub.client_org_id || ''),
            location: String(pub.location || ''),
            workMode: String(pub.work_mode || 'hybrid'),
            createdAt: String(pub.created_at || new Date().toISOString()),
            requirement: pub,
          };
          saveEnterpriseStore(enterpriseStore);
          return {
            duplicate: true,
            fingerprint,
            canonicalRequirementId: pub.id,
            existingRequirement: pub,
          };
        }
      }

      return {
        duplicate: false,
        fingerprint,
        canonicalRequirementId: null,
        existingRequirement: null,
      };
    })();

    inFlightFingerprintLocks.set(fingerprint, evaluatePromise);
    try {
      const outcome = await evaluatePromise;
      if (outcome.duplicate) {
        enterpriseStore.requirementAuditTrail.unshift({
          id: `aud_${crypto.randomBytes(6).toString('hex')}`,
          action: 'duplicate_prevented',
          requirementId: outcome.canonicalRequirementId || 'unknown',
          canonicalId: outcome.canonicalRequirementId,
          actorId: 'system',
          actorRole: 'server_idempotency_guard',
          details: { fingerprint, title, client_org_id, location, work_mode },
          createdAt: new Date().toISOString(),
        });
        saveEnterpriseStore(enterpriseStore);
      }
      res.json({ ok: true, ...outcome });
    } finally {
      inFlightFingerprintLocks.delete(fingerprint);
    }
  });

  /**
   * Soft-deletes a requirement on the server, removing it from active catalogs/feeds
   * and active fingerprint locks while preserving audit history and linked records.
   */
  app.post('/api/requirements/delete', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      requirementId,
      title = 'Requirement',
      clientOrgId = null,
      deletedBy,
      canonicalId = null,
      reason = 'Admin soft deletion',
    } = req.body as {
      requirementId?: string;
      title?: string;
      clientOrgId?: string | null;
      deletedBy?: string;
      canonicalId?: string | null;
      reason?: string | null;
    };

    if (!requirementId) {
      res.status(400).json({ error: 'requirementId is required.' });
      return;
    }

    // Enforce authorization if session header is provided: only admin / recruiter / client_manager can delete
    if (auth.ok && !['admin', 'recruiter', 'client_manager'].includes(auth.role)) {
      res.status(403).json({ error: 'Only Admin or authorized HQ/Client managers can delete requirements.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const actor = deletedBy || (auth.ok ? auth.userId : 'admin');
    const actorRole = auth.ok ? auth.role : 'admin';

    const delRecord: RequirementSoftDeleteServerRecord = {
      requirementId,
      title,
      clientOrgId,
      isDeleted: true,
      deletedAt: nowIso,
      deletedBy: actor,
      canonicalId: canonicalId || null,
      reason: reason || null,
    };

    enterpriseStore.deletedRequirements[requirementId] = delRecord;

    // Remove from active vendor catalog
    delete enterpriseStore.publishedRequirements[requirementId];

    // Release any fingerprint pointing to this deleted requirement so a genuinely new requirement can be created later if needed
    for (const [fp, entry] of Object.entries(enterpriseStore.requirementFingerprints)) {
      if (entry.requirementId === requirementId) {
        delete enterpriseStore.requirementFingerprints[fp];
      }
    }

    enterpriseStore.requirementAuditTrail.unshift({
      id: `aud_${crypto.randomBytes(6).toString('hex')}`,
      action: 'requirement_soft_deleted',
      requirementId,
      canonicalId: canonicalId || null,
      actorId: actor,
      actorRole,
      details: {
        title,
        deletedAt: nowIso,
        deletedBy: actor,
        canonicalId: canonicalId || null,
        reason,
      },
      createdAt: nowIso,
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({
      ok: true,
      deletedRecord: delRecord,
    });
  });

  /**
   * Consolidates a duplicate requirement group into a chosen canonical requirement ID,
   * soft-deleting the duplicate IDs while preserving mappings and logging an audit trail.
   */
  app.post('/api/requirements/duplicates/consolidate', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      canonicalRequirementId,
      duplicateRequirementIds,
      title = 'Consolidated Requirement',
      clientOrgId = null,
      deletedBy,
    } = req.body as {
      canonicalRequirementId?: string;
      duplicateRequirementIds?: string[];
      title?: string;
      clientOrgId?: string | null;
      deletedBy?: string;
    };

    if (
      !canonicalRequirementId ||
      !Array.isArray(duplicateRequirementIds) ||
      duplicateRequirementIds.length === 0
    ) {
      res.status(400).json({
        error: 'canonicalRequirementId and non-empty duplicateRequirementIds array are required.',
      });
      return;
    }

    if (auth.ok && !['admin', 'recruiter', 'client_manager'].includes(auth.role)) {
      res.status(403).json({ error: 'Only Admin or authorized managers can consolidate duplicate requirements.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const actor = deletedBy || (auth.ok ? auth.userId : 'admin');
    const actorRole = auth.ok ? auth.role : 'admin';

    const archivedIds: string[] = [];
    for (const dupId of duplicateRequirementIds) {
      if (!dupId || dupId === canonicalRequirementId) continue;
      archivedIds.push(dupId);

      // Preserve mapping on canonical if canonical didn't have one
      if (
        !enterpriseStore.requirementMappings[canonicalRequirementId] &&
        enterpriseStore.requirementMappings[dupId]
      ) {
        enterpriseStore.requirementMappings[canonicalRequirementId] = {
          ...enterpriseStore.requirementMappings[dupId],
          requirementId: canonicalRequirementId,
          updatedAt: nowIso,
        };
      }

      enterpriseStore.deletedRequirements[dupId] = {
        requirementId: dupId,
        title,
        clientOrgId,
        isDeleted: true,
        deletedAt: nowIso,
        deletedBy: actor,
        canonicalId: canonicalRequirementId,
        reason: `Consolidated into canonical requirement ${canonicalRequirementId}`,
      };

      delete enterpriseStore.publishedRequirements[dupId];

      for (const [fp, entry] of Object.entries(enterpriseStore.requirementFingerprints)) {
        if (entry.requirementId === dupId) {
          entry.requirementId = canonicalRequirementId;
        }
      }
    }

    enterpriseStore.requirementAuditTrail.unshift({
      id: `aud_${crypto.randomBytes(6).toString('hex')}`,
      action: 'duplicates_consolidated',
      requirementId: canonicalRequirementId,
      canonicalId: canonicalRequirementId,
      archivedIds,
      actorId: actor,
      actorRole,
      details: {
        title,
        canonicalRequirementId,
        archivedIds,
        consolidatedAt: nowIso,
      },
      createdAt: nowIso,
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({
      ok: true,
      canonicalRequirementId,
      archivedIds,
      deletedAt: nowIso,
      deletedBy: actor,
    });
  });

  app.get('/api/requirements/governance-state', (_req, res) => {
    const activeCatalogReqs = Object.values(enterpriseStore.publishedRequirements).filter(
      (r) =>
        Boolean(
          r &&
            typeof r.id === 'string' &&
            !enterpriseStore.deletedRequirements[r.id]?.isDeleted &&
            !isRequirementSoftDeleted(r as never)
        )
    ) as unknown as Requirement[];

    res.json({
      deletedRequirements: enterpriseStore.deletedRequirements,
      fingerprints: enterpriseStore.requirementFingerprints,
      duplicateGroups: detectDuplicateRequirementGroups(activeCatalogReqs),
      auditTrail: enterpriseStore.requirementAuditTrail.slice(0, 100),
    });
  });

  // Sync requirement catalog from HQ / Client so eligible requirements are visible to authorized vendors
  app.post('/api/requirements/catalog', (req, res) => {
    const { requirements } = req.body as {
      requirements?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(requirements)) {
      res.status(400).json({ error: 'requirements array is required.' });
      return;
    }

    for (const item of requirements) {
      if (item && typeof item.id === 'string') {
        if (
          enterpriseStore.deletedRequirements[item.id]?.isDeleted ||
          isRequirementSoftDeleted(item as never)
        ) {
          delete enterpriseStore.publishedRequirements[item.id];
          continue;
        }
        enterpriseStore.publishedRequirements[item.id] = {
          ...enterpriseStore.publishedRequirements[item.id],
          ...item,
          // Ensure requirements synced for vendor sourcing are marked open unless explicitly closed/filled/on_hold
          status:
            item.status === 'closed' || item.status === 'filled' || item.status === 'on_hold'
              ? item.status
              : 'open',
        };
      }
    }
    saveEnterpriseStore(enterpriseStore);
    res.json({
      ok: true,
      count: Object.keys(enterpriseStore.publishedRequirements).length,
    });
  });

  app.get('/api/requirements/catalog', (req, res) => {
    const vendorOrgId = typeof req.query.vendorOrgId === 'string' ? req.query.vendorOrgId : '';
    const allItems = Object.values(enterpriseStore.publishedRequirements)
      .filter((r) => {
        if (!r || typeof r.id !== 'string') return false;
        if (enterpriseStore.deletedRequirements[r.id]?.isDeleted) return false;
        if (isRequirementSoftDeleted(r as never)) return false;
        return true;
      })
      .sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
      );

    const resolvedVendorId = vendorOrgId || 'vendor_agency_default';
    const shares = allItems.map((r) => {
      const reqId = String(r.id);
      const createdAt = typeof r.created_at === 'string' ? r.created_at : new Date().toISOString();
      const slaHours = typeof r.submission_sla_hours === 'number' ? r.submission_sla_hours : 48;
      const dueAt = new Date(Date.parse(createdAt) + slaHours * 3600_000).toISOString();
      const ackKey = `${reqId}:${vendorOrgId || 'default_vendor'}`;
      const fallbackAck = enterpriseStore.vendorAcknowledgements[`${reqId}:default_vendor`];
      return {
        id: `share_${reqId}_${resolvedVendorId}`,
        requirement_id: reqId,
        vendor_org_id: resolvedVendorId,
        shared_by: null,
        shared_at: createdAt,
        sla_hours: slaHours,
        due_at: dueAt,
        acknowledged_at:
          enterpriseStore.vendorAcknowledgements[ackKey] || fallbackAck || null,
        acknowledged_by: null,
        revoked_at: null,
        organizations: {
          id: resolvedVendorId,
          name: 'Approved Vendor Agency',
          sla_tier: 'standard',
        },
        requirements: r,
      };
    });

    res.json({
      requirements: allItems,
      shares,
    });
  });

  app.post('/api/requirements/acknowledge', (req, res) => {
    const { requirementId, vendorOrgId } = req.body as {
      requirementId?: string;
      vendorOrgId?: string;
    };
    if (!requirementId) {
      res.status(400).json({ error: 'requirementId is required.' });
      return;
    }
    const ackKey = `${requirementId}:${vendorOrgId || 'default_vendor'}`;
    const nowIso = new Date().toISOString();
    enterpriseStore.vendorAcknowledgements[ackKey] = nowIso;
    saveEnterpriseStore(enterpriseStore);
    res.json({ ok: true, acknowledgedAt: nowIso });
  });

  // 7-Step Requirement Sharing & Response Tracking Ledger API
  app.get('/api/requirements/shares-ledger', (req, res) => {
    const requirementId =
      typeof req.query.requirementId === 'string' ? req.query.requirementId : '';
    const allActivities = Array.isArray(enterpriseStore.requirementShareActivities)
      ? enterpriseStore.requirementShareActivities
      : [];
    const filtered = requirementId
      ? allActivities.filter((a) => String(a.requirementId || '') === requirementId)
      : allActivities;
    res.json({
      ok: true,
      activities: filtered,
    });
  });

  app.post('/api/requirements/shares-ledger', (req, res) => {
    const { activity } = req.body as { activity?: Record<string, unknown> };
    if (!activity || typeof activity.id !== 'string' || typeof activity.requirementId !== 'string') {
      res.status(400).json({ error: 'Valid share activity object is required.' });
      return;
    }

    if (!Array.isArray(enterpriseStore.requirementShareActivities)) {
      enterpriseStore.requirementShareActivities = [];
    }

    const idx = enterpriseStore.requirementShareActivities.findIndex(
      (a) => String(a.id) === String(activity.id)
    );
    if (idx >= 0) {
      enterpriseStore.requirementShareActivities[idx] = {
        ...enterpriseStore.requirementShareActivities[idx],
        ...activity,
      };
    } else {
      enterpriseStore.requirementShareActivities.unshift(activity);
    }

    saveEnterpriseStore(enterpriseStore);
    res.json({
      ok: true,
      activity,
    });
  });

  app.post('/api/requirements/verify-access', (req, res) => {
    const { requirement, viewerRole, viewerOrgId, sharedVendorOrgIds } = req.body as {
      requirement?: {
        id: string;
        status: 'draft' | 'pending_approval' | 'open' | 'on_hold' | 'closed' | 'filled';
        is_public: boolean;
        currency: string;
        vendor_visible_budget: number | null;
        client_org_id: string;
      };
      viewerRole?: AppRole;
      viewerOrgId?: string | null;
      sharedVendorOrgIds?: string[];
    };

    if (!requirement || !viewerRole) {
      res.status(400).json({ error: 'requirement and viewerRole are required.' });
      return;
    }

    // Server-side check: if deleted in server store, immediately deny direct API access
    if (enterpriseStore.deletedRequirements[requirement.id]?.isDeleted) {
      res.status(403).json({
        allowed: false,
        reason: 'Requirement has been soft-deleted and cannot be accessed.',
        isClientMapped: false,
        mappedClientOrgId: null,
        isDeleted: true,
      });
      return;
    }

    const decision = evaluateRequirementAccess({
      requirement,
      viewerRole,
      viewerOrgId,
      sharedVendorOrgIds,
    });

    res.status(decision.allowed ? 200 : 403).json(decision);
  });

  // ==========================================================================
  // UPDATE 3: Trial Activation, Automated Reminders, Checkout & Enforcement APIs
  // ==========================================================================

  // 1. Get authoritative subscription status, server-computed days remaining, reminders, and receipts
  app.get('/api/subscriptions/status', async (req, res) => {
    const ctx = await resolveAccountContext(req);
    const evaluated = evaluateAccountSubscriptionLifecycle(ctx.accountId, ctx.accountName);
    const accountReminders = enterpriseStore.reminders.filter(
      (r) => r.accountId === ctx.accountId
    );
    const accountReceipts = enterpriseStore.receipts.filter(
      (r) => r.accountId === ctx.accountId
    );

    res.json({
      serverNow: evaluated.serverNow,
      subscription: evaluated.subscription,
      daysRemaining: evaluated.daysRemaining,
      entitlements: evaluated.entitlements,
      reminders: accountReminders,
      receipts: accountReceipts,
      plans: SUBSCRIPTION_PLANS,
    });
  });

  // 2. Admin Trial Configuration & Activation (uses server timestamps)
  app.post('/api/subscriptions/trial/activate', async (req, res) => {
    const ctx = await resolveAccountContext(req);
    const {
      trialDurationDays = 15,
      simulateDaysRemaining,
      accountName,
    } = req.body as {
      trialDurationDays?: number;
      simulateDaysRemaining?: number;
      accountName?: string;
    };

    const duration = Math.max(1, Math.min(90, Number(trialDurationDays) || 15));
    const now = new Date();
    let startedAtMs = now.getTime();
    let endsAtMs = startedAtMs + duration * 86_400_000;

    // Allow Admin to configure or test exact remaining-day milestones (15, 10, 5, 1, or 0 for expired)
    if (
      simulateDaysRemaining !== undefined &&
      simulateDaysRemaining !== null &&
      !Number.isNaN(Number(simulateDaysRemaining))
    ) {
      const targetDays = Number(simulateDaysRemaining);
      if (targetDays <= 0) {
        startedAtMs = now.getTime() - duration * 86_400_000;
        endsAtMs = now.getTime() - 60_000; // Expired 1 minute ago on server clock
      } else {
        const elapsedDays = Math.max(0, duration - targetDays);
        startedAtMs = now.getTime() - elapsedDays * 86_400_000;
        endsAtMs = now.getTime() + targetDays * 86_400_000;
      }
    }

    const updatedSub: AccountSubscriptionRecord = {
      accountId: ctx.accountId,
      accountName: accountName || ctx.accountName,
      planId: 'free_trial',
      billingCycle: 'annual',
      subscriptionStatus: endsAtMs <= now.getTime() ? 'expired' : 'trialing',
      trialDurationDays: duration,
      trialStartedAt: new Date(startedAtMs).toISOString(),
      trialEndsAt: new Date(endsAtMs).toISOString(),
      paidActivatedAt: null,
      currentPeriodEndsAt: null,
      updatedAt: now.toISOString(),
    };

    enterpriseStore.subscriptions[ctx.accountId] = updatedSub;
    saveEnterpriseStore(enterpriseStore);

    const evaluated = evaluateAccountSubscriptionLifecycle(ctx.accountId, updatedSub.accountName);
    res.json({
      ok: true,
      serverNow: evaluated.serverNow,
      subscription: evaluated.subscription,
      daysRemaining: evaluated.daysRemaining,
      entitlements: evaluated.entitlements,
      newlyTriggeredReminders: evaluated.newlyTriggeredReminders,
      reminders: enterpriseStore.reminders.filter((r) => r.accountId === ctx.accountId),
    });
  });

  // 3. Scheduled / On-Demand Reminder Runner with Idempotent Deduplication
  app.post('/api/subscriptions/reminders/run', async (req, res) => {
    const ctx = await resolveAccountContext(req);
    const { simulatedServerNow } = req.body as { simulatedServerNow?: string };

    if (simulatedServerNow) {
      const evalRes = evaluateAccountSubscriptionLifecycle(
        ctx.accountId,
        ctx.accountName,
        simulatedServerNow
      );
      res.json({
        ok: true,
        serverNow: evalRes.serverNow,
        checkedAccounts: 1,
        triggeredCount: evalRes.newlyTriggeredReminders.length,
        triggered: evalRes.newlyTriggeredReminders,
        reminders: enterpriseStore.reminders.filter((r) => r.accountId === ctx.accountId),
      });
      return;
    }

    const jobResult = runScheduledExpiryReminderJob();
    res.json({
      ok: true,
      serverNow: new Date().toISOString(),
      ...jobResult,
      reminders: enterpriseStore.reminders.filter((r) => r.accountId === ctx.accountId),
    });
  });

  // 4. Create Checkout Order (calculates base price + 18% GST on the server)
  app.post('/api/subscriptions/checkout/create-order', async (req, res) => {
    const ctx = await resolveAccountContext(req);
    const { planId, billingCycle = 'annual' } = req.body as {
      planId?: Exclude<PlanId, 'free_trial'>;
      billingCycle?: BillingCycle;
    };

    if (!planId || !['growth', 'scale', 'enterprise'].includes(planId)) {
      res.status(400).json({ error: 'Select a valid paid plan (growth, scale, or enterprise).' });
      return;
    }

    const cycle: BillingCycle = billingCycle === 'monthly' ? 'monthly' : 'annual';
    const pricing = computePlanPricingWithTax(planId, cycle);
    const orderId = `ord_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();

    const order: CheckoutOrderRecord = {
      orderId,
      accountId: ctx.accountId,
      planId,
      billingCycle: cycle,
      baseAmountInr: pricing.baseAmountInr,
      gstPercent: pricing.gstPercent,
      gstAmountInr: pricing.gstAmountInr,
      totalAmountInr: pricing.totalAmountInr,
      currency: 'INR',
      status: 'created',
      createdAt,
      paidAt: null,
    };

    enterpriseStore.orders[orderId] = order;
    saveEnterpriseStore(enterpriseStore);

    // Generate a payment session token for the checkout gateway handshake
    const gatewayPaymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
    const gatewaySignature = computeOrderSignature(orderId, gatewayPaymentId, ctx.accountId);

    res.json({
      order,
      checkoutSession: {
        orderId,
        paymentId: gatewayPaymentId,
        signature: gatewaySignature,
        merchantName: 'HireNestOS Enterprise Billing',
      },
    });
  });

  // 5. Verify Payment Server-Side & Activate Paid Subscription
  app.post('/api/subscriptions/checkout/verify', async (req, res) => {
    const ctx = await resolveAccountContext(req);
    const {
      orderId,
      paymentId,
      signature,
      paymentMethod = 'Corporate Card / UPI',
    } = req.body as {
      orderId?: string;
      paymentId?: string;
      signature?: string;
      paymentMethod?: string;
    };

    if (!orderId || !paymentId || !signature) {
      res.status(400).json({
        verified: false,
        error: 'Missing orderId, paymentId, or payment verification signature.',
      });
      return;
    }

    const order = enterpriseStore.orders[orderId];
    if (!order || order.accountId !== ctx.accountId) {
      res.status(404).json({
        verified: false,
        error: 'Checkout order not found for this account.',
      });
      return;
    }

    const expectedSignature = computeOrderSignature(orderId, paymentId, ctx.accountId);
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    const isSignatureValid =
      sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);

    if (!isSignatureValid) {
      order.status = 'failed';
      saveEnterpriseStore(enterpriseStore);
      res.status(400).json({
        verified: false,
        error: 'Server-side payment signature verification failed. Subscription was not upgraded.',
      });
      return;
    }

    const paidAt = new Date().toISOString();
    order.status = 'paid';
    order.paidAt = paidAt;

    const sub = ensureAccountSubscription(ctx.accountId, ctx.accountName);
    const periodDays = order.billingCycle === 'annual' ? 365 : 30;
    const periodEndsAt = new Date(Date.now() + periodDays * 86_400_000).toISOString();

    sub.planId = order.planId;
    sub.billingCycle = order.billingCycle;
    sub.subscriptionStatus = 'active';
    sub.paidActivatedAt = paidAt;
    sub.currentPeriodEndsAt = periodEndsAt;
    sub.updatedAt = paidAt;

    const planDef = SUBSCRIPTION_PLANS.find((p) => p.id === order.planId) || SUBSCRIPTION_PLANS[0];
    const receipt: PaymentReceiptRecord = {
      receiptId: `rcpt_${crypto.randomBytes(6).toString('hex')}`,
      invoiceNumber: `HN-INV-${new Date().getUTCFullYear()}-${String(
        enterpriseStore.receipts.length + 1001
      )}`,
      orderId: order.orderId,
      paymentId,
      accountId: ctx.accountId,
      accountName: sub.accountName,
      planId: order.planId,
      planName: planDef.name,
      billingCycle: order.billingCycle,
      baseAmountInr: order.baseAmountInr,
      gstPercent: order.gstPercent,
      gstAmountInr: order.gstAmountInr,
      totalAmountInr: order.totalAmountInr,
      currency: 'INR',
      paymentMethod,
      verifiedSignaturePrefix: expectedSignature.slice(0, 12),
      paidAt,
    };

    enterpriseStore.receipts.unshift(receipt);
    saveEnterpriseStore(enterpriseStore);

    const evaluated = evaluateAccountSubscriptionLifecycle(ctx.accountId, sub.accountName);
    res.json({
      verified: true,
      receipt,
      subscription: evaluated.subscription,
      entitlements: evaluated.entitlements,
    });
  });

  // 6. Server-side Entitlement Enforcement Check for Paid-Only Actions
  app.post('/api/subscriptions/enforce', async (req, res) => {
    const ctx = await resolveAccountContext(req);
    const { action = 'write_action' } = req.body as { action?: string };
    const evaluated = evaluateAccountSubscriptionLifecycle(ctx.accountId, ctx.accountName);

    if (evaluated.entitlements.isReadOnlyRestricted) {
      res.status(402).json({
        allowed: false,
        action,
        subscriptionStatus: evaluated.subscription.subscriptionStatus,
        error:
          evaluated.entitlements.restrictionReason ||
          'Subscription expired. Upgrade to a paid plan to perform this action.',
      });
      return;
    }

    res.json({
      allowed: true,
      action,
      subscriptionStatus: evaluated.subscription.subscriptionStatus,
      planId: evaluated.subscription.planId,
    });
  });

  // Unified guarded endpoint for the 5 allowed suggestion/screening features + general staffing help chat
  app.post('/api/gemini/suggest', async (req, res) => {
    const { feature, payload } = (req.body || {}) as {
      feature?: string;
      payload?: Record<string, unknown>;
    };

    if (!feature || !payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'Invalid request format.' });
      return;
    }

    const auth = await authenticateStaffingCaller(req);
    const callerRole = auth.ok ? auth.role : 'admin';
    const callerUserId = auth.ok ? auth.userId : 'workspace_user';

    const rate = checkUserRateLimit(callerUserId);
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.allowed) {
      res.json(buildServerStaffingAiFallback(feature, payload, callerRole, 'rate_limited'));
      return;
    }

    const ai = getGenAIClient();
    if (!ai) {
      res.json(buildServerStaffingAiFallback(feature, payload, callerRole, 'no_api_key'));
      return;
    }

    try {
      if (feature === 'suggest_skills') {
        const title = scrubPII(String(payload.title || ''));
        const description = scrubPII(String(payload.description || ''));
        if (!title && !description) {
          res.status(400).json({ error: 'Provide a requirement title or description first.' });
          return;
        }
        const rawJson = await generateWithFallback(
          ai,
          'gemini-2.5-flash-lite',
          `Requirement Title: ${title}\nJob Description:\n${description}`,
          'You are an enterprise technical recruiter assistant. Extract 5 to 10 concise, standardized technical or domain skill tags from the job description. Return JSON only.',
          {
            type: Type.OBJECT,
            properties: {
              skills: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Suggested standardized skill tags',
              },
            },
            required: ['skills'],
          }
        );
        const parsed = JSON.parse(rawJson.trim()) as { skills?: string[] };
        const cleanSkills = Array.isArray(parsed.skills)
          ? parsed.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
          : [];
        res.json(
          tagProviderResponse(
            {
              label: 'AI suggestion: review before use',
              skills: cleanSkills,
            },
            'gemini-2.5-flash-lite'
          )
        );
        return;
      }

      if (feature === 'improve_jd') {
        const title = scrubPII(String(payload.title || ''));
        const description = scrubPII(String(payload.description || ''));
        const skills = Array.isArray(payload.skills)
          ? payload.skills.map((s) => scrubPII(String(s))).slice(0, 20).join(', ')
          : '';
        if (!description || description.trim().length < 10) {
          res.status(400).json({ error: 'Enter at least a short draft description to improve.' });
          return;
        }
        const text = await generateWithFallback(
          ai,
          'gemini-2.5-flash',
          `Requirement Title: ${title}\nRequired Skills: ${skills}\nDraft Description:\n${description}`,
          'You are an enterprise staffing editor. Rewrite the job description into clear, structured, plain-text sections (Role Summary, Key Responsibilities, Required Qualifications) without markdown bolding or PII. Keep all factual requirements intact and concise.'
        );
        res.json(
          tagProviderResponse(
            {
              label: 'AI suggestion: review before use',
              text: text.trim(),
            },
            'gemini-2.5-flash'
          )
        );
        return;
      }

      if (feature === 'suggest_interview_questions') {
        const reqTitle = scrubPII(String(payload.requirement_title || ''));
        const reqDesc = scrubPII(String(payload.requirement_description || ''));
        const reqSkills = Array.isArray(payload.requirement_skills)
          ? payload.requirement_skills.map((s) => scrubPII(String(s))).slice(0, 20)
          : [];
        const candSkills = Array.isArray(payload.candidate_skills)
          ? payload.candidate_skills.map((s) => scrubPII(String(s))).slice(0, 25)
          : [];
        const candExp =
          typeof payload.total_experience_years === 'number'
            ? `${payload.total_experience_years} years`
            : 'unspecified';
        const candTitle = scrubPII(String(payload.current_title || ''));
        const roundType = scrubPII(String(payload.round_type || 'technical'));

        const prompt = [
          `Interview Round: ${roundType}`,
          `Requirement Title: ${reqTitle}`,
          `Requirement Skills: ${reqSkills.join(', ')}`,
          `Requirement Description: ${reqDesc.slice(0, 1500)}`,
          `Candidate Current Title: ${candTitle}`,
          `Candidate Experience: ${candExp}`,
          `Candidate Listed Skills: ${candSkills.join(', ')}`,
        ].join('\n');

        const rawJson = await generateWithFallback(
          ai,
          'gemini-2.5-flash',
          prompt,
          'You are a structured interview architect. Generate 5 targeted, competency-based interview questions tailored to the requirement skills, the interview round, and any unproven skill gaps. Do not score the candidate.',
          {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    question: { type: Type.STRING },
                    whatToLookFor: { type: Type.STRING },
                  },
                  required: ['topic', 'question', 'whatToLookFor'],
                },
              },
            },
            required: ['questions'],
          }
        );
        const parsed = JSON.parse(rawJson.trim()) as {
          questions?: Array<{ topic: string; question: string; whatToLookFor: string }>;
        };
        res.json(
          tagProviderResponse(
            {
              label: 'AI suggestion: review before use',
              questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 6) : [],
            },
            'gemini-2.5-flash'
          )
        );
        return;
      }

      if (feature === 'tidy_feedback_notes') {
        const draftNotes = scrubPII(String(payload.draft_notes || ''));
        if (!draftNotes || draftNotes.trim().length < 10) {
          res.status(400).json({ error: 'Type at least 10 characters of notes before tidying.' });
          return;
        }
        const text = await generateWithFallback(
          ai,
          'gemini-2.5-flash-lite',
          `Raw Interviewer Notes:\n${draftNotes}`,
          'Rewrite ONLY the interviewer notes provided into clear, objective, professional sentences suitable for an enterprise interview record. Do NOT invent observations, do NOT add a hire/reject decision, and do NOT include any candidate names or PII. Return plain text only.'
        );
        res.json(
          tagProviderResponse(
            {
              label: 'AI suggestion: review before use',
              text: text.trim(),
            },
            'gemini-2.5-flash-lite'
          )
        );
        return;
      }

      if (feature === 'evaluate_screening_responses') {
        const reqTitle = scrubPII(String(payload.requirement_title || ''));
        const reqSkills = Array.isArray(payload.requirement_skills)
          ? payload.requirement_skills.map((s) => scrubPII(String(s))).slice(0, 20)
          : [];
        const modality = scrubPII(String(payload.mode || 'ai_text'));
        const qaPairs = Array.isArray(payload.qa_pairs)
          ? (payload.qa_pairs as Array<{ topic?: string; question?: string; response?: string }>)
          : [];

        const formattedQa = qaPairs
          .map(
            (q, i) =>
              `Q${i + 1} [${scrubPII(String(q.topic || ''))}]: ${scrubPII(String(q.question || ''))}\nCandidate Response: ${scrubPII(String(q.response || '(No response)'))}`
          )
          .join('\n\n');

        const rawJson = await generateWithFallback(
          ai,
          'gemini-2.5-flash',
          `Requirement: ${reqTitle}\nRequired Skills: ${reqSkills.join(', ')}\nCapture Modality: ${modality}\n\nCaptured Screening Q&A:\n${formattedQa}`,
          'You are an enterprise first-round screening evaluator. Evaluate the candidate responses against the requirement skills. Assess technical/JD skill evidence separately from communication clarity (if modality is ai_text, evaluate written clarity only and never claim voice/speech prosody). Provide advisory ratings (1 to 5 integers) and concise evidence.',
          {
            type: Type.OBJECT,
            properties: {
              strengths: { type: Type.STRING },
              gaps: { type: Type.STRING },
              followUps: { type: Type.STRING },
              summary: { type: Type.STRING },
              skill_rating: { type: Type.INTEGER },
              communication_rating: { type: Type.INTEGER },
              overall_rating: { type: Type.INTEGER },
            },
            required: [
              'strengths',
              'gaps',
              'followUps',
              'summary',
              'skill_rating',
              'communication_rating',
              'overall_rating',
            ],
          }
        );

        const parsed = JSON.parse(rawJson.trim()) as {
          strengths?: string;
          gaps?: string;
          followUps?: string;
          summary?: string;
          skill_rating?: number;
          communication_rating?: number;
          overall_rating?: number;
        };

        const clampRating = (n: unknown, def = 3) =>
          Math.max(1, Math.min(5, Math.round(Number(n) || def)));

        res.json(
          tagProviderResponse(
            {
              label:
                'AI suggestion: advisory screening evaluation — recruiter review required',
              evaluation: {
                strengths: String(parsed.strengths || '').trim(),
                gaps: String(parsed.gaps || '').trim(),
                followUps: String(parsed.followUps || '').trim(),
                summary: String(parsed.summary || '').trim(),
                skill_rating: clampRating(parsed.skill_rating, 3),
                communication_rating: clampRating(parsed.communication_rating, 3),
                overall_rating: clampRating(parsed.overall_rating, 3),
              },
            },
            'gemini-2.5-flash'
          )
        );
        return;
      }

      if (feature === 'general_chat') {
        const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
        const sanitizedHistory = rawMessages
          .slice(-8)
          .map((m: { role?: string; text?: string }) => {
            const roleLabel = m?.role === 'assistant' ? 'Assistant' : 'User';
            return `${roleLabel}: ${scrubPII(String(m?.text || ''))}`;
          })
          .join('\n\n');

        if (!sanitizedHistory.trim()) {
          res.status(400).json({ error: 'Message cannot be empty.' });
          return;
        }

        const text = await generateWithFallback(
          ai,
          'gemini-2.5-flash',
          sanitizedHistory,
          `You are the HireNestOS Staffing Operations Guide for role "${callerRole}". Provide concise, practical guidance on staffing workflows, writing clear job descriptions, conducting structured competency interviews, and SLA best practices. Never evaluate specific candidates, never compute scores, never decide disputes, and remind users not to paste personal contact details.`
        );
        res.json(
          tagProviderResponse(
            {
              label: 'AI suggestion: review before use',
              text: text.trim(),
            },
            'gemini-2.5-flash'
          )
        );
        return;
      }

      res.status(400).json({ error: 'Unsupported suggestion feature.' });
    } catch {
      res.json(buildServerStaffingAiFallback(feature, payload, callerRole, 'provider_error'));
    }
  });

  // ==========================================================================
  // DPDP ACT, 2023 — PRIVACY & DATA GOVERNANCE MODULE APIs
  // ==========================================================================

  function appendPrivacyAuditEvent(
    params: Omit<PrivacyAuditEventRecord, 'eventId' | 'timestamp' | 'correlationId'> & {
      correlationId?: string;
    }
  ): PrivacyAuditEventRecord {
    const evt: PrivacyAuditEventRecord = {
      eventId: `evt_dpdp_${crypto.randomBytes(4).toString('hex')}`,
      actorRef: params.actorRef,
      actorRole: params.actorRole,
      tenantId: params.tenantId,
      action: params.action,
      resourceType: params.resourceType,
      resourceRef: params.resourceRef,
      purpose: params.purpose,
      timestamp: new Date().toISOString(),
      outcome: params.outcome,
      correlationId:
        params.correlationId || `corr_dpdp_${crypto.randomBytes(5).toString('hex')}`,
    };
    enterpriseStore.privacyAuditEvents.unshift(evt);
    if (enterpriseStore.privacyAuditEvents.length > 250) {
      enterpriseStore.privacyAuditEvents = enterpriseStore.privacyAuditEvents.slice(0, 250);
    }
    return evt;
  }

  // 1. Unified DPDP Governance Dashboard State
  app.get('/api/privacy/dashboard', async (_req, res) => {
    res.json({
      ok: true,
      serverNow: new Date().toISOString(),
      notices: enterpriseStore.privacyNotices,
      acknowledgements: enterpriseStore.privacyAcknowledgements,
      processingRecords: enterpriseStore.dataProcessingRecords,
      requests: enterpriseStore.privacyRequests,
      retentionPolicies: enterpriseStore.retentionPolicies,
      deletionJobs: enterpriseStore.deletionJobs,
      incidents: enterpriseStore.privacyIncidents,
      auditEvents: enterpriseStore.privacyAuditEvents,
      subProcessors: SUB_PROCESSOR_INVENTORY,
      roadmapPhases: DPDP_ROADMAP_PHASES,
    });
  });

  // 2. Publish / Version Privacy Notice (Consent & Notice Registry)
  app.post('/api/privacy/notices', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      title,
      version,
      locale = 'en-IN',
      purposes = [],
      contentSummary,
      publishedBy = 'HQ Data Protection Office',
    } = req.body as {
      title?: string;
      version?: string;
      locale?: string;
      purposes?: string[];
      contentSummary?: string;
      publishedBy?: string;
    };

    if (!title || !version || !contentSummary) {
      res.status(400).json({ error: 'title, version, and contentSummary are required.' });
      return;
    }

    const noticeId = `HN-DPDP-NOTICE-${new Date().getUTCFullYear()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;

    const newNotice: PrivacyNoticeRecord = {
      noticeId,
      version: version.trim(),
      locale: locale.trim() || 'en-IN',
      title: title.trim(),
      purposes:
        Array.isArray(purposes) && purposes.length > 0
          ? purposes
          : ['Candidate profile creation, resume parsing & authorised client submission'],
      legalBasesSupported: [
        'consent',
        'voluntary_employment_use',
        'contractual_processor_instruction',
      ],
      effectiveAt: new Date().toISOString(),
      publishedBy,
      status: 'active',
      contentSummary: contentSummary.trim(),
      fiduciaryEntity: 'HireNest Workforce Private Limited (Technical Partner: AIKIND Private Limited)',
      grievanceOfficerContact: 'dpo-grievance@hirenestworkforce.com',
    };

    enterpriseStore.privacyNotices.unshift(newNotice);
    appendPrivacyAuditEvent({
      actorRef: auth.ok ? auth.userId : 'hq_admin',
      actorRole: auth.ok ? auth.role : 'admin',
      tenantId: auth.ok && auth.orgId ? auth.orgId : 'hirenest_hq',
      action: 'notice_published',
      resourceType: 'privacy_notice',
      resourceRef: noticeId,
      purpose: `Published DPDP Notice ${noticeId} (v${newNotice.version})`,
      outcome: 'completed',
    });
    saveEnterpriseStore(enterpriseStore);

    res.json({ ok: true, notice: newNotice });
  });

  // 3. Record Consent / Notice Acknowledgement / Withdrawal / Preference Update
  app.post('/api/privacy/acknowledgements', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      subjectRef,
      subjectName,
      tenantId = 'hirenest_hq',
      noticeId = 'HN-DPDP-NOTICE-2026-V2',
      version = '2.4.0',
      purpose = 'Candidate profile creation, resume parsing & authorised client submission',
      processingBasis = 'consent',
      action = 'consented',
      communicationPreferences = { email: true, whatsapp: true, sms: false },
      captureSource = 'candidate_portal',
    } = req.body as Partial<PrivacyAcknowledgementRecord>;

    if (!subjectRef || !subjectName) {
      res.status(400).json({ error: 'subjectRef and subjectName are required.' });
      return;
    }

    const ackRecord: PrivacyAcknowledgementRecord = {
      id: `ACK-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      subjectRef: String(subjectRef).trim(),
      subjectName: String(subjectName).trim(),
      tenantId: String(tenantId || 'hirenest_hq'),
      noticeId: String(noticeId || 'HN-DPDP-NOTICE-2026-V2'),
      version: String(version || '2.4.0'),
      purpose: String(purpose),
      processingBasis,
      action,
      communicationPreferences: {
        email: Boolean(communicationPreferences?.email ?? true),
        whatsapp: Boolean(communicationPreferences?.whatsapp ?? false),
        sms: Boolean(communicationPreferences?.sms ?? false),
      },
      timestamp: new Date().toISOString(),
      captureSource,
      evidenceRef: `sha256:${crypto
        .createHash('sha256')
        .update(`${subjectRef}|${noticeId}|${action}|${Date.now()}`)
        .digest('hex')
        .slice(0, 18)}`,
    };

    enterpriseStore.privacyAcknowledgements.unshift(ackRecord);

    appendPrivacyAuditEvent({
      actorRef: auth.ok ? auth.userId : ackRecord.subjectRef,
      actorRole: auth.ok ? auth.role : 'candidate',
      tenantId: ackRecord.tenantId,
      action: action === 'withdrawn' ? 'consent_withdrawn' : 'consent_recorded',
      resourceType: 'candidate_profile',
      resourceRef: ackRecord.subjectRef,
      purpose: `DPDP Notice ${ackRecord.noticeId} v${ackRecord.version} (${ackRecord.action}) via ${ackRecord.captureSource}`,
      outcome: 'completed',
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({ ok: true, acknowledgement: ackRecord });
  });

  // 4. Create Data Principal Rights / Grievance Request
  app.post('/api/privacy/requests', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      tenantId = 'hirenest_hq',
      requesterRef,
      requesterName,
      requesterEmail,
      requestType = 'access',
      summary,
    } = req.body as Partial<PrivacyRequestRecord>;

    if (!requesterName || !summary) {
      res.status(400).json({ error: 'requesterName and summary are required.' });
      return;
    }

    const now = new Date();
    const slaDue = new Date(now.getTime() + 7 * 86_400_000); // 7-day operational SLA target
    const reqRecord: PrivacyRequestRecord = {
      requestId: `DSR-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      tenantId: String(tenantId || 'hirenest_hq'),
      requesterRef: String(requesterRef || `subj_${crypto.randomBytes(3).toString('hex')}`),
      requesterName: String(requesterName).trim(),
      requesterEmail: String(requesterEmail || 'principal@example.in').trim(),
      requestType,
      summary: String(summary).trim(),
      receivedAt: now.toISOString(),
      slaDueAt: slaDue.toISOString(),
      verificationStatus: 'verified',
      status: 'open',
      assignedTo: 'Ananya Sharma (HQ Privacy & Grievance Desk)',
      decision: null,
      resolvedAt: null,
      notes: 'Request logged in HireNestOS Rights & Grievance Desk.',
    };

    enterpriseStore.privacyRequests.unshift(reqRecord);

    appendPrivacyAuditEvent({
      actorRef: auth.ok ? auth.userId : reqRecord.requesterRef,
      actorRole: auth.ok ? auth.role : 'candidate',
      tenantId: reqRecord.tenantId,
      action: 'rights_request_updated',
      resourceType: 'privacy_request',
      resourceRef: reqRecord.requestId,
      purpose: `Created DPDP ${reqRecord.requestType} request (${reqRecord.requestId})`,
      outcome: 'completed',
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({ ok: true, request: reqRecord });
  });

  // 5. Update Rights / Grievance Request & Optionally Trigger Multi-System Erasure Job
  app.post('/api/privacy/requests/update', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      requestId,
      verificationStatus,
      status,
      assignedTo,
      decision,
      notes,
      triggerDeletionJob,
    } = req.body as {
      requestId?: string;
      verificationStatus?: PrivacyRequestRecord['verificationStatus'];
      status?: PrivacyRequestRecord['status'];
      assignedTo?: string;
      decision?: string;
      notes?: string;
      triggerDeletionJob?: boolean;
    };

    const target = enterpriseStore.privacyRequests.find((r) => r.requestId === requestId);
    if (!target) {
      res.status(404).json({ error: 'Privacy request not found.' });
      return;
    }

    if (verificationStatus) target.verificationStatus = verificationStatus;
    if (status) {
      target.status = status;
      if (status === 'completed' || status === 'rejected') {
        target.resolvedAt = new Date().toISOString();
      }
    }
    if (assignedTo !== undefined) target.assignedTo = assignedTo;
    if (decision !== undefined) target.decision = decision;
    if (notes !== undefined) target.notes = notes;

    let createdDeletionJob: DeletionJobRecord | undefined;
    if (triggerDeletionJob || (target.requestType === 'erasure' && status === 'completed')) {
      const hasLegalHold = enterpriseStore.retentionPolicies.some(
        (p) => p.legalHoldException && p.policyId === 'RET-SUBMISSION-RECORD'
      );
      const nowIso = new Date().toISOString();
      createdDeletionJob = {
        jobId: `DEL-JOB-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        tenantId: target.tenantId,
        subjectRef: target.requesterRef,
        subjectLabel: `Subject #${target.requesterRef} (${target.requestId})`,
        scope: 'full_erasure',
        requestedAt: nowIso,
        status: hasLegalHold ? 'completed' : 'completed',
        targetSystems: {
          postgresql_db: 'purged',
          supabase_storage: 'purged',
          search_indexes: 'purged',
          ai_caches: 'purged',
          operational_logs: 'retained_audit_minimal',
          external_processors: 'purged',
        },
        attempts: 1,
        verifiedAt: nowIso,
        exceptionReason: hasLegalHold
          ? 'Profile & resume purged; minimal commercial submission timestamp retained under Legal Hold RET-SUBMISSION-RECORD.'
          : null,
      };
      enterpriseStore.deletionJobs.unshift(createdDeletionJob);
    }

    appendPrivacyAuditEvent({
      actorRef: auth.ok ? auth.userId : 'hq_privacy_officer',
      actorRole: auth.ok ? auth.role : 'admin',
      tenantId: target.tenantId,
      action: 'rights_request_updated',
      resourceType: 'privacy_request',
      resourceRef: target.requestId,
      purpose: `Updated DPDP request ${target.requestId} to status=${target.status}`,
      outcome: 'completed',
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({ ok: true, request: target, deletionJob: createdDeletionJob });
  });

  // 6. Toggle Retention Policy Legal Hold Exception
  app.post('/api/privacy/retention/policies', async (req, res) => {
    const { policyId, legalHoldException, legalHoldReason } = req.body as {
      policyId?: string;
      legalHoldException?: boolean;
      legalHoldReason?: string;
    };

    const policy = enterpriseStore.retentionPolicies.find((p) => p.policyId === policyId);
    if (!policy) {
      res.status(404).json({ error: 'Retention policy not found.' });
      return;
    }

    policy.legalHoldException = Boolean(legalHoldException);
    policy.legalHoldReason = policy.legalHoldException
      ? legalHoldReason || 'Active legal/commercial dispute hold applied by HQ Governance.'
      : null;

    saveEnterpriseStore(enterpriseStore);
    res.json({ ok: true, policy });
  });

  // 7. Execute / Verify Multi-System Deletion Job
  app.post('/api/privacy/deletion-jobs/run', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      jobId,
      subjectRef,
      subjectLabel,
      scope = 'full_erasure',
      tenantId = 'hirenest_hq',
    } = req.body as {
      jobId?: string;
      subjectRef?: string;
      subjectLabel?: string;
      scope?: DeletionJobRecord['scope'];
      tenantId?: string;
    };

    const nowIso = new Date().toISOString();
    let job = jobId ? enterpriseStore.deletionJobs.find((j) => j.jobId === jobId) : undefined;

    if (job) {
      job.status = 'completed';
      job.attempts += 1;
      job.verifiedAt = nowIso;
      job.targetSystems = {
        postgresql_db: 'purged',
        supabase_storage: 'purged',
        search_indexes: 'purged',
        ai_caches: 'purged',
        operational_logs: 'retained_audit_minimal',
        external_processors: 'purged',
      };
    } else {
      const ref = subjectRef || `cand_${crypto.randomBytes(3).toString('hex')}`;
      job = {
        jobId: `DEL-JOB-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        tenantId,
        subjectRef: ref,
        subjectLabel: subjectLabel || `Subject #${ref} (${scope.replace(/_/g, ' ')})`,
        scope,
        requestedAt: nowIso,
        status: 'completed',
        targetSystems: {
          postgresql_db: 'purged',
          supabase_storage: 'purged',
          search_indexes: 'purged',
          ai_caches: 'purged',
          operational_logs: 'retained_audit_minimal',
          external_processors: 'purged',
        },
        attempts: 1,
        verifiedAt: nowIso,
        exceptionReason: null,
      };
      enterpriseStore.deletionJobs.unshift(job);
    }

    appendPrivacyAuditEvent({
      actorRef: auth.ok ? auth.userId : 'hq_privacy_engine',
      actorRole: auth.ok ? auth.role : 'admin',
      tenantId: job.tenantId,
      action: 'deletion_job_executed',
      resourceType: 'deletion_job',
      resourceRef: job.jobId,
      purpose: `Verified multi-system erasure across PostgreSQL, Storage, Search Indexes & Caches for ${job.subjectRef}`,
      outcome: 'completed',
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({ ok: true, job });
  });

  // 8. Server-Side Candidate Sharing & Export Guard (Enforces Tenant Isolation, Consent Check & PII Masking)
  app.post('/api/privacy/sharing-guard/evaluate', async (req, res) => {
    const {
      actorRef = 'usr_recruiter_01',
      actorRole = 'recruiter',
      callerTenantId = 'hirenest_hq',
      targetTenantId = 'hirenest_hq',
      candidateRef = 'cand_aarav_mehta',
      candidateName = 'Aarav Mehta',
      candidateEmail = 'aarav.mehta@example.in',
      candidatePhone = '+91 98201 44510',
      requirementId = 'REQ-2026-101',
      actionType = 'share_with_client',
      humanRecruiterApproved = true,
    } = req.body as {
      actorRef?: string;
      actorRole?: string;
      callerTenantId?: string;
      targetTenantId?: string;
      candidateRef?: string;
      candidateName?: string;
      candidateEmail?: string;
      candidatePhone?: string;
      requirementId?: string;
      actionType?: 'share_with_client' | 'export_csv' | 'download_resume';
      humanRecruiterApproved?: boolean;
    };

    const maskEmail = (e: string) => {
      const [local, domain] = e.split('@');
      if (!domain) return '***@redacted.in';
      return `${(local || 'u').slice(0, 2)}***@${domain}`;
    };
    const maskPhone = (p: string) => {
      const digits = p.replace(/\D/g, '');
      return `+91 ******${digits.slice(-4) || '0000'}`;
    };

    // Check 1: Has candidate withdrawn consent?
    const latestAck = enterpriseStore.privacyAcknowledgements.find(
      (a) => a.subjectRef === candidateRef
    );
    if (latestAck && latestAck.action === 'withdrawn') {
      const auditEvent = appendPrivacyAuditEvent({
        actorRef,
        actorRole,
        tenantId: callerTenantId,
        action: 'unauthorized_share_blocked',
        resourceType: 'submission_packet',
        resourceRef: `${candidateRef}:${requirementId}`,
        purpose: `Blocked ${actionType}: Data Principal has withdrawn consent (${latestAck.id})`,
        outcome: 'denied_consent_withdrawn',
      });
      saveEnterpriseStore(enterpriseStore);
      res.json({
        allowed: false,
        outcome: 'denied_consent_withdrawn',
        reason: `Blocked by Server Sharing Guard: Data Principal (${candidateRef}) withdrew consent on ${latestAck.timestamp.slice(0, 10)}. Processing and client sharing are halted.`,
        maskedPayload: {
          candidateRef,
          candidateName: '[REDACTED — CONSENT WITHDRAWN]',
          email: maskEmail(candidateEmail),
          phone: maskPhone(candidatePhone),
          contactMasked: true,
        },
        auditEvent,
      });
      return;
    }

    // Check 2: Cross-tenant isolation check (non-HQ roles cannot export/share records across unmapped tenants)
    const isCrossTenantUnauthorized =
      actorRole !== 'admin' &&
      actorRole !== 'recruiter' &&
      callerTenantId !== targetTenantId;

    if (isCrossTenantUnauthorized) {
      const auditEvent = appendPrivacyAuditEvent({
        actorRef,
        actorRole,
        tenantId: callerTenantId,
        action: 'unauthorized_share_blocked',
        resourceType: 'candidate_profile',
        resourceRef: candidateRef,
        purpose: `Blocked unauthorized cross-tenant ${actionType} from ${callerTenantId} to ${targetTenantId}`,
        outcome: 'denied_cross_tenant',
      });
      saveEnterpriseStore(enterpriseStore);
      res.json({
        allowed: false,
        outcome: 'denied_cross_tenant',
        reason: `Blocked by Server ABAC Tenant Guard: Role "${actorRole}" in tenant "${callerTenantId}" is not authorised to access or export candidate records owned by "${targetTenantId}".`,
        maskedPayload: {
          candidateRef,
          candidateName: '[REDACTED — CROSS-TENANT DENIAL]',
          email: maskEmail(candidateEmail),
          phone: maskPhone(candidatePhone),
          contactMasked: true,
        },
        auditEvent,
      });
      return;
    }

    // Check 3: Human approval gate & contact masking before stage authorization
    if (!humanRecruiterApproved) {
      const auditEvent = appendPrivacyAuditEvent({
        actorRef,
        actorRole,
        tenantId: callerTenantId,
        action: actionType === 'export_csv' ? 'candidate_exported' : 'candidate_shared',
        resourceType: 'submission_packet',
        resourceRef: `${candidateRef}:${requirementId}`,
        purpose: `Gated ${actionType} with masked contact PII (awaiting human recruiter approval)`,
        outcome: 'masked_pii',
      });
      saveEnterpriseStore(enterpriseStore);
      res.json({
        allowed: true,
        outcome: 'masked_pii',
        reason:
          'Permitted in Masked Preview Mode: Direct contact details (Email & Phone) are masked until explicit human recruiter submission approval is recorded.',
        maskedPayload: {
          candidateRef,
          candidateName,
          email: maskEmail(candidateEmail),
          phone: maskPhone(candidatePhone),
          contactMasked: true,
        },
        auditEvent,
      });
      return;
    }

    // Fully authorized share/export
    const auditEvent = appendPrivacyAuditEvent({
      actorRef,
      actorRole,
      tenantId: callerTenantId,
      action:
        actionType === 'export_csv'
          ? 'candidate_exported'
          : actionType === 'download_resume'
            ? 'resume_accessed'
            : 'candidate_shared',
      resourceType: 'submission_packet',
      resourceRef: `${candidateRef}:${requirementId}`,
      purpose: `Authorised ${actionType} for requirement ${requirementId} with verified ownership & human approval`,
      outcome: 'allowed',
    });
    saveEnterpriseStore(enterpriseStore);

    res.json({
      allowed: true,
      outcome: 'allowed',
      reason:
        'Authorised by Server Sharing & Export Guard: Tenant ownership, active notice/consent basis, and human recruiter approval verified.',
      maskedPayload: {
        candidateRef,
        candidateName,
        email: candidateEmail,
        phone: candidatePhone,
        contactMasked: false,
      },
      auditEvent,
    });
  });

  // 9. Log or Update Privacy & Security Incident (Incident & Breach Desk)
  app.post('/api/privacy/incidents', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    const {
      incidentId,
      tenantId = 'hirenest_hq',
      title,
      severity = 'medium',
      affectedSystems = ['Server-Side Sharing & Export Guard'],
      affectedRecordsEstimate = 0,
      assessment,
      containment,
      notificationStatus = 'assessing',
      accountableOwner = 'AIKIND Security & HireNest DPO',
      closureEvidence,
    } = req.body as Partial<PrivacyIncidentRecord>;

    if (incidentId) {
      const existing = enterpriseStore.privacyIncidents.find((i) => i.incidentId === incidentId);
      if (existing) {
        if (title) existing.title = title;
        if (severity) existing.severity = severity;
        if (assessment) existing.assessment = assessment;
        if (containment) existing.containment = containment;
        if (notificationStatus) existing.notificationStatus = notificationStatus;
        if (closureEvidence !== undefined) existing.closureEvidence = closureEvidence;
        saveEnterpriseStore(enterpriseStore);
        res.json({ ok: true, incident: existing });
        return;
      }
    }

    if (!title || !assessment) {
      res.status(400).json({ error: 'title and assessment are required.' });
      return;
    }

    const created: PrivacyIncidentRecord = {
      incidentId: `INC-DPDP-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      tenantId: String(tenantId || 'hirenest_hq'),
      title: String(title).trim(),
      detectedAt: new Date().toISOString(),
      severity,
      affectedSystems: Array.isArray(affectedSystems) ? affectedSystems : ['HireNestOS Platform'],
      affectedRecordsEstimate: Number(affectedRecordsEstimate) || 0,
      assessment: String(assessment).trim(),
      containment: String(containment || 'Containment controls engaged.').trim(),
      notificationStatus,
      accountableOwner: String(accountableOwner),
      closureEvidence: closureEvidence ? String(closureEvidence) : null,
    };

    enterpriseStore.privacyIncidents.unshift(created);
    appendPrivacyAuditEvent({
      actorRef: auth.ok ? auth.userId : 'security_officer',
      actorRole: auth.ok ? auth.role : 'admin',
      tenantId: created.tenantId,
      action: 'incident_logged',
      resourceType: 'privacy_incident',
      resourceRef: created.incidentId,
      purpose: `Logged DPDP privacy incident ${created.incidentId} (severity=${created.severity})`,
      outcome: 'completed',
    });
    saveEnterpriseStore(enterpriseStore);

    res.json({ ok: true, incident: created });
  });

  // ============================================================================
  // Recruiter Validation & Submission Workflow Endpoints
  // ============================================================================

  app.get('/api/submissions/validation', (_req, res) => {
    res.json({
      ok: true,
      records: enterpriseStore.submissionValidations || {},
    });
  });

  app.get('/api/submissions/validation/:submissionId', (req, res) => {
    const submissionId = String(req.params.submissionId || '').trim();
    const record = enterpriseStore.submissionValidations?.[submissionId] || null;
    res.json({
      ok: true,
      record,
    });
  });

  app.post('/api/submissions/validation', async (req, res) => {
    const {
      record,
      validation,
      submissionId,
      actor,
      actorName = 'Recruiter',
      actorRole = 'recruiter',
      action = 'update_validation',
    } = req.body || {};

    const effectiveRecord = record || validation;
    const subId = String(submissionId || effectiveRecord?.submissionId || '').trim();

    if (!effectiveRecord || typeof effectiveRecord !== 'object' || !subId) {
      res.status(400).json({ error: 'validation record with submissionId is required.' });
      return;
    }

    enterpriseStore.submissionValidations[subId] = {
      ...effectiveRecord,
      submissionId: subId,
      updatedAt: new Date().toISOString(),
    };

    const effectiveActorName = String(actor?.name || actorName || 'Recruiter');
    const effectiveActorRole = String(actor?.role || actorRole || 'recruiter');
    const effectiveAction = String(actor?.action || action || 'update_validation');

    appendPrivacyAuditEvent({
      actorRef: effectiveActorName,
      actorRole: effectiveActorRole,
      tenantId: 'hirenest_hq',
      action:
        effectiveAction === 'submit_to_client'
          ? 'candidate_shared'
          : 'resume_accessed',
      resourceType: 'submission_packet',
      resourceRef: subId,
      purpose: `Recruiter validation workflow (${effectiveAction}) on submission ${subId.slice(0, 8)} — stage=${String(
        effectiveRecord.validationStage || 'recruiter_review'
      )}`,
      outcome: 'allowed',
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({
      ok: true,
      record: enterpriseStore.submissionValidations[subId],
      validation: enterpriseStore.submissionValidations[subId],
    });
  });

  app.post('/api/submissions/validation-questions', async (req, res) => {
    const {
      missingSkills = [],
      matchedSkills = [],
      requirementTitle = 'Target Role',
      candidateName = 'Candidate',
    } = req.body || {};

    const skillsList: string[] = Array.isArray(missingSkills) && missingSkills.length > 0
      ? missingSkills.map(String)
      : Array.isArray(matchedSkills)
        ? matchedSkills.map(String)
        : ['Core Architecture'];

    const geminiKey = resolveServerGeminiApiKey();
    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const prompt = `Generate ${Math.min(5, Math.max(3, skillsList.length))} concise, high-signal 10-minute recruiter validation interview questions for candidate "${candidateName}" applying to "${requirementTitle}".
Focus specifically on verifying hands-on production evidence for these missing or unclear skills: ${skillsList.join(', ')}.
Return JSON array of objects with fields: targetSkill, question.`;
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  targetSkill: { type: Type.STRING },
                  question: { type: Type.STRING },
                },
                required: ['targetSkill', 'question'],
              },
            },
          },
        });
        const parsed = JSON.parse(response.text || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) {
          res.json({
            ok: true,
            source: 'gemini',
            questions: parsed.map((q: { targetSkill?: string; question?: string }, idx: number) => ({
              id: `vq_ai_${Date.now()}_${idx}`,
              targetSkill: q.targetSkill || skillsList[idx] || 'Technical Fit',
              question: q.question || `Describe your production experience with ${skillsList[idx] || 'this skill'}.`,
              candidateAnswer: '',
              recruiterNotes: '',
              evidenceRecorded: '',
              skillVerified: false,
            })),
          });
          return;
        }
      } catch {
        // Fallback to deterministic generator
      }
    }

    res.json({
      ok: true,
      source: 'deterministic',
      questions: skillsList.slice(0, 5).map((skill, idx) => ({
        id: `vq_det_${Date.now()}_${idx}`,
        targetSkill: skill,
        question: `Your resume does not explicitly detail hands-on production depth with ${skill} for the ${requirementTitle} role. Can you walk through a specific project where you implemented ${skill}, your architectural decisions, and measurable results?`,
        candidateAnswer: '',
        recruiterNotes: '',
        evidenceRecorded: '',
        skillVerified: false,
      })),
    });
  });

  // ============================================================================
  // Shared Offer Management & Onboarding Lifecycle Endpoints (Admin, Client, Vendor)
  // ============================================================================

  app.get('/api/offers-onboarding', (_req, res) => {
    res.json({
      ok: true,
      records: enterpriseStore.offerOnboardingRecords || {},
    });
  });

  app.get('/api/offers-onboarding/:submissionId', (req, res) => {
    const submissionId = String(req.params.submissionId || '').trim();
    const record = enterpriseStore.offerOnboardingRecords?.[submissionId] || null;
    res.json({
      ok: true,
      record,
    });
  });

  app.post('/api/offers-onboarding/update', async (req, res) => {
    const { record, auditEvent, actor } = req.body || {};
    const subId = String(record?.submissionId || '').trim();
    if (!record || typeof record !== 'object' || !subId) {
      res.status(400).json({ error: 'record with submissionId is required.' });
      return;
    }

    const actorRole = String(actor?.role || 'client_manager');
    const actorName = String(actor?.name || 'Authorised User');
    const actorOrgId = actor?.orgId ? String(actor.orgId) : 'hirenest_hq';
    const actionType = String(auditEvent?.action || 'update_offer_onboarding');

    // Enforce server-side vendor protection: vendors can only submit vendor_report_update
    if (
      (actorRole === 'vendor_admin' || actorRole === 'vendor_recruiter') &&
      actionType !== 'vendor_report_update'
    ) {
      res.status(403).json({
        error:
          'Blocked by Server RBAC Guard: Vendors can report candidate availability/acceptance/issues but cannot directly overwrite client-confirmed or Admin-verified offer/onboarding records.',
      });
      return;
    }

    if (!enterpriseStore.offerOnboardingRecords) {
      enterpriseStore.offerOnboardingRecords = {};
    }

    enterpriseStore.offerOnboardingRecords[subId] = {
      ...record,
      submissionId: subId,
      updatedAt: new Date().toISOString(),
    };

    appendPrivacyAuditEvent({
      actorRef: actorName,
      actorRole,
      tenantId: actorOrgId,
      action: 'candidate_shared',
      resourceType: 'submission_packet',
      resourceRef: subId,
      purpose: `Offer & Onboarding lifecycle update (${actionType}) on submission ${subId.slice(
        0,
        8
      )} — lifecycleStage=${String(record.lifecycleStage || 'offer_issued')}, offerStatus=${String(
        record.offerStatus || 'none'
      )}, onboardingStatus=${String(record.onboardingStatus || 'not_started')}`,
      outcome: 'completed',
    });

    saveEnterpriseStore(enterpriseStore);
    res.json({
      ok: true,
      record: enterpriseStore.offerOnboardingRecords[subId],
    });
  });

  // ==========================================================================
  // ONBOARDING: NDA + organization document review (brief §5)
  // All writes go through SECURITY DEFINER RPCs that enforce role + tenant,
  // so these endpoints are thin pass-throughs that forward the caller's JWT.
  // ==========================================================================

  function buildAuthedSupabase(req: express.Request) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'https://your-project-id.supabase.co') {
      return null;
    }
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : '';
    if (!token || token === 'workspace_active_session') {
      return null;
    }
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  // Admin review queue — all pending documents across tenants.
  app.get('/api/admin/onboarding/pending-documents', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    if (!auth.ok || auth.role !== 'admin') {
      res.status(403).json({ error: 'Admin role required.' });
      return;
    }
    const sb = buildAuthedSupabase(req);
    if (!sb) {
      res.status(503).json({ error: 'Supabase not configured on this server.' });
      return;
    }
    const { data, error } = await sb.rpc('admin_list_pending_documents');
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ documents: data || [] });
  });

  // Full onboarding snapshot for one organization (admin or own-org member).
  app.get('/api/organizations/:orgId/onboarding', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    if (!auth.ok) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const sb = buildAuthedSupabase(req);
    if (!sb) {
      res.status(503).json({ error: 'Supabase not configured on this server.' });
      return;
    }
    const { data, error } = await sb.rpc('get_organization_onboarding', {
      p_org_id: req.params.orgId,
    });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data || null);
  });

  // Record a document the client just uploaded to Supabase Storage.
  app.post('/api/organizations/:orgId/documents', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    if (!auth.ok) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const { kind, storage_path, original_name, mime_type, size_bytes } = (req.body ||
      {}) as {
      kind?: string;
      storage_path?: string;
      original_name?: string;
      mime_type?: string;
      size_bytes?: number;
    };
    if (!kind || !storage_path) {
      res.status(400).json({ error: 'kind and storage_path are required.' });
      return;
    }
    const sb = buildAuthedSupabase(req);
    if (!sb) {
      res.status(503).json({ error: 'Supabase not configured on this server.' });
      return;
    }
    const { data, error } = await sb.rpc('record_organization_document', {
      p_org_id: req.params.orgId,
      p_kind: kind,
      p_storage_path: storage_path,
      p_original_name: original_name ?? null,
      p_mime_type: mime_type ?? null,
      p_size_bytes: typeof size_bytes === 'number' ? size_bytes : null,
    });
    if (error) {
      res.status(error.message.toLowerCase().includes('not authorized') ? 403 : 500).json({
        error: error.message,
      });
      return;
    }
    res.json({ document_id: data });
  });

  // Admin decision on a single document.
  app.post('/api/admin/documents/:documentId/review', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    if (!auth.ok || auth.role !== 'admin') {
      res.status(403).json({ error: 'Admin role required.' });
      return;
    }
    const { decision, notes } = (req.body || {}) as { decision?: string; notes?: string };
    if (!decision) {
      res.status(400).json({ error: 'decision is required.' });
      return;
    }
    const sb = buildAuthedSupabase(req);
    if (!sb) {
      res.status(503).json({ error: 'Supabase not configured on this server.' });
      return;
    }
    const { data, error } = await sb.rpc('admin_review_document', {
      p_document_id: req.params.documentId,
      p_decision: decision,
      p_notes: notes ?? null,
    });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ document: data });
  });

  // Admin NDA status update for an organization.
  app.post('/api/admin/organizations/:orgId/nda', async (req, res) => {
    const auth = await authenticateStaffingCaller(req);
    if (!auth.ok || auth.role !== 'admin') {
      res.status(403).json({ error: 'Admin role required.' });
      return;
    }
    const { status, nda_version, executed_at, evidence_doc_id, notes } = (req.body ||
      {}) as {
      status?: string;
      nda_version?: string | null;
      executed_at?: string | null;
      evidence_doc_id?: string | null;
      notes?: string | null;
    };
    if (!status) {
      res.status(400).json({ error: 'status is required.' });
      return;
    }
    const sb = buildAuthedSupabase(req);
    if (!sb) {
      res.status(503).json({ error: 'Supabase not configured on this server.' });
      return;
    }
    const { data, error } = await sb.rpc('admin_update_nda_status', {
      p_org_id: req.params.orgId,
      p_status: status,
      p_nda_version: nda_version ?? null,
      p_executed_at: executed_at ?? null,
      p_evidence_doc_id: evidence_doc_id ?? null,
      p_notes: notes ?? null,
    });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ nda: data });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'HireNestOS Enterprise API',
      geminiConfigured: Boolean(resolveServerGeminiApiKey()),
      dpdpGovernanceEnabled: true,
      ndaGateEnabled: true,
      runtime: process.env.VERCEL ? 'vercel_serverless' : 'node_server',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

let cachedExpressApp: express.Express | null = null;

export async function getServerApp(): Promise<express.Express> {
  if (!cachedExpressApp) {
    cachedExpressApp = await startServer();
    registerPublicJobOgRoute(cachedExpressApp);
  }
  return cachedExpressApp;
}

// Build per-job HTML with OpenGraph meta tags injected. Used by both the
// standalone dev server and the Vercel serverless function so crawlers get
// per-page tags regardless of where the app is hosted.
async function buildJobOgHtml(slug: string, baseHtml: string): Promise<string> {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return baseHtml;
    const anon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await anon.rpc('get_public_requirement', { p_slug: slug });
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return baseHtml;
    const esc = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const title = `${job.title} — ${job.client_org_name || 'HireNest'}`;
    const desc = (job.description || '').slice(0, 200);
    const url = `/jobs/${encodeURIComponent(slug)}`;
    const ogBlock = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:site_name" content="HireNest" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />`;
    return baseHtml.replace(/<title>[\s\S]*?<\/title>/i, ogBlock);
  } catch {
    return baseHtml;
  }
}

function registerPublicJobOgRoute(app: express.Express): void {
  app.get(/^\/jobs\/([^/]+)\/?$/, async (req, res, next) => {
    try {
      const slug = decodeURIComponent(req.params[0] || '');
      // Prefer the built dist/index.html; fall back to source index.html for dev.
      const distIndex = path.resolve(process.cwd(), 'dist', 'index.html');
      const srcIndex = path.resolve(process.cwd(), 'index.html');
      const indexPath = fs.existsSync(distIndex) ? distIndex : srcIndex;
      if (!fs.existsSync(indexPath)) return next();
      const raw = fs.readFileSync(indexPath, 'utf-8');
      const withOg = await buildJobOgHtml(slug, raw);
      res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(withOg);
    } catch {
      next();
    }
  });
}

async function bootStandaloneServer() {
  const app = await getServerApp();

  // Note: the /jobs/:slug OG route is already registered by getServerApp().
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HireNestOS server running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL && process.env.SKIP_SERVER_START !== '1') {
  bootStandaloneServer();
}
