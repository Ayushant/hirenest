import React from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RefreshCw,
  X,
} from 'lucide-react';

// Button
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const base =
      'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer';
    const variants: Record<string, string> = {
      primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
      secondary:
        'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200',
      outline:
        'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800',
      danger: 'bg-red-600 text-white hover:bg-red-700',
      ghost:
        'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white',
    };
    const sizes: Record<string, string> = {
      sm: 'px-3 py-1.5 text-xs',
      md: 'px-4 py-2 text-xs',
      lg: 'px-5 py-2.5 text-sm',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

// Input
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600 ${
            error
              ? 'border-red-500 dark:border-red-500'
              : 'border-slate-300 dark:border-slate-700'
          } ${className}`}
          {...props}
        />
        {hint && !error && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        )}
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

// Select
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className = '', id, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 ${
            error
              ? 'border-red-500 dark:border-red-500'
              : 'border-slate-300 dark:border-slate-700'
          } ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';

// Textarea
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600 ${
            error
              ? 'border-red-500 dark:border-red-500'
              : 'border-slate-300 dark:border-slate-700'
          } ${className}`}
          {...props}
        />
        {hint && !error && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        )}
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

// Badge (Semantic text status indicator with subtle hairline border)
export const Badge: React.FC<{
  tone?: 'slate' | 'indigo' | 'emerald' | 'amber' | 'red';
  children: React.ReactNode;
  className?: string;
}> = ({ tone = 'slate', children, className = '' }) => {
  const tones = {
    slate:
      'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700',
    indigo:
      'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800',
    emerald:
      'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800',
    amber:
      'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800',
    red: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
};

// Card (Single-elevation flat surface with 1px border)
export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div
    className={`rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 ${className}`}
  >
    {children}
  </div>
);

// StatCard
export const StatCard: React.FC<{
  label: string;
  value: number | string;
  sublabel?: string;
  tone?: 'default' | 'emerald' | 'amber' | 'red';
  onClick?: () => void;
}> = ({ label, value, sublabel, tone = 'default', onClick }) => {
  const valueColors = {
    default: 'text-slate-900 dark:text-slate-100',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
      className={`rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 transition-colors ${
        onClick
          ? 'cursor-pointer hover:border-indigo-500/60 dark:hover:border-indigo-500/60'
          : ''
      }`}
    >
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${valueColors[tone]}`}>
        {value}
      </p>
      {sublabel && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sublabel}</p>
      )}
    </div>
  );
};

// Tabs
export const Tabs: React.FC<{
  tabs: Array<{ id: string; label: string; count?: number }>;
  activeTab: string;
  onChange: (id: string) => void;
}> = ({ tabs, activeTab, onChange }) => (
  <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
    {tabs.map((tab) => {
      const active = tab.id === activeTab;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            active
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && (
            <span className="ml-1.5 font-mono tabular-nums text-slate-400 dark:text-slate-500">
              ({tab.count})
            </span>
          )}
        </button>
      );
    })}
  </div>
);

// Skeleton
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`animate-pulse rounded bg-slate-200/80 dark:bg-slate-800/80 ${className}`}
  />
);

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({
  rows = 6,
  cols = 5,
}) => (
  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
    <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 grid grid-cols-5 gap-4">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-24" />
      ))}
    </div>
    <div className="divide-y divide-slate-200 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-3.5 grid grid-cols-5 gap-4 items-center">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  </div>
);

// EmptyState
export const EmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}> = ({
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => (
  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center">
    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
      <Inbox className="h-5 w-5" />
    </div>
    <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
      {description}
    </p>
    {(actionLabel || secondaryActionLabel) && (
      <div className="mt-4 flex items-center justify-center gap-2">
        {actionLabel && onAction && (
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
        {secondaryActionLabel && onSecondaryAction && (
          <Button size="sm" variant="outline" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </Button>
        )}
      </div>
    )}
  </div>
);

// ErrorState
export const ErrorState: React.FC<{
  message: string;
  onRetry?: () => void;
}> = ({ message, onRetry }) => (
  <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 p-6 text-center">
    <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mx-auto" />
    <p className="mt-2 text-xs font-medium text-red-800 dark:text-red-300">{message}</p>
    {onRetry && (
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )}
  </div>
);

// Pagination (Server-side bounded range pagination)
export const Pagination: React.FC<{
  page: number;
  pageSize?: number;
  totalCount: number;
  onPageChange: (nextPage: number) => void;
}> = ({ page, pageSize = 25, totalCount, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalCount, page * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
      <div className="font-mono tabular-nums">
        Showing {from}–{to} of {totalCount}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Button>
        <span className="font-mono tabular-nums px-2">
          Page {page} of {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

// Dialog (Modal)
export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}> = ({ open, onClose, title, description, children, maxWidth = 'max-w-lg' }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60">
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${maxWidth} rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg overflow-hidden max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

// Drawer (Slide-over right panel)
export const Drawer: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  widthClass?: string;
}> = ({ open, onClose, title, subtitle, children, widthClass = 'max-w-2xl' }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50">
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${widthClass} h-full border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shadow-xl`}
      >
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

// RatingInput 1–5 (5-segment RatingInput with labels per Section 8.1)
const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Below Avg',
  3: 'Satisfactory',
  4: 'Good',
  5: 'Excellent',
};

export const RatingInput: React.FC<{
  label: string;
  value: number;
  onChange: (val: number) => void;
  error?: string;
}> = ({ label, value, onChange, error }) => (
  <div>
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
        {value ? `${value}/5 · ${RATING_LABELS[value]}` : 'Select 1–5'}
      </span>
    </div>
    <div className="grid grid-cols-5 gap-1.5">
      {[1, 2, 3, 4, 5].map((score) => {
        const active = value === score;
        return (
          <button
            key={score}
            type="button"
            onClick={() => onChange(score)}
            className={`py-2 px-2 rounded-lg border text-center transition-colors cursor-pointer ${
              active
                ? 'border-indigo-600 bg-indigo-600 text-white font-semibold'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:border-slate-400'
            }`}
          >
            <div className="text-xs font-mono tabular-nums">{score}</div>
            <div className="text-[10px] truncate opacity-85">{RATING_LABELS[score]}</div>
          </button>
        );
      })}
    </div>
    {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
  </div>
);

// Skill Chips Input (manual chip entry for MVP)
export const SkillsChipInput: React.FC<{
  label?: string;
  skills: string[];
  onChange: (skills: string[]) => void;
  error?: string;
  hint?: string;
}> = ({ label = 'Skills', skills, onChange, error, hint }) => {
  const [draft, setDraft] = React.useState('');

  const addSkill = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return;
    if (!skills.some((s) => s.toLowerCase() === cleaned.toLowerCase())) {
      onChange([...skills, cleaned]);
    }
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addSkill(draft);
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a skill and press Enter (e.g. TypeScript, PostgreSQL)"
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => addSkill(draft)}>
          Add Skill
        </Button>
      </div>
      {skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-800 dark:text-slate-200"
            >
              {skill}
              <button
                type="button"
                onClick={() => onChange(skills.filter((s) => s !== skill))}
                aria-label={`Remove ${skill}`}
                className="text-slate-400 hover:text-red-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {hint && !error && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};

// PageHeader (Consistent page anatomy per Section 9)
export const PageHeader: React.FC<{
  title: string;
  description: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        {title}
      </h1>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);
