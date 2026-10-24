import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  RefreshCw,
  X,
} from 'lucide-react';
import { decomposeCompoundSkills } from '../../lib/matchingEngine';

// Category palette (in order):
// #1F4CC4 rich blue · #4F95DB sky · #6A89A7 storm blue · #384959 storm slate · #2A9D8F teal · #D99A2B amber
export const CATEGORY_PALETTE = [
  '#1F4CC4',
  '#4F95DB',
  '#6A89A7',
  '#384959',
  '#2A9D8F',
  '#D99A2B',
] as const;

// Avatar deterministic 100-tint bg + 700-shade text from the category palette
const AVATAR_STYLES = [
  { bg: '#DAE6FF', text: '#1B3EA0' }, // Rich Blue 100 / 700
  { bg: '#E3F0FD', text: '#1F5F99' }, // Sky 100 / 700
  { bg: '#E6ECF2', text: '#384959' }, // Storm Blue 100 / 700
  { bg: '#E6ECF2', text: '#27333F' }, // Storm Slate 100 / 800
  { bg: '#E4F5F2', text: '#1A6B61' }, // Teal 100 / 700
  { bg: '#FDF1DC', text: '#8F5A0A' }, // Amber 100 / 700
];

export const Avatar: React.FC<{
  id?: string | null;
  name?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}> = ({ id, name, size = 'md', className = '' }) => {
  const seed = id || name || 'hirenest';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const palette = AVATAR_STYLES[hash % AVATAR_STYLES.length];
  const initials = (name || 'U')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const sizeClass =
    size === 'sm'
      ? 'h-6 w-6 text-[11px] leading-[16px]'
      : 'h-7 w-7 text-[12px] leading-[16px]';

  return (
    <span
      style={{ backgroundColor: palette.bg, color: palette.text }}
      className={`inline-flex items-center justify-center rounded-[6px] font-semibold select-none shrink-0 ${sizeClass} ${className}`}
    >
      {initials || 'U'}
    </span>
  );
};

// Button: 32px (sm 28px), 13/500, 6px radius; primary Rich Blue 600, secondary white + Storm 200 border, ghost, danger
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
      'inline-flex items-center justify-center gap-1.5 font-medium rounded-[6px] transition-colors duration-120 ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer';
    const variants: Record<string, string> = {
      primary:
        'bg-[var(--primary-bg)] text-[var(--primary-text)] hover:bg-[var(--primary-hover)]',
      secondary:
        'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-button-sec)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]',
      outline:
        'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-button-sec)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]',
      danger:
        'border border-[var(--border)] bg-[var(--surface)] text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] hover:border-[var(--status-danger)]',
      ghost:
        'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
    };
    const sizes: Record<string, string> = {
      sm: 'h-7 px-2.5 text-[12px] leading-[16px]',
      md: 'h-8 px-3 text-[13px] leading-[20px]',
      lg: 'h-8 px-3.5 text-[13px] leading-[20px]',
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

// Input: 34px height, 6px radius, label 12/500 Storm 600, focus = 3px Rich Blue 100 ring
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
            className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full h-[34px] rounded-[6px] border px-3 text-[14px] leading-[20px] bg-[var(--surface)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-120 focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)] ${
            error
              ? 'border-[var(--status-danger)]'
              : 'border-[var(--border)] hover:border-[var(--border-strong)]'
          } ${className}`}
          {...props}
        />
        {hint && !error && (
          <p className="mt-1 text-[12px] leading-[16px] text-[var(--text-tertiary)]">{hint}</p>
        )}
        {error && (
          <p className="mt-1 text-[12px] leading-[16px] text-[var(--status-danger)]">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

// Select: 34px height, 6px radius, focus = 3px Rich Blue 100 ring
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
            className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`w-full h-[34px] rounded-[6px] border px-2.5 text-[14px] leading-[20px] bg-[var(--surface)] text-[var(--text-primary)] transition-colors duration-120 focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)] ${
            error
              ? 'border-[var(--status-danger)]'
              : 'border-[var(--border)] hover:border-[var(--border-strong)]'
          } ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="mt-1 text-[12px] leading-[16px] text-[var(--status-danger)]">{error}</p>
        )}
      </div>
    );
  }
);
Select.displayName = 'Select';

// Textarea: 6px radius, focus = 3px Rich Blue 100 ring
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
            className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`w-full rounded-[6px] border px-3 py-2 text-[14px] leading-[20px] bg-[var(--surface)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-120 focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)] ${
            error
              ? 'border-[var(--status-danger)]'
              : 'border-[var(--border)] hover:border-[var(--border-strong)]'
          } ${className}`}
          {...props}
        />
        {hint && !error && (
          <p className="mt-1 text-[12px] leading-[16px] text-[var(--text-tertiary)]">{hint}</p>
        )}
        {error && (
          <p className="mt-1 text-[12px] leading-[16px] text-[var(--status-danger)]">{error}</p>
        )}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

// Badge (soft-tint chip = tint background + 700-shade text + 6px dot, 6px radius)
export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'storm_blue'
  | 'rich_blue'
  | 'sky'
  | 'teal'
  | 'slate'
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'red';

export const Badge: React.FC<{
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}> = ({ tone = 'neutral', children, className = '' }) => {
  const chipStyles: Record<
    string,
    { bg: string; text: string; dot: string }
  > = {
    neutral: {
      bg: 'bg-[var(--status-neutral-bg)]',
      text: 'text-[var(--status-neutral)]',
      dot: 'bg-[var(--status-neutral-dot)]',
    },
    slate: {
      bg: 'bg-[var(--status-neutral-bg)]',
      text: 'text-[var(--status-neutral)]',
      dot: 'bg-[var(--status-neutral-dot)]',
    },
    success: {
      bg: 'bg-[var(--status-success-bg)]',
      text: 'text-[var(--status-success)]',
      dot: 'bg-[var(--status-success-dot)]',
    },
    emerald: {
      bg: 'bg-[var(--status-success-bg)]',
      text: 'text-[var(--status-success)]',
      dot: 'bg-[var(--status-success-dot)]',
    },
    warning: {
      bg: 'bg-[var(--status-warning-bg)]',
      text: 'text-[var(--status-warning)]',
      dot: 'bg-[var(--status-warning-dot)]',
    },
    amber: {
      bg: 'bg-[var(--status-warning-bg)]',
      text: 'text-[var(--status-warning)]',
      dot: 'bg-[var(--status-warning-dot)]',
    },
    danger: {
      bg: 'bg-[var(--status-danger-bg)]',
      text: 'text-[var(--status-danger)]',
      dot: 'bg-[var(--status-danger-dot)]',
    },
    red: {
      bg: 'bg-[var(--status-danger-bg)]',
      text: 'text-[var(--status-danger)]',
      dot: 'bg-[var(--status-danger-dot)]',
    },
    info: {
      bg: 'bg-[var(--status-info-bg)]',
      text: 'text-[var(--status-info)]',
      dot: 'bg-[var(--status-info-dot)]',
    },
    sky: {
      bg: 'bg-[var(--chip-sky-bg)]',
      text: 'text-[var(--chip-sky-text)]',
      dot: 'bg-[var(--chip-sky-dot)]',
    },
    storm_blue: {
      bg: 'bg-[var(--chip-storm-blue-bg)]',
      text: 'text-[var(--chip-storm-blue-text)]',
      dot: 'bg-[var(--chip-storm-blue-dot)]',
    },
    rich_blue: {
      bg: 'bg-[var(--chip-rich-blue-bg)]',
      text: 'text-[var(--chip-rich-blue-text)]',
      dot: 'bg-[var(--chip-rich-blue-dot)]',
    },
    indigo: {
      bg: 'bg-[var(--chip-rich-blue-bg)]',
      text: 'text-[var(--chip-rich-blue-text)]',
      dot: 'bg-[var(--chip-rich-blue-dot)]',
    },
    teal: {
      bg: 'bg-[var(--chip-teal-bg)]',
      text: 'text-[var(--chip-teal-text)]',
      dot: 'bg-[var(--chip-teal-dot)]',
    },
  };

  const activeStyle = chipStyles[tone] || chipStyles.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[6px] px-2 py-0.5 text-[12px] leading-[16px] font-medium whitespace-nowrap shrink-0 ${activeStyle.bg} ${activeStyle.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${activeStyle.dot}`} />
      <span>{children}</span>
    </span>
  );
};

// Card: 10px radius, 1px border, flat white surface
export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div
    className={`rounded-[10px] border border-[var(--border)] bg-[var(--surface)] ${className}`}
  >
    {children}
  </div>
);

// MetricStrip: One white panel, 3–4 metrics separated by dividers; each has a 12px label + 8px dot in its category colour and a 28px mono value
export const MetricStrip: React.FC<{
  items: Array<{
    label: string;
    value: number | string;
    sublabel?: string;
    tone?: 'default' | 'neutral' | 'success' | 'warning' | 'danger' | 'amber' | 'red' | 'emerald';
    onClick?: () => void;
  }>;
}> = ({ items }) => (
  <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)] overflow-hidden">
    {items.map((item, idx) => {
      const dotColor = CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length];
      return (
        <div
          key={idx}
          onClick={item.onClick}
          role={item.onClick ? 'button' : undefined}
          tabIndex={item.onClick ? 0 : undefined}
          onKeyDown={
            item.onClick
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') item.onClick?.();
                }
              : undefined
          }
          className={`p-4 sm:px-5 ${
            item.onClick ? 'cursor-pointer hover:bg-[var(--bg-hover)] transition-colors' : ''
          }`}
        >
          <div className="flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
            <span
              style={{ backgroundColor: dotColor }}
              className="h-2 w-2 rounded-full shrink-0"
            />
            <span className="truncate">{item.label}</span>
          </div>
          <div className="mt-1.5 text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
            {item.value}
          </div>
          {item.sublabel && (
            <div className="mt-0.5 text-[12px] leading-[16px] text-[var(--text-tertiary)]">
              {item.sublabel}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

// StatCard: Plain metric cell with 8px category dot and 28px mono value
export const StatCard: React.FC<{
  label: string;
  value: number | string;
  sublabel?: string;
  tone?: 'default' | 'emerald' | 'amber' | 'red';
  onClick?: () => void;
}> = ({ label, value, sublabel, tone = 'default', onClick }) => {
  const dotMap: Record<string, string> = {
    default: '#1F4CC4',
    emerald: '#2A9D8F',
    amber: '#D99A2B',
    red: '#B8322B',
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
      className={`py-3.5 px-4 border-l first:border-l-0 border-[var(--border)] bg-[var(--surface)] transition-colors ${
        onClick ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
        <span
          style={{ backgroundColor: dotMap[tone] || dotMap.default }}
          className="h-2 w-2 rounded-full shrink-0"
        />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1.5 text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
        {value}
      </p>
      {sublabel && (
        <p className="mt-0.5 text-[12px] leading-[16px] text-[var(--text-tertiary)]">{sublabel}</p>
      )}
    </div>
  );
};

// Tabs: Text tabs with a 2px Rich Blue 600 underline on the active tab and a mono count chip
export const Tabs: React.FC<{
  tabs: Array<{ id: string; label: string; count?: number }>;
  activeTab: string;
  onChange: (id: string) => void;
}> = ({ tabs, activeTab, onChange }) => (
  <div className="border-b border-[var(--border)] flex items-center gap-6 overflow-x-auto">
    {tabs.map((tab) => {
      const active = tab.id === activeTab;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`py-2.5 text-[13px] leading-[20px] font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2 cursor-pointer ${
            active
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && (
            <span
              className={`rounded-[6px] px-1.5 py-0.5 font-mono tabular-nums text-[12px] leading-[16px] ${
                active
                  ? 'bg-[var(--chip-rich-blue-bg)] text-[var(--chip-rich-blue-text)]'
                  : 'bg-[var(--track)] text-[var(--text-secondary)]'
              }`}
            >
              {tab.count}
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
    className={`animate-pulse rounded-[6px] bg-[var(--track)] ${className}`}
  />
);

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({
  rows = 6,
  cols = 5,
}) => (
  <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
    <div className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 h-9 grid grid-cols-5 gap-4 items-center">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-20" />
      ))}
    </div>
    <div className="divide-y divide-[var(--border)]">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 h-11 grid grid-cols-5 gap-4 items-center">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-3.5 w-full" />
          ))}
        </div>
      ))}
    </div>
  </div>
);

// EmptyState: Left-aligned inside the panel; a 40px rounded-10 Sky 100 tile with a 20px Rich Blue 600 stroke icon; one title line, one guidance line, one button
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
  <div className="p-6 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-left">
    <div className="h-10 w-10 rounded-[10px] bg-[var(--highlight-soft)] flex items-center justify-center mb-3">
      <Inbox strokeWidth={1.75} className="h-5 w-5 text-[var(--accent)]" />
    </div>
    <h3 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">{title}</h3>
    <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)] max-w-xl">
      {description}
    </p>
    {(actionLabel || secondaryActionLabel) && (
      <div className="mt-3.5 flex items-center gap-2">
        {actionLabel && onAction && (
          <Button size="sm" variant="primary" onClick={onAction}>
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
  <div className="py-4 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-4">
    <div className="flex items-center gap-2 text-[13px] leading-[20px] text-[var(--text-primary)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-danger-dot)] shrink-0" />
      <span>{message}</span>
    </div>
    {onRetry && (
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    )}
  </div>
);

// Pagination: "1–25 of 312" + prev/next ghost buttons, bottom-right
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
    <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-4 py-2.5 text-[12px] leading-[16px] text-[var(--text-secondary)]">
      <div className="font-mono tabular-nums">
        {from}–{to} of {totalCount}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>
        <Button
          size="sm"
          variant="ghost"
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

// Dialog (Modal): 480px default (640px for forms), 10px radius, floating shadow
export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}> = ({ open, onClose, title, description, children, maxWidth = 'max-w-[480px]' }) => {
  if (!open) return null;
  const normalizedWidth =
    maxWidth === 'max-w-lg' || maxWidth === 'max-w-md'
      ? 'max-w-[480px]'
      : maxWidth === 'max-w-2xl' || maxWidth === 'max-w-xl'
      ? 'max-w-[640px]'
      : maxWidth;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        style={{ boxShadow: 'var(--shadow-floating)' }}
        className={`w-full ${normalizedWidth} rounded-[10px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded-[6px] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

// Drawer (Slide-over right panel): 480px from right with a Sky 50 header strip
export const Drawer: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  widthClass?: string;
}> = ({ open, onClose, title, subtitle, children, widthClass = 'max-w-[480px]' }) => {
  if (!open) return null;
  const normalizedWidth =
    widthClass === 'max-w-2xl' || widthClass === 'max-w-xl' || widthClass === 'max-w-md'
      ? 'max-w-[480px]'
      : widthClass;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div
        role="dialog"
        aria-modal="true"
        style={{ boxShadow: 'var(--shadow-floating)' }}
        className={`w-full ${normalizedWidth} h-full border-l border-[var(--border)] bg-[var(--surface)] flex flex-col`}
      >
        <div className="flex items-start justify-between border-b border-[var(--border)] bg-[var(--drawer-header-bg)] px-5 py-4">
          <div>
            <h2 className="text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded-[6px] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

// RatingInput 1–5: Five 24px rounded-6 squares; filled Rich Blue 500 (score 5 = Rich Blue 700), empty Storm 100
const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Below average',
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
      <span className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
        {value ? `${value}/5 · ${RATING_LABELS[value]}` : '1–5'}
      </span>
    </div>
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((score) => {
        const filled = value >= score;
        const isFive = value === 5 && score === 5;
        return (
          <button
            key={score}
            type="button"
            onClick={() => onChange(score)}
            aria-label={`Rate ${score} out of 5 (${RATING_LABELS[score]})`}
            className={`h-6 w-6 rounded-[6px] text-[12px] leading-[16px] font-mono tabular-nums flex items-center justify-center transition-colors cursor-pointer ${
              filled
                ? isFive
                  ? 'bg-[#1B3EA0] text-white font-medium'
                  : 'bg-[#2F63DE] text-white font-medium'
                : 'bg-[var(--track)] text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]'
            }`}
          >
            {score}
          </button>
        );
      })}
      {value > 0 && (
        <span className="ml-2 text-[12px] leading-[16px] text-[var(--text-secondary)]">
          {RATING_LABELS[value]}
        </span>
      )}
    </div>
    {error && (
      <p className="mt-1 text-[12px] leading-[16px] text-[var(--status-danger)]">{error}</p>
    )}
  </div>
);

// Skill Chips Input (6px radius bordered chips)
export const SkillsChipInput: React.FC<{
  label?: string;
  skills: string[];
  onChange: (skills: string[]) => void;
  error?: string;
  hint?: string;
}> = ({ label = 'Skills', skills, onChange, error, hint }) => {
  const [draft, setDraft] = React.useState('');

  const addSkill = (raw: string) => {
    const tokens = decomposeCompoundSkills([raw]);
    if (tokens.length === 0) return;

    const next = [...skills];
    let changed = false;
    for (const token of tokens) {
      if (!next.some((s) => s.toLowerCase() === token.toLowerCase())) {
        next.push(token);
        changed = true;
      }
    }
    if (changed) {
      onChange(next);
    }
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      addSkill(draft);
    }
  };

  return (
    <div>
      <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (draft.trim()) {
              addSkill(draft);
            }
          }}
          placeholder="Type a skill and press Enter (e.g. TypeScript, PostgreSQL)"
          className="flex-1 h-[34px] rounded-[6px] border border-[var(--border)] px-3 text-[14px] leading-[20px] bg-[var(--surface)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)]"
        />
        <Button type="button" size="md" variant="outline" onClick={() => addSkill(draft)}>
          Add
        </Button>
      </div>
      {skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[12px] leading-[16px] font-medium text-[var(--text-primary)]"
            >
              {skill}
              <button
                type="button"
                onClick={() => onChange(skills.filter((s) => s !== skill))}
                aria-label={`Remove ${skill}`}
                className="text-[var(--text-tertiary)] hover:text-[var(--status-danger)] cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {hint && !error && (
        <p className="mt-1 text-[12px] leading-[16px] text-[var(--text-tertiary)]">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-[12px] leading-[16px] text-[var(--status-danger)]">{error}</p>
      )}
    </div>
  );
};

// PageHeader: Title on left (20px/28px/600), max 1-line secondary text, primary action on right, 24px below
export const PageHeader: React.FC<{
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
    <div className="min-w-0">
      <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
        {title}
      </h1>
      {description && (
        <p className="mt-0.5 text-[13px] leading-[20px] text-[var(--text-secondary)] truncate">
          {description}
        </p>
      )}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);
