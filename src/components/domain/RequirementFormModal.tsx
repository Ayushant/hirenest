import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Sparkles } from 'lucide-react';
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

  // AI Suggestion states (Advisory only: user reviews & clicks to apply)
  const [aiSkillSuggestions, setAiSkillSuggestions] = useState<string[]>([]);
  const [aiImprovedJd, setAiImprovedJd] = useState<string | null>(null);
  const [aiLabel, setAiLabel] = useState<string>('AI suggestion: review before use');
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

      // Save requirement_financials (client_manager own org / HQ)
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

      // Save requirement_margins (admin only)
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
      title={isEditing ? 'Edit Requirement' : 'Create Requirement'}
      description="Define job specification, skills, SLA hours, and governed budget visibility."
      maxWidth="max-w-3xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {isHq && !isEditing && (
          <Select
            label="Client Organization"
            {...register('client_org_id')}
            error={errors.client_org_id?.message}
            options={[
              { value: '', label: 'Select client organization...' },
              ...clientOrgs.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        )}

        <Input
          label="Requirement Title"
          placeholder="e.g. Senior Backend Engineer (Distributed Systems)"
          {...register('title')}
          error={errors.title?.message}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Requirement Description (Plain Text)
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={aiLoading === 'jd'}
                onClick={handleImproveJd}
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                Improve JD wording
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={aiLoading === 'skills'}
                onClick={handleSuggestSkills}
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                Suggest skills
              </Button>
            </div>
          </div>

          <Textarea
            rows={5}
            placeholder="Describe responsibilities, technical environment, and must-have qualifications..."
            {...register('description')}
            error={errors.description?.message}
          />

          {aiError && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{aiError}</p>
          )}

          {/* AI Improved JD Suggestion Box */}
          {aiImprovedJd && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-slate-50 dark:bg-slate-950 p-3 space-y-2">
              <AiSuggestionBanner
                label={aiLabel}
                onDismiss={() => setAiImprovedJd(null)}
              />
              <textarea
                rows={5}
                value={aiImprovedJd}
                onChange={(e) => setAiImprovedJd(e.target.value)}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-800 dark:text-slate-200"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAiImprovedJd(null)}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setValue('description', aiImprovedJd, { shouldValidate: true });
                    setAiImprovedJd(null);
                  }}
                >
                  Use Suggested Description
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Skills Chip Input + AI Skill Suggestions */}
        <div className="space-y-2">
          <SkillsChipInput
            label="Required Skills"
            skills={skills}
            onChange={(next) => {
              setSkills(next);
              if (next.length > 0) setSkillsError(null);
            }}
            error={skillsError || undefined}
          />

          {aiSkillSuggestions.length > 0 && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-slate-50 dark:bg-slate-950 p-3 space-y-2">
              <AiSuggestionBanner
                label={aiLabel}
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
                      className={`rounded border px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                        alreadyAdded
                          ? 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-default'
                          : 'border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50'
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

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input
            label="Min Experience (Yrs)"
            type="number"
            step="0.5"
            {...register('min_experience')}
            error={errors.min_experience?.message}
          />
          <Input
            label="Max Experience (Yrs)"
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
            label="SLA Hours"
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
            label="Work Mode"
            {...register('work_mode')}
            error={errors.work_mode?.message}
            options={[
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'onsite', label: 'Onsite' },
              { value: 'remote', label: 'Remote' },
            ]}
          />
          <Select
            label="Employment Type"
            {...register('employment_type')}
            error={errors.employment_type?.message}
            options={[
              { value: 'full_time', label: 'Full Time' },
              { value: 'contract', label: 'Contract' },
              { value: 'contract_to_hire', label: 'Contract to Hire' },
              { value: 'part_time', label: 'Part Time' },
            ]}
          />
        </div>

        {/* Budgets & Financials */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/40">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Budget & Financial Governance
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Currency"
              placeholder="INR / USD"
              {...register('currency')}
              error={errors.currency?.message}
            />
            <Input
              label="Vendor-Visible Budget"
              type="number"
              placeholder="Shared with approved vendors"
              {...register('vendor_visible_budget')}
            />
            <Input
              label="Internal Client Budget (Private)"
              type="number"
              placeholder="Never shared with vendors"
              hint="Stored in requirement_financials (Client + HQ only)"
              {...register('actual_client_budget')}
            />
          </div>
          <Input
            label="Internal Financial Notes (Client + HQ only)"
            placeholder="Billing terms, rate card notes..."
            {...register('financial_notes')}
          />

          {isAdmin && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Platform Margin (Admin Only)"
                type="number"
                step="0.01"
                placeholder="e.g. 12"
                {...register('platform_margin')}
              />
              <Select
                label="Margin Type (Admin Only)"
                {...register('margin_type')}
                options={[
                  { value: 'percentage', label: 'Percentage (%)' },
                  { value: 'fixed', label: 'Fixed Amount' },
                ]}
              />
            </div>
          )}
        </div>

        <Phase2ComingSoonCard
          title="Automated JD Document Parsing"
          description="Direct PDF/DOCX JD ingestion is planned for Phase 2 via local Ollama."
        />

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEditing ? 'Save Changes' : 'Create Requirement'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
