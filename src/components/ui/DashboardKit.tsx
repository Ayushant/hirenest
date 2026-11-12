import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ArrowRight, Sun, Cloud, Sunset, Moon, Activity } from 'lucide-react';
import { CATEGORY_PALETTE } from './kit';

// ─── Time-based Greeting ─────────────────────────────────
type GreetingInfo = { text: string; emoji: React.ReactNode };

export function getTimeGreeting(firstName?: string): GreetingInfo {
  const h = new Date().getHours();
  let text: string;
  let emoji: React.ReactNode;
  if (h >= 5 && h < 12) {
    text = 'Good morning';
    emoji = <Sun className="w-6 h-6 text-amber-500 inline-block" />;
  } else if (h >= 12 && h < 17) {
    text = 'Good afternoon';
    emoji = <Cloud className="w-6 h-6 text-sky-500 inline-block" />;
  } else if (h >= 17 && h < 21) {
    text = 'Good evening';
    emoji = <Sunset className="w-6 h-6 text-orange-500 inline-block" />;
  } else {
    text = 'Working late?';
    emoji = <Moon className="w-6 h-6 text-indigo-400 inline-block" />;
  }
  if (firstName) text += `, ${firstName}`;
  return { text, emoji };
}

export const GreetingHeader: React.FC<{ firstName?: string; subtitle: string }> = ({
  firstName,
  subtitle,
}) => {
  const { text, emoji } = useMemo(() => getTimeGreeting(firstName), [firstName]);
  return (
    <div>
      <h1 className="type-greeting text-[var(--text-primary)] flex items-center gap-2">
        {emoji} {text}
      </h1>
      <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)]">{subtitle}</p>
    </div>
  );
};

// ─── Since Your Last Visit ───────────────────────────────
const LAST_VISIT_KEY = 'hirenest_last_visit';

function getLastVisitTimestamp(): number | null {
  try {
    const v = localStorage.getItem(LAST_VISIT_KEY);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

function saveVisitTimestamp() {
  try {
    localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
  } catch {}
}

function formatTimeSince(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export type DeltaItem = { label: string; count: number; icon?: React.ReactNode };

export const SinceLastVisit: React.FC<{ items: DeltaItem[] }> = ({ items }) => {
  const [lastVisit, setLastVisit] = useState<number | null>(null);

  useEffect(() => {
    const prev = getLastVisitTimestamp();
    setLastVisit(prev);
    saveVisitTimestamp();
  }, []);

  const hasActivity = items.some((i) => i.count > 0);
  if (!lastVisit && !hasActivity) return null;

  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-[var(--text-secondary)]" />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
          Since your last visit
        </span>
        {lastVisit && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            ({formatTimeSince(Date.now() - lastVisit)})
          </span>
        )}
      </div>
      {hasActivity ? (
        <div className="flex flex-wrap gap-3">
          {items
            .filter((i) => i.count > 0)
            .map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-1.5 rounded-full bg-[var(--bg-secondary)] px-3 py-1"
              >
                {item.icon}
                <span className="text-[18px] font-bold text-[var(--text-primary)]">{item.count}</span>
                <span className="text-[12px] text-[var(--text-secondary)]">{item.label}</span>
              </div>
            ))}
        </div>
      ) : (
        <p className="text-[12px] text-[var(--text-tertiary)]">No new activity — you&apos;re all caught up!</p>
      )}
    </div>
  );
};

const CHART_COLORS = [
  '#4F46D8', '#4F95DB', '#2A9D8F', '#D99A2B', '#6A89A7', '#384959',
  '#8C68EA', '#AB92F5', '#17734A', '#B8322B',
];

// ─── KPI Card ─────────────────────────────────────────────
export const KpiCard: React.FC<{
  label: string;
  value: number | string;
  change?: number | null;
  changePeriod?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  accentColor?: string;
}> = ({ label, value, change, changePeriod = 'vs last month', icon, onClick, accentColor }) => {
  const isPositive = change != null && change > 0;
  const isNegative = change != null && change < 0;
  const isNeutral = change != null && change === 0;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      className={`relative overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 transition-all ${
        onClick ? 'cursor-pointer hover:border-[var(--border-strong)] hover:shadow-sm' : ''
      }`}
    >
      {accentColor && (
        <div
          className="absolute top-0 left-0 w-full h-[3px]"
          style={{ backgroundColor: accentColor }}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <p className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] uppercase tracking-[0.04em] truncate">
            {label}
          </p>
          <p className="text-[32px] leading-[40px] font-semibold tracking-[-0.02em] font-mono tabular-nums text-[var(--text-primary)]">
            {value}
          </p>
          {change != null && (
            <div className="flex items-center gap-1.5">
              {isPositive && <TrendingUp className="w-3.5 h-3.5 text-[#17734A]" />}
              {isNegative && <TrendingDown className="w-3.5 h-3.5 text-[#B8322B]" />}
              {isNeutral && <Minus className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />}
              <span
                className="text-[12px] leading-[16px] font-medium"
                style={{
                  color: isPositive ? '#17734A' : isNegative ? '#B8322B' : 'var(--text-tertiary)',
                }}
              >
                {isPositive ? '+' : ''}{change}%
              </span>
              <span className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                {changePeriod}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div
            className="shrink-0 p-2.5 rounded-[8px]"
            style={{
              backgroundColor: accentColor ? `${accentColor}14` : 'var(--bg-subtle)',
              color: accentColor || 'var(--text-secondary)',
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── KPI Row (grid of KPI cards) ─────────────────────────
export const KpiRow: React.FC<{
  children: React.ReactNode;
  cols?: 3 | 4 | 5 | 6;
}> = ({ children, cols = 4 }) => (
  <div
    className={`grid gap-4 ${
      cols === 3
        ? 'grid-cols-1 sm:grid-cols-3'
        : cols === 5
          ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
          : cols === 6
            ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
            : 'grid-cols-2 sm:grid-cols-4'
    }`}
  >
    {children}
  </div>
);

// ─── Chart Card (wrapper) ─────────────────────────────────
export const ChartCard: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, action, children, className = '' }) => (
  <div
    className={`rounded-[10px] border border-[var(--border)] bg-[var(--surface)] ${className}`}
  >
    <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[14px] leading-[20px] font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-[12px] leading-[16px] text-[var(--text-tertiary)]">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
    <div className="px-2 pb-4">{children}</div>
  </div>
);

// ─── Mini Bar Chart ───────────────────────────────────────
export const MiniBarChart: React.FC<{
  data: Array<{ name: string; value: number }>;
  height?: number;
  color?: string;
}> = ({ data, height = 220, color = '#4F46D8' }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} barCategoryGap="20%">
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey="name"
        tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        width={35}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}
        labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
        itemStyle={{ color: 'var(--text-secondary)' }}
      />
      <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
    </BarChart>
  </ResponsiveContainer>
);

// ─── Stacked/Grouped Bar Chart ────────────────────────────
export const GroupedBarChart: React.FC<{
  data: Array<Record<string, string | number>>;
  keys: string[];
  colors?: string[];
  height?: number;
}> = ({ data, keys, colors = CHART_COLORS, height = 220 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} barCategoryGap="20%">
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis
        dataKey="name"
        tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        width={35}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}
        labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
      />
      {keys.map((key, i) => (
        <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} maxBarSize={36} />
      ))}
    </BarChart>
  </ResponsiveContainer>
);

// ─── Area / Trend Chart ───────────────────────────────────
export const TrendChart: React.FC<{
  data: Array<{ name: string; value: number }>;
  height?: number;
  color?: string;
  showGrid?: boolean;
}> = ({ data, height = 200, color = '#4F46D8', showGrid = true }) => (
  <ResponsiveContainer width="100%" height={height}>
    <AreaChart data={data}>
      {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />}
      <XAxis
        dataKey="name"
        tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        width={35}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}
        labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
      />
      <defs>
        <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={2}
        fill={`url(#gradient-${color.replace('#', '')})`}
      />
    </AreaChart>
  </ResponsiveContainer>
);

// ─── Donut Chart ──────────────────────────────────────────
export const DonutChart: React.FC<{
  data: Array<{ name: string; value: number }>;
  colors?: string[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  centerLabel?: string;
  centerValue?: string | number;
}> = ({
  data,
  colors = CHART_COLORS,
  height = 220,
  innerRadius = 55,
  outerRadius = 80,
  centerLabel,
  centerValue,
}) => (
  <ResponsiveContainer width="100%" height={height}>
    <PieChart>
      <Pie
        data={data}
        cx="50%"
        cy="50%"
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        paddingAngle={2}
        dataKey="value"
        stroke="none"
      >
        {data.map((_, i) => (
          <Cell key={i} fill={colors[i % colors.length]} />
        ))}
      </Pie>
      <Tooltip
        contentStyle={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}
      />
      {centerLabel && (
        <text x="50%" y="46%" textAnchor="middle" className="fill-[var(--text-primary)]" style={{ fontSize: 22, fontWeight: 600 }}>
          {centerValue}
        </text>
      )}
      {centerLabel && (
        <text x="50%" y="58%" textAnchor="middle" className="fill-[var(--text-tertiary)]" style={{ fontSize: 11 }}>
          {centerLabel}
        </text>
      )}
    </PieChart>
  </ResponsiveContainer>
);

// ─── Chart Legend ─────────────────────────────────────────
export const ChartLegend: React.FC<{
  items: Array<{ name: string; color: string; value?: number | string }>;
}> = ({ items }) => (
  <div className="flex flex-wrap gap-x-5 gap-y-2 px-3 pb-2">
    {items.map((item) => (
      <div key={item.name} className="flex items-center gap-2 text-[12px] leading-[16px]">
        <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: item.color }} />
        <span className="text-[var(--text-secondary)]">{item.name}</span>
        {item.value != null && (
          <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
            {item.value}
          </span>
        )}
      </div>
    ))}
  </div>
);

// ─── Horizontal Progress Bar ──────────────────────────────
export const ProgressBar: React.FC<{
  label: string;
  value: number;
  total: number;
  color?: string;
}> = ({ label, value, total, color = '#4F46D8' }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[12px] leading-[16px]">
        <span className="text-[var(--text-secondary)] truncate">{label}</span>
        <span className="font-mono tabular-nums font-medium text-[var(--text-primary)] shrink-0 ml-2">
          {value}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--track)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

// ─── Activity / Action Item Row ───────────────────────────
export const ActionItem: React.FC<{
  icon?: React.ReactNode;
  label: string;
  count?: number;
  badge?: string;
  badgeColor?: string;
  onClick?: () => void;
}> = ({ icon, label, count, badge, badgeColor, onClick }) => (
  <div
    onClick={onClick}
    className={`flex items-center justify-between gap-3 h-12 px-4 text-[13px] leading-[20px] border-b last:border-b-0 border-[var(--border)] ${
      onClick ? 'cursor-pointer hover:bg-[var(--bg-hover)] transition-colors' : ''
    }`}
  >
    <div className="flex items-center gap-3 min-w-0">
      {icon && <span className="shrink-0 text-[var(--text-tertiary)]">{icon}</span>}
      <span className="text-[var(--text-primary)] truncate">{label}</span>
      {badge && (
        <span
          className="px-2 py-0.5 rounded-[4px] text-[12px] leading-[16px] font-medium shrink-0"
          style={{
            backgroundColor: badgeColor ? `${badgeColor}18` : 'var(--status-warning-bg)',
            color: badgeColor || 'var(--status-warning)',
          }}
        >
          {badge}
        </span>
      )}
    </div>
    <div className="flex items-center gap-3 shrink-0">
      {count != null && (
        <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
          {count}
        </span>
      )}
      {onClick && (
        <ArrowRight className="w-3.5 h-3.5 text-[var(--accent)]" />
      )}
    </div>
  </div>
);

// ─── Section Header ───────────────────────────────────────
export const DashboardSection: React.FC<{
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, action, children }) => (
  <section className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
        {title}
      </h2>
      {action}
    </div>
    {children}
  </section>
);

// ─── Funnel Chart (horizontal stacked bars) ───────────────
export const FunnelChart: React.FC<{
  stages: Array<{ name: string; value: number; color: string }>;
}> = ({ stages }) => {
  const maxVal = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-3 py-1">
      {stages.map((stage) => {
        const pct = Math.max((stage.value / maxVal) * 100, 4);
        return (
          <div key={stage.name} className="flex items-center gap-3">
            <span className="w-28 text-[12px] leading-[16px] text-[var(--text-secondary)] text-right truncate shrink-0">
              {stage.name}
            </span>
            <div className="flex-1 h-7 bg-[var(--track)] rounded-[4px] overflow-hidden relative">
              <div
                className="h-full rounded-[4px] transition-all duration-700 ease-out flex items-center"
                style={{ width: `${pct}%`, backgroundColor: stage.color }}
              >
                <span className="px-2 text-[12px] font-semibold text-white whitespace-nowrap">
                  {stage.value}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
