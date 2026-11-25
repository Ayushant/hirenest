import { ShieldCheck } from 'lucide-react';
import { classifyRequirement, REQUIREMENT_CATEGORY_LABEL } from '../../lib/requirementCategory';
import { parseRequirementMeta } from '../../lib/enterpriseLifecycle';

type Props = {
  requirement: {
    id?: string;
    title?: string | null;
    skills?: string[] | null;
    description?: string | null;
    currency?: string | null;
    status?: string | null;
  };
  className?: string;
};

/**
 * Checks whether a requirement has a mandatory Background Verification (BGV) process,
 * derived from explicit currency metadata (|bgv=1|) or inferred from the JD text.
 */
export function hasBgvRequired(requirement?: {
  id?: string;
  currency?: string | null;
  description?: string | null;
  title?: string | null;
} | null): boolean {
  if (!requirement) return false;
  const currencyStr = String(requirement.currency || '');
  if (/\|bgv=(?:1|true)(?:\||$)/i.test(currencyStr)) return true;
  if (/\|bgv=(?:0|false)(?:\||$)/i.test(currencyStr)) return false;
  const meta = parseRequirementMeta(requirement);
  if (meta.hasBgv !== undefined && meta.hasBgv !== null) return meta.hasBgv;

  const text = `${requirement.title || ''} ${requirement.description || ''}`;
  return /\b(?:bgv|background\s+verification|police\s+clearance|pcc\b|criminal\s+record|employment\s+check)\b/i.test(
    text
  );
}

function profilesOf(requirement: Props['requirement']): Array<'bench' | 'market'> {
  const profileType = parseRequirementMeta(requirement).profileType;
  if (!profileType) return [];
  return profileType === 'both' ? ['bench', 'market'] : [profileType];
}

/**
 * Ribbon tags shown above a requirement title: "IT" / "Non-IT", plus "Bench profile" /
 * "Market profile" when the requirement specifies one, and a floating "BGV" cloud badge
 * when background verification is mandatory.
 */
export function RequirementRibbon({ requirement, className = '' }: Props) {
  const category = classifyRequirement(requirement);
  const isIt = category === 'it';
  const profiles = profilesOf(requirement);
  const hasBgv = hasBgvRequired(requirement);
  const base =
    'inline-flex items-center h-[18px] pl-2 pr-3 mb-1 whitespace-nowrap shrink-0 text-[10px] leading-[18px] font-semibold uppercase tracking-[0.08em] text-white';
  const shape = {
    // ribbon notch on the right edge
    clipPath: 'polygon(0 0, 100% 0, calc(100% - 6px) 50%, 100% 100%, 0 100%)',
    borderRadius: '3px 0 0 3px',
  } as const;
  return (
    <span className={`inline-flex max-w-full flex-wrap items-center gap-1.5 ${className}`}>
      <span
        title={isIt ? 'IT requirement' : 'Non-IT requirement'}
        className={base}
        style={{
          ...shape,
          background: isIt
            ? 'linear-gradient(90deg, #1D5FD1, #1A56C2)'
            : 'linear-gradient(90deg, #D97706, #F59E0B)',
        }}
      >
        {REQUIREMENT_CATEGORY_LABEL[category]}
      </span>
      {requirement.status && (
        <span
          title={`Requirement is ${requirement.status === 'open' ? 'Active & Open for submissions' : requirement.status}`}
          className="inline-flex items-center h-[18px] px-2 mb-1 rounded-[3px] whitespace-nowrap shrink-0 text-[10px] leading-[18px] font-bold uppercase tracking-[0.08em] text-white"
          style={{
            background:
              requirement.status === 'open'
                ? '#059669'
                : requirement.status === 'on_hold'
                  ? '#D97706'
                  : '#475569',
          }}
        >
          {requirement.status === 'open'
            ? '● Active'
            : requirement.status === 'on_hold'
              ? 'On Hold'
              : 'Closed'}
        </span>
      )}
      {profiles.map((profile) => (
        <span
          key={profile}
          title={profile === 'bench' ? 'Bench profile requirement' : 'Market profile requirement'}
          className={`${base} req-ribbon-wave`}
          style={{
            borderRadius: '3px 0 0 3px',
            background:
              profile === 'bench'
                ? 'linear-gradient(90deg, #047857, #34D399, #047857)'
                : 'linear-gradient(90deg, #6D28D9, #A78BFA, #6D28D9)',
            backgroundSize: '200% 100%',
          }}
        >
          {profile === 'bench' ? 'Bench profile' : 'Market profile'}
        </span>
      ))}
      {hasBgv && (
        <span
          title="Background Verification (BGV) process mandatory: Employment Check & Police Clearance Certificate (PCC)"
          className="inline-flex items-center gap-1 h-[18px] px-2.5 mb-1 rounded-full whitespace-nowrap shrink-0 text-[10px] leading-[18px] font-bold uppercase tracking-[0.08em] text-white shadow-xs req-bgv-cloud"
          style={{
            background: 'linear-gradient(135deg, #0284C7, #0EA5E9 45%, #38BDF8)',
            boxShadow: '0 2px 6px rgba(14, 165, 233, 0.45)',
          }}
        >
          <ShieldCheck className="h-3 w-3 stroke-[2.5]" />
          <span>BGV</span>
        </span>
      )}
    </span>
  );
}

export type RequirementCategoryFilterValue = 'all' | 'it' | 'non_it';

export function matchesRequirementCategory(
  req: { title?: string | null; skills?: string[] | null; description?: string | null },
  value: RequirementCategoryFilterValue
): boolean {
  return value === 'all' || classifyRequirement(req) === value;
}

/** All / IT / Non-IT segmented filter with counts. */
export function RequirementCategoryFilter({
  value,
  onChange,
  requirements,
}: {
  value: RequirementCategoryFilterValue;
  onChange: (next: RequirementCategoryFilterValue) => void;
  requirements: Array<{ title?: string | null; skills?: string[] | null; description?: string | null }>;
}) {
  const itCount = requirements.filter((r) => classifyRequirement(r) === 'it').length;
  const options: Array<{ id: RequirementCategoryFilterValue; label: string; count: number }> = [
    { id: 'all', label: 'All types', count: requirements.length },
    { id: 'it', label: 'IT', count: itCount },
    { id: 'non_it', label: 'Non-IT', count: requirements.length - itCount },
  ];
  return (
    <div
      role="group"
      aria-label="Requirement type"
      className="inline-flex items-center rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`h-7 px-3 rounded-[6px] text-[12px] font-medium transition-colors ${
            value === o.id
              ? 'bg-[var(--primary-bg)] text-white'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {o.label} <span className="font-mono tabular-nums opacity-80">{o.count}</span>
        </button>
      ))}
    </div>
  );
}
