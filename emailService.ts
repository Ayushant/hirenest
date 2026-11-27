import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * HireNest Email Service
 * 
 * Strict routing policy:
 * 1. Resend: Used ONLY for user/team management and activation/invitation emails
 *    (vendor invites, client invites, staff invites, password activation).
 * 2. SMTP: Used for ALL operational notifications:
 *    - Job auto-close alerts (Sender: gopal@hirenestworkforce.com)
 *    - Candidate matching alerts to vendors & admin (Sender: gopal@hirenestworkforce.com)
 *    - Candidate submitted to client alerts (Sender: gopal@hirenestworkforce.com)
 *    - SLA & compliance operational notifications (Sender: admin@hirenestworkforce.com / praveen@hirenestworkforce.com)
 */

export interface EmailSendResult {
  ok: boolean;
  channel: 'resend' | 'smtp';
  messageId?: string;
  error?: string;
}

let cachedSmtpTransporter: Transporter | null = null;

export function getSmtpConfig() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || process.env.SMTP_USERNAME || '';
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const configured = Boolean(host && user && pass);

  return { host, port, user, pass, secure, configured };
}

function getSmtpTransporter(): Transporter | null {
  const config = getSmtpConfig();
  if (!config.configured) {
    return null;
  }
  if (!cachedSmtpTransporter) {
    cachedSmtpTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
  }
  return cachedSmtpTransporter;
}

/**
 * 1. RESEND SENDER - STRICTLY FOR INVITES & TEAM MANAGEMENT ONLY
 */
export async function sendInviteEmailViaResend(params: {
  to: string[];
  subject: string;
  html: string;
}): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[emailService:Resend] RESEND_API_KEY is not set on the server.');
    return { ok: false, channel: 'resend', error: 'RESEND_API_KEY is not configured on server' };
  }
  if (!params.to || params.to.length === 0) {
    return { ok: false, channel: 'resend', error: 'No recipient email specified' };
  }

  const from =
    process.env.RESEND_INVITE_FROM ||
    process.env.RESEND_FROM_EMAIL ||
    'HireNest Admin <admin@hirenestworkforce.com>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, channel: 'resend', messageId: data.id };
    }

    const bodyText = (await res.text()).slice(0, 300);
    let detail = bodyText;
    try {
      detail = (JSON.parse(bodyText) as { message?: string }).message || bodyText;
    } catch {
      // keep raw bodyText
    }
    console.warn('[emailService:Resend] Resend rejected the message:', res.status, detail);
    return { ok: false, channel: 'resend', error: `Resend ${res.status}: ${detail} (sender: ${from})` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[emailService:Resend] Resend network error:', msg);
    return { ok: false, channel: 'resend', error: `Resend request failed: ${msg}` };
  }
}

/**
 * 2. RESEND NOTIFICATION FALLBACK - SENDS OPERATIONAL ALERTS IF SMTP IS OFFLINE
 */
export async function sendNotificationViaResend(params: {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      ok: false,
      channel: 'resend',
      error: 'Neither SMTP nor RESEND_API_KEY is configured on the server',
    };
  }

  let from =
    process.env.RESEND_NOTIFY_FROM ||
    process.env.RESEND_FROM_EMAIL ||
    'HireNest Admin <admin@hirenestworkforce.com>';

  if (params.from === 'admin' || params.from === 'admin@hirenestworkforce.com' || !params.from) {
    from = 'HireNest Admin <admin@hirenestworkforce.com>';
  } else if (params.from === 'gopal' || params.from === 'gopal@hirenestworkforce.com') {
    from = 'Gopal · HireNest <gopal@hirenestworkforce.com>';
  } else if (params.from === 'praveen' || params.from === 'praveen@hirenestworkforce.com') {
    from = 'Praveen · HireNest <praveen@hirenestworkforce.com>';
  } else if (params.from && params.from.includes('@')) {
    from = params.from.includes('<') ? params.from : `HireNest Admin <${params.from}>`;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: params.to,
        ...(params.bcc?.length ? { bcc: params.bcc } : {}),
        subject: params.subject,
        html: params.html,
        reply_to: params.replyTo,
      }),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, channel: 'resend', messageId: data.id };
    }

    const bodyText = (await res.text()).slice(0, 300);
    return { ok: false, channel: 'resend', error: `Resend error: ${bodyText}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, channel: 'resend', error: `Resend network error: ${msg}` };
  }
}

/**
 * 3. SMTP SENDER - STRICTLY FOR ALL OPERATIONAL & CANDIDATE NOTIFICATIONS
 * (With automated Resend fallback if SMTP credentials or DNS are not yet ready)
 */
export async function sendNotificationEmailViaSmtp(params: {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  from?: 'gopal' | 'admin' | 'praveen' | string;
  replyTo?: string;
}): Promise<EmailSendResult> {
  const recipients = Array.from(new Set((params.to || []).map((email) => email.trim().toLowerCase()).filter(Boolean)));
  if (recipients.length === 0) {
    return { ok: false, channel: 'smtp', error: 'No recipient email specified' };
  }

  const bccDefaults = Array.from(new Set([
    ...(params.bcc || []),
    'gopal@hirenestworkforce.com',
    'praveen@hirenestworkforce.com',
    'admin@hirenestworkforce.com',
    ...(process.env.ADMIN_EMAIL ? [process.env.ADMIN_EMAIL.trim().toLowerCase()] : []),
    ...(process.env.DEFAULT_EMAIL_BCC || '').split(',').map((email) => email.trim().toLowerCase()),
  ].filter(Boolean))).filter((email) => !recipients.includes(email));

  // Deliver each notification separately: each external recipient sees only their own address in To.
  const results = await Promise.all(recipients.map((recipient) =>
    sendNotificationEmailViaSmtpSingle({ ...params, to: [recipient], bcc: bccDefaults })
  ));
  const failed = results.find((result) => !result.ok);
  return {
    ok: results.every((result) => result.ok),
    channel: results[0]?.channel || 'smtp',
    messageId: results.map((result) => result.messageId).filter(Boolean).join(','),
    error: failed?.error,
  };
}

async function sendNotificationEmailViaSmtpSingle(params: {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  from?: 'gopal' | 'admin' | 'praveen' | string;
  replyTo?: string;
}): Promise<EmailSendResult> {

  // Determine standard sender email: default to admin@hirenestworkforce.com
  let senderAddress = 'admin@hirenestworkforce.com';
  let senderName = 'HireNest Admin';

  if (params.from === 'gopal' || params.from === 'gopal@hirenestworkforce.com') {
    senderAddress = 'gopal@hirenestworkforce.com';
    senderName = 'Gopal · HireNest';
  } else if (params.from === 'praveen' || params.from === 'praveen@hirenestworkforce.com') {
    senderAddress = 'praveen@hirenestworkforce.com';
    senderName = 'Praveen · HireNest';
  } else if (params.from && params.from.includes('@')) {
    senderAddress = params.from;
    senderName = params.from.includes('admin')
      ? 'HireNest Admin'
      : params.from.includes('gopal')
        ? 'Gopal · HireNest'
        : params.from.includes('praveen')
          ? 'Praveen · HireNest'
          : 'HireNest';
  }

  const formattedFrom = `"${senderName}" <${senderAddress}>`;
  const transporter = getSmtpTransporter();

  // If SMTP is not configured on the server, automatically fall back to Resend
  if (!transporter) {
    console.warn(
      `[emailService:SMTP] SMTP not configured. Falling back to Resend for operational notification to: ${params.to.join(', ')}`
    );
    return sendNotificationViaResend(params);
  }

  try {
    const info = await transporter.sendMail({
      from: formattedFrom,
      to: params.to.join(', '),
      ...(params.bcc?.length ? { bcc: params.bcc.join(', ') } : {}),
      subject: params.subject,
      html: params.html,
      replyTo: params.replyTo || senderAddress,
    });

    return {
      ok: true,
      channel: 'smtp',
      messageId: info.messageId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[emailService:SMTP] SMTP send failed (${msg}). Falling back to Resend...`);
    // Resilient fallback to Resend if SMTP fails (e.g. unverified DNS or temporary provider drop)
    return sendNotificationViaResend(params);
  }
}
