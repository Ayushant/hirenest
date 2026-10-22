import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth, getHomeRouteForRole } from '../../auth/AuthProvider';
import { Button, Input, Select } from '../../components/ui/kit';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../../components/ui/Toast';

// Shared Two-Column Split Layout for Auth Pages:
// Left 42% in deep storm-slate #1E2A36 with a subtle sky radial wash at the top, wordmark, and a concise 3-line product statement in #D6E1EC;
// Right 58% on Storm 50 with a 400px white form card (10px radius, 1px border).
const AuthSplitLayout: React.FC<{
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ children, maxWidthClass = 'max-w-[400px]' }) => (
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

      <div className="my-12 lg:my-0 max-w-md space-y-3">
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

    {/* Right 58% Storm 50 Canvas with 400px White Form Card */}
    <div className="flex-1 lg:w-[58%] flex items-center justify-center p-6 sm:p-12 bg-[var(--app-bg)]">
      <div
        className={`w-full ${maxWidthClass} rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-7 space-y-6 text-left`}
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
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Sign in
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Enter your credentials to access your workspace.
        </p>
      </div>

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
            {authError.toLowerCase().includes('confirm') && (
              <p className="text-[var(--text-secondary)]">
                Confirm email is enabled on your Supabase project. Check your inbox or run the SQL snippet below in the Supabase SQL Editor.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-[12px] leading-[16px]">
          <button
            type="button"
            onClick={() => setShowBootstrapHelp((v) => !v)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline cursor-pointer"
          >
            {showBootstrapHelp ? 'Hide admin SQL' : 'Admin SQL setup'}
          </button>
          <Link
            to="/forgot-password"
            className="text-[var(--accent)] hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        {showBootstrapHelp && (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2 text-[12px] leading-[16px]">
            <p className="font-medium text-[var(--text-primary)]">
              Confirm email & activate HQ Admin (Supabase SQL Editor):
            </p>
            <pre className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] p-2.5 font-mono text-[11px] overflow-x-auto select-all">
{`update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = '${typedEmail.trim()}';

update public.profiles
set role = 'admin', status = 'active'
where email = '${typedEmail.trim()}';`}
            </pre>
          </div>
        )}

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
                    Supabase free-tier SMTP limits confirmation emails to ~2/hour. Disable Confirm email in Authentication → Providers → Email, or create the user in Authentication → Users and run:
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
          First HQ Admin? Run in Supabase SQL Editor:
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
