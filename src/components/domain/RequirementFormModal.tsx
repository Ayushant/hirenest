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
} from '../ui/kit';
import { AiSuggestionBanner, Phase2ComingSoonCard } from './DomainBadges';
import {
  createRequirement,
  updateRequirement,
  upsertRequirementFinancials,
  upsertRequirementMargins,
} from '../../api/requirements';
import { suggestSkillsFromJd, improveJdWording } from '../../api/ai';
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
    client_org_id: z.string().min(1, 'Client organization is required'),
    title: z.string().min(3, 'Title must be at least 3 characters'),
    description: z.string().min(20, 'Description must be at least 20 characters'),
    min_experience: z.coerce.number().min(0, 'Min experience must be >= 0'),
    max_experience: z.coerce.number().min(0, 'Max experience must be >= 0'),
    location: z.string().min(2, 'Location is required'),
    work_mode: z.enum(['onsite', 'hybrid', 'remote']),
    employment_type: z.enum(['full_time', 'contract', 'contract_to_hire', 'part_time']),
    openings: z.coerce.number().int().min(1, 'At least 1 opening required'),
    vendor_visible_budget: z.string().optional(),
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

  const [skills, setSkills] = useState<string[]>(initialRequirement?.skills || []);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      client_org_id: initialRequirement?.client_org_id || userOrgId || '',
      title: initialRequirement?.title || '',
      description: initialRequirement?.description || '',
      min_experience: initialRequirement?.min_experience ?? 2,
      max_experience: initialRequirement?.max_experience ?? 6,
      location: initialRequirement?.location || '',
      work_mode: initialRequirement?.work_mode || 'hybrid',
      employment_type: initialRequirement?.employment_type || 'full_time',
      openings: initialRequirement?.openings ?? 1,
      vendor_visible_budget:
        initialRequirement?.vendor_visible_budget !== null &&
        initialRequirement?.vendor_visible_budget !== undefined
          ? String(initialRequirement.vendor_visible_budget)
          : '',
      currency: initialRequirement?.currency || 'INR',
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
      setSkills(initialRequirement?.skills || []);
      setAiSkillSuggestions([]);
      setAiImprovedJd(null);
      setAiError(null);
      reset({
        client_org_id: initialRequirement?.client_org_id || userOrgId || '',
        title: initialRequirement?.title || '',
        description: initialRequirement?.description || '',
        min_experience: initialRequirement?.min_experience ?? 2,
        max_experience: initialRequirement?.max_experience ?? 6,
        location: initialRequirement?.location || '',
        work_mode: initialRequirement?.work_mode || 'hybrid',
        employment_type: initialRequirement?.employment_type || 'full_time',
        openings: initialRequirement?.openings ?? 1,
        vendor_visible_budget:
          initialRequirement?.vendor_visible_budget !== null &&
          initialRequirement?.vendor_visible_budget !== undefined
            ? String(initialRequirement.vendor_visible_budget)
            : '',
        currency: initialRequirement?.currency || 'INR',
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
  }, [open, initialRequirement, initialFinancials, initialMargins, userOrgId, defaultSlaHours, reset]);

  const watchedTitle = watch('title');
  const watchedDesc = watch('description');

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
    setSubmitting(true);

    try {
      const vendorBudget =
        values.vendor_visible_budget && values.vendor_visible_budget.trim() !== ''
          ? Number(values.vendor_visible_budget)
          : null;

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
          vendor_visible_budget: vendorBudget,
          currency: values.currency,
          submission_sla_hours: values.submission_sla_hours,
        });
      } else {
        savedReq = await createRequirement({
          client_org_id: values.client_org_id,
          title: values.title,
          description: values.description,
          skills,
          min_experience: values.min_experience,
          max_experience: values.max_experience,
          location: values.location,
          work_mode: values.work_mode,
          employment_type: values.employment_type,
          openings: values.openings,
          vendor_visible_budget: vendorBudget,
          currency: values.currency,
          submission_sla_hours: values.submission_sla_hours,
        });
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
        description: savedReq.title,
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
      description="Job specification, skills, SLA hours, and budget visibility."
      maxWidth="max-w-[640px]"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {isHq && !isEditing && (
          <Select
            label="Client organization"
            {...register('client_org_id')}
            error={errors.client_org_id?.message}
            options={[
              { value: '', label: 'Select client organization...' },
              ...clientOrgs.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
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

        {/* Budgets & Financials */}
        <div className="pt-3 border-t border-[var(--border)] space-y-3">
          <h4 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
            Budget & financial governance
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Currency"
              placeholder="INR / USD"
              {...register('currency')}
              error={errors.currency?.message}
            />
            <Input
              label="Vendor-visible budget"
              type="number"
              placeholder="Shared with vendors"
              {...register('vendor_visible_budget')}
            />
            <Input
              label="Internal client budget"
              type="number"
              placeholder="Private (Client + HQ)"
              {...register('actual_client_budget')}
            />
          </div>
          <Input
            label="Internal financial notes"
            placeholder="Billing terms, rate card notes..."
            {...register('financial_notes')}
          />

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
                  { value: 'fixed', label: 'Fixed amount' },
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
