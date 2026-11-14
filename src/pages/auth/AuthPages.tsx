import React, { useState, useEffect } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogOut, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth, getHomeRouteForRole } from '../../auth/AuthProvider';
import { Button, Input, Select } from '../../components/ui/kit';
import { mapSupabaseError } from '../../lib/errors';
import { RequirementThread } from './RequirementThread';
import { useToast } from '../../components/ui/Toast';

const NAVY = '#14213D';

// Shared Two-Column Split Layout for Auth Pages:
// Left 42% in deep storm-slate #1B2742 with a subtle sky radial wash at the top, wordmark, and a concise 3-line product statement in #E3DDD3;
// Right 58% on Storm 50 with a white form card (10px radius, 1px border).
const AuthSplitLayout: React.FC<{
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ children, maxWidthClass = 'max-w-[440px]' }) => (
  <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--app-bg)] text-[var(--text-primary)]">
    {/* Left 42% Storm-Slate Panel */}
    <div
      style={{
        backgroundImage:
          'radial-gradient(ellipse at top, rgba(232, 190, 143, 0.16), transparent 65%)',
      }}
      className="lg:w-[42%] bg-[#1B2742] text-[#E3DDD3] p-8 sm:p-12 flex flex-col justify-between shrink-0"
    >
      <div className="flex items-center gap-3">
        <img
          src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
          alt="HireNest Workforce Logo"
          className="h-11 w-11 rounded-[8px] bg-white object-contain p-1 shrink-0 shadow-sm"
        />
        <div className="flex flex-col">
          <span className="text-[15px] leading-[20px] font-semibold text-white">
            HireNest
          </span>
          <span className="text-[12px] leading-[16px] text-[#A39F92]">
            Hire Nest Workforce Pvt Ltd
          </span>
        </div>
      </div>

      <div className="my-10 lg:my-0 max-w-md space-y-3">
        <div className="h-[3px] w-4 rounded-full bg-[#E8BE8F]" />
        <p className="text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-white">
          Governed enterprise staffing for HQ, hiring companies, vendor agencies, and candidates.
        </p>
        <p className="text-[13px] leading-[20px] text-[#E3DDD3]">
          One source of truth for requirements, vendor SLAs, candidate ownership, structured interviews, and 6-dimension quality scoring.
        </p>
      </div>

      <div className="space-y-1 text-[12px] leading-[16px] text-[#A39F92]">
        <div className="font-mono tabular-nums">HireNest Workforce Operations</div>
        <div>
          Built by{' '}
          <a
            href="https://atkind.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#E8BE8F] hover:text-white hover:underline transition-colors"
          >
            Atkind Pvt Ltd
          </a>
        </div>
      </div>
    </div>

    {/* Right 58% Storm 50 Canvas with White Form Card */}
    <div className="flex-1 lg:w-[58%] flex flex-col items-center justify-center p-6 sm:p-10 bg-[var(--app-bg)]">
      <div
        className={`w-full ${maxWidthClass} rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-7 space-y-5 text-left`}
      >
        <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
          <img
            src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
            alt="HireNest Workforce Private Limited"
            className="h-10 w-auto rounded-[6px] bg-white object-contain shrink-0"
          />
          <div className="min-w-0">
            <div className="text-[13px] leading-[18px] font-semibold text-[var(--text-primary)]">
              HireNestOS
            </div>
            <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)] truncate">
              Hire Nest Workforce Private Limited
            </div>
          </div>
        </div>
        {children}
      </div>
      <div className="mt-4 text-[12px] leading-[16px] text-[var(--text-tertiary)]">
        Built by{' '}
        <a
          href="https://atkind.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--accent)] hover:underline"
        >
          Atkind Pvt Ltd
        </a>
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
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema) as never,
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: SignInValues) => {
    setLoading(true);
    setAuthError(null);
    try {
      const cleanEmail = values.email.trim();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: values.password,
      });
      if (error) throw error;

      if (data.user) {
        await refreshProfile();
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
      toast({ title: 'Sign in failed', description: msg, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--zp-canvas)] text-[var(--text-primary)]">
      {/* Navy panel: the requirement thread is the one visual moment on this page */}
      <aside
        className="hidden lg:flex lg:w-[45%] flex-col px-12 py-10 xl:px-16 xl:py-12 text-[#F8F4F0] shrink-0"
        style={{ background: NAVY }}
      >
        <Link to="/" className="flex items-center gap-3 self-start rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38ACEF]">
          <img
            src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
            alt=""
            className="h-10 w-10 rounded-[10px] bg-white object-contain p-0.5"
          />
          <span className="font-display text-[17px] font-semibold tracking-[-0.02em]">HireNestOS</span>
        </Link>

        <div className="flex-1 flex items-center justify-center py-8">
          <RequirementThread className="w-full max-w-[520px] h-auto overflow-visible" />
        </div>

        <div className="max-w-[440px]">
          <p className="font-display text-[clamp(32px,3vw,44px)] leading-[1.05] font-medium tracking-[-0.03em] text-[#FFFEFB]">
            One sign-in for every side of the hire.
          </p>
          <p className="mt-4 text-[15px] leading-[1.6] text-[#B9C3D6]">
            HQ, hiring clients, staffing vendors and candidates each land in their own workspace,
            looking at the same requirement.
          </p>
        </div>
      </aside>

      {/* Form side: sits directly on the cream canvas, no card */}
      <div className="flex-1 flex flex-col min-h-screen lg:min-h-0">
        <header className="flex items-center justify-between gap-4 px-5 sm:px-10 h-16 lg:h-20">
          <Link to="/" className="lg:hidden flex items-center gap-2.5">
            <img
              src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
              alt=""
              className="h-9 w-9 rounded-[8px] bg-white object-contain p-0.5 border border-[var(--border)]"
            />
            <span className="font-display text-[16px] font-semibold tracking-[-0.02em]">HireNestOS</span>
          </Link>
          <p className="ml-auto text-[14px] text-[var(--text-secondary)]">
            <span className="hidden sm:inline">New to HireNestOS? </span>
            <Link to="/signup" className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </header>

        <main className="flex-1 flex items-center px-5 sm:px-10 py-10">
          <div className="w-full max-w-[400px] mx-auto lg:mx-0 lg:ml-[clamp(40px,8vw,120px)]">
            <h1 className="font-display text-[44px] sm:text-[52px] leading-[1] font-medium tracking-[-0.035em] text-[var(--text-primary)]">
              Sign in
            </h1>
            <p className="mt-3 text-[16px] leading-[1.5] text-[var(--text-secondary)]">
              Welcome back. Use the work email you registered with.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-9 space-y-5">
              <div>
                <label htmlFor="signin-email" className="block text-[14px] font-semibold text-[var(--text-primary)] mb-2">
                  Work email
                </label>
                <Input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  className="!h-12 !text-[16px] !px-3.5 !rounded-[8px]"
                  {...register('email')}
                  error={errors.email?.message}
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label htmlFor="signin-password" className="block text-[14px] font-semibold text-[var(--text-primary)]">
                    Password
                  </label>
                  <Link to="/forgot-password" className="text-[14px] font-medium text-[var(--accent)] underline-offset-4 hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="signin-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="!h-12 !text-[16px] !pl-3.5 !pr-16 !rounded-[8px]"
                    {...register('password')}
                    error={errors.password?.message}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1.5 top-1.5 h-9 px-2.5 rounded-[6px] text-[13px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="rounded-[8px] border-l-[3px] border-[var(--status-danger)] bg-[var(--status-danger-bg)] px-3.5 py-3 text-[14px] leading-[20px] text-[var(--status-danger)]"
                >
                  {authError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full !h-12 !text-[16px] !rounded-[12px] mt-2"
                loading={loading}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </div>
        </main>

        <footer className="px-5 sm:px-10 py-6 flex flex-wrap items-center justify-between gap-3 text-[13px] text-[var(--text-tertiary)]">
          <span>© 2026 HireNest Workforce Pvt Ltd</span>
          <div className="flex items-center gap-5">
            <Link to="/privacy-policy" className="hover:text-[var(--text-primary)] transition-colors">
              Privacy policy
            </Link>
            <a
              href="https://atkind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              Built by Atkind
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
};

// 3. Sign Up Page
const signUpSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  signup_intent: z.enum(['candidate', 'vendor', 'client']),
  company_name: z.string().optional(),
});

type SignUpValues = z.infer<typeof signUpSchema>;

export const SignUpPage: React.FC = () => {
  const { toast } = useToast();
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);

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
      signup_intent: (['candidate', 'vendor', 'client'].includes(searchParams.get('intent') || '') ? searchParams.get('intent') as 'candidate' | 'vendor' | 'client' : 'candidate'),
      company_name: '',
    },
  });

  const intent = watch('signup_intent');

  const onSubmit = async (values: SignUpValues) => {
    setLoading(true);
    setSignUpError(null);
    try {
      const cleanEmail = values.email.trim();
      const companyName =
        values.signup_intent === 'vendor' || values.signup_intent === 'client'
          ? values.company_name?.trim() || null
          : null;

      let userId: string | null = null;
      let hasSession = false;

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/email-confirmed`,
          data: {
            full_name: values.full_name.trim(),
            signup_intent: values.signup_intent,
            company_name: companyName,
          },
        },
      });

      // If email is already registered, try signing in with the entered password
      if (
        error?.message?.toLowerCase().includes('already registered') ||
        (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      ) {
        const { data: signInData, error: signInErr } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: values.password,
          });
        if (signInErr) {
          throw new Error(
            'An account with this email already exists. Sign in with your existing password or use a different email.'
          );
        }
        userId = signInData.user?.id || null;
        hasSession = Boolean(signInData.session);
      } else if (error) {
        throw error;
      } else {
        userId = data.user?.id || null;
        hasSession = Boolean(data.session);
      }

      if (!hasSession) {
        toast({
          title: 'Account created',
          description: 'Check your email inbox to confirm your account, then sign in.',
          tone: 'info',
        });
        navigate('/signin', { replace: true });
        return;
      }

      await refreshProfile();
      const { data: prof } = userId
        ? await supabase
            .from('profiles')
            .select('role, status')
            .eq('id', userId)
            .maybeSingle()
        : { data: null };

      toast({
        title: 'Account created',
        tone: 'success',
      });

      const returnTo = searchParams.get('returnTo');
      if (returnTo && returnTo.startsWith('/')) {
        navigate(returnTo, { replace: true });
      } else {
        navigate(getHomeRouteForRole(prof?.role, prof?.status), {
          replace: true,
        });
      }
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

  return (
    <AuthSplitLayout>
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Create account
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Register as a candidate, staffing vendor, or hiring company.
        </p>
      </div>

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
          placeholder="Minimum 6 characters"
          {...register('password')}
          error={errors.password?.message}
        />

        <Select
          label="I am registering as"
          {...register('signup_intent')}
          error={errors.signup_intent?.message}
          options={[
            { value: 'candidate', label: 'Candidate (Direct applicant - instant access)' },
            { value: 'vendor', label: 'Vendor agency (requires HQ approval)' },
            { value: 'client', label: 'Hiring company / Client (requires HQ approval)' },
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
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--status-danger-bg)] p-3 text-[12px] leading-[16px] text-[var(--status-danger)]">
            <div className="flex items-start gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-danger-dot)] shrink-0 mt-1.5" />
              <span>{signUpError}</span>
            </div>
          </div>
        )}

        <Button type="submit" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>

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
    if (password.length < 6) {
      toast({
        title: 'Password must be at least 6 characters',
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
          placeholder="Minimum 6 characters"
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
  const { session, loading, profile, signOut, refreshProfile, homeRoute } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (profile && profile.role !== 'pending' && profile.status === 'active') {
      navigate(homeRoute, { replace: true });
    }
  }, [profile?.role, profile?.status, homeRoute, navigate]);

  if (!loading && !session) {
    return <Navigate to="/signin" replace />;
  }

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      await refreshProfile();
      const { data: freshProf } = profile?.id
        ? await supabase
            .from('profiles')
            .select('role, status')
            .eq('id', profile.id)
            .maybeSingle()
        : { data: null };

      if (freshProf && freshProf.role !== 'pending' && freshProf.status === 'active') {
        toast({
          title: 'Account approved',
          tone: 'success',
        });
        navigate(getHomeRouteForRole(freshProf.role, freshProf.status), {
          replace: true,
        });
      } else {
        toast({
          title: 'Still pending approval',
          description: 'An HQ Admin must approve your organization account in Admin → Approvals.',
          tone: 'info',
        });
      }
    } finally {
      setChecking(false);
    }
  };

  const handleSignOutToSignIn = async () => {
    await signOut();
    navigate('/signin', { replace: true });
  };

  const handleSignOutToSignUp = async () => {
    await signOut();
    navigate('/signup', { replace: true });
  };

  return (
    <AuthSplitLayout maxWidthClass="max-w-[460px]">
      <div className="space-y-1">
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          Account pending verification
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          HireNest HQ verifies company and agency registrations before activating workspace access.
        </p>
      </div>

      {profile && (
        <div className="border-y border-[var(--border)] py-3 space-y-2 text-[13px] leading-[20px]">
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

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="primary"
          size="md"
          loading={checking}
          onClick={handleCheckStatus}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Check status
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={handleSignOutToSignIn}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign in with another account
        </Button>
      </div>

      <div className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
        Need a new account?{' '}
        <button
          type="button"
          onClick={handleSignOutToSignUp}
          className="font-medium text-[var(--accent)] hover:underline cursor-pointer"
        >
          Create an account
        </button>
      </div>
    </AuthSplitLayout>
  );
};

// 7. Access Suspended Page
export const SuspendedAccessPage: React.FC = () => {
  const { session, loading, profile, organization, signOut } = useAuth();
  const navigate = useNavigate();

  if (!loading && !session) {
    return <Navigate to="/signin" replace />;
  }

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
        <Button
          variant="outline"
          size="md"
          onClick={async () => {
            await signOut();
            navigate('/signin', { replace: true });
          }}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </AuthSplitLayout>
  );
};


// Landing page for the "Confirm email" link in the signup email.
export const EmailConfirmedPage: React.FC = () => {
  const navigate = useNavigate();
  const { session, loading, homeRoute } = useAuth();
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  const failed = /error=|error_code=/.test(hash);

  return (
    <AuthSplitLayout>
      <div className="space-y-4 text-center">
        <div
          className={`mx-auto h-12 w-12 rounded-full flex items-center justify-center text-[22px] ${
            failed ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'bg-[var(--status-success-bg)] text-[var(--status-success)]'
          }`}
        >
          {failed ? '!' : '✓'}
        </div>
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
          {failed ? 'This link has expired' : 'Email confirmed'}
        </h1>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          {failed
            ? 'The confirmation link is invalid or has already been used. Sign in, or sign up again to receive a new link.'
            : 'Your email address is verified and your HireNest account is ready.'}
        </p>
        <Button
          className="w-full"
          loading={loading && !failed}
          onClick={() => navigate(!failed && session ? homeRoute : '/signin', { replace: true })}
        >
          {!failed && session ? 'Continue to HireNest' : 'Go to sign in'}
        </Button>
      </div>
    </AuthSplitLayout>
  );
};
