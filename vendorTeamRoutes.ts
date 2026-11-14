import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

type AuthOk = { ok: true; userId: string; role: string; orgId: string | null };
type AuthResult = AuthOk | { ok: false; status: number; message: string };

interface Deps {
  authenticate: (req: express.Request, opts?: { strict?: boolean }) => Promise<AuthResult>;
  getAdmin: () => SupabaseClient | null;
}

const VENDOR_ROLES = ['vendor_admin', 'vendor_recruiter'] as const;
type VendorRole = (typeof VENDOR_ROLES)[number];
const isVendorRole = (v: unknown): v is VendorRole =>
  typeof v === 'string' && (VENDOR_ROLES as readonly string[]).includes(v);

/**
 * Vendor-organisation team management. A Vendor Admin can invite and manage users inside
 * their OWN organisation only. Every query is scoped to the caller's org_id server-side.
 */
export function registerVendorTeamRoutes(app: express.Express, deps: Deps): void {
  async function guard(req: express.Request, res: express.Response) {
    const auth = await deps.authenticate(req, { strict: true });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return null;
    }
    if (auth.role !== 'vendor_admin' || !auth.orgId) {
      res.status(403).json({ error: 'Only a Vendor Admin can manage the agency team.' });
      return null;
    }
    const admin = deps.getAdmin();
    if (!admin) {
      res.status(503).json({ error: 'Service unavailable.' });
      return null;
    }
    const { data: org } = await admin.from('organizations').select('status, type').eq('id', auth.orgId).maybeSingle();
    if (!org || org.type !== 'vendor' || org.status !== 'approved') {
      res.status(403).json({ error: 'Your agency is not approved yet.' });
      return null;
    }
    return { admin, userId: auth.userId, orgId: auth.orgId };
  }

  async function audit(
    admin: SupabaseClient,
    e: { actorId: string; targetUserId?: string; action: string; after?: unknown }
  ) {
    await admin.from('access_audit_log').insert({
      actor_id: e.actorId,
      actor_role: 'vendor_admin',
      target_user_id: e.targetUserId ?? null,
      action: e.action,
      after: e.after ?? null,
    });
  }

  app.get('/api/vendor/team', async (req, res) => {
    const ctx = await guard(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.admin
      .from('profiles')
      .select('id, full_name, email, phone, role, status, created_at')
      .eq('org_id', ctx.orgId)
      .in('role', [...VENDOR_ROLES])
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ members: data || [], currentUserId: ctx.userId });
  });

  app.post('/api/vendor/team', async (req, res) => {
    const ctx = await guard(req, res);
    if (!ctx) return;
    const b = (req.body || {}) as Record<string, unknown>;
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const role = b.role;
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ error: 'Name and a valid email are required.' });
      return;
    }
    if (!isVendorRole(role)) {
      res.status(400).json({ error: 'Role must be vendor_admin or vendor_recruiter.' });
      return;
    }
    const { data: existing } = await ctx.admin.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (existing) {
      res.status(409).json({ error: 'A user with this email already exists.' });
      return;
    }
    const redirectTo = `${process.env.APP_BASE_URL || 'https://os.hirenestworkforce.com'}/reset-password`;
    const { data: invite, error: invErr } = await ctx.admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      redirectTo,
    });
    if (invErr || !invite?.user) {
      res.status(400).json({ error: invErr?.message || 'Could not send invitation.' });
      return;
    }
    const uid = invite.user.id;
    const { error: pErr } = await ctx.admin.from('profiles').upsert(
      {
        id: uid,
        org_id: ctx.orgId, // always the caller's own org
        role,
        status: 'active',
        full_name: name,
        email,
        phone: b.mobile ? String(b.mobile) : null,
      },
      { onConflict: 'id' }
    );
    if (pErr) {
      res.status(400).json({ error: pErr.message });
      return;
    }
    await audit(ctx.admin, { actorId: ctx.userId, targetUserId: uid, action: 'vendor_user_created', after: { email, role } });
    res.json({ ok: true, userId: uid, invited: true });
  });

  async function loadTarget(ctx: { admin: SupabaseClient; orgId: string }, id: string) {
    const { data } = await ctx.admin
      .from('profiles')
      .select('id, role, status, org_id')
      .eq('id', id)
      .maybeSingle();
    // Cross-org access is indistinguishable from "not found".
    if (!data || data.org_id !== ctx.orgId || !isVendorRole(data.role)) return null;
    return data;
  }

  async function activeAdminCount(admin: SupabaseClient, orgId: string) {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('role', 'vendor_admin')
      .eq('status', 'active');
    return count || 0;
  }

  app.patch('/api/vendor/team/:id', async (req, res) => {
    const ctx = await guard(req, res);
    if (!ctx) return;
    const id = req.params.id;
    const b = (req.body || {}) as Record<string, unknown>;
    if (id === ctx.userId) {
      res.status(403).json({ error: 'You cannot change your own role or status.' });
      return;
    }
    const target = await loadTarget(ctx, id);
    if (!target) {
      res.status(404).json({ error: 'User not found in your agency.' });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (b.role !== undefined) {
      if (!isVendorRole(b.role)) {
        res.status(400).json({ error: 'Invalid role.' });
        return;
      }
      if (target.role === 'vendor_admin' && b.role !== 'vendor_admin' && (await activeAdminCount(ctx.admin, ctx.orgId)) <= 1) {
        res.status(400).json({ error: 'Your agency needs at least one active Vendor Admin.' });
        return;
      }
      patch.role = b.role;
    }
    if (b.status !== undefined) {
      if (b.status !== 'active' && b.status !== 'suspended') {
        res.status(400).json({ error: 'Status must be active or suspended.' });
        return;
      }
      if (b.status === 'suspended' && target.role === 'vendor_admin' && (await activeAdminCount(ctx.admin, ctx.orgId)) <= 1) {
        res.status(400).json({ error: 'You cannot suspend the last active Vendor Admin.' });
        return;
      }
      patch.status = b.status;
    }
    if (b.name !== undefined) patch.full_name = String(b.name).trim();
    if (b.mobile !== undefined) patch.phone = b.mobile ? String(b.mobile) : null;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }
    const { error } = await ctx.admin.from('profiles').update(patch).eq('id', id).eq('org_id', ctx.orgId);
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    await audit(ctx.admin, { actorId: ctx.userId, targetUserId: id, action: 'vendor_user_updated', after: patch });
    res.json({ ok: true });
  });

  // Self-service share: a vendor who can SEE an open requirement in their workspace may submit to it.
  // Creates the missing share row (never re-creates one HQ deliberately revoked).
  app.post('/api/vendor/requirements/:id/ensure-share', async (req, res) => {
    const auth = await deps.authenticate(req, { strict: true });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    if ((auth.role !== 'vendor_admin' && auth.role !== 'vendor_recruiter') || !auth.orgId) {
      res.status(403).json({ error: 'Vendor access required.' });
      return;
    }
    const admin = deps.getAdmin();
    if (!admin) {
      res.status(503).json({ error: 'Service unavailable.' });
      return;
    }
    const { data: org } = await admin.from('organizations').select('status, type').eq('id', auth.orgId).maybeSingle();
    if (!org || org.type !== 'vendor' || org.status !== 'approved') {
      res.status(403).json({ error: 'Your agency is not approved yet.' });
      return;
    }
    const reqId = req.params.id;
    const { data: r } = await admin
      .from('requirements')
      .select('id, status, submission_sla_hours')
      .eq('id', reqId)
      .maybeSingle();
    if (!r || r.status !== 'open') {
      res.status(404).json({ error: 'This requirement is not open for submissions.' });
      return;
    }
    const { data: existing } = await admin
      .from('requirement_vendor_shares')
      .select('id, revoked_at')
      .eq('requirement_id', reqId)
      .eq('vendor_org_id', auth.orgId)
      .maybeSingle();
    if (existing) {
      if (existing.revoked_at) {
        res.status(403).json({ error: 'This requirement was withdrawn from your agency by HireNest.' });
        return;
      }
      res.json({ ok: true, created: false });
      return;
    }
    const hours = Number(r.submission_sla_hours) > 0 ? Number(r.submission_sla_hours) : 48;
    const now = Date.now();
    const { error } = await admin.from('requirement_vendor_shares').insert({
      requirement_id: reqId,
      vendor_org_id: auth.orgId,
      shared_by: auth.userId,
      shared_at: new Date(now).toISOString(),
      due_at: new Date(now + hours * 3600_000).toISOString(),
    });
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    await admin.from('access_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'vendor_self_share',
      after: { requirement_id: reqId, vendor_org_id: auth.orgId },
    });
    res.json({ ok: true, created: true });
  });
}
