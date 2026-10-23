import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  Button,
  Input,
  Select,
  Textarea,
  SkillsChipInput,
  Badge,
} from '../ui/kit';
import { AiSuggestionBanner, Phase2ComingSoonCard } from './DomainBadges';
import {
  createRequirement,
  updateRequirement,
  upsertRequirementFinancials,
  upsertRequirementMargins,
  publishAndShareRequirementWithAllVendors,
} from '../../api/requirements';
import { suggestSkillsFromJd, improveJdWording } from '../../api/ai';
import {
  type BudgetMode,
  type BudgetUnit,
  BUDGET_UNIT_METADATA,
  encodeRequirementMetaToCurrency,
  formatBudgetDisplay,
  parseRequirementMeta,
  validateBudgetValues,
} from '../../lib/enterpriseLifecycle';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../ui/Toast';
import type {
  AppRole,
  Organization,
  Requirement,
  RequirementFinancials,
  RequirementMargins,
} from '../../types/db';

const requirementSchema = z
  .object({
    client_org_id: z.string().optional(),
    title: z.string().min(3, 'Title must be at least 3 characters'),
    description: z.string().min(20, 'Description must be at least 20 characters'),
    min_experience: z.coerce.number().min(0, 'Min experience must be >= 0'),
    max_experience: z.coerce.number().min(0, 'Max experience must be >= 0'),
    location: z.string().min(2, 'Location is required'),
    work_mode: z.enum(['onsite', 'hybrid', 'remote']),
    employment_type: z.enum(['full_time', 'contract', 'contract_to_hire', 'part_time']),
    openings: z.coerce.number().int().min(1, 'At least 1 opening required'),
    currency: z.string().min(1, 'Currency is required'),
    submission_sla_hours: z.coerce.number().int().min(1, 'SLA hours must be >= 1'),
    actual_client_budget: z.string().optional(),
    financial_notes: z.string().optional(),
    platform_margin: z.string().optional(),
    margin_type: z.enum(['fixed', 'percentage']).optional(),
  })
  .refine((data) => data.max_experience >= data.min_experience, {
    message: 'Max experience must be greater than or equal to min experience',
    path: ['max_experience'],
  });

type RequirementFormValues = z.infer<typeof requirementSchema>;

export const RequirementFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (req: Requirement) => void;
  role: AppRole;
  userOrgId: string | null;
  clientOrgs?: Organization[];
  defaultSlaHours?: number;
  initialRequirement?: Requirement | null;
  initialFinancials?: RequirementFinancials | null;
  initialMargins?: RequirementMargins | null;
}> = ({
  open,
  onClose,
  onSaved,
  role,
  userOrgId,
  clientOrgs = [],
  defaultSlaHours = 48,
  initialRequirement,
  initialFinancials,
  initialMargins,
}) => {
  const { toast } = useToast();
  const isEditing = Boolean(initialRequirement);
  const isHq = role === 'admin' || role === 'recruiter';
  const isAdmin = role === 'admin';

  const initialMeta = parseRequirementMeta(initialRequirement);

  const [skills, setSkills] = useState<string[]>(initialRequirement?.skills || []);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Update 1: Explicit Client Mapping state + Vendor Publication state
  const [isClientMapped, setIsClientMapped] = useState<boolean>(
    isHq ? (isEditing ? initialMeta.isClientMapped : true) : true
  );
  const [publishForVendors, setPublishForVendors] = useState<boolean>(true);
  const [clientMapError, setClientMapError] = useState<string | null>(null);

  // Update 2: Budget Range vs Fixed + LPA / LPM Unit state (never silently converts values)
  const [budgetMode, setBudgetMode] = useState<BudgetMode>(initialMeta.budgetMode || 'range');
  const [budgetUnit, setBudgetUnit] = useState<BudgetUnit>(initialMeta.budgetUnit || 'LPA');
  const [budgetMinInput, setBudgetMinInput] = useState<string>(
    initialMeta.budgetMin !== null && initialMeta.budgetMin !== undefined
      ? String(initialMeta.budgetMin)
      : '12'
  );
  const [budgetMaxInput, setBudgetMaxInput] = useState<string>(
    initialMeta.budgetMax !== null && initialMeta.budgetMax !== undefined
      ? String(initialMeta.budgetMax)
      : '15'
  );
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const [aiSkillSuggestions, setAiSkillSuggestions] = useState<string[]>([]);
  const [aiImprovedJd, setAiImprovedJd] = useState<string | null>(null);
  const [aiLabel, setAiLabel] = useState<string>('Suggestion: review before use');
  const [aiLoading, setAiLoading] = useState<'skills' | 'jd' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<RequirementFormValues>({
    resolver: zodResolver(requirementSchema) as never,
    defaultValues: {
      client_org_id:
        initialMeta.mappedClientOrgId ||
        initialRequirement?.client_org_id ||
        userOrgId ||
        clientOrgs[0]?.id ||
        '',
      title: initialRequirement?.title || '',
      description: initialRequirement?.description || '',
      min_experience: initialRequirement?.min_experience ?? 2,
      max_experience: initialRequirement?.max_experience ?? 6,
      location: initialRequirement?.location || '',
      work_mode: initialRequirement?.work_mode || 'hybrid',
      employment_type: initialRequirement?.employment_type || 'full_time',
      openings: initialRequirement?.openings ?? 1,
      currency: initialMeta.baseCurrency || 'INR',
      submission_sla_hours: initialRequirement?.submission_sla_hours ?? defaultSlaHours,
      actual_client_budget:
        initialFinancials?.actual_client_budget !== null &&
        initialFinancials?.actual_client_budget !== undefined
          ? String(initialFinancials.actual_client_budget)
          : '',
      financial_notes: initialFinancials?.notes || '',
      platform_margin:
        initialMargins?.platform_margin !== null &&
        initialMargins?.platform_margin !== undefined
          ? String(initialMargins.platform_margin)
          : '',
      margin_type: initialMargins?.margin_type || 'percentage',
    },
  });

  useEffect(() => {
    if (open) {
      const parsed = parseRequirementMeta(initialRequirement);
      setSkills(initialRequirement?.skills || []);
      setAiSkillSuggestions([]);
      setAiImprovedJd(null);
      setAiError(null);
      setClientMapError(null);
      setBudgetError(null);

      setIsClientMapped(isHq ? (initialRequirement ? parsed.isClientMapped : true) : true);
      setPublishForVendors(true);
      setBudgetMode(parsed.budgetMode || 'range');
      setBudgetUnit(parsed.budgetUnit || 'LPA');
      setBudgetMinInput(
        parsed.budgetMin !== null && parsed.budgetMin !== undefined
          ? String(parsed.budgetMin)
          : initialRequirement
            ? ''
            : '12'
      );
      setBudgetMaxInput(
        parsed.budgetMax !== null && parsed.budgetMax !== undefined
          ? String(parsed.budgetMax)
          : initialRequirement
            ? ''
            : '15'
      );

      reset({
        client_org_id:
          parsed.mappedClientOrgId ||
          initialRequirement?.client_org_id ||
          userOrgId ||
          clientOrgs[0]?.id ||
          '',
        title: initialRequirement?.title || '',
        description: initialRequirement?.description || '',
        min_experience: initialRequirement?.min_experience ?? 2,
        max_experience: initialRequirement?.max_experience ?? 6,
        location: initialRequirement?.location || '',
        work_mode: initialRequirement?.work_mode || 'hybrid',
        employment_type: initialRequirement?.employment_type || 'full_time',
        openings: initialRequirement?.openings ?? 1,
        currency: parsed.baseCurrency || 'INR',
        submission_sla_hours: initialRequirement?.submission_sla_hours ?? defaultSlaHours,
        actual_client_budget:
          initialFinancials?.actual_client_budget !== null &&
          initialFinancials?.actual_client_budget !== undefined
            ? String(initialFinancials.actual_client_budget)
            : '',
        financial_notes: initialFinancials?.notes || '',
        platform_margin:
          initialMargins?.platform_margin !== null &&
          initialMargins?.platform_margin !== undefined
            ? String(initialMargins.platform_margin)
            : '',
        margin_type: initialMargins?.margin_type || 'percentage',
      });
    }
  }, [
    open,
    initialRequirement,
    initialFinancials,
    initialMargins,
    userOrgId,
    clientOrgs,
    defaultSlaHours,
    isHq,
    reset,
  ]);

  const watchedTitle = watch('title');
  const watchedDesc = watch('description');
  const watchedCurrency = watch('currency') || 'INR';

  const parsedMinNum =
    budgetMinInput.trim() !== '' && !Number.isNaN(Number(budgetMinInput))
      ? Number(budgetMinInput)
      : null;
  const parsedMaxNum =
    budgetMode === 'fixed'
      ? parsedMinNum
      : budgetMaxInput.trim() !== '' && !Number.isNaN(Number(budgetMaxInput))
        ? Number(budgetMaxInput)
        : null;

  const liveBudgetPreview = formatBudgetDisplay({
    budgetMode,
    budgetUnit,
    budgetMin: parsedMinNum,
    budgetMax: parsedMaxNum,
    baseCurrency: watchedCurrency,
  });

  const handleSuggestSkills = async () => {
    setAiLoading('skills');
    setAiError(null);
    try {
      const res = await suggestSkillsFromJd({
        title: watchedTitle,
        description: watchedDesc,
      });
      setAiLabel(res.label);
      setAiSkillSuggestions(res.skills);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI assistant unavailable right now');
    } finally {
      setAiLoading(null);
    }
  };

  const handleImproveJd = async () => {
    setAiLoading('jd');
    setAiError(null);
    try {
      const res = await improveJdWording({
        title: watchedTitle,
        description: watchedDesc,
        skills,
      });
      setAiLabel(res.label);
      setAiImprovedJd(res.text);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI assistant unavailable right now');
    } finally {
      setAiLoading(null);
    }
  };

  const onSubmit = async (values: RequirementFormValues) => {
    if (skills.length === 0) {
      setSkillsError('Add at least one required skill.');
      return;
    }
    setSkillsError(null);

    // Validate Client Mapping (Update 1)
    const effectiveClientOrgId = (values.client_org_id || userOrgId || '').trim();
    if (isClientMapped && !effectiveClientOrgId) {
      setClientMapError('Select a client organization to map this requirement to.');
      return;
    }
    setClientMapError(null);

    // Validate LPA / LPM Budget (Update 2)
    const budgetCheck = validateBudgetValues({
      budgetMode,
      budgetUnit,
      budgetMin: parsedMinNum,
      budgetMax: parsedMaxNum,
    });
    if (!budgetCheck.valid) {
      setBudgetError(budgetCheck.error || 'Invalid budget range.');
      return;
    }
    setBudgetError(null);

    setSubmitting(true);

    try {
      // Determine database client_org_id (satisfies FK even when unmapped/internal)
      const dbClientOrgId =
        effectiveClientOrgId ||
        initialRequirement?.client_org_id ||
        clientOrgs[0]?.id ||
        userOrgId ||
        '';

      if (!dbClientOrgId) {
        throw new Error('At least one client organization is required in the workspace.');
      }

      const vendorVisibleNumeric =
        parsedMaxNum !== null ? parsedMaxNum : parsedMinNum !== null ? parsedMinNum : null;

      const encodedCurrency = encodeRequirementMetaToCurrency({
        baseCurrency: values.currency,
        budgetUnit,
        budgetMode,
        budgetMin: parsedMinNum,
        budgetMax: parsedMaxNum,
        isClientMapped,
        mappedClientOrgId: isClientMapped ? dbClientOrgId : null,
      });

      let savedReq: Requirement;
      if (isEditing && initialRequirement) {
        savedReq = await updateRequirement(initialRequirement.id, {
          title: values.title,
          description: values.description,
          skills,
          min_experience: values.min_experience,
          max_experience: values.max_experience,
          location: values.location,
          work_mode: values.work_mode,
          employment_type: values.employment_type,
          openings: values.openings,
          vendor_visible_budget: vendorVisibleNumeric,
          currency: encodedCurrency,
          submission_sla_hours: values.submission_sla_hours,
        });
      } else {
        savedReq = await createRequirement({
          client_org_id: dbClientOrgId,
          title: values.title,
          description: values.description,
          skills,
          min_experience: values.min_experience,
          max_experience: values.max_experience,
          location: values.location,
          work_mode: values.work_mode,
          employment_type: values.employment_type,
          openings: values.openings,
          vendor_visible_budget: vendorVisibleNumeric,
          currency: encodedCurrency,
          submission_sla_hours: values.submission_sla_hours,
        });
      }

      // When HQ creates/edits with vendor publishing enabled, automatically set status = 'open'
      // and share with all vendor organizations so vendor workspaces see it immediately.
      if (isHq && publishForVendors) {
        await publishAndShareRequirementWithAllVendors({
          requirementId: savedReq.id,
          slaHours: values.submission_sla_hours,
        });
        savedReq = { ...savedReq, status: 'open' };
      }

      if (values.actual_client_budget !== undefined || values.financial_notes !== undefined) {
        const clientBudgetNum =
          values.actual_client_budget && values.actual_client_budget.trim() !== ''
            ? Number(values.actual_client_budget)
            : null;
        await upsertRequirementFinancials({
          requirement_id: savedReq.id,
          actual_client_budget: clientBudgetNum,
          notes: values.financial_notes || null,
        });
      }

      if (isAdmin && values.platform_margin !== undefined && values.margin_type) {
        const marginNum =
          values.platform_margin && values.platform_margin.trim() !== ''
            ? Number(values.platform_margin)
            : null;
        await upsertRequirementMargins({
          requirement_id: savedReq.id,
          platform_margin: marginNum,
          margin_type: values.margin_type,
        });
      }

      toast({
        title: isEditing ? 'Requirement updated' : 'Requirement created',
        description: `${savedReq.title} (${isClientMapped ? 'Mapped to client' : 'Internal / Unmapped'}${
          isHq && publishForVendors ? ' · Published to vendors' : ''
        })`,
        tone: 'success',
      });
      onSaved(savedReq);
      onClose();
    } catch (err) {
      toast({
        title: 'Could not save requirement',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit requirement' : 'New requirement'}
      description="Job specification, explicit client mapping, LPA/LPM budget unit, and SLA governance."
      maxWidth="max-w-[660px]"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Update 1: Admin / HQ Explicit Client Mapping & Vendor Sourcing Section */}
        {isHq && (
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[12px] leading-[16px] font-semibold text-[var(--text-primary)] block">
                  Client visibility & vendor publication
                </span>
                <span className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
                  Unmapped requirements remain hidden from clients while allowing eligible vendor sourcing.
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge tone={isClientMapped ? 'emerald' : 'amber'}>
                  {isClientMapped ? 'Mapped to client' : 'Internal / Unmapped'}
                </Badge>
                <Badge tone={publishForVendors ? 'sky' : 'neutral'}>
                  {publishForVendors ? 'Shared with vendors' : 'Draft only'}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsClientMapped(true);
                  setClientMapError(null);
                }}
                className={`h-8 px-3 rounded-[6px] border text-[12px] leading-[16px] font-medium text-left transition-colors cursor-pointer ${
                  isClientMapped
                    ? 'border-[var(--accent)] bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                Explicitly map to client
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsClientMapped(false);
                  setClientMapError(null);
                }}
                className={`h-8 px-3 rounded-[6px] border text-[12px] leading-[16px] font-medium text-left transition-colors cursor-pointer ${
                  !isClientMapped
                    ? 'border-[var(--accent)] bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                Keep unmapped (internal / vendor only)
              </button>
            </div>

            {isClientMapped ? (
              <Select
                label="Mapped client organization"
                {...register('client_org_id')}
                error={clientMapError || errors.client_org_id?.message}
                options={[
                  { value: '', label: 'Select client organization...' },
                  ...clientOrgs.map((o) => ({ value: o.id, label: o.name })),
                ]}
              />
            ) : (
              <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
                This requirement will not appear in client lists, search, counts, exports, or direct client links until an Admin explicitly maps it to a client.
              </p>
            )}

            <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] leading-[16px] font-medium text-[var(--text-primary)]">
                  Publish as Open & share with vendor agencies immediately
                </div>
                <div className="text-[11px] leading-[14px] text-[var(--text-tertiary)]">
                  Makes this requirement visible in Vendor Shared Requirements with SLA countdown.
                </div>
              </div>
              <input
                type="checkbox"
                checked={publishForVendors}
                onChange={(e) => setPublishForVendors(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[#1F4CC4] cursor-pointer"
              />
            </div>
          </div>
        )}

        <Input
          label="Requirement title"
          placeholder="e.g. Senior Backend Engineer (Distributed Systems)"
          {...register('title')}
          error={errors.title?.message}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Description
            </label>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                loading={aiLoading === 'jd'}
                onClick={handleImproveJd}
              >
                Improve JD wording
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                loading={aiLoading === 'skills'}
                onClick={handleSuggestSkills}
              >
                Suggest skills
              </Button>
            </div>
          </div>

          <Textarea
            rows={5}
            placeholder="Responsibilities, technical environment, and required qualifications..."
            {...register('description')}
            error={errors.description?.message}
          />

          {aiError && (
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">{aiError}</p>
          )}

          {/* Inline Suggestion Block for JD */}
          {aiImprovedJd && (
            <div className="rounded-[6px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3 space-y-2">
              <AiSuggestionBanner
                label={aiLabel}
                onUse={() => {
                  setValue('description', aiImprovedJd, { shouldValidate: true });
                  setAiImprovedJd(null);
                }}
                onDismiss={() => setAiImprovedJd(null)}
              />
              <textarea
                rows={4}
                value={aiImprovedJd}
                onChange={(e) => setAiImprovedJd(e.target.value)}
                className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[13px] leading-[20px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)]"
              />
            </div>
          )}
        </div>

        {/* Skills Chip Input + Inline Skill Suggestions */}
        <div className="space-y-2">
          <SkillsChipInput
            label="Required skills"
            skills={skills}
            onChange={(next) => {
              setSkills(next);
              if (next.length > 0) setSkillsError(null);
            }}
            error={skillsError || undefined}
          />

          {aiSkillSuggestions.length > 0 && (
            <div className="rounded-[6px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3 space-y-2">
              <AiSuggestionBanner
                label={aiLabel}
                onUse={() => {
                  const merged = [...skills];
                  for (const s of aiSkillSuggestions) {
                    if (!merged.some((ex) => ex.toLowerCase() === s.toLowerCase())) {
                      merged.push(s);
                    }
                  }
                  setSkills(merged);
                  setAiSkillSuggestions([]);
                }}
                onDismiss={() => setAiSkillSuggestions([])}
              />
              <div className="flex flex-wrap gap-1.5">
                {aiSkillSuggestions.map((s) => {
                  const alreadyAdded = skills.some(
                    (existing) => existing.toLowerCase() === s.toLowerCase()
                  );
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => {
                        if (!alreadyAdded) setSkills([...skills, s]);
                      }}
                      className={`rounded-[6px] border px-2 py-0.5 text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                        alreadyAdded
                          ? 'border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-tertiary)] cursor-default'
                          : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      + {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Input
            label="Min exp (yrs)"
            type="number"
            step="0.5"
            {...register('min_experience')}
            error={errors.min_experience?.message}
          />
          <Input
            label="Max exp (yrs)"
            type="number"
            step="0.5"
            {...register('max_experience')}
            error={errors.max_experience?.message}
          />
          <Input
            label="Openings"
            type="number"
            {...register('openings')}
            error={errors.openings?.message}
          />
          <Input
            label="SLA (hours)"
            type="number"
            {...register('submission_sla_hours')}
            error={errors.submission_sla_hours?.message}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label="Location"
            placeholder="e.g. Bengaluru / Mumbai"
            {...register('location')}
            error={errors.location?.message}
          />
          <Select
            label="Work mode"
            {...register('work_mode')}
            error={errors.work_mode?.message}
            options={[
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'onsite', label: 'Onsite' },
              { value: 'remote', label: 'Remote' },
            ]}
          />
          <Select
            label="Employment type"
            {...register('employment_type')}
            error={errors.employment_type?.message}
            options={[
              { value: 'full_time', label: 'Full time' },
              { value: 'contract', label: 'Contract' },
              { value: 'contract_to_hire', label: 'Contract to hire' },
              { value: 'part_time', label: 'Part time' },
            ]}
          />
        </div>

        {/* Update 2: Budget Unit Selection (LPA — annual / LPM — monthly) & Financial Governance */}
        <div className="pt-3 border-t border-[var(--border)] space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Requirement budget & financial governance
            </h4>
            {/* Mode Toggle: Budget range vs Fixed budget */}
            <div className="inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-0.5">
              <button
                type="button"
                onClick={() => {
                  setBudgetMode('range');
                  setBudgetError(null);
                }}
                className={`px-2.5 py-1 rounded-[4px] text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                  budgetMode === 'range'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Budget range
              </button>
              <button
                type="button"
                onClick={() => {
                  setBudgetMode('fixed');
                  setBudgetError(null);
                }}
                className={`px-2.5 py-1 rounded-[4px] text-[12px] leading-[16px] font-medium transition-colors cursor-pointer ${
                  budgetMode === 'fixed'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Fixed budget
              </button>
            </div>
          </div>

          {/* Budget Unit Selector: LPA — annual vs LPM — monthly */}
          <div className="space-y-1.5">
            <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Budget unit
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {(['LPA', 'LPM'] as const).map((unitCode) => {
                const info = BUDGET_UNIT_METADATA[unitCode];
                const active = budgetUnit === unitCode;
                return (
                  <button
                    key={unitCode}
                    type="button"
                    onClick={() => {
                      // Do NOT silently convert numeric values when switching between LPA and LPM
                      setBudgetUnit(unitCode);
                      setBudgetError(null);
                    }}
                    className={`rounded-[6px] border px-3 py-2 text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                        : 'border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="text-[13px] leading-[18px] font-medium text-[var(--text-primary)]">
                      {info.selectorLabel}
                    </div>
                    <div className="text-[11px] leading-[16px] text-[var(--text-tertiary)]">
                      {info.fullLabel}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Minimum / Maximum Budget + Preview Only */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
            {budgetMode === 'range' ? (
              <>
                <Input
                  label={`Minimum budget (${budgetUnit})`}
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={budgetUnit === 'LPA' ? 'e.g. 12' : 'e.g. 1.2'}
                  value={budgetMinInput}
                  onChange={(e) => {
                    setBudgetMinInput(e.target.value);
                    setBudgetError(null);
                  }}
                />
                <Input
                  label={`Maximum budget (${budgetUnit})`}
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={budgetUnit === 'LPA' ? 'e.g. 15' : 'e.g. 1.8'}
                  value={budgetMaxInput}
                  onChange={(e) => {
                    setBudgetMaxInput(e.target.value);
                    setBudgetError(null);
                  }}
                />
              </>
            ) : (
              <div className="sm:col-span-2">
                <Input
                  label={`Fixed budget (${budgetUnit})`}
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={budgetUnit === 'LPA' ? 'e.g. 14' : 'e.g. 1.5'}
                  value={budgetMinInput}
                  onChange={(e) => {
                    setBudgetMinInput(e.target.value);
                    setBudgetMaxInput(e.target.value);
                    setBudgetError(null);
                  }}
                />
              </div>
            )}

            {/* Preview only card */}
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
              <div className="text-[11px] leading-[14px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
                Preview only
              </div>
              <div className="mt-1 font-mono tabular-nums text-[15px] leading-[20px] font-semibold text-[var(--text-primary)]">
                {liveBudgetPreview.formatted}
              </div>
              <div className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
                {liveBudgetPreview.subtitle || BUDGET_UNIT_METADATA[budgetUnit].fullLabel}
              </div>
            </div>
          </div>

          {budgetError && (
            <p className="text-[12px] leading-[16px] text-[var(--status-danger)]">{budgetError}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <Input
              label={`Internal client budget (${budgetUnit})`}
              type="number"
              step="0.1"
              placeholder="Private (Client + HQ)"
              {...register('actual_client_budget')}
            />
            <Input
              label="Internal financial notes"
              placeholder="Billing terms, rate card notes..."
              {...register('financial_notes')}
            />
          </div>

          {isAdmin && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Platform margin (admin)"
                type="number"
                step="0.01"
                placeholder="e.g. 12"
                {...register('platform_margin')}
              />
              <Select
                label="Margin type (admin)"
                {...register('margin_type')}
                options={[
                  { value: 'percentage', label: 'Percentage (%)' },
                  { value: 'fixed', label: `Fixed amount (${budgetUnit})` },
                ]}
              />
            </div>
          )}
        </div>

        <Phase2ComingSoonCard
          title="JD document ingestion"
          description="Direct PDF/DOCX JD upload is scheduled for Phase 2."
        />

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEditing ? 'Save changes' : 'Create requirement'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
