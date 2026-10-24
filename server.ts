import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
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
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
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

// In-memory per-user rate limiter: max 20 requests per hour per authenticated user ID.
const RATE_LIMIT_MAX = 20;
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

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
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
  preferredModel: 'gemini-3.1-flash-lite' | 'gemini-3.8-flash',
  contents: string,
  systemInstruction: string,
  jsonSchema?: Record<string, unknown>
): Promise<string> {
  const modelsToTry = [preferredModel, 'gemini-3.8-flash', 'gemini-flash-latest'];
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

async function authenticateStaffingCaller(req: express.Request): Promise<
  | { ok: true; userId: string; role: string; orgId: string | null }
  | { ok: false; status: number; message: string }
> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, status: 401, message: 'Authentication required.' };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'https://your-project-id.supabase.co') {
    return { ok: false, status: 503, message: 'Supabase environment is not configured.' };
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data: userData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !userData?.user) {
    return { ok: false, status: 401, message: 'Invalid or expired session.' };
  }

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('id, role, status, org_id')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, status: 403, message: 'Profile not found or access denied.' };
  }

  if (profile.role === 'pending' || profile.status !== 'active') {
    return { ok: false, status: 403, message: 'Active workspace account required.' };
  }

  if (profile.role === 'candidate') {
    return { ok: false, status: 403, message: 'AI assistant is not enabled for candidate accounts.' };
  }

  return {
    ok: true,
    userId: userData.user.id,
    role: profile.role,
    orgId: profile.org_id || null,
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
      const geminiKey = process.env.GEMINI_API_KEY?.trim();
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

          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
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

          const rawJson = response.text?.trim();
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

  // Unified guarded endpoint for the 4 allowed suggestion features + general staffing help chat
  app.post('/api/gemini/suggest', async (req, res) => {
    try {
      const auth = await authenticateStaffingCaller(req);
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.message });
        return;
      }

      const rate = checkUserRateLimit(auth.userId);
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      if (!rate.allowed) {
        res.status(429).json({
          error: 'AI assistant unavailable right now (hourly request limit of 20 reached).',
        });
        return;
      }

      const ai = getGenAIClient();
      if (!ai) {
        res.status(503).json({ error: 'AI assistant unavailable right now' });
        return;
      }

      const { feature, payload } = req.body as {
        feature?: string;
        payload?: Record<string, unknown>;
      };

      if (!feature || !payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Invalid request format.' });
        return;
      }

      if (feature === 'suggest_skills') {
        const title = scrubPII(String(payload.title || ''));
        const description = scrubPII(String(payload.description || ''));
        if (!title && !description) {
          res.status(400).json({ error: 'Provide a requirement title or description first.' });
          return;
        }
        const rawJson = await generateWithFallback(
          ai,
          'gemini-3.1-flash-lite',
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
        res.json({
          label: 'AI suggestion: review before use',
          skills: cleanSkills,
        });
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
          'gemini-3.8-flash',
          `Requirement Title: ${title}\nRequired Skills: ${skills}\nDraft Description:\n${description}`,
          'You are an enterprise staffing editor. Rewrite the job description into clear, structured, plain-text sections (Role Summary, Key Responsibilities, Required Qualifications) without markdown bolding or PII. Keep all factual requirements intact and concise.'
        );
        res.json({
          label: 'AI suggestion: review before use',
          text: text.trim(),
        });
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
          'gemini-3.8-flash',
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
        res.json({
          label: 'AI suggestion: review before use',
          questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 6) : [],
        });
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
          'gemini-3.1-flash-lite',
          `Raw Interviewer Notes:\n${draftNotes}`,
          'Rewrite ONLY the interviewer notes provided into clear, objective, professional sentences suitable for an enterprise interview record. Do NOT invent observations, do NOT add a hire/reject decision, and do NOT include any candidate names or PII. Return plain text only.'
        );
        res.json({
          label: 'AI suggestion: review before use',
          text: text.trim(),
        });
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
          'gemini-3.8-flash',
          sanitizedHistory,
          `You are the HireNestOS Staffing Operations Guide for role "${auth.role}". Provide concise, practical guidance on staffing workflows, writing clear job descriptions, conducting structured competency interviews, and SLA best practices. Never evaluate specific candidates, never compute scores, never decide disputes, and remind users not to paste personal contact details.`
        );
        res.json({
          label: 'AI suggestion: review before use',
          text: text.trim(),
        });
        return;
      }

      res.status(400).json({ error: 'Unsupported suggestion feature.' });
    } catch {
      res.status(503).json({ error: 'AI assistant unavailable right now' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HireNestOS server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.SKIP_SERVER_START !== '1') {
  startServer();
}
