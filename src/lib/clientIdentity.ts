/**
 * Client confidentiality: only the client itself and HireNest internal staff see the client's
 * company name. Vendors, candidates and the public job board see a stable Client ID instead.
 */
export function clientIdLabel(orgId?: string | null): string {
  const clean = String(orgId || '').replace(/-/g, '').slice(0, 6).toUpperCase();
  return clean ? `CL-${clean}` : 'Client';
}

const NAME_VISIBLE_ROLES = new Set(['admin', 'recruiter', 'client_manager', 'client_member']);

export function canSeeClientName(role?: string | null): boolean {
  return NAME_VISIBLE_ROLES.has(String(role || ''));
}

export function displayClientName(
  org: { id?: string | null; name?: string | null } | null | undefined,
  role?: string | null,
  fallbackOrgId?: string | null
): string {
  if (canSeeClientName(role) && org?.name) return org.name;
  return clientIdLabel(org?.id || fallbackOrgId);
}
