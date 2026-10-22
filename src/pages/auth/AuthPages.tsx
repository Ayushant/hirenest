import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth, getHomeRouteForRole } from '../../auth/AuthProvider';
import { Badge, Button, Input, Select } from '../../components/ui/kit';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../../components/ui/Toast';
import type { AppRole } from '../../types/db';

export const DEMO_PASSWORD = 'Password123!';

export interface DemoAccountPreset {
  label: string;
  roleLabel: string;
  email: string;
  role: AppRole;
  orgName: string;
  signupIntent: 'candidate' | 'vendor' | 'client';
}

export const DEMO_ACCOUNTS: DemoAccountPreset[] = [
  {
    label: 'HQ Admin',
    roleLabel: 'admin',
    email: 'admin@hirenest.test',
    role: 'admin',
    orgName: 'HireNest Workforce HQ',
    signupIntent: 'candidate',
  },
  {
    label: 'HQ Recruiter',
    roleLabel: 'recruiter',
    email: 'recruiter@hirenest.test',
    role: 'recruiter',
    orgName: 'HireNest Workforce HQ',
    signupIntent: 'candidate',
  },
  {
    label: 'Client Manager',
    roleLabel: 'client_manager',
    email: 'client@hirenest.test',
    role: 'client_manager',
    orgName: 'FinCore Technologies',
    signupIntent: 'client',
  },
  {
    label: 'Vendor Admin',
    roleLabel: 'vendor_admin',
    email: 'vendor@hirenest.test',
    role: 'vendor_admin',
    orgName: 'Apex Talent Partners',
    signupIntent: 'vendor',
  },
  {
    label: 'Direct Candidate',
    roleLabel: 'candidate',
    email: 'candidate@hirenest.test',
    role: 'candidate',
    orgName: 'Direct Applicant',
    signupIntent: 'candidate',
  },
];

export const FULL_DEMO_SEED_SQL = `-- Run once in Supabase Dashboard -> SQL Editor to provision all 5 demo roles + sample data
create extension if not exists pgcrypto;

do $$
declare
  v_client_org uuid := '11111111-1111-4111-8111-111111111101';
  v_vendor_org uuid := '22222222-2222-4222-8222-222222222202';
  v_admin_id   uuid;
  v_rec_id     uuid;
  v_client_id  uuid;
  v_vendor_id  uuid;
  v_cand_uid   uuid;
  v_req_id     uuid := '33333333-3333-4333-8333-333333333301';
  v_vcand_id   uuid := '44444444-4444-4444-8444-444444444401';
  v_dcand_id   uuid := '44444444-4444-4444-8444-444444444402';
  v_sub_id     uuid := '55555555-5555-4555-8555-555555555501';
  r record;
begin
  -- 1. Confirm & promote any existing personal account to HQ Admin
  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now())
  where email in ('theayushant@gmail.com', 'kayushant@gmai.com', 'kayushant@gmail.com');

  update public.profiles
  set role = 'admin', status = 'active'
  where email in ('theayushant@gmail.com', 'kayushant@gmai.com', 'kayushant@gmail.com');

  -- 2. Create Demo Client & Vendor Organizations
  insert into public.organizations (id, name, type, status, industry, domain, contact_name, contact_email, sla_tier)
  values
    (v_client_org, 'FinCore Technologies', 'client', 'approved', 'FinTech', 'fincore.test', 'Riya Kapoor', 'client@hirenest.test', 'enterprise'),
    (v_vendor_org, 'Apex Talent Partners', 'vendor', 'approved', 'Staffing & Recruiting', 'apextalent.test', 'Vikram Rao', 'vendor@hirenest.test', 'premium')
  on conflict (id) do update
  set status = 'approved', name = excluded.name;

  -- 3. Upsert the 5 Demo Auth Users (Password: Password123!)
  for r in (
    select * from (values
      ('admin@hirenest.test',     'Aarav Mehta (HQ Admin)',      'admin'::public.app_role,          null::uuid),
      ('recruiter@hirenest.test', 'Neha Sharma (HQ Recruiter)',  'recruiter'::public.app_role,      null::uuid),
      ('client@hirenest.test',    'Riya Kapoor (Client Mgr)',    'client_manager'::public.app_role, v_client_org),
      ('vendor@hirenest.test',    'Vikram Rao (Vendor Admin)',   'vendor_admin'::public.app_role,   v_vendor_org),
      ('candidate@hirenest.test', 'Rohan Verma (Candidate)',     'candidate'::public.app_role,      null::uuid)
    ) as t(email, full_name, app_role, org_id)
  ) loop
    select id into v_admin_id from auth.users where email = r.email limit 1;

    if v_admin_id is null then
      v_admin_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, recovery_token,
        email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_admin_id,
        'authenticated',
        'authenticated',
        r.email,
        extensions.crypt('Password123!', extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', r.full_name, 'signup_intent', 'candidate'),
        now(),
        now(),
        '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        v_admin_id,
        v_admin_id::text,
        jsonb_build_object('sub', v_admin_id::text, 'email', r.email, 'email_verified', true),
        'email',
        now(),
        now(),
        now()
      );
    else
      update auth.users
      set encrypted_password = extensions.crypt('Password123!', extensions.gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          confirmation_token = coalesce(confirmation_token, ''),
          recovery_token = coalesce(recovery_token, ''),
          email_change_token_new = coalesce(email_change_token_new, ''),
          email_change = coalesce(email_change, '')
      where id = v_admin_id;
    end if;

    insert into public.profiles (id, email, full_name, role, status, org_id)
    values (v_admin_id, r.email, r.full_name, r.app_role, 'active', r.org_id)
    on conflict (id) do update
    set role = excluded.role,
        status = 'active',
        org_id = excluded.org_id,
        full_name = excluded.full_name;
  end loop;

  select id into v_admin_id  from public.profiles where email = 'admin@hirenest.test' limit 1;
  select id into v_rec_id    from public.profiles where email = 'recruiter@hirenest.test' limit 1;
  select id into v_client_id from public.profiles where email = 'client@hirenest.test' limit 1;
  select id into v_vendor_id from public.profiles where email = 'vendor@hirenest.test' limit 1;
  select id into v_cand_uid  from public.profiles where email = 'candidate@hirenest.test' limit 1;

  -- 4. Approve Platform Rating Weights
  update public.platform_settings
  set timing_weight = 30,
      quality_weight = 50,
      compliance_weight = 20,
      weights_approved = true,
      weights_approved_by = v_admin_id,
      share_vendor_summary_with_clients = true
  where id = 1;

  -- 5. Seed an Open Public Requirement + Vendor Share
  insert into public.requirements (
    id, client_org_id, title, description, skills,
    min_experience, max_experience, location, work_mode, employment_type,
    openings, vendor_visible_budget, currency, status, is_public,
    submission_sla_hours, created_by, opened_at
  ) values (
    v_req_id,
    v_client_org,
    'Senior Distributed Systems Engineer',
    'Architect and scale low-latency payment ledger services using TypeScript, Node.js, PostgreSQL, and Kubernetes.',
    array['TypeScript', 'PostgreSQL', 'Node.js', 'Kubernetes'],
    4, 8, 'Bengaluru', 'hybrid', 'full_time',
    2, 3200000, 'INR', 'open', true,
    48, v_admin_id, now()
  ) on conflict (id) do update
  set status = 'open', is_public = true;

  insert into public.requirement_vendor_shares (
    requirement_id, vendor_org_id, shared_by, shared_at, due_at
  ) values (
    v_req_id, v_vendor_org, v_admin_id, now(), now() + interval '48 hours'
  ) on conflict (requirement_id, vendor_org_id) do nothing;

  -- 6. Seed Vendor Candidate + Direct Candidate
  insert into public.candidates (
    id, user_id, full_name, current_title, location, total_experience_years,
    skills, summary, original_source, source_vendor_org_id, owner_vendor_org_id, created_by
  ) values
    (
      v_vcand_id, null, 'Siddharth Nair', 'Staff Backend Engineer', 'Bengaluru', 6,
      array['TypeScript', 'PostgreSQL', 'Node.js', 'Kubernetes', 'Redis'],
      '6 years building distributed payment APIs and high-throughput PostgreSQL clusters.',
      'vendor', v_vendor_org, v_vendor_org, v_vendor_id
    ),
    (
      v_dcand_id, v_cand_uid, 'Rohan Verma', 'Senior Full-Stack Engineer', 'Mumbai', 5,
      array['TypeScript', 'PostgreSQL', 'Node.js', 'React'],
      'Direct applicant specializing in TypeScript, Node.js, and PostgreSQL microservices.',
      'direct', null, null, v_cand_uid
    )
  on conflict (id) do update
  set user_id = excluded.user_id, skills = excluded.skills;

  insert into public.candidate_contacts (candidate_id, email, phone, linkedin_url)
  values
    (v_vcand_id, 'siddharth.nair@talent.test', '+919876543210', 'https://linkedin.com/in/siddharth-nair'),
    (v_dcand_id, 'candidate@hirenest.test', '+919876543211', 'https://linkedin.com/in/rohan-verma')
  on conflict (candidate_id) do nothing;

  -- 7. Seed a Pipeline Submission in client_review
  insert into public.submissions (
    id, requirement_id, candidate_id, source, vendor_org_id,
    submitted_by, stage, stage_changed_at, shared_with_client_at, notes
  ) values (
    v_sub_id, v_req_id, v_vcand_id, 'vendor', v_vendor_org,
    v_vendor_id, 'client_review', now(), now(),
    'Strong distributed systems background; verified production Kubernetes + PostgreSQL ownership.'
  ) on conflict (id) do nothing;

  perform public.recompute_matches(v_req_id);
end $$;`;

// Shared Two-Column Split Layout for Auth Pages:
// Left 42% in deep storm-slate #1E2A36 with a subtle sky radial wash at the top, wordmark, and a concise 3-line product statement in #D6E1EC;
// Right 58% on Storm 50 with a white form card (10px radius, 1px border).
const AuthSplitLayout: React.FC<{
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ children, maxWidthClass = 'max-w-[420px]' }) => (
  <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--app-bg)] text-[var(--text-primary)]">
    {/* Left 42% Storm-Slate Panel */}
    <div
      style={{
        backgroundImage:
          'radial-gradient(ellipse at top, rgba(136, 189, 242, 0.16), transparent 65%)',
      }}
      className="lg:w-[42%] bg-[#1E2A36] text-[#D6E1EC] p-8 sm:p-12 flex flex-col justify-between shrink-0"
    >
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-6 rounded-[6px] bg-[#1F4CC4] flex items-center justify-center shrink-0">
          <span className="h-2 w-2 rounded-full bg-[#88BDF2]" />
        </span>
        <span className="text-[14px] leading-[18px] font-semibold text-white">
          HireNest
        </span>
      </div>

      <div className="my-10 lg:my-0 max-w-md space-y-3">
        <div className="h-[3px] w-4 rounded-full bg-[#88BDF2]" />
        <p className="text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-white">
          Governed enterprise staffing for HQ, hiring companies, vendor agencies, and candidates.
        </p>
        <p className="text-[13px] leading-[20px] text-[#D6E1EC]">
          One source of truth for requirements, vendor SLAs, candidate ownership, structured interviews, and 6-dimension quality scoring.
        </p>
      </div>

      <div className="text-[12px] leading-[16px] text-[#8FA6BC] font-mono tabular-nums">
        HireNest Workforce Operations
      </div>
    </div>

    {/* Right 58% Storm 50 Canvas with White Form Card */}
    <div className="flex-1 lg:w-[58%] flex items-center justify-center p-6 sm:p-10 bg-[var(--app-bg)]">
      <div
        className={`w-full ${maxWidthClass} rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-7 space-y-5 text-left`}
      >
        {children}
      </div>
    </div>
  </div>
);

// 1. Setup Screen when VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing
export const SetupGuideScreen: React.FC = () => (
  <AuthSplitLayout maxWidthClass="max-w-[560px]">
    <div className="space-y-1">
      <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
        Connect your Supabase project
      </h1>
      <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
        Configure environment variables to enable authentication, row-level security, and the 25 database RPCs.
      </p>
    </div>

    <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)] text-[13px] leading-[20px]">
      <li className="py-3 flex gap-3">
        <span className="font-mono tabular-nums text-[var(--text-tertiary)]">1</span>
        <span className="text-[var(--text-primary)]">
          Open your Supabase project settings and copy your project URL and publishable anon key.
        </span>
      </li>
      <li className="py-3 flex gap-3">
        <span className="font-mono tabular-nums text-[var(--text-tertiary)]">2</span>
        <span className="text-[var(--text-primary)]">
          Add the required variables below to your environment configuration (never use a service-role key in client variables).
        </span>
      </li>
      <li className="py-3 flex gap-3">
        <span className="font-mono tabular-nums text-[var(--text-tertiary)]">3</span>
        <span className="text-[var(--text-primary)]">
          Reload the application to sign in and activate your first HQ admin account.
        </span>
      </li>
    </ol>

    <pre className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] p-4 font-mono text-[12px] leading-[18px] overflow-x-auto">
{`VITE_SUPABASE_URL="https://<your-project-ref>.supabase.co"
VITE_SUPABASE_ANON_KEY="<your-publishable-anon-key>"
GEMINI_API_KEY="<optional-server-only-gemini-key>"`}
    </pre>
  </AuthSplitLayout>
);

// 2. Sign In Page (with 1-click Demo Role Switcher & SQL Seeder)
const signInSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type SignInValues = z.infer<typeof signInSchema>;

export const SignInPage: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [demoLoadingRole, setDemoLoadingRole] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showDemoSql, setShowDemoSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema) as never,
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const completeSignInRedirect = async (userId: string) => {
    const { data: prof } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', userId)
      .maybeSingle();

    const returnTo = searchParams.get('returnTo');
    if (returnTo && returnTo.startsWith('/') && returnTo !== '/signin') {
      navigate(returnTo, { replace: true });
    } else {
      navigate(getHomeRouteForRole(prof?.role, prof?.status), { replace: true });
    }
  };

  const onSubmit = async (values: SignInValues) => {
    setLoading(true);
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });
      if (error) throw error;

      if (data.user) {
        await completeSignInRedirect(data.user.id);
      }
    } catch (err) {
      const msg = mapSupabaseError(err);
      setAuthError(msg);
      if (
        msg.toLowerCase().includes('confirm') ||
        msg.toLowerCase().includes('invalid login')
      ) {
        setShowDemoSql(true);
      }
      toast({ title: 'Sign in failed', description: msg, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDemoRoleLogin = async (preset: DemoAccountPreset) => {
    setValue('email', preset.email, { shouldValidate: true });
    setValue('password', DEMO_PASSWORD, { shouldValidate: true });
    setDemoLoadingRole(preset.role);
    setAuthError(null);

    try {
      // 1. Try signing in directly with the demo account
      const { data, error } = await supabase.auth.signInWithPassword({
        email: preset.email,
        password: DEMO_PASSWORD,
      });

      if (!error && data.user) {
        toast({
          title: `Signed in as ${preset.label}`,
          description: preset.email,
          tone: 'success',
        });
        await completeSignInRedirect(data.user.id);
        return;
      }

      // 2. If not yet seeded, try creating via signUp (works if Confirm Email is disabled)
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: preset.email,
        password: DEMO_PASSWORD,
        options: {
          data: {
            full_name: preset.label,
            signup_intent: preset.signupIntent,
            company_name:
              preset.signupIntent === 'candidate' ? null : preset.orgName,
          },
        },
      });

      if (!signUpErr && signUpData.session && signUpData.user) {
        toast({
          title: `Created & signed in as ${preset.label}`,
          description:
            preset.role === 'candidate'
              ? 'Direct candidate workspace ready.'
              : 'Run the 1-Click Demo Seed SQL to activate elevated roles & orgs.',
          tone: 'info',
        });
        await completeSignInRedirect(signUpData.user.id);
        return;
      }

      // 3. Otherwise show the 1-Click SQL Seed box so all 5 roles are provisioned without email rate limits
      setShowDemoSql(true);
      setAuthError(
        `Demo accounts are not yet seeded in your Supabase project. Copy & run the 1-Click Demo Seed SQL below in Supabase SQL Editor, then click "${preset.label}" again.`
      );
    } catch (err) {
      setShowDemoSql(true);
      setAuthError(mapSupabaseError(err));
    } finally {
      setDemoLoadingRole(null);
    }
  };

  const handleCopyDemoSql = async () => {
    try {
      await navigator.clipboard.writeText(FULL_DEMO_SEED_SQL);
      setCopiedSql(true);
      toast({
        title: 'Demo Seed SQL copied',
        description: 'Paste into Supabase Dashboard → SQL Editor and click Run.',
        tone: 'success',
      });
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      toast({
        title: 'Select and copy the SQL block below',
        tone: 'info',
      });
    }
  };

  return (
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Sign in
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Enter your credentials or select a demo role below to test workspaces.
        </p>
      </div>

      {/* Demo Role Quick-Login Strip */}
      <div className="rounded-[10px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] leading-[16px] font-medium text-[var(--text-primary)]">
            Instant demo login (all 5 roles)
          </span>
          <button
            type="button"
            onClick={() => setShowDemoSql((v) => !v)}
            className="text-[12px] leading-[16px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
          >
            {showDemoSql ? 'Hide seed SQL' : '1-click seed SQL'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {DEMO_ACCOUNTS.map((preset) => (
            <Button
              key={preset.role}
              type="button"
              size="sm"
              variant="secondary"
              loading={demoLoadingRole === preset.role}
              disabled={Boolean(demoLoadingRole) || loading}
              onClick={() => handleDemoRoleLogin(preset)}
              className="justify-start text-left"
            >
              <span className="truncate">{preset.label}</span>
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between text-[11px] leading-[16px] text-[var(--text-secondary)] font-mono tabular-nums">
          <span>Password: {DEMO_PASSWORD}</span>
          <span>*@hirenest.test</span>
        </div>
      </div>

      {showDemoSql && (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-2.5 text-[12px] leading-[16px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--text-primary)]">
              Seed all 5 roles + sample data (Supabase SQL Editor)
            </span>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={handleCopyDemoSql}
            >
              {copiedSql ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy SQL
                </>
              )}
            </Button>
          </div>
          <p className="text-[var(--text-secondary)]">
            Bypasses Supabase SMTP email limits and creates <span className="font-mono">admin</span>, <span className="font-mono">recruiter</span>, <span className="font-mono">client</span>, <span className="font-mono">vendor</span>, and <span className="font-mono">candidate</span> `@hirenest.test` accounts + sample orgs & requirement.
          </p>
          <pre className="max-h-40 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] p-2.5 font-mono text-[11px] overflow-auto select-all">
            {FULL_DEMO_SEED_SQL}
          </pre>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          {...register('email')}
          error={errors.email?.message}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          {...register('password')}
          error={errors.password?.message}
        />

        {authError && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--status-danger-bg)] p-3 text-[12px] leading-[16px] text-[var(--status-danger)] space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-danger-dot)] shrink-0" />
              <span>{authError}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-[12px] leading-[16px]">
          <Badge tone="neutral">Real Supabase Auth</Badge>
          <Link
            to="/forgot-password"
            className="text-[var(--accent)] hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>

      <div className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
        No account?{' '}
        <Link
          to="/signup"
          className="font-medium text-[var(--accent)] hover:underline"
        >
          Create an account
        </Link>
      </div>
    </AuthSplitLayout>
  );
};

// 3. Sign Up Page
const signUpSchema = z
  .object({
    full_name: z.string().min(2, 'Full name is required'),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    signup_intent: z.enum(['candidate', 'vendor', 'client']),
    company_name: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.signup_intent === 'vendor' || data.signup_intent === 'client') {
        return Boolean(data.company_name && data.company_name.trim().length >= 2);
      }
      return true;
    },
    {
      message: 'Company name is required for vendor agencies and hiring companies',
      path: ['company_name'],
    }
  );

type SignUpValues = z.infer<typeof signUpSchema>;

export const SignUpPage: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [awaitingEmailConfirm, setAwaitingEmailConfirm] = useState<{
    email: string;
    password: string;
    intent: 'candidate' | 'vendor' | 'client';
  } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema) as never,
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
      signup_intent: 'candidate',
      company_name: '',
    },
  });

  const intent = watch('signup_intent');
  const currentEmail = watch('email') || 'your-email@example.com';

  const onSubmit = async (values: SignUpValues) => {
    setLoading(true);
    setSignUpError(null);
    try {
      const cleanEmail = values.email.trim();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: values.password,
        options: {
          data: {
            full_name: values.full_name.trim(),
            signup_intent: values.signup_intent,
            company_name:
              values.signup_intent === 'candidate'
                ? null
                : values.company_name?.trim() || null,
          },
        },
      });

      if (error) throw error;

      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setSignUpError(
          'An account with this email already exists. Sign in or confirm your email in Supabase.'
        );
        setAwaitingEmailConfirm({
          email: cleanEmail,
          password: values.password,
          intent: values.signup_intent,
        });
        return;
      }

      if (data.user && !data.session) {
        setAwaitingEmailConfirm({
          email: cleanEmail,
          password: values.password,
          intent: values.signup_intent,
        });
        toast({
          title: 'Account created — confirmation needed',
          tone: 'info',
        });
        return;
      }

      toast({
        title: 'Account registered',
        tone: 'success',
      });

      navigate(values.signup_intent === 'candidate' ? '/candidate' : '/pending', {
        replace: true,
      });
    } catch (err) {
      const msg = mapSupabaseError(err);
      setSignUpError(msg);
      toast({
        title: 'Registration failed',
        description: msg,
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignInAfterConfirm = async () => {
    if (!awaitingEmailConfirm) return;
    setLoading(true);
    setSignUpError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: awaitingEmailConfirm.email,
        password: awaitingEmailConfirm.password,
      });
      if (error) throw error;
      if (data.user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('role, status')
          .eq('id', data.user.id)
          .maybeSingle();
        navigate(getHomeRouteForRole(prof?.role, prof?.status), { replace: true });
      }
    } catch (err) {
      setSignUpError(mapSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Create account
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Role assignment is governed automatically by the database.
        </p>
      </div>

      {awaitingEmailConfirm ? (
        <div className="space-y-4">
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--status-success-bg)] p-3 text-[12px] leading-[16px] space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium text-[var(--status-success)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success-dot)] shrink-0" />
              <span>
                Registered <span className="font-mono">{awaitingEmailConfirm.email}</span>
              </span>
            </div>
            <p className="text-[var(--text-secondary)]">
              Confirm your email via the link sent to your inbox, or run the SQL below in your Supabase SQL Editor:
            </p>
          </div>

          <pre className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] p-2.5 font-mono text-[11px] overflow-x-auto select-all">
{`update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = '${awaitingEmailConfirm.email}';

update public.profiles
set role = 'admin', status = 'active'
where email = '${awaitingEmailConfirm.email}';`}
          </pre>

          {signUpError && (
            <div className="text-[12px] leading-[16px] text-[var(--status-danger)]">
              {signUpError}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="w-full"
              loading={loading}
              onClick={handleSignInAfterConfirm}
            >
              Sign in now
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setAwaitingEmailConfirm(null)}
            >
              Back to form
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Full name"
            placeholder="Aarav Mehta"
            {...register('full_name')}
            error={errors.full_name?.message}
          />
          <Input
            label="Email"
            type="email"
            placeholder="name@company.com"
            {...register('email')}
            error={errors.email?.message}
          />
          <Input
            label="Password"
            type="password"
            placeholder="Minimum 8 characters"
            {...register('password')}
            error={errors.password?.message}
          />

          <Select
            label="Account type"
            {...register('signup_intent')}
            error={errors.signup_intent?.message}
            options={[
              { value: 'candidate', label: 'Candidate (Direct applicant)' },
              { value: 'vendor', label: 'Vendor agency' },
              { value: 'client', label: 'Hiring company' },
            ]}
          />

          {(intent === 'vendor' || intent === 'client') && (
            <Input
              label="Company name"
              placeholder={
                intent === 'vendor'
                  ? 'e.g. Apex Talent Partners'
                  : 'e.g. FinCore Technologies'
              }
              {...register('company_name')}
              error={errors.company_name?.message}
            />
          )}

          {signUpError && (
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--status-danger-bg)] p-3 text-[12px] leading-[16px] space-y-2">
              <p className="font-medium text-[var(--status-danger)]">{signUpError}</p>
              {signUpError.toLowerCase().includes('rate limit') && (
                <div className="space-y-2 text-[var(--text-secondary)]">
                  <p>
                    Supabase free-tier SMTP limits confirmation emails to ~2/hour. Go back to Sign in and click "1-click seed SQL" to provision all 5 roles directly in SQL Editor, or run:
                  </p>
                  <pre className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] p-2 font-mono text-[11px] overflow-x-auto select-all">
{`update public.profiles
set role = 'admin', status = 'active'
where email = '${currentEmail.trim()}';`}
                  </pre>
                </div>
              )}
            </div>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            Create account
          </Button>
        </form>
      )}

      <div className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
        Already registered?{' '}
        <Link
          to="/signin"
          className="font-medium text-[var(--accent)] hover:underline"
        >
          Sign in
        </Link>
      </div>
    </AuthSplitLayout>
  );
};

// 4. Forgot Password Page
export const ForgotPasswordPage: React.FC = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast({
        title: 'Password reset email sent',
        tone: 'success',
      });
    } catch (err) {
      toast({
        title: 'Could not send reset email',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Reset password
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          We will send a recovery link to your registered email.
        </p>
      </div>

      {sent ? (
        <div className="rounded-[6px] border border-[var(--border)] bg-[var(--status-success-bg)] p-3 text-[13px] leading-[20px] text-[var(--status-success)]">
          Recovery instructions sent to <span className="font-mono">{email}</span>.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
          <Button type="submit" className="w-full" loading={loading}>
            Send recovery link
          </Button>
        </form>
      )}

      <div className="text-[13px] leading-[20px]">
        <Link
          to="/signin"
          className="text-[var(--accent)] hover:underline"
        >
          ← Back to sign in
        </Link>
      </div>
    </AuthSplitLayout>
  );
};

// 5. Update Password Page
export const UpdatePasswordPage: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({
        title: 'Password must be at least 8 characters',
        tone: 'error',
      });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({
        title: 'Password updated',
        tone: 'success',
      });
      navigate('/signin', { replace: true });
    } catch (err) {
      toast({
        title: 'Could not update password',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Set new password
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Enter a new password for your account.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="New password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimum 8 characters"
        />
        <Button type="submit" className="w-full" loading={loading}>
          Update password
        </Button>
      </form>
    </AuthSplitLayout>
  );
};

// 6. Pending Approval Page
export const PendingApprovalPage: React.FC = () => {
  const { profile, signOut, refreshProfile, homeRoute } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  React.useEffect(() => {
    if (profile && profile.role !== 'pending' && profile.status === 'active') {
      navigate(homeRoute, { replace: true });
    }
  }, [profile, homeRoute, navigate]);

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      await refreshProfile();
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Account pending verification
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          HireNest will verify your company and activate your access.
        </p>
      </div>

      {profile && (
        <div className="border-y border-[var(--border)] py-3 space-y-1.5 text-[13px] leading-[20px]">
          <div className="flex justify-between">
            <span className="text-[var(--text-secondary)]">Name</span>
            <span className="font-medium text-[var(--text-primary)]">{profile.full_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-secondary)]">Email</span>
            <span className="font-mono text-[12px] text-[var(--text-primary)]">
              {profile.email}
            </span>
          </div>
          {profile.requested_company && (
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Company</span>
              <span className="text-[var(--text-primary)]">{profile.requested_company}</span>
            </div>
          )}
          {profile.requested_role && (
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Intent</span>
              <span className="capitalize text-[var(--text-primary)]">
                {profile.requested_role}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-1.5 text-[12px] leading-[16px]">
        <p className="font-medium text-[var(--text-primary)]">
          Activate as HQ Admin in Supabase SQL Editor:
        </p>
        <pre className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] p-2 font-mono text-[11px] overflow-x-auto select-all">
{`update public.profiles
set role = 'admin', status = 'active'
where email = '${profile?.email || 'your-email@example.com'}';`}
        </pre>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="md" loading={checking} onClick={handleCheckStatus}>
          Check status
        </Button>
        <Button variant="ghost" size="md" onClick={() => signOut()}>
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </AuthSplitLayout>
  );
};

// 7. Access Suspended Page
export const SuspendedAccessPage: React.FC = () => {
  const { profile, organization, signOut } = useAuth();
  return (
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Access suspended
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          {organization && organization.status !== 'approved'
            ? `Your organization (${organization.name}) is currently marked "${organization.status}".`
            : 'Your user profile has been suspended by HireNest HQ.'}{' '}
          Contact HireNest Workforce Operations for assistance.
        </p>
      </div>
      {profile && (
        <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)] font-mono">
          {profile.email}
        </div>
      )}
      <div>
        <Button variant="outline" size="md" onClick={() => signOut()}>
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </AuthSplitLayout>
  );
};
