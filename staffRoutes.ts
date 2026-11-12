import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_TEMPLATES,
  PERMISSION_MODULES,
  PERMISSION_ACTIONS,
  RECORD_SCOPES,
  STAFF_ROLES,
  appRoleForStaffRole,
  canGrant,
  hasPermission,
  isStaffRole,
  mergeAccess,
  type ModuleGrant,
  type PermissionAction,
  type PermissionModule,
  type PermissionSet,
  type StaffAccess,
  type StaffRole,
} from './src/lib/staffRbac';

type AuthOk = { ok: true; userId: string; role: string; orgId: string | null };
type AuthResult = AuthOk | { ok: false; status: number; message: string };

interface Deps {
  authenticate: (req: express.Request, opts?: { strict?: boolean }) => Promise<AuthResult>;
  getAdmin: () => SupabaseClient | null;
}

export interface StaffCaller {
  userId: string;
  staffRole: StaffRole;
  access: StaffAccess;
}

/**
 * Resolve a user's effective staff access from the DB on every request, so role changes,
 * template edits and suspensions take effect immediately (no stale sessions).
 */
export async function resolveStaffAccess(
  admin: SupabaseClient,
  userId: string,
  profileRole: string
): Promise<StaffCaller | null> {
  const { data: sm } = await admin
    .from('staff_members')
    .select('system_role, permission_overrides, extra_restricted_fields')
    .eq('user_id', userId)
    .maybeSingle();

  let role: StaffRole | null = null;
  if (sm && isStaffRole(sm.system_role)) role = sm.system_role;
  // Backward compatible: legacy HQ admin / recruiter profiles with no staff row.
  else if (profileRole === 'admin') role = 'platform_admin';
  else if (profileRole === 'recruiter') role = 'recruiter';
  if (!role) return null;

  const { data: tpl } = await admin
    .from('staff_permission_templates')
    .select('permissions, restricted_fields')
    .eq('system_role', role)
    .maybeSingle();

  const base: StaffAccess = tpl
    ? { role, permissions: tpl.permissions as PermissionSet, restrictedFields: tpl.restricted_fields || [] }
    : DEFAULT_TEMPLATES[role];

  const access = mergeAccess(
    base,
    (sm?.permission_overrides as PermissionSet | undefined) || null,
    (sm?.extra_restricted_fields as string[] | undefined) || null
  );
  return { userId, staffRole: role, access };
}

function sanitizeGrant(raw: unknown): ModuleGrant | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { actions?: unknown; scope?: unknown };
  const scope = (RECORD_SCOPES as readonly string[]).includes(String(r.scope))
    ? (r.scope as ModuleGrant['scope'])
    : null;
  if (!scope || !Array.isArray(r.actions)) return null;
  const actions = r.actions.filter((a): a is PermissionAction =>
    (PERMISSION_ACTIONS as readonly string[]).includes(String(a))
  );
  return { scope, actions: Array.from(new Set(actions)) };
}

function sanitizePermissionSet(raw: unknown): PermissionSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: PermissionSet = {};
  for (const [mod, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!(PERMISSION_MODULES as readonly string[]).includes(mod)) continue;
    const grant = sanitizeGrant(val);
    out[mod as PermissionModule] = grant || { scope: 'own', actions: [] };
  }
  return out;
}

export function registerStaffRoutes(app: express.Express, deps: Deps): void {
  async function audit(
    admin: SupabaseClient,
    entry: {
      actorId: string | null;
      actorRole: string | null;
      targetUserId?: string | null;
      action: string;
      before?: unknown;
      after?: unknown;
      reason?: string | null;
    }
  ) {
    await admin.from('access_audit_log').insert({
      actor_id: entry.actorId && /^[0-9a-f-]{36}$/i.test(entry.actorId) ? entry.actorId : null,
      actor_role: entry.actorRole,
      target_user_id: entry.targetUserId ?? null,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
    });
  }

  /** Authenticates (strict JWT), resolves staff access, and optionally enforces a permission. */
  async function guard(
    req: express.Request,
    res: express.Response,
    need?: { module: PermissionModule; action: PermissionAction }
  ): Promise<{ admin: SupabaseClient; caller: StaffCaller } | null> {
    const auth = await deps.authenticate(req, { strict: true });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return null;
    }
    const admin = deps.getAdmin();
    if (!admin) {
      res.status(503).json({ error: 'User management requires Supabase to be configured.' });
      return null;
    }
    const caller = await resolveStaffAccess(admin, auth.userId, auth.role);
    if (!caller) {
      res.status(403).json({ error: 'Internal staff access required.' });
      return null;
    }
    if (need && !hasPermission(caller.access, need.module, need.action)) {
      await audit(admin, {
        actorId: caller.userId,
        actorRole: caller.staffRole,
        action: 'denied',
        after: need,
      });
      res.status(403).json({ error: `Missing permission: ${need.module}.${need.action}` });
      return null;
    }
    return { admin, caller };
  }

  // ---- My Access (every internal employee; read-only) ----
  app.get('/api/staff/me', async (req, res) => {
    const ctx = await guard(req, res);
    if (!ctx) return;
    const { admin, caller } = ctx;
    const { data: sm } = await admin
      .from('staff_members')
      .select('employee_id, designation, team, joining_date, department_id, reporting_manager_id')
      .eq('user_id', caller.userId)
      .maybeSingle();
    const [{ data: dept }, { data: mgr }, { data: profile }] = await Promise.all([
      sm?.department_id
        ? admin.from('departments').select('name').eq('id', sm.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sm?.reporting_manager_id
        ? admin.from('profiles').select('full_name, email').eq('id', sm.reporting_manager_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('profiles').select('full_name, email').eq('id', caller.userId).maybeSingle(),
    ]);
    res.json({
      ok: true,
      me: {
        userId: caller.userId,
        name: profile?.full_name || '',
        email: profile?.email || '',
        role: caller.staffRole,
        department: dept?.name || null,
        designation: sm?.designation || null,
        employeeId: sm?.employee_id || null,
        team: sm?.team || null,
        joiningDate: sm?.joining_date || null,
        reportingManager: mgr ? { name: mgr.full_name, email: mgr.email } : null,
        permissions: caller.access.permissions,
        restrictedFields: caller.access.restrictedFields,
      },
    });
  });

  // ---- Departments ----
  app.get('/api/staff/departments', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'view' });
    if (!ctx) return;
    const { data } = await ctx.admin.from('departments').select('id, name').order('name');
    res.json({ ok: true, departments: data || [] });
  });

  app.post('/api/staff/departments', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'create' });
    if (!ctx) return;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 80) {
      res.status(400).json({ error: 'Department name must be 2-80 characters.' });
      return;
    }
    const { data, error } = await ctx.admin.from('departments').insert({ name }).select('id, name').single();
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    await audit(ctx.admin, { actorId: ctx.caller.userId, actorRole: ctx.caller.staffRole, action: 'department_created', after: data });
    res.json({ ok: true, department: data });
  });

  // ---- Users ----
  app.get('/api/staff/users', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'view' });
    if (!ctx) return;
    const { data: members } = await ctx.admin
      .from('staff_members')
      .select(
        'user_id, employee_id, department_id, designation, system_role, reporting_manager_id, team, joining_date, permission_overrides, activated_at, invited_at'
      );
    const ids = (members || []).map((m) => m.user_id);
    const { data: profiles } = ids.length
      ? await ctx.admin.from('profiles').select('id, full_name, email, phone, status').in('id', ids)
      : { data: [] as Array<{ id: string; full_name: string; email: string; phone: string; status: string }> };
    const byId = new Map((profiles || []).map((p) => [p.id, p]));
    const users = (members || []).map((m) => {
      const p = byId.get(m.user_id);
      return {
        id: m.user_id,
        name: p?.full_name || '',
        email: p?.email || '',
        mobile: p?.phone || '',
        status: p?.status || 'active',
        employeeId: m.employee_id,
        departmentId: m.department_id,
        designation: m.designation,
        role: m.system_role,
        reportingManagerId: m.reporting_manager_id,
        team: m.team,
        joiningDate: m.joining_date,
        hasOverrides: Object.keys(m.permission_overrides || {}).length > 0,
        invitedAt: m.invited_at,
        activatedAt: m.activated_at,
      };
    });
    res.json({ ok: true, users });
  });

  /** Common checks for assigning a role / overrides: prevents privilege escalation. */
  function assertCanAssignRole(caller: StaffCaller, target: StaffRole): string | null {
    if (target === 'platform_admin' || target === 'super_admin') {
      return caller.staffRole === 'platform_admin'
        ? null
        : 'Only a Platform Admin can assign Platform Admin or Super Admin roles.';
    }
    if (caller.staffRole === 'platform_admin' || caller.staffRole === 'super_admin') return null;
    return 'You are not allowed to assign roles.';
  }

  function validateOverrides(caller: StaffCaller, overrides: PermissionSet): string | null {
    for (const [mod, grant] of Object.entries(overrides)) {
      if (!grant || grant.actions.length === 0) continue; // revocation is always allowed
      if (!canGrant(caller.access, mod as PermissionModule, grant)) {
        return `You cannot grant ${mod} (${grant.scope}) — exceeds your own access.`;
      }
    }
    return null;
  }

  app.post('/api/staff/users', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'create' });
    if (!ctx) return;
    const { admin, caller } = ctx;
    const b = (req.body || {}) as Record<string, unknown>;
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const role = b.role;
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ error: 'Name and a valid official email are required.' });
      return;
    }
    if (!isStaffRole(role)) {
      res.status(400).json({ error: `Role must be one of: ${STAFF_ROLES.join(', ')}` });
      return;
    }
    const roleErr = assertCanAssignRole(caller, role);
    if (roleErr) {
      await audit(admin, { actorId: caller.userId, actorRole: caller.staffRole, action: 'denied', after: { create_role: role } });
      res.status(403).json({ error: roleErr });
      return;
    }
    const overrides = sanitizePermissionSet(b.permissionOverrides) || {};
    const ovErr = validateOverrides(caller, overrides);
    if (ovErr) {
      res.status(403).json({ error: ovErr });
      return;
    }

    const redirectTo = `${process.env.APP_BASE_URL || 'https://os.hirenestworkforce.com'}/reset-password`;
    const { data: invite, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name, signup_intent: 'staff' },
      redirectTo,
    });
    if (invErr || !invite?.user) {
      res.status(400).json({ error: invErr?.message || 'Could not send invitation.' });
      return;
    }
    const uid = invite.user.id;

    const { data: internalOrg } = await admin.from('organizations').select('id').eq('type', 'internal').maybeSingle();
    await admin.from('profiles').upsert(
      {
        id: uid,
        org_id: internalOrg?.id || null,
        role: appRoleForStaffRole(role),
        status: b.status === 'suspended' ? 'suspended' : 'active',
        full_name: name,
        email,
        phone: b.mobile ? String(b.mobile) : null,
      },
      { onConflict: 'id' }
    );
    const { error: smErr } = await admin.from('staff_members').upsert(
      {
        user_id: uid,
        employee_id: b.employeeId ? String(b.employeeId) : null,
        department_id: b.departmentId ? String(b.departmentId) : null,
        designation: b.designation ? String(b.designation) : null,
        system_role: role,
        reporting_manager_id: b.reportingManagerId ? String(b.reportingManagerId) : null,
        team: b.team ? String(b.team) : null,
        joining_date: b.joiningDate ? String(b.joiningDate) : null,
        permission_template: role,
        permission_overrides: overrides,
        invited_at: new Date().toISOString(),
        created_by: caller.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (smErr) {
      res.status(400).json({ error: smErr.message });
      return;
    }
    await audit(admin, {
      actorId: caller.userId,
      actorRole: caller.staffRole,
      targetUserId: uid,
      action: 'user_created',
      after: { email, role, departmentId: b.departmentId || null, overrides },
    });
    res.json({ ok: true, userId: uid, invited: true });
  });

  app.patch('/api/staff/users/:id', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'edit' });
    if (!ctx) return;
    const { admin, caller } = ctx;
    const targetId = req.params.id;
    const b = (req.body || {}) as Record<string, unknown>;

    // Nobody may change their own role / permissions / manager.
    if (targetId === caller.userId && ('role' in b || 'permissionOverrides' in b || 'reportingManagerId' in b || 'status' in b)) {
      await audit(admin, { actorId: caller.userId, actorRole: caller.staffRole, targetUserId: targetId, action: 'denied', after: { self_change: Object.keys(b) } });
      res.status(403).json({ error: 'You cannot change your own role, permissions, manager or status.' });
      return;
    }

    const { data: current } = await admin.from('staff_members').select('*').eq('user_id', targetId).maybeSingle();
    if (!current) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }
    // A non-platform admin cannot modify a higher-privileged account.
    if ((current.system_role === 'platform_admin' || current.system_role === 'super_admin') && caller.staffRole !== 'platform_admin') {
      res.status(403).json({ error: 'Only a Platform Admin can modify admin accounts.' });
      return;
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const events: Array<{ action: string; before: unknown; after: unknown }> = [];

    if ('role' in b) {
      if (!isStaffRole(b.role)) {
        res.status(400).json({ error: 'Invalid role.' });
        return;
      }
      const err = assertCanAssignRole(caller, b.role);
      if (err) {
        res.status(403).json({ error: err });
        return;
      }
      if (b.role !== current.system_role) {
        update.system_role = b.role;
        update.permission_template = b.role;
        events.push({ action: 'role_changed', before: current.system_role, after: b.role });
      }
    }
    if ('permissionOverrides' in b) {
      const ov = sanitizePermissionSet(b.permissionOverrides);
      if (!ov) {
        res.status(400).json({ error: 'Invalid permission overrides.' });
        return;
      }
      const err = validateOverrides(caller, ov);
      if (err) {
        res.status(403).json({ error: err });
        return;
      }
      update.permission_overrides = ov;
      events.push({ action: 'permissions_changed', before: current.permission_overrides, after: ov });
    }
    if ('departmentId' in b && (b.departmentId || null) !== current.department_id) {
      update.department_id = b.departmentId || null;
      events.push({ action: 'department_changed', before: current.department_id, after: b.departmentId || null });
    }
    if ('reportingManagerId' in b && (b.reportingManagerId || null) !== current.reporting_manager_id) {
      const mgrId = (b.reportingManagerId as string | null) || null;
      if (mgrId) {
        // Reject cycles: walk up from the proposed manager.
        let cursor: string | null = mgrId;
        for (let i = 0; cursor && i < 50; i++) {
          if (cursor === targetId) {
            res.status(400).json({ error: 'That reporting line would create a cycle.' });
            return;
          }
          const { data: up }: { data: { reporting_manager_id: string | null } | null } = await admin
            .from('staff_members')
            .select('reporting_manager_id')
            .eq('user_id', cursor)
            .maybeSingle();
          cursor = up?.reporting_manager_id ?? null;
        }
      }
      update.reporting_manager_id = mgrId;
      events.push({ action: 'manager_changed', before: current.reporting_manager_id, after: mgrId });
    }
    for (const [key, col] of [
      ['designation', 'designation'],
      ['employeeId', 'employee_id'],
      ['team', 'team'],
      ['joiningDate', 'joining_date'],
    ] as const) {
      if (key in b) update[col] = b[key] ? String(b[key]) : null;
    }

    const { error } = await admin.from('staff_members').update(update).eq('user_id', targetId);
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (update.system_role) {
      await admin.from('profiles').update({ role: appRoleForStaffRole(update.system_role as StaffRole) }).eq('id', targetId);
    }
    if (typeof b.name === 'string' || typeof b.mobile === 'string') {
      await admin
        .from('profiles')
        .update({
          ...(typeof b.name === 'string' ? { full_name: b.name.trim() } : {}),
          ...(typeof b.mobile === 'string' ? { phone: b.mobile.trim() } : {}),
        })
        .eq('id', targetId);
    }
    for (const ev of events) {
      await audit(admin, { actorId: caller.userId, actorRole: caller.staffRole, targetUserId: targetId, ...ev });
    }
    // Authorization is resolved from the DB on each request, so role changes apply immediately.
    res.json({ ok: true, changed: events.map((e) => e.action) });
  });

  async function setSuspended(req: express.Request, res: express.Response, suspend: boolean) {
    const ctx = await guard(req, res, { module: 'user_management', action: 'edit' });
    if (!ctx) return;
    const { admin, caller } = ctx;
    const targetId = req.params.id;
    if (targetId === caller.userId) {
      res.status(403).json({ error: 'You cannot suspend or reactivate your own account.' });
      return;
    }
    const { data: current } = await admin.from('staff_members').select('system_role').eq('user_id', targetId).maybeSingle();
    if (!current) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }
    if ((current.system_role === 'platform_admin' || current.system_role === 'super_admin') && caller.staffRole !== 'platform_admin') {
      res.status(403).json({ error: 'Only a Platform Admin can suspend admin accounts.' });
      return;
    }
    await admin.from('profiles').update({ status: suspend ? 'suspended' : 'active' }).eq('id', targetId);
    // Revoke access at the auth layer too: banned users cannot sign in or refresh tokens.
    await admin.auth.admin.updateUserById(targetId, { ban_duration: suspend ? '876000h' : 'none' });
    await audit(admin, {
      actorId: caller.userId,
      actorRole: caller.staffRole,
      targetUserId: targetId,
      action: suspend ? 'suspended' : 'reactivated',
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });
    res.json({ ok: true });
  }
  app.post('/api/staff/users/:id/suspend', (req, res) => void setSuspended(req, res, true));
  app.post('/api/staff/users/:id/reactivate', (req, res) => void setSuspended(req, res, false));

  // ---- Permission templates (Platform Admin configures the matrix) ----
  app.get('/api/staff/templates', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'view' });
    if (!ctx) return;
    const { data } = await ctx.admin.from('staff_permission_templates').select('system_role, permissions, restricted_fields');
    const stored = new Map((data || []).map((t) => [t.system_role, t]));
    const templates = STAFF_ROLES.map((r) => ({
      role: r,
      permissions: (stored.get(r)?.permissions as PermissionSet) || DEFAULT_TEMPLATES[r].permissions,
      restrictedFields: stored.get(r)?.restricted_fields || DEFAULT_TEMPLATES[r].restrictedFields,
      customised: stored.has(r),
    }));
    res.json({ ok: true, templates });
  });

  app.put('/api/staff/templates/:role', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'manage_team' });
    if (!ctx) return;
    const { admin, caller } = ctx;
    if (caller.staffRole !== 'platform_admin') {
      res.status(403).json({ error: 'Only a Platform Admin can edit permission templates.' });
      return;
    }
    const role = req.params.role;
    if (!isStaffRole(role) || role === 'platform_admin') {
      res.status(400).json({ error: 'This template cannot be edited.' });
      return;
    }
    const perms = sanitizePermissionSet(req.body?.permissions);
    if (!perms) {
      res.status(400).json({ error: 'Invalid permissions.' });
      return;
    }
    // Only Platform Admin may keep platform-only modules; a Senior BOM must never get them by template.
    if (role !== 'super_admin') {
      for (const mod of ['platform_security', 'subscription_billing'] as PermissionModule[]) delete perms[mod];
      if (perms.finance) perms.finance.actions = perms.finance.actions.filter((a) => a !== 'approve');
    }
    const restricted = Array.isArray(req.body?.restrictedFields)
      ? (req.body.restrictedFields as unknown[]).map(String).slice(0, 50)
      : DEFAULT_TEMPLATES[role].restrictedFields;
    const { data: before } = await admin.from('staff_permission_templates').select('permissions').eq('system_role', role).maybeSingle();
    await admin.from('staff_permission_templates').upsert({
      system_role: role,
      permissions: perms,
      restricted_fields: restricted,
      updated_by: caller.userId,
      updated_at: new Date().toISOString(),
    });
    await audit(admin, {
      actorId: caller.userId,
      actorRole: caller.staffRole,
      action: 'template_changed',
      before: before?.permissions || DEFAULT_TEMPLATES[role].permissions,
      after: perms,
      reason: role,
    });
    res.json({ ok: true });
  });

  // ---- Access audit ----
  app.get('/api/staff/audit', async (req, res) => {
    const ctx = await guard(req, res, { module: 'user_management', action: 'view' });
    if (!ctx) return;
    const target = typeof req.query.userId === 'string' ? req.query.userId : null;
    let q = ctx.admin
      .from('access_audit_log')
      .select('id, actor_id, actor_role, target_user_id, action, before, after, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (target) q = q.eq('target_user_id', target);
    const { data } = await q;
    res.json({ ok: true, events: data || [] });
  });
}

type Rule = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: RegExp;
  module: PermissionModule;
  action: PermissionAction;
  /** 'allow' = client/vendor/candidate callers pass through unchanged (shared endpoint). */
  external: 'allow' | 'deny';
  recordId?: (req: express.Request) => string | null;
};

const bodyId = (key: string) => (req: express.Request): string | null => {
  const v = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'string' && v ? v : null;
};

/** Central map of existing internal endpoints → required permission. Enforced server-side. */
const ENFORCEMENT_RULES: Rule[] = [
  { method: 'POST', path: /^\/api\/requirements\/delete$/, module: 'requirements', action: 'delete', external: 'allow', recordId: bodyId('requirementId') },
  { method: 'POST', path: /^\/api\/requirements\/duplicates\/consolidate$/, module: 'requirements', action: 'edit', external: 'allow' },
  { method: 'POST', path: /^\/api\/requirements\/mapping$/, module: 'requirements', action: 'edit', external: 'allow', recordId: bodyId('requirementId') },
  { method: 'POST', path: /^\/api\/subscriptions\/assign-plan$/, module: 'subscription_billing', action: 'edit', external: 'deny' },
  { method: 'GET', path: /^\/api\/subscriptions\/all-plans$/, module: 'subscription_billing', action: 'view', external: 'deny' },
  { method: 'POST', path: /^\/api\/subscriptions\/reminders\/run$/, module: 'subscription_billing', action: 'edit', external: 'deny' },
  { method: 'POST', path: /^\/api\/privacy\/retention\/policies$/, module: 'platform_security', action: 'edit', external: 'deny' },
  { method: 'POST', path: /^\/api\/privacy\/deletion-jobs\/run$/, module: 'platform_security', action: 'edit', external: 'deny' },
  { method: 'POST', path: /^\/api\/privacy\/incidents$/, module: 'platform_security', action: 'edit', external: 'deny' },
  { method: 'POST', path: /^\/api\/privacy\/requests\/update$/, module: 'platform_security', action: 'edit', external: 'deny' },
  { method: 'GET', path: /^\/api\/admin\/onboarding\/pending-documents$/, module: 'clients_vendors', action: 'view', external: 'deny' },
  { method: 'POST', path: /^\/api\/admin\/documents\/[^/]+\/review$/, module: 'clients_vendors', action: 'approve', external: 'deny' },
  { method: 'POST', path: /^\/api\/admin\/organizations\/[^/]+\/nda$/, module: 'clients_vendors', action: 'edit', external: 'deny' },
  { method: 'GET', path: /^\/api\/early-access\/applications$/, module: 'business_development', action: 'view', external: 'deny' },
  { method: 'PATCH', path: /^\/api\/early-access\/applications\/[^/]+$/, module: 'business_development', action: 'edit', external: 'deny' },
  { method: 'POST', path: /^\/api\/early-access\/applications\/[^/]+\/invite$/, module: 'business_development', action: 'edit', external: 'deny' },
];

/**
 * Registers a gate (before the route handlers) that enforces ENFORCEMENT_RULES.
 * Requires a verified Supabase JWT. Internal staff are checked against their effective
 * permissions and record scope; external roles (client/vendor/candidate) are unaffected
 * on shared endpoints and denied on staff-only ones.
 */
export function registerStaffEnforcement(app: express.Express, deps: Deps): void {
  app.use('/api', async (req, res, next) => {
    const rule = ENFORCEMENT_RULES.find((r) => r.method === req.method && r.path.test(`/api${req.path}`));
    if (!rule) return next();

    const auth = await deps.authenticate(req, { strict: true });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return;
    }
    const admin = deps.getAdmin();
    const isStaffProfile = auth.role === 'admin' || auth.role === 'recruiter';

    if (!isStaffProfile) {
      if (rule.external === 'allow') return next();
      res.status(403).json({ error: 'Internal staff access required.' });
      return;
    }
    // Without a service client we cannot resolve fine-grained access; keep legacy admin behaviour only.
    if (!admin) {
      if (auth.role === 'admin') return next();
      res.status(403).json({ error: 'Permission service unavailable.' });
      return;
    }

    const caller = await resolveStaffAccess(admin, auth.userId, auth.role);
    const deny = async (message: string) => {
      await admin.from('access_audit_log').insert({
        actor_id: auth.userId,
        actor_role: caller?.staffRole ?? auth.role,
        action: 'denied',
        after: { endpoint: `${req.method} ${req.path}`, need: `${rule.module}.${rule.action}` },
      });
      res.status(403).json({ error: message });
    };
    if (!caller || !hasPermission(caller.access, rule.module, rule.action)) {
      await deny(`Missing permission: ${rule.module}.${rule.action}`);
      return;
    }

    // Record scope: own/assigned grants only reach records explicitly assigned to the caller.
    const scope = caller.access.permissions[rule.module]?.scope;
    const recordId = rule.recordId?.(req) ?? null;
    if (recordId && (scope === 'own' || scope === 'assigned')) {
      const { data: row } = await admin
        .from('staff_record_assignments')
        .select('user_id')
        .eq('module', rule.module)
        .eq('record_id', recordId)
        .eq('user_id', auth.userId)
        .maybeSingle();
      if (!row) {
        await deny('This record is not assigned to you.');
        return;
      }
    }
    next();
  });
}
