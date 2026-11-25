import type { SupabaseClient } from '@supabase/supabase-js';
import { computeFineTunedCandidateMatch } from './src/lib/matchingEngine';
import type { Candidate, Requirement } from './src/types/db';
import { sendNotificationEmailViaSmtp } from './emailService';

/**
 * Alert engine: in-app notifications + SMTP email.
 * Every alert is deduplicated through public.alert_log so cron retries never double-send.
 * 
 * SENDER ROUTING:
 * - All operational & candidate matching alerts: admin@hirenestworkforce.com
 * - Job auto-closed alerts: admin@hirenestworkforce.com
 * - Candidate matching alerts to admin & vendors: admin@hirenestworkforce.com
 * - Candidate submitted to client alerts: admin@hirenestworkforce.com
 * - SLA warnings & operations: admin@hirenestworkforce.com
 */

const APP_URL = () => process.env.APP_BASE_URL || 'https://os.hirenestworkforce.com';
const SLA_WINDOW_MIN = 120; // vendor SLA after acknowledging a requirement
const SLA_WARN_MIN = 30; // warn when this many minutes remain
const MIN_MATCH = 70;

export async function sendEmailResult(
  to: string[],
  subject: string,
  html: string,
  from?: 'gopal' | 'admin' | 'praveen' | string
): Promise<{ ok: boolean; error?: string; channel?: string }> {
  if (to.length === 0) return { ok: false, error: 'No recipient' };
  const res = await sendNotificationEmailViaSmtp({
    to,
    subject,
    html,
    from: from || 'admin@hirenestworkforce.com',
  });
  return { ok: res.ok, error: res.error, channel: res.channel };
}

export async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  from?: 'gopal' | 'admin' | 'praveen' | string
): Promise<boolean> {
  return (await sendEmailResult(to, subject, html, from)).ok;
}

/** Returns true if this dedupe key is new (and records it). */
async function claim(admin: SupabaseClient, key: string): Promise<boolean> {
  const { error } = await admin.from('alert_log').insert({ dedupe_key: key });
  return !error; // unique violation => already sent
}

async function notifyUsers(
  admin: SupabaseClient,
  users: Array<{ id: string; email: string | null }>,
  n: { kind: string; title: string; body: string; link: string },
  from?: 'gopal' | 'admin' | 'praveen' | string
): Promise<number> {
  if (users.length === 0) return 0;

  // Insert in-app notifications for valid profile IDs
  const validDbUsers = users.filter((u) => u.id && u.id.length > 20 && !u.id.endsWith('_hq'));
  if (validDbUsers.length > 0) {
    try {
      await admin.from('notifications').insert(
        validDbUsers.map((u) => ({ user_id: u.id, kind: n.kind, title: n.title, body: n.body, link: n.link }))
      );
    } catch {
      // Ignore notification table errors
    }
  }

  const emails = Array.from(
    new Set(users.map((u) => u.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))
  );

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f172a; margin-top: 0; font-size: 18px;">${n.title}</h2>
      <p style="font-size: 14px; color: #334155;">${n.body}</p>
      <div style="margin-top: 24px;">
        <a href="${APP_URL()}${n.link}" style="display: inline-block; padding: 10px 20px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">Open in HireNest</a>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px;" />
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">HireNest Workforce Private Limited · Automated Operational Notification</p>
    </div>
  `;

  await sendEmail(emails, n.title, html, from);
  return users.length;
}

async function orgUsers(admin: SupabaseClient, orgId: string) {
  const { data } = await admin
    .from('profiles')
    .select('id, email')
    .eq('org_id', orgId)
    .eq('status', 'active');
  return (data || []) as Array<{ id: string; email: string | null }>;
}

async function staffUsers(admin: SupabaseClient, roles: string[] = ['admin', 'recruiter']) {
  const { data } = await admin
    .from('profiles')
    .select('id, email')
    .in('role', roles)
    .eq('status', 'active');

  const map = new Map<string, { id: string; email: string | null }>();
  for (const u of data || []) {
    if (u.email) map.set(u.email.toLowerCase().trim(), u);
  }

  // Ensure Gopal, Praveen, official admin, and configured ADMIN_EMAIL are always in staff recipients:
  const mandatoryStaff = [
    { id: 'gopal_hq', email: 'gopal@hirenestworkforce.com' },
    { id: 'praveen_hq', email: 'praveen@hirenestworkforce.com' },
    { id: 'admin_hq', email: 'admin@hirenestworkforce.com' },
  ];

  if (process.env.ADMIN_EMAIL?.trim()) {
    const envEmail = process.env.ADMIN_EMAIL.trim();
    mandatoryStaff.push({ id: 'admin_env', email: envEmail });
  }

  for (const m of mandatoryStaff) {
    if (!map.has(m.email.toLowerCase())) {
      map.set(m.email.toLowerCase(), m);
    }
  }

  return Array.from(map.values());
}

/** Run every ~10 min: warn vendors with <=30 min left of their 2h SLA and no submission yet. */
export async function runSlaAlerts(admin: SupabaseClient): Promise<{ warned: number }> {
  const now = Date.now();
  const from = new Date(now - SLA_WINDOW_MIN * 60_000).toISOString();
  const to = new Date(now - (SLA_WINDOW_MIN - SLA_WARN_MIN) * 60_000).toISOString();
  const { data: shares } = await admin
    .from('requirement_vendor_shares')
    .select('id, requirement_id, vendor_org_id, acknowledged_at, requirements:requirement_id(title, status)')
    .gte('acknowledged_at', from)
    .lte('acknowledged_at', to);

  let warned = 0;
  for (const s of (shares || []) as unknown as Array<{
    id: string;
    requirement_id: string;
    vendor_org_id: string;
    acknowledged_at: string;
    requirements: { title: string; status: string } | null;
  }>) {
    if (s.requirements?.status !== 'open') continue;
    const { count } = await admin
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('requirement_id', s.requirement_id)
      .eq('vendor_org_id', s.vendor_org_id);
    if ((count || 0) > 0) continue;
    if (!(await claim(admin, `sla30:${s.id}`))) continue;
    const minsLeft = Math.max(
      0,
      Math.round(SLA_WINDOW_MIN - (now - new Date(s.acknowledged_at).getTime()) / 60_000)
    );
    warned += await notifyUsers(admin, await orgUsers(admin, s.vendor_org_id), {
      kind: 'sla_warning',
      title: `SLA: ${minsLeft} min left to submit profiles`,
      body: `You acknowledged "${s.requirements?.title ?? 'a requirement'}". About ${minsLeft} minutes remain of your 2-hour SLA window and no profile has been submitted yet.`,
      link: `/vendor/requirements/${s.requirement_id}`,
    });
  }
  return { warned };
}

/** Daily ~10 AM IST: matching-profile digest to vendors + new-match digest to admins. */
export async function runMorningDigest(admin: SupabaseClient): Promise<{ vendors: number; admins: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const { data: openReqs } = await admin.from('requirements').select('id, title').eq('status', 'open');
  const openIds = (openReqs || []).map((r) => r.id as string);
  if (openIds.length === 0) return { vendors: 0, admins: 0 };

  // Vendors: open requirements shared with them + their own profiles that match >= 70%.
  const { data: vendors } = await admin.from('organizations').select('id, name').eq('type', 'vendor').eq('status', 'approved');
  let vendorsNotified = 0;
  for (const v of vendors || []) {
    const { data: shared } = await admin
      .from('requirement_vendor_shares')
      .select('requirement_id')
      .eq('vendor_org_id', v.id)
      .in('requirement_id', openIds);
    const sharedIds = (shared || []).map((s) => s.requirement_id as string);
    if (sharedIds.length === 0) continue;
    const { data: ownCands } = await admin
      .from('candidates')
      .select('id')
      .or(`owner_vendor_org_id.eq.${v.id},source_vendor_org_id.eq.${v.id}`)
      .limit(1000);
    const candIds = (ownCands || []).map((c) => c.id as string);
    let matches = 0;
    if (candIds.length > 0) {
      const { count } = await admin
        .from('candidate_matches')
        .select('id', { count: 'exact', head: true })
        .in('requirement_id', sharedIds)
        .in('candidate_id', candIds)
        .gte('final_score', MIN_MATCH);
      matches = count || 0;
    }
    if (!(await claim(admin, `morning:${v.id}:${day}`))) continue;
    vendorsNotified += await notifyUsers(
      admin,
      await orgUsers(admin, v.id),
      {
        kind: 'morning_digest',
        title: `Good morning — ${sharedIds.length} open requirement(s), ${matches} matching profile(s)`,
        body: `${sharedIds.length} open requirement(s) are shared with you and ${matches} of your profiles match at ${MIN_MATCH}% or higher. Submit early to hold your SLA.`,
        link: '/vendor/requirements',
      },
      'admin@hirenestworkforce.com'
    );
  }

  // Admins / ops: candidate-requirement matches created in the last 24h.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: newMatches } = await admin
    .from('candidate_matches')
    .select('id', { count: 'exact', head: true })
    .in('requirement_id', openIds)
    .gte('final_score', MIN_MATCH)
    .gte('calculated_at', since);
  let adminsNotified = 0;
  if ((newMatches || 0) > 0 && (await claim(admin, `match-digest:${day}`))) {
    adminsNotified = await notifyUsers(
      admin,
      await staffUsers(admin, ['admin', 'recruiter']),
      {
        kind: 'match_digest',
        title: `${newMatches} new candidate match(es) in the last 24h`,
        body: `${newMatches} candidate(s) now match an open requirement at ${MIN_MATCH}% or higher.`,
        link: '/admin/requirements',
      },
      'admin@hirenestworkforce.com'
    );
  }
  return { vendors: vendorsNotified, admins: adminsNotified };
}

/** Run every ~10 min: auto-close open requirements whose SLA has expired. */
export async function runSlaAutoClose(admin: SupabaseClient): Promise<{ closed: number }> {
  const now = new Date().toISOString();
  // Find open requirements where opened_at + submission_sla_hours has passed
  const { data: expired } = await admin
    .from('requirements')
    .select('id, title, submission_sla_hours, opened_at, client_org_id')
    .eq('status', 'open')
    .not('opened_at', 'is', null);

  let closed = 0;
  for (const r of (expired || []) as Array<{
    id: string; title: string; submission_sla_hours: number;
    opened_at: string; client_org_id: string | null;
  }>) {
    const expiresAt = new Date(r.opened_at).getTime() + r.submission_sla_hours * 3600_000;
    if (Date.now() < expiresAt) continue;

    const dedupeKey = `sla-close:${r.id}:${r.opened_at}`;
    if (!(await claim(admin, dedupeKey))) continue;

    const { error } = await admin
      .from('requirements')
      .update({ status: 'closed', closed_at: now })
      .eq('id', r.id)
      .eq('status', 'open');
    if (error) continue;

    closed++;

    // Notify admins (Gopal & Praveen) via SMTP from admin@hirenestworkforce.com
    await notifyUsers(
      admin,
      await staffUsers(admin, ['admin', 'recruiter']),
      {
        kind: 'sla_auto_close',
        title: `Requirement auto-closed: ${r.title}`,
        body: `"${r.title}" was automatically closed after its ${r.submission_sla_hours}-hour SLA expired. Re-open it from the requirement detail page to set a new SLA.`,
        link: `/admin/requirements/${r.id}`,
      },
      'admin@hirenestworkforce.com'
    );

    // Also notify mapped vendors whose SLA expired
    const { data: shares } = await admin
      .from('requirement_vendor_shares')
      .select('vendor_org_id')
      .eq('requirement_id', r.id);

    for (const sh of shares || []) {
      await notifyUsers(
        admin,
        await orgUsers(admin, sh.vendor_org_id),
        {
          kind: 'sla_auto_close',
          title: `Requirement SLA window concluded: ${r.title}`,
          body: `The active submission window for "${r.title}" has concluded. Thank you for your submissions.`,
          link: `/vendor/requirements/${r.id}`,
        },
        'admin@hirenestworkforce.com'
      );
    }
  }
  return { closed };
}

/** Daily: vendors missing a verified NDA are reminded; admins told about documents awaiting review. */
export async function runComplianceAlerts(admin: SupabaseClient): Promise<{ vendors: number; admins: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const week = `${new Date().getUTCFullYear()}-w${Math.floor(Date.now() / (7 * 86400_000))}`;
  const { data: vendors } = await admin.from('organizations').select('id, name').eq('type', 'vendor').eq('status', 'approved');
  const { data: nda } = await admin.from('organization_nda_status').select('org_id, status');
  const verified = new Set((nda || []).filter((n) => n.status === 'verified').map((n) => n.org_id as string));
  let vendorsNotified = 0;
  for (const v of vendors || []) {
    if (verified.has(v.id)) continue;
    if (!(await claim(admin, `nda-remind:${v.id}:${week}`))) continue;
    vendorsNotified += await notifyUsers(admin, await orgUsers(admin, v.id), {
      kind: 'compliance_reminder',
      title: 'Action needed: complete NDA & compliance documents',
      body: 'Your NDA is not yet verified. Upload your signed NDA and compliance documents to keep receiving requirements.',
      link: '/vendor/onboarding',
    });
  }
  const { count: pending } = await admin
    .from('organization_documents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review');
  let adminsNotified = 0;
  if ((pending || 0) > 0 && (await claim(admin, `docs-pending:${day}`))) {
    adminsNotified = await notifyUsers(admin, await staffUsers(admin, ['admin']), {
      kind: 'documents_pending',
      title: `${pending} document(s) awaiting review`,
      body: `${pending} vendor/client compliance or NDA document(s) are waiting for review.`,
      link: '/admin/organizations',
    });
  }
  return { vendors: vendorsNotified, admins: adminsNotified };
}

/**
 * Run every ~10 min: when a new open requirement appears, auto-match the reusable candidates
 * (rejected, released, or from closed / on-hold requirements) and tell HQ how many qualify.
 * Each requirement is evaluated once (dedupe key), shortly after it opens.
 */
export async function runReusableCandidateAlerts(admin: SupabaseClient): Promise<{ requirements: number; notified: number }> {
  const since = new Date(Date.now() - 72 * 3600_000).toISOString();
  const { data: reqs } = await admin
    .from('requirements')
    .select('*')
    .eq('status', 'open')
    .gte('created_at', since)
    .limit(50);
  if (!reqs || reqs.length === 0) return { requirements: 0, notified: 0 };

  // Reusable candidate ids with the reason they are reusable.
  const { data: subs } = await admin
    .from('submissions')
    .select('candidate_id, requirement_id, stage, requirements:requirement_id(status)')
    .limit(3000);
  const ACTIVE = new Set(['applied', 'recruiter_review', 'client_review', 'interviewing', 'offered']);
  const reusableIds = new Set<string>();
  for (const sub of (subs || []) as unknown as Array<{ candidate_id: string; stage: string; requirements: { status: string } | { status: string }[] | null }>) {
    const rq = Array.isArray(sub.requirements) ? sub.requirements[0] : sub.requirements;
    if (
      sub.stage === 'rejected' ||
      sub.stage === 'withdrawn' ||
      (ACTIVE.has(sub.stage) && (rq?.status === 'closed' || rq?.status === 'filled' || rq?.status === 'on_hold'))
    ) {
      reusableIds.add(sub.candidate_id);
    }
  }
  if (reusableIds.size === 0) {
    // Still mark as evaluated so we do not rescan every run.
    for (const r of reqs) await claim(admin, `reusable:${r.id}`);
    return { requirements: reqs.length, notified: 0 };
  }

  const candidates: Candidate[] = [];
  const idList = Array.from(reusableIds);
  for (let i = 0; i < idList.length; i += 200) {
    const { data } = await admin.from('candidates').select('*').in('id', idList.slice(i, i + 200));
    candidates.push(...((data || []) as Candidate[]));
  }

  let notified = 0;
  for (const r of reqs as Requirement[]) {
    if (!(await claim(admin, `reusable:${r.id}`))) continue;
    // Candidates already in this requirement's pipeline are not "reusable" for it.
    const { data: already } = await admin.from('submissions').select('candidate_id').eq('requirement_id', r.id);
    const inPipeline = new Set((already || []).map((a) => a.candidate_id as string));
    let count = 0;
    for (const c of candidates) {
      if (inPipeline.has(c.id)) continue;
      const m = computeFineTunedCandidateMatch(r, c, null);
      if (m.final_score >= MIN_MATCH && m.matched_skills.length > 0) count += 1;
    }
    if (count === 0) continue;
    notified += await notifyUsers(admin, await staffUsers(admin, ['admin', 'recruiter']), {
      kind: 'reusable_matches',
      title: `${count} reusable candidate(s) match "${r.title}"`,
      body: `${count} candidate(s) from rejected, released or closed requirements match the new requirement "${r.title}" at ${MIN_MATCH}% or higher. Open the Matches tab and tick "Reusable only".`,
      link: `/admin/requirements/${r.id}`,
    });
  }
  return { requirements: reqs.length, notified };
}

/**
 * Triggered on candidate submission to client:
 * Sends SMTP email from gopal@hirenestworkforce.com to client, vendor, and admin.
 * Includes submitting vendor, target role, client account, and matching score.
 */
export async function notifyCandidateSubmittedToClient(
  admin: SupabaseClient,
  submissionId: string
): Promise<void> {
  const { data: sub, error: subErr } = await admin
    .from('submissions')
    .select('id, candidate_id, requirement_id, vendor_org_id, notes, stage')
    .eq('id', submissionId)
    .maybeSingle();

  if (subErr || !sub) {
    console.error('[notifyCandidateSubmittedToClient] Sub query error:', subErr);
    return;
  }

  if (!(await claim(admin, `sub_client:${submissionId}`))) {
    return;
  }

  const { data: candidate } = await admin
    .from('candidates')
    .select('id, full_name, current_title, total_experience_years, skills, owner_vendor_org_id, source_vendor_org_id')
    .eq('id', sub.candidate_id)
    .maybeSingle();

  const { data: requirement } = await admin
    .from('requirements')
    .select('id, title, client_org_id, location, work_mode, skills')
    .eq('id', sub.requirement_id)
    .maybeSingle();

  const candidateName = candidate?.full_name || 'Candidate';
  const reqTitle = requirement?.title || 'Requirement';
  const clientOrgId = requirement?.client_org_id;

  // Resolve vendor name
  let vendorName = 'HireNest Partner';
  const vId = sub.vendor_org_id || candidate?.owner_vendor_org_id || candidate?.source_vendor_org_id;
  if (vId) {
    const { data: vOrg } = await admin.from('organizations').select('name').eq('id', vId).maybeSingle();
    if (vOrg?.name) vendorName = vOrg.name;
  }

  let clientName = 'Client';
  if (clientOrgId) {
    const { data: cOrg } = await admin.from('organizations').select('name').eq('id', clientOrgId).maybeSingle();
    if (cOrg?.name) clientName = cOrg.name;
  }

  // Query matching score from candidate_matches
  const { data: match } = await admin
    .from('candidate_matches')
    .select('final_score, computed_score, matched_skills')
    .eq('requirement_id', sub.requirement_id)
    .eq('candidate_id', sub.candidate_id)
    .maybeSingle();

  const matchScore = match?.final_score != null
    ? Math.round(Number(match.final_score))
    : match?.computed_score != null
    ? Math.round(Number(match.computed_score))
    : null;

  const matchedSkills: string[] = Array.isArray(match?.matched_skills) && match.matched_skills.length > 0
    ? match.matched_skills
    : Array.isArray(candidate?.skills)
    ? candidate.skills.slice(0, 8)
    : [];

  const skillsHtml = matchedSkills.length > 0
    ? matchedSkills.map((s) => `<span style="display: inline-block; background: #e0f2fe; color: #0369a1; padding: 2px 7px; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0; font-weight: 500;">${s}</span>`).join('')
    : '<span style="font-size: 12px; color: #64748b;">Standard qualification criteria met</span>';

  const scoreBadge = matchScore !== null
    ? `<div style="display: inline-block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 5px 12px; border-radius: 9999px; font-weight: 700; font-size: 13px;">Match Score: ${matchScore}%</div>`
    : `<div style="display: inline-block; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; padding: 5px 12px; border-radius: 9999px; font-weight: 600; font-size: 13px;">Validated Profile</div>`;

  const recipients = await staffUsers(admin, ['admin', 'recruiter']);
  if (clientOrgId) {
    const clientStaff = await orgUsers(admin, clientOrgId);
    recipients.push(...clientStaff);
  }
  if (sub.vendor_org_id) {
    const vendorStaff = await orgUsers(admin, sub.vendor_org_id);
    recipients.push(...vendorStaff);
  }

  const emails = Array.from(
    new Set(recipients.map((u) => u.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))
  );
  if (!emails.includes('gopal@hirenestworkforce.com')) {
    emails.push('gopal@hirenestworkforce.com');
  }

  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px;">
        <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #059669;">Client Review Presentation</span>
        <h2 style="color: #0f172a; margin: 6px 0 0; font-size: 20px;">Candidate Submitted to Client: ${candidateName}</h2>
      </div>

      <div style="margin-bottom: 16px;">
        ${scoreBadge}
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600; width: 140px;">Candidate</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${candidateName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Submitting Vendor</td>
            <td style="padding: 10px 0; color: #2563eb; font-weight: 600;">${vendorName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Target Role</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${reqTitle}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Client Account</td>
            <td style="padding: 10px 0; color: #334155;">${clientName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Validation Status</td>
            <td style="padding: 10px 0; color: #059669; font-weight: 600;">Passed Recruiter Review & Screening</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #64748b; font-weight: 600; vertical-align: top;">Key Competencies</td>
            <td style="padding: 10px 0;">${skillsHtml}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top: 24px;">
        <a href="${APP_URL()}/admin/submissions?subId=${sub.id}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">Open Submission Dossier</a>
      </div>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 16px;" />
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">HireNest Workforce Private Limited · Submitted by ${vendorName} for ${reqTitle}</p>
    </div>
  `;

  const subject = `Candidate Submitted to Client: ${candidateName} (via ${vendorName}) for ${reqTitle}${matchScore !== null ? ` [${matchScore}% Match]` : ''}`;

  await sendEmail(emails, subject, emailHtml, 'admin@hirenestworkforce.com');
}

/**
 * Triggered whenever ANY candidate is submitted for a requirement (by a vendor or recruiter):
 * Sends SMTP email from admin@hirenestworkforce.com to admin (Gopal) with vendor name, role title, and matching score.
 */
export async function notifyCandidateSubmitted(
  admin: SupabaseClient,
  submissionId: string
): Promise<boolean> {
  // Query submission directly without complex relation embeds
  const { data: sub, error: subErr } = await admin
    .from('submissions')
    .select('id, candidate_id, requirement_id, vendor_org_id, submitted_by, notes, stage, created_at')
    .eq('id', submissionId)
    .maybeSingle();

  if (subErr || !sub) {
    console.error('[notifyCandidateSubmitted] Sub query error:', subErr);
    return false;
  }

  // Idempotency: prevent sending duplicate emails for the same submission
  if (!(await claim(admin, `sub_submitted:${submissionId}`))) {
    return false;
  }

  const { data: candidate } = await admin
    .from('candidates')
    .select('id, full_name, current_title, total_experience_years, skills, owner_vendor_org_id, source_vendor_org_id')
    .eq('id', sub.candidate_id)
    .maybeSingle();

  const { data: requirement } = await admin
    .from('requirements')
    .select('id, title, client_org_id, location, work_mode, skills')
    .eq('id', sub.requirement_id)
    .maybeSingle();

  const candidateName = candidate?.full_name || 'Candidate';
  const reqTitle = requirement?.title || 'Requirement';

  // Resolve vendor name
  let vendorName = 'Vendor Partner';
  const vId = sub.vendor_org_id || candidate?.owner_vendor_org_id || candidate?.source_vendor_org_id;
  if (vId) {
    const { data: vOrg } = await admin.from('organizations').select('name').eq('id', vId).maybeSingle();
    if (vOrg?.name) vendorName = vOrg.name;
  }

  let clientName = 'Client';
  if (requirement?.client_org_id) {
    const { data: cOrg } = await admin.from('organizations').select('name').eq('id', requirement.client_org_id).maybeSingle();
    if (cOrg?.name) clientName = cOrg.name;
  }

  if (sub.submitted_by && vendorName === 'Vendor Partner') {
    const { data: prof } = await admin.from('profiles').select('full_name, email').eq('id', sub.submitted_by).maybeSingle();
    if (prof?.full_name) vendorName = prof.full_name;
  }

  // Query matching score from candidate_matches
  const { data: match } = await admin
    .from('candidate_matches')
    .select('final_score, computed_score, matched_skills')
    .eq('requirement_id', sub.requirement_id)
    .eq('candidate_id', sub.candidate_id)
    .maybeSingle();

  const matchScore = match?.final_score != null
    ? Math.round(Number(match.final_score))
    : match?.computed_score != null
    ? Math.round(Number(match.computed_score))
    : null;

  const matchedSkills: string[] = Array.isArray(match?.matched_skills) && match.matched_skills.length > 0
    ? match.matched_skills
    : Array.isArray(candidate?.skills)
    ? candidate.skills.slice(0, 8)
    : [];

  const expYears = candidate?.total_experience_years != null ? `${candidate.total_experience_years} years` : 'N/A';
  const notesText = sub.notes
    ? `<div style="margin: 16px 0; font-size: 13px; color: #334155; background: #f8fafc; padding: 12px; border-left: 3px solid #2563eb; border-radius: 4px;"><strong>Vendor Submission Notes:</strong><br/>${sub.notes}</div>`
    : '';

  const skillsHtml = matchedSkills.length > 0
    ? matchedSkills.map((s) => `<span style="display: inline-block; background: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0; font-weight: 500;">${s}</span>`).join('')
    : '<span style="font-size: 12px; color: #64748b;">Pending assessment</span>';

  const matchBadge = matchScore !== null
    ? `<div style="display: inline-block; background: ${matchScore >= 80 ? '#ecfdf5' : '#eff6ff'}; color: ${matchScore >= 80 ? '#047857' : '#1d4ed8'}; border: 1px solid ${matchScore >= 80 ? '#a7f3d0' : '#bfdbfe'}; padding: 6px 14px; border-radius: 9999px; font-weight: 700; font-size: 14px;">🎯 Match Score: ${matchScore}%</div>`
    : `<div style="display: inline-block; background: #f1f5f9; color: #475569; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 13px;">Match Evaluation Queued</div>`;

  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px;">
        <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #2563eb;">Candidate Submission Alert</span>
        <h2 style="color: #0f172a; margin: 6px 0 0; font-size: 20px;">New Profile Submitted: ${candidateName}</h2>
      </div>

      <div style="margin-bottom: 16px;">
        ${matchBadge}
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600; width: 140px;">Candidate</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${candidateName} <span style="font-size: 12px; color: #64748b; font-weight: normal;">(${expYears})</span></td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Submitting Vendor</td>
            <td style="padding: 10px 0; color: #2563eb; font-weight: 600;">${vendorName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Target Role</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${reqTitle}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Client Account</td>
            <td style="padding: 10px 0; color: #334155;">${clientName}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #64748b; font-weight: 600; vertical-align: top;">Matched Skills</td>
            <td style="padding: 10px 0;">${skillsHtml}</td>
          </tr>
        </tbody>
      </table>

      ${notesText}

      <div style="margin-top: 24px; text-align: left;">
        <a href="${APP_URL()}/admin/submissions?subId=${sub.id}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">Review Submission & Validation Gate</a>
      </div>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 16px;" />
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">
        HireNest Workforce Private Limited · Notifications Dispatcher · Sourced by ${vendorName} for ${reqTitle}
      </p>
    </div>
  `;

  // Recipients: Gopal, Praveen, Admin + Internal Recruiters
  const recipients = await staffUsers(admin, ['admin', 'recruiter']);

  // Also send submission receipt to vendor staff
  if (sub.vendor_org_id) {
    const vendorStaff = await orgUsers(admin, sub.vendor_org_id);
    recipients.push(...vendorStaff);
  }

  const emails = Array.from(
    new Set(recipients.map((u) => u.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))
  );

  // Guarantee gopal@hirenestworkforce.com is always included
  if (!emails.includes('gopal@hirenestworkforce.com')) {
    emails.push('gopal@hirenestworkforce.com');
  }

  const subject = `New Candidate Submission: ${candidateName} by ${vendorName} for ${reqTitle}${matchScore !== null ? ` (${matchScore}% Match)` : ''}`;

  const sendResult = await sendEmailResult(emails, subject, emailHtml, 'admin@hirenestworkforce.com');
  if (!sendResult.ok) {
    console.error(`[notifyCandidateSubmitted] Email sending failed (${sendResult.channel}):`, sendResult.error);
    // Release claim so it can retry
    await admin.from('alert_log').delete().eq('dedupe_key', `sub_submitted:${submissionId}`);
    return false;
  }

  console.log(`[notifyCandidateSubmitted] Email successfully dispatched to ${emails.join(', ')}`);
  return true;
}

/**
 * Sweep unnotified recent submissions and send alert emails if pending.
 */
export async function runNewSubmissionAlerts(admin: SupabaseClient): Promise<{ sent: number }> {
  const { data: recentSubs } = await admin
    .from('submissions')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(30);

  let sent = 0;
  for (const s of recentSubs || []) {
    const ok = await notifyCandidateSubmitted(admin, s.id);
    if (ok) sent++;
  }
  return { sent };
}

/**
 * Triggered whenever a vendor acknowledges a shared requirement:
 * 1. Creates in-app notifications for HQ admins & recruiters.
 * 2. Sends live alert email from Gopal to gopal@hirenestworkforce.com, praveen, admin, and staffing team.
 */
export async function notifyRequirementAcknowledged(
  admin: SupabaseClient,
  requirementId: string,
  vendorOrgId?: string,
  acknowledgedByUserId?: string,
  meta?: { acknowledgedByEmail?: string; acknowledgedByName?: string }
): Promise<boolean> {
  let resolvedVendorOrgId = vendorOrgId && vendorOrgId !== 'default_vendor' ? vendorOrgId : null;

  // If vendorOrgId is unknown, try to find it from requirement_vendor_shares
  if (!resolvedVendorOrgId) {
    const { data: share } = await admin
      .from('requirement_vendor_shares')
      .select('vendor_org_id, acknowledged_by')
      .eq('requirement_id', requirementId)
      .not('acknowledged_at', 'is', null)
      .order('acknowledged_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (share?.vendor_org_id) {
      resolvedVendorOrgId = share.vendor_org_id;
      if (!acknowledgedByUserId && share.acknowledged_by) {
        acknowledgedByUserId = share.acknowledged_by;
      }
    }
  }

  const claimKey = `ack_req:${requirementId}:${resolvedVendorOrgId || 'general'}`;
  if (!(await claim(admin, claimKey))) {
    return true; // Already alerted
  }

  // Fetch requirement details
  const { data: req, error: reqErr } = await admin
    .from('requirements')
    .select('id, title, client_org_id, location, work_mode, min_experience, max_experience')
    .eq('id', requirementId)
    .maybeSingle();

  if (reqErr || !req) {
    console.error(`[notifyRequirementAcknowledged] Could not find requirement ${requirementId}:`, reqErr);
    await admin.from('alert_log').delete().eq('dedupe_key', claimKey);
    return false;
  }

  // Fetch vendor organization
  let vendorName = 'Vendor Partner';
  if (resolvedVendorOrgId) {
    const { data: vOrg } = await admin
      .from('organizations')
      .select('name')
      .eq('id', resolvedVendorOrgId)
      .maybeSingle();
    if (vOrg?.name) vendorName = vOrg.name;
  }

  // Fetch client organization
  let clientName = 'HireNest Client';
  if (req.client_org_id) {
    const { data: cOrg } = await admin
      .from('organizations')
      .select('name')
      .eq('id', req.client_org_id)
      .maybeSingle();
    if (cOrg?.name) clientName = cOrg.name;
  }

  // Fetch acknowledging user details if available
  let ackUserName = meta?.acknowledgedByName?.trim() || '';
  let ackUserEmail = meta?.acknowledgedByEmail?.trim() || '';
  if ((!ackUserName || !ackUserEmail) && acknowledgedByUserId) {
    const { data: prof } = await admin
      .from('profiles')
      .select('full_name, email')
      .eq('id', acknowledgedByUserId)
      .maybeSingle();
    if (prof?.full_name && !ackUserName) ackUserName = prof.full_name;
    if (prof?.email && !ackUserEmail) ackUserEmail = prof.email;
  }

  const ackTimeStr = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' IST';

  // 1. In-app notifications to active HQ admins and recruiters
  const staffList = await staffUsers(admin, ['admin', 'recruiter']);
  const validDbStaff = staffList.filter((u) => u.id && u.id.length > 20 && !u.id.endsWith('_hq'));
  if (validDbStaff.length > 0) {
    try {
      await admin.from('notifications').insert(
        validDbStaff.map((u) => ({
          user_id: u.id,
          kind: 'requirement_acknowledged',
          title: `Requirement Acknowledged: ${vendorName}`,
          body: `${vendorName}${ackUserName ? ` (${ackUserName})` : ''} acknowledged "${req.title}". Sourcing SLA clock (2h) is active.`,
          link: `/admin/requirements/${req.id}`,
        }))
      );
    } catch (notifErr) {
      console.warn('[notifyRequirementAcknowledged] Notification insert failed:', notifErr);
    }
  }

  // 2. Build email alert
  const subject = `Vendor Acknowledged: ${vendorName} on "${req.title}"`;
  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px;">
        <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #059669;">Requirement Acknowledged · SLA Clock Active</span>
        <h2 style="color: #0f172a; margin: 6px 0 0; font-size: 20px;">${vendorName} has acknowledged your requirement</h2>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="display: inline-block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 6px 14px; border-radius: 9999px; font-weight: 700; font-size: 13px;">
          ⏱️ 2-Hour Sourcing SLA Clock Running
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600; width: 140px;">Requirement</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${req.title}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Client Account</td>
            <td style="padding: 10px 0; color: #334155;">${clientName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Vendor Partner</td>
            <td style="padding: 10px 0; color: #2563eb; font-weight: 600;">${vendorName}</td>
          </tr>
          ${ackUserName || ackUserEmail ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Acknowledged By</td>
            <td style="padding: 10px 0; color: #334155;">${ackUserName || 'Vendor Recruiter'}${ackUserEmail ? ` &lt;${ackUserEmail}&gt;` : ''}</td>
          </tr>` : ''}
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Acknowledged At</td>
            <td style="padding: 10px 0; color: #334155;">${ackTimeStr}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">SLA Window</td>
            <td style="padding: 10px 0; color: #047857; font-weight: 600;">120 minutes (submission timing tracked on vendor scorecard)</td>
          </tr>
        </tbody>
      </table>

      <div style="background: #f8fafc; border-left: 3px solid #059669; padding: 12px 14px; border-radius: 4px; font-size: 13px; color: #334155; margin-bottom: 20px;">
        <strong>Next Step:</strong> ${vendorName} has committed to sourcing for this position. Their submission timing and SLA compliance are being tracked automatically on the Vendor Performance leaderboard.
      </div>

      <div style="margin-top: 24px; text-align: left;">
        <a href="${APP_URL()}/admin/requirements/${req.id}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">Open Requirement in HireNest</a>
      </div>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 16px;" />
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">
        HireNest Workforce Private Limited · Notifications Dispatcher · Sourcing response from ${vendorName}
      </p>
    </div>
  `;

  // Recipients: HQ staff (Gopal, Praveen, Admin)
  const recipients = await staffUsers(admin, ['admin', 'recruiter']);
  const emails = Array.from(
    new Set(recipients.map((u) => u.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))
  );

  // Guarantee gopal@hirenestworkforce.com is always included
  if (!emails.includes('gopal@hirenestworkforce.com')) {
    emails.push('gopal@hirenestworkforce.com');
  }

  const sendResult = await sendEmailResult(emails, subject, emailHtml, 'admin@hirenestworkforce.com');
  if (!sendResult.ok) {
    console.error(`[notifyRequirementAcknowledged] Email dispatch failed (${sendResult.channel}):`, sendResult.error);
    await admin.from('alert_log').delete().eq('dedupe_key', claimKey);
    return false;
  }

  console.log(`[notifyRequirementAcknowledged] Alert email dispatched to ${emails.join(', ')} for ${vendorName} on "${req.title}"`);
  return true;
}

/**
 * Sweep unnotified requirement acknowledgements from recent shares.
 */
export async function runRequirementAckAlerts(admin: SupabaseClient): Promise<{ sent: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: shares } = await admin
    .from('requirement_vendor_shares')
    .select('requirement_id, vendor_org_id, acknowledged_at, acknowledged_by')
    .not('acknowledged_at', 'is', null)
    .gte('acknowledged_at', sevenDaysAgo)
    .order('acknowledged_at', { ascending: false })
    .limit(40);

  let sent = 0;
  for (const s of shares || []) {
    if (!s.requirement_id || !s.vendor_org_id) continue;
    const claimKey = `ack_req:${s.requirement_id}:${s.vendor_org_id}`;
    const { count } = await admin
      .from('alert_log')
      .select('id', { count: 'exact', head: true })
      .eq('dedupe_key', claimKey);
    if ((count || 0) > 0) continue;

    const ok = await notifyRequirementAcknowledged(
      admin,
      s.requirement_id,
      s.vendor_org_id,
      s.acknowledged_by
    );
    if (ok) sent++;
  }
  return { sent };
}

/**
 * Triggered when candidate matches are computed for an open requirement:
 * Sends SMTP email from gopal@hirenestworkforce.com to mapped vendors and admins.
 */
export async function notifyRequirementCandidateMatches(
  admin: SupabaseClient,
  requirementId: string
): Promise<{ matchesCount: number }> {
  const { data: req } = await admin
    .from('requirements')
    .select('id, title, status')
    .eq('id', requirementId)
    .maybeSingle();

  if (!req || req.status !== 'open') return { matchesCount: 0 };

  const { data: matches } = await admin
    .from('candidate_matches')
    .select('candidate_id, final_score, candidates(owner_vendor_org_id)')
    .eq('requirement_id', requirementId)
    .gte('final_score', MIN_MATCH)
    .limit(200);

  const count = matches?.length || 0;
  if (count === 0) return { matchesCount: 0 };

  // Notify HQ Admins (Gopal & Praveen)
  await notifyUsers(
    admin,
    await staffUsers(admin, ['admin', 'recruiter']),
    {
      kind: 'candidate_match_alert',
      title: `${count} matching candidate(s) for "${req.title}"`,
      body: `Matching engine has identified ${count} qualified profile(s) (>=${MIN_MATCH}%) ready for review on "${req.title}".`,
      link: `/admin/requirements/${req.id}`,
    },
    'admin@hirenestworkforce.com'
  );

  // Notify vendors whose candidates match
  const vendorOrgIds = new Set<string>();
  for (const m of matches || []) {
    const orgId = (m.candidates as any)?.owner_vendor_org_id;
    if (orgId) vendorOrgIds.add(orgId);
  }

  for (const vendorId of vendorOrgIds) {
    await notifyUsers(
      admin,
      await orgUsers(admin, vendorId),
      {
        kind: 'candidate_match_alert',
        title: `Qualified candidates in your pool for "${req.title}"`,
        body: `Your agency has candidates matching open requirement "${req.title}". Submit profiles early to maintain your SLA.`,
        link: `/vendor/requirements/${req.id}`,
      },
      'admin@hirenestworkforce.com'
    );
  }

  return { matchesCount: count };
}
