import { classifyRequirement, REQUIREMENT_CATEGORY_LABEL } from '../../lib/requirementCategory';

type Props = {
  requirement: {
    id?: string;
    title?: string | null;
    skills?: string[] | null;
    description?: string | null;
    currency?: string | null;
  };
  className?: string;
};

function profileTypeOf(requirement: Props['requirement']): 'bench' | 'market' | null {
  const m = /\|pt=(bench|market)(?:\||$)/.exec(String(requirement.currency || ''));
  return m ? (m[1] as 'bench' | 'market') : null;
}

/**
 * Ribbon tags shown above a requirement title: "IT" / "Non-IT", plus "Bench profile" /
 * "Market profile" when the requirement specifies one.
 */
export function RequirementRibbon({ requirement, className = '' }: Props) {
  const category = classifyRequirement(requirement);
  const isIt = category === 'it';
  const profile = profileTypeOf(requirement);
  const base =
    'inline-flex items-center h-[18px] pl-2 pr-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white';
  const shape = {
    // ribbon notch on the right edge
    clipPath: 'polygon(0 0, 100% 0, calc(100% - 6px) 50%, 100% 100%, 0 100%)',
    borderRadius: '3px 0 0 3px',
  } as const;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
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
      {profile && (
        <span
          title={profile === 'bench' ? 'Bench profile requirement' : 'Market profile requirement'}
          className={base}
          style={{
            ...shape,
            background:
              profile === 'bench'
                ? 'linear-gradient(90deg, #047857, #10B981)'
                : 'linear-gradient(90deg, #6D28D9, #8B5CF6)',
          }}
        >
          {profile === 'bench' ? 'Bench profile' : 'Market profile'}
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
