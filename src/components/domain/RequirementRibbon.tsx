import { classifyRequirement, REQUIREMENT_CATEGORY_LABEL } from '../../lib/requirementCategory';

type Props = {
  requirement: { title?: string | null; skills?: string[] | null; description?: string | null };
  className?: string;
};

/** Small ribbon tag shown above a requirement title: "IT" or "Non-IT". */
export function RequirementRibbon({ requirement, className = '' }: Props) {
  const category = classifyRequirement(requirement);
  const isIt = category === 'it';
  return (
    <span
      title={isIt ? 'IT requirement' : 'Non-IT requirement'}
      className={`inline-flex items-center h-[18px] pl-2 pr-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white ${className}`}
      style={{
        background: isIt
          ? 'linear-gradient(90deg, #4F46E5, #7C3AED)'
          : 'linear-gradient(90deg, #D97706, #F59E0B)',
        // ribbon notch on the right edge
        clipPath: 'polygon(0 0, 100% 0, calc(100% - 6px) 50%, 100% 100%, 0 100%)',
        borderRadius: '3px 0 0 3px',
      }}
    >
      {REQUIREMENT_CATEGORY_LABEL[category]}
    </span>
  );
}
