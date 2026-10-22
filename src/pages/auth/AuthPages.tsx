import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert, Clock, Database, Lock, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth, getHomeRouteForRole } from '../../auth/AuthProvider';
import { Button, Input, Select, Card } from '../../components/ui/kit';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../../components/ui/Toast';

// 1. Setup Screen when VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing
// Guardrail 2: No AI features on the setup screen or before login.
export const SetupGuideScreen: React.FC = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
    <Card className="max-w-2xl w-full p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-lg">
          H
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            HireNestOS — Environment Configuration Required
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Connect your Supabase project to activate the staffing operating system.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
        <Database className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Missing Supabase Publishable Credentials</p>
          <p>
            HireNestOS uses Supabase as its single source of truth for authentication, RLS
            governance, deterministic matching, and the 25 pipeline RPCs. No mock or fabricated
            data is rendered when disconnected.
          </p>
        </div>
      </div>

      <div className="space-y-3 text-xs">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">
          Required Environment Variables
        </h2>
        <pre className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100 p-4 font-mono text-xs overflow-x-auto">
{`VITE_SUPABASE_URL="https://<your-project-ref>.supabase.co"
VITE_SUPABASE_ANON_KEY="<your-publishable-anon-key>"

# Optional server-only Gemini key (never prefix with VITE_):
GEMINI_API_KEY="<your-gemini-api-key>"`}
        </pre>
        <p className="text-slate-500 dark:text-slate-400">
          Security rule: Only use the anon/publishable key in <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>. Never configure a service-role key. Once set in the Secrets / Environment panel, reload this page.
        </p>
      </div>
    </Card>
  </div>
);

// 2. Sign In Page
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [showBootstrapHelp, setShowBootstrapHelp] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema) as never,
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const typedEmail = watch('email') || 'your-email@example.com';

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
        const { data: prof } = await supabase
          .from('profiles')
          .select('role, status')
          .eq('id', data.user.id)
          .maybeSingle();

        const returnTo = searchParams.get('returnTo');
        if (returnTo && returnTo.startsWith('/') && returnTo !== '/signin') {
          navigate(returnTo, { replace: true });
        } else {
          navigate(getHomeRouteForRole(prof?.role, prof?.status), { replace: true });
        }
      }
    } catch (err) {
      const msg = mapSupabaseError(err);
      setAuthError(msg);
      if (
        msg.toLowerCase().includes('confirm') ||
        msg.toLowerCase().includes('invalid login')
      ) {
        setShowBootstrapHelp(true);
      }
      toast({ title: 'Sign in failed', description: msg, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-7 space-y-6">
        <div>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded bg-indigo-600 text-white font-bold text-sm mb-3">
            H
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Sign in to HireNestOS
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Governed enterprise staffing portal for HQ, Clients, Vendors, and Candidates.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Work or Personal Email"
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
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300 space-y-1.5">
              <p className="font-semibold">{authError}</p>
              {authError.toLowerCase().includes('confirm') && (
                <p>
                  Your Supabase project has <strong>Confirm email</strong> enabled. Check your
                  inbox for the verification link, or run the SQL snippet below in your
                  Supabase SQL Editor to confirm and activate immediately.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowBootstrapHelp((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
            >
              {showBootstrapHelp ? 'Hide Admin SQL setup' : 'First-time Admin SQL setup'}
            </button>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          {showBootstrapHelp && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900 p-3 space-y-2 text-xs">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Confirm Email & Activate as HQ Admin (Supabase SQL Editor):
              </p>
              <pre className="rounded bg-slate-950 text-slate-100 p-2.5 font-mono text-[11px] overflow-x-auto select-all">
{`-- 1. Confirm email in Supabase Auth
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = '${typedEmail.trim()}';

-- 2. Activate as HQ Admin in public.profiles
update public.profiles
set role = 'admin', status = 'active'
where email = '${typedEmail.trim()}';`}
              </pre>
            </div>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            Sign In
          </Button>
        </form>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
          Don&apos;t have an account?{' '}
          <Link
            to="/signup"
            className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Create an account
          </Link>
        </div>
      </Card>
    </div>
  );
};

// 3. Sign Up Page (Section 4.2: options.data = { full_name, signup_intent: 'candidate'|'vendor'|'client', company_name })
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

      // Supabase returns empty identities array when email is already registered
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setSignUpError(
          'An account with this email already exists. Please Sign In or confirm your email in Supabase.'
        );
        setAwaitingEmailConfirm({
          email: cleanEmail,
          password: values.password,
          intent: values.signup_intent,
        });
        return;
      }

      // If Supabase has "Confirm email" enabled (mailer_autoconfirm: false), data.session is null
      if (data.user && !data.session) {
        setAwaitingEmailConfirm({
          email: cleanEmail,
          password: values.password,
          intent: values.signup_intent,
        });
        toast({
          title: 'Account created — confirmation needed',
          description: 'Confirm your email or run the SQL snippet shown to sign in right away.',
          tone: 'info',
        });
        return;
      }

      toast({
        title: 'Account registered',
        description:
          values.signup_intent === 'candidate'
            ? 'Welcome to HireNestOS.'
            : 'HireNest will verify your company and activate your access.',
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-7 space-y-6">
        <div>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded bg-indigo-600 text-white font-bold text-sm mb-3">
            H
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Register for HireNestOS
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Role assignment is governed automatically by the database.
          </p>
        </div>

        {awaitingEmailConfirm ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 text-xs text-emerald-900 dark:text-emerald-200 space-y-1.5">
              <p className="font-semibold">
                Account registered for <span className="font-mono">{awaitingEmailConfirm.email}</span>
              </p>
              <p>
                Your Supabase project requires email confirmation before issuing a session.
                Either click the link sent to your email, <strong>or</strong> run the SQL below
                in your <strong>Supabase Dashboard → SQL Editor</strong> to confirm and activate
                immediately:
              </p>
            </div>

            <pre className="rounded-lg bg-slate-950 text-slate-100 p-3 font-mono text-[11px] overflow-x-auto select-all">
{`-- Run in Supabase SQL Editor to confirm email & make HQ Admin:
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = '${awaitingEmailConfirm.email}';

update public.profiles
set role = 'admin', status = 'active'
where email = '${awaitingEmailConfirm.email}';`}
            </pre>

            {signUpError && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300">
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
                I&apos;ve Confirmed / Ran SQL — Sign In Now
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setAwaitingEmailConfirm(null)}
              >
                Back to Registration Form
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Full Name"
              placeholder="Aarav Mehta"
              {...register('full_name')}
              error={errors.full_name?.message}
            />
            <Input
              label="Email Address"
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
              label="I am a…"
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
                label="Company Name"
                placeholder={
                  intent === 'vendor'
                    ? 'e.g. Apex Talent Partners'
                    : 'e.g. FinCore Technologies Pvt Ltd'
                }
                {...register('company_name')}
                error={errors.company_name?.message}
              />
            )}

            {signUpError && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300 space-y-2">
                <p className="font-semibold">{signUpError}</p>
                {signUpError.toLowerCase().includes('rate limit') && (
                  <div className="space-y-2 text-slate-700 dark:text-slate-300">
                    <p>
                      Supabase blocked the signup because its free-tier SMTP only sends ~2
                      confirmation emails per hour. Fix it in 10 seconds using either method:
                    </p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        <strong>Turn off Confirm Email (Recommended):</strong> In{' '}
                        <strong>Supabase Dashboard → Authentication → Providers → Email</strong>,
                        toggle <strong>Confirm email</strong> OFF and click <strong>Save</strong>.
                        Then click <strong>Create Account</strong> again.
                      </li>
                      <li>
                        <strong>Or create user in Supabase Dashboard:</strong> Go to{' '}
                        <strong>Authentication → Users → Add user → Create new user</strong>{' '}
                        (keep <em>Auto Confirm User</em> checked), then run in SQL Editor:
                      </li>
                    </ol>
                    <pre className="rounded bg-slate-950 text-slate-100 p-2 font-mono text-[11px] overflow-x-auto select-all">
{`update public.profiles
set role = 'admin', status = 'active'
where email = '${currentEmail.trim()}';`}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              Create Account
            </Button>
          </form>
        )}

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
          Already registered?{' '}
          <Link
            to="/signin"
            className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </Card>
    </div>
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
        description: 'Check your inbox for the reset link.',
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-7 space-y-5">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            Reset Your Password
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            We will send a password recovery link to your registered email.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 text-xs text-emerald-800 dark:text-emerald-200">
            Password recovery instructions have been sent to <strong>{email}</strong>.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email Address"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
            <Button type="submit" className="w-full" loading={loading}>
              Send Recovery Link
            </Button>
          </form>
        )}

        <div className="text-center text-xs">
          <Link
            to="/signin"
            className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Back to Sign In
          </Link>
        </div>
      </Card>
    </div>
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
        title: 'Password too short',
        description: 'Password must be at least 8 characters.',
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
        description: 'Your password has been updated.',
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-7 space-y-5">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            Set New Password
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Enter a new password for your HireNestOS account.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New Password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
          />
          <Button type="submit" className="w-full" loading={loading}>
            Update Password
          </Button>
        </form>
      </Card>
    </div>
  );
};

// 6. Pending Approval Page (Section 4.2)
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <Card className="max-w-lg w-full p-8 text-center space-y-5">
        <div className="mx-auto h-12 w-12 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center">
          <Clock className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            Account Pending Verification
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            HireNest will verify your company and activate your access.
          </p>
        </div>
        {profile && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-left text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Name:</span>
              <span className="font-medium">{profile.full_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Email:</span>
              <span className="font-mono">{profile.email}</span>
            </div>
            {profile.requested_company && (
              <div className="flex justify-between">
                <span className="text-slate-500">Requested Company:</span>
                <span className="font-medium">{profile.requested_company}</span>
              </div>
            )}
            {profile.requested_role && (
              <div className="flex justify-between">
                <span className="text-slate-500">Requested Intent:</span>
                <span className="font-medium capitalize">{profile.requested_role}</span>
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900 p-3 text-left space-y-1.5 text-xs">
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            Setting up your first HQ Admin? Run in Supabase SQL Editor:
          </p>
          <pre className="rounded bg-slate-950 text-slate-100 p-2.5 font-mono text-[11px] overflow-x-auto select-all">
{`update public.profiles
set role = 'admin', status = 'active'
where email = '${profile?.email || 'your-email@example.com'}';`}
          </pre>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="primary" size="sm" loading={checking} onClick={handleCheckStatus}>
            Check Status Again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </Card>
    </div>
  );
};

// 7. Access Suspended Page (Section 4.2)
export const SuspendedAccessPage: React.FC = () => {
  const { profile, organization, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <Card className="max-w-lg w-full p-8 text-center space-y-5">
        <div className="mx-auto h-12 w-12 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center">
          <Lock className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            Access Suspended
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {organization && organization.status !== 'approved'
              ? `Your organization (${organization.name}) is currently marked "${organization.status}".`
              : 'Your user profile has been suspended by HireNest HQ.'}{' '}
            Please contact HireNest Workforce Operations for assistance.
          </p>
        </div>
        {profile && (
          <div className="text-xs text-slate-500 font-mono">{profile.email}</div>
        )}
        <div className="pt-2">
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </Card>
    </div>
  );
};
