/**
 * Internal-employee RBAC model (shared by server enforcement and UI).
 * Vendor / client / candidate roles are NOT part of this model and are unaffected.
 */

export const STAFF_ROLES = [
  'platform_admin',
  'super_admin',
  'senior_bom',
  'bdm',
  'hr',
  'admin_recruiter',
  'recruiter',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  platform_admin: 'Platform Admin',
  super_admin: 'Super Admin',
  senior_bom: 'Senior Business Operations Manager',
  bdm: 'BDM',
  hr: 'HR',
  admin_recruiter: 'Admin Recruiter',
  recruiter: 'Recruiter',
};

export const STAFF_ROLE_DESCRIPTION: Record<StaffRole, string> = {
  platform_admin: 'Full platform control, including security, billing and creating other admins.',
  super_admin: 'Runs day-to-day operations and manages users below admin level. No security or billing.',
  senior_bom: 'Cross-functional operations lead: business development, recruitment, follow-ups and task assignment. Cannot edit financial terms or access admin settings.',
  bdm: 'Business development: leads, client relationships, sales pipeline and follow-ups for assigned clients.',
  hr: 'Employee records, onboarding, attendance, leave and HR documents.',
  admin_recruiter: 'Runs recruitment: requirements, candidates, screening approvals, submissions and interviews.',
  recruiter: 'Works assigned requirements: sourcing, screening, matching and submissions.',
};
// Vendor Recruiters are created inside a vendor organisation by its Vendor Admin (separate, org-scoped role).

export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'export',
  'assign',
  'reassign',
  'manage_team',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const RECORD_SCOPES = ['own', 'assigned', 'department', 'organisation', 'platform'] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];

export const PERMISSION_MODULES = [
  'business_development',
  'clients_vendors',
  'requirements',
  'candidates',
  'submissions',
  'interviews',
  'tasks',
  'follow_ups',
  'reports',
  'hr',
  'finance',
  'user_management',
  'platform_security',
  'subscription_billing',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const MODULE_LABEL: Record<PermissionModule, string> = {
  business_development: 'Business Development',
  clients_vendors: 'Client & Vendor Coordination',
  requirements: 'Requirements',
  candidates: 'Candidates',
  submissions: 'Submissions',
  interviews: 'Interviews',
  tasks: 'Tasks & Assignments',
  follow_ups: 'Follow-ups',
  reports: 'Reports',
  hr: 'HR Records',
  finance: 'Financial Approvals',
  user_management: 'User & Team Management',
  platform_security: 'Platform Security',
  subscription_billing: 'Subscription & Billing',
};

export interface ModuleGrant {
  actions: PermissionAction[];
  scope: RecordScope;
}
export type PermissionSet = Partial<Record<PermissionModule, ModuleGrant>>;

export interface StaffAccess {
  role: StaffRole;
  permissions: PermissionSet;
  /** Fields hidden from this user even inside modules they can view. */
  restrictedFields: string[];
}

const ALL: PermissionAction[] = [...PERMISSION_ACTIONS];
const g = (scope: RecordScope, actions: PermissionAction[]): ModuleGrant => ({ scope, actions });

const SENSITIVE_HR = ['salary', 'bank_details', 'government_id', 'medical', 'performance_review'];
const SENSITIVE_FIN = ['client_margin', 'vendor_payout', 'billing_rate'];
const SENSITIVE_CONTACT = ['candidate_phone', 'candidate_email'];

/** Modules only a Platform Admin may ever grant (privilege-escalation guard). */
export const PLATFORM_ADMIN_ONLY_MODULES: PermissionModule[] = [
  'platform_security',
  'subscription_billing',
];

export const DEFAULT_TEMPLATES: Record<StaffRole, StaffAccess> = {
  platform_admin: {
    role: 'platform_admin',
    restrictedFields: [],
    permissions: Object.fromEntries(
      PERMISSION_MODULES.map((m) => [m, g('platform', ALL)])
    ) as PermissionSet,
  },
  super_admin: {
    role: 'super_admin',
    restrictedFields: [],
    permissions: {
      business_development: g('organisation', ALL),
      clients_vendors: g('organisation', ALL),
      requirements: g('organisation', ALL),
      candidates: g('organisation', ALL),
      submissions: g('organisation', ALL),
      interviews: g('organisation', ALL),
      tasks: g('organisation', ALL),
      follow_ups: g('organisation', ALL),
      reports: g('organisation', ALL),
      hr: g('organisation', ALL),
      finance: g('organisation', ['view', 'export']),
      user_management: g('organisation', ['view', 'create', 'edit', 'assign', 'reassign', 'manage_team']),
    },
  },
  // Cross-functional operations: read/write, but no admin/security/billing/financial approvals.
  senior_bom: {
    role: 'senior_bom',
    restrictedFields: [...SENSITIVE_HR, ...SENSITIVE_FIN],
    permissions: {
      business_development: g('organisation', ['view', 'create', 'edit', 'assign', 'export']),
      clients_vendors: g('organisation', ['view', 'create', 'edit', 'assign', 'export']),
      requirements: g('organisation', ['view', 'create', 'edit', 'assign', 'reassign', 'export']),
      candidates: g('organisation', ['view', 'create', 'edit', 'assign', 'reassign', 'export']),
      submissions: g('organisation', ['view', 'create', 'edit', 'assign', 'reassign']),
      interviews: g('organisation', ['view', 'create', 'edit', 'assign', 'reassign']),
      // May create tasks and assign them to anyone in the team, including admins.
      tasks: g('organisation', ['view', 'create', 'edit', 'assign', 'reassign']),
      follow_ups: g('organisation', ['view', 'create', 'edit', 'assign']),
      reports: g('organisation', ['view', 'export']),
      hr: g('department', ['view', 'create', 'edit']),
    },
  },
  bdm: {
    role: 'bdm',
    restrictedFields: [...SENSITIVE_HR, ...SENSITIVE_FIN, ...SENSITIVE_CONTACT],
    permissions: {
      business_development: g('assigned', ['view', 'create', 'edit', 'export']),
      clients_vendors: g('assigned', ['view', 'create', 'edit']),
      requirements: g('assigned', ['view', 'create', 'edit']),
      tasks: g('own', ['view', 'create', 'edit']),
      follow_ups: g('own', ['view', 'create', 'edit']),
      reports: g('own', ['view', 'export']),
    },
  },
  hr: {
    role: 'hr',
    restrictedFields: [...SENSITIVE_FIN],
    permissions: {
      hr: g('organisation', ['view', 'create', 'edit', 'approve', 'export']),
      tasks: g('own', ['view', 'create', 'edit']),
      follow_ups: g('own', ['view', 'create', 'edit']),
      reports: g('department', ['view', 'export']),
    },
  },
  admin_recruiter: {
    role: 'admin_recruiter',
    restrictedFields: [...SENSITIVE_HR, ...SENSITIVE_FIN],
    permissions: {
      requirements: g('organisation', ['view', 'create', 'edit', 'approve', 'assign', 'reassign']),
      candidates: g('organisation', ['view', 'create', 'edit', 'approve', 'assign', 'reassign', 'export']),
      submissions: g('organisation', ['view', 'create', 'edit', 'approve', 'assign', 'reassign']),
      interviews: g('organisation', ['view', 'create', 'edit', 'assign', 'reassign']),
      tasks: g('department', ['view', 'create', 'edit', 'assign']),
      follow_ups: g('department', ['view', 'create', 'edit', 'assign']),
      reports: g('department', ['view', 'export']),
    },
  },
  recruiter: {
    role: 'recruiter',
    restrictedFields: [...SENSITIVE_HR, ...SENSITIVE_FIN],
    permissions: {
      requirements: g('assigned', ['view']),
      candidates: g('assigned', ['view', 'create', 'edit']),
      submissions: g('assigned', ['view', 'create', 'edit']),
      interviews: g('assigned', ['view', 'create', 'edit']),
      tasks: g('own', ['view', 'edit']),
      follow_ups: g('own', ['view', 'create', 'edit']),
      reports: g('own', ['view']),
    },
  },
};

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
}

/** Underlying app_role stored on profiles for each staff role (keeps existing RLS working). */
export function appRoleForStaffRole(role: StaffRole): 'admin' | 'recruiter' {
  return role === 'platform_admin' || role === 'super_admin' ? 'admin' : 'recruiter';
}

/** Merge per-user overrides on top of the role template. Overrides replace a module's grant. */
export function mergeAccess(
  template: StaffAccess,
  overrides?: PermissionSet | null,
  extraRestrictedFields?: string[] | null
): StaffAccess {
  const permissions: PermissionSet = { ...template.permissions };
  for (const [mod, grant] of Object.entries(overrides || {})) {
    if (!(PERMISSION_MODULES as readonly string[]).includes(mod)) continue;
    if (!grant || !Array.isArray(grant.actions) || grant.actions.length === 0) {
      delete permissions[mod as PermissionModule];
    } else {
      permissions[mod as PermissionModule] = grant;
    }
  }
  return {
    role: template.role,
    permissions,
    restrictedFields: Array.from(new Set([...template.restrictedFields, ...(extraRestrictedFields || [])])),
  };
}

export function hasPermission(
  access: StaffAccess,
  module: PermissionModule,
  action: PermissionAction
): boolean {
  return Boolean(access.permissions[module]?.actions.includes(action));
}

const SCOPE_RANK: Record<RecordScope, number> = {
  own: 1,
  assigned: 2,
  department: 3,
  organisation: 4,
  platform: 5,
};
export function scopeCovers(have: RecordScope, need: RecordScope): boolean {
  return SCOPE_RANK[have] >= SCOPE_RANK[need];
}

/**
 * Can `actor` grant `grant` for `module`? Prevents privilege escalation:
 * - only platform admins grant platform-only modules or platform scope
 * - nobody grants more than they hold themselves (except platform admin)
 */
export function canGrant(
  actor: StaffAccess,
  module: PermissionModule,
  grant: ModuleGrant
): boolean {
  if (actor.role === 'platform_admin') return true;
  if (PLATFORM_ADMIN_ONLY_MODULES.includes(module)) return false;
  if (grant.scope === 'platform') return false;
  const mine = actor.permissions[module];
  if (!mine) return false;
  if (!scopeCovers(mine.scope, grant.scope)) return false;
  return grant.actions.every((a) => mine.actions.includes(a));
}
