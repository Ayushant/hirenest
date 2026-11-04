/**
 * Seed demo users for all HireNestOS roles.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-users.ts
 *
 * Requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 *
 * Creates these demo accounts (all with password: Demo@1234):
 *   - admin@hirenest.demo      → admin
 *   - recruiter@hirenest.demo  → recruiter
 *   - vendor@hirenest.demo     → vendor_admin
 *   - vendorrec@hirenest.demo  → vendor_recruiter
 *   - client@hirenest.demo     → client_manager
 *   - clientmem@hirenest.demo  → client_member
 *   - candidate@hirenest.demo  → candidate
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEMO_PASSWORD = 'Demo@1234';

interface DemoUser {
  email: string;
  name: string;
  role: string;
  orgType: 'internal' | 'vendor' | 'client' | null;
  orgName: string | null;
}

const DEMO_USERS: DemoUser[] = [
  { email: 'admin@hirenest.demo', name: 'Demo Admin', role: 'admin', orgType: 'internal', orgName: null },
  { email: 'recruiter@hirenest.demo', name: 'Demo Recruiter', role: 'recruiter', orgType: 'internal', orgName: null },
  { email: 'vendor@hirenest.demo', name: 'Demo Vendor Admin', role: 'vendor_admin', orgType: 'vendor', orgName: 'Demo Staffing Agency' },
  { email: 'vendorrec@hirenest.demo', name: 'Demo Vendor Recruiter', role: 'vendor_recruiter', orgType: 'vendor', orgName: 'Demo Staffing Agency' },
  { email: 'client@hirenest.demo', name: 'Demo Client Manager', role: 'client_manager', orgType: 'client', orgName: 'Demo Corp Ltd' },
  { email: 'clientmem@hirenest.demo', name: 'Demo Client Member', role: 'client_member', orgType: 'client', orgName: 'Demo Corp Ltd' },
  { email: 'candidate@hirenest.demo', name: 'Demo Candidate', role: 'candidate', orgType: null, orgName: null },
];

async function ensureOrg(type: 'internal' | 'vendor' | 'client', name: string): Promise<string> {
  const { data: existing } = await admin
    .from('organizations')
    .select('id')
    .eq('type', type)
    .eq('name', name)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from('organizations')
    .insert({ name, type, status: 'approved' })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create org "${name}": ${error.message}`);
  return created.id;
}

async function seedUser(user: DemoUser) {
  // Check if profile already exists
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, role, status')
    .eq('email', user.email)
    .maybeSingle();

  if (existingProfile?.role === user.role && existingProfile?.status === 'active') {
    console.log(`  ✓ ${user.email} already exists as ${user.role}`);
    return;
  }

  // Resolve org
  let orgId: string | null = null;
  if (user.orgType === 'internal') {
    const { data: internalOrg } = await admin
      .from('organizations')
      .select('id')
      .eq('type', 'internal')
      .maybeSingle();
    orgId = internalOrg?.id || null;
  } else if (user.orgType && user.orgName) {
    orgId = await ensureOrg(user.orgType, user.orgName);
  }

  // Create or find auth user
  const { data: userList } = await admin.auth.admin.listUsers();
  let authUser = userList?.users?.find((u) => u.email === user.email);

  if (!authUser) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: user.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: user.name, signup_intent: user.role },
    });
    if (createErr) throw new Error(`Failed to create auth user ${user.email}: ${createErr.message}`);
    authUser = created.user;
    // Wait for trigger to create profile
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Promote profile
  const { error: updateErr } = await admin
    .from('profiles')
    .update({
      role: user.role,
      status: 'active',
      org_id: orgId,
      full_name: user.name,
    })
    .eq('email', user.email);

  if (updateErr) throw new Error(`Failed to update profile ${user.email}: ${updateErr.message}`);
  console.log(`  ✓ ${user.email} → ${user.role} (org: ${user.orgName || 'internal'})`);
}

async function main() {
  console.log('Seeding demo users...\n');
  console.log(`  Password for all: ${DEMO_PASSWORD}\n`);

  for (const user of DEMO_USERS) {
    try {
      await seedUser(user);
    } catch (err) {
      console.error(`  ✗ ${user.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\n--- Demo Logins ---');
  console.log('');
  console.log('  Role               Email                        Password');
  console.log('  ─────────────────  ───────────────────────────  ──────────');
  for (const u of DEMO_USERS) {
    const r = u.role.padEnd(18);
    const e = u.email.padEnd(28);
    console.log(`  ${r} ${e} ${DEMO_PASSWORD}`);
  }
  console.log('');
}

main().catch(console.error);
