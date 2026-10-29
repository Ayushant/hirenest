import React, { useState, useEffect, useRef } from 'react';
import { z } from 'zod';
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
  EmploymentType,
  MarginType,
  Organization,
  Requirement,
  RequirementFinancials,
  RequirementMargins,
  WorkMode,
} from '../../types/db';

const EMPTY_CLIENT_ORGS: Organization[] = [];

const requirementSchema = z
  .object({
    client_org_id: z.string().optional(),
    title: z.string().trim().min(3, 'Title must be at least 3 characters'),
    description: z.string().trim().min(20, 'Description must be at least 20 characters'),
    min_experience: z.coerce.number().min(0, 'Min experience must be >= 0'),
    max_experience: z.coerce.number().min(0, 'Max experience must be >= 0'),
    location: z.string().trim().min(2, 'Location is required'),
    work_mode: z.enum(['onsite', 'hybrid', 'remote']),
    employment_type: z.enum(['full_time', 'contract', 'contract_to_hire', 'part_time']),
    openings: z.coerce.number().int().min(1, 'At least 1 opening required'),
    currency: z.string().min(1, 'Currency is required'),
    submission_sla_hours: z.coerce.number().int().min(1, 'SLA hours must be >= 1'),
  })
  .refine((data) => data.max_experience >= data.min_experience, {
    message: 'Max experience must be greater than or equal to min experience',
    path: ['max_experience'],
  });

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
  clientOrgs = EMPTY_CLIENT_ORGS,
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

  // Controlled state for all requirement fields (ensuring every input/textarea/select accepts typing reliably)
  const [clientOrgId, setClientOrgId] = useState<string>(
    initialMeta.mappedClientOrgId ||
      initialRequirement?.client_org_id ||
      userOrgId ||
      clientOrgs[0]?.id ||
      ''
  );
  const [title, setTitle] = useState<string>(initialRequirement?.title || '');
  const [description, setDescription] = useState<string>(initialRequirement?.description || '');
  const [minExpInput, setMinExpInput] = useState<string>(
    String(initialRequirement?.min_experience ?? 2)
  );
  const [maxExpInput, setMaxExpInput] = useState<string>(
    String(initialRequirement?.max_experience ?? 6)
  );
  const [openingsInput, setOpeningsInput] = useState<string>(
    String(initialRequirement?.openings ?? 1)
  );
  const [slaHoursInput, setSlaHoursInput] = useState<string>(
    String(initialRequirement?.submission_sla_hours ?? defaultSlaHours)
  );
  const [location, setLocation] = useState<string>(initialRequirement?.location || '');
  const [workMode, setWorkMode] = useState<WorkMode>(initialRequirement?.work_mode || 'hybrid');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    initialRequirement?.employment_type || 'full_time'
  );
  const [currency, setCurrency] = useState<string>(initialMeta.baseCurrency || 'INR');

  const [fieldErrors, setFieldErrors] = useState< Partial<Record<string, string>> >({});

  const [skills, setSkills] = useState<string[]>(initialRequirement?.skills || []);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Explicit Client Mapping state + Vendor Publication state
  const [isClientMapped, setIsClientMapped] = useState<boolean>(
    isHq ? (isEditing ? initialMeta.isClientMapped : true) : true
  );
  const [publishForVendors, setPublishForVendors] = useState<boolean>(true);
  const [clientMapError, setClientMapError] = useState<string | null>(null);

  // Budget Range vs Fixed + LPA / LPM Unit state
  const [budgetMode, setBudgetMode] = useState<BudgetMode>(
    isEditing ? initialMeta.budgetMode || 'range' : 'range'
  );
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

  // Controlled state for Internal Client Budget, Internal Financial Notes & Platform Margin
  const [actualClientBudgetInput, setActualClientBudgetInput] = useState<string>(
    initialFinancials?.actual_client_budget !== null &&
      initialFinancials?.actual_client_budget !== undefined
      ? String(initialFinancials.actual_client_budget)
      : ''
  );
  const [financialNotesInput, setFinancialNotesInput] = useState<string>(
    initialFinancials?.notes || ''
  );
  const [platformMarginInput, setPlatformMarginInput] = useState<string>(
    initialMargins?.platform_margin !== null && initialMargins?.platform_margin !== undefined
      ? String(initialMargins.platform_margin)
      : ''
  );
  const [marginTypeInput, setMarginTypeInput] = useState<MarginType>(
    initialMargins?.margin_type || 'percentage'
  );

  // Prevent re-initializing the form while the user is actively typing/clicking inside the open modal
  const initializedSessionRef = useRef<string | null>(null);
  const financialsTouchedRef = useRef<boolean>(false);
  const marginsTouchedRef = useRef<boolean>(false);
  const savedRequirementRef = useRef<Requirement | null>(null);

  const [aiSkillSuggestions, setAiSkillSuggestions] = useState<string[]>([]);
  const [aiImprovedJd, setAiImprovedJd] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<{
    label: string;
    source: 'provider' | 'template';
    reason: string | null;
  }>({ label: 'Suggestion: review before use', source: 'provider', reason: null });
  const [aiLoading, setAiLoading] = useState<'skills' | 'jd' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Initialize form ONCE per modal open / target requirement change
  useEffect(() => {
    if (!open) {
      initializedSessionRef.current = null;
      financialsTouchedRef.current = false;
      marginsTouchedRef.current = false;
      savedRequirementRef.current = null;
      return;
    }

    const sessionKey = initialRequirement?.id ? `edit:${initialRequirement.id}` : 'create';
    if (initializedSessionRef.current === sessionKey) {
      return;
    }
    initializedSessionRef.current = sessionKey;
    financialsTouchedRef.current = false;
    marginsTouchedRef.current = false;
    savedRequirementRef.current = null;

    const parsed = parseRequirementMeta(initialRequirement);
    setClientOrgId(
      parsed.mappedClientOrgId ||
        initialRequirement?.client_org_id ||
        userOrgId ||
        clientOrgs[0]?.id ||
        ''
    );
    setTitle(initialRequirement?.title || '');
    setDescription(initialRequirement?.description || '');
    setMinExpInput(String(initialRequirement?.min_experience ?? 2));
    setMaxExpInput(String(initialRequirement?.max_experience ?? 6));
    setOpeningsInput(String(initialRequirement?.openings ?? 1));
    setSlaHoursInput(String(initialRequirement?.submission_sla_hours ?? defaultSlaHours));
    setLocation(initialRequirement?.location || '');
    setWorkMode(initialRequirement?.work_mode || 'hybrid');
    setEmploymentType(initialRequirement?.employment_type || 'full_time');
    setCurrency(parsed.baseCurrency || 'INR');
    setFieldErrors({});

    setSkills(initialRequirement?.skills || []);
    setSkillsError(null);
    setAiSkillSuggestions([]);
    setAiImprovedJd(null);
    setAiError(null);
    setClientMapError(null);
    setBudgetError(null);

    setIsClientMapped(isHq ? (initialRequirement ? parsed.isClientMapped : true) : true);
    setPublishForVendors(true);
    setBudgetMode(initialRequirement ? parsed.budgetMode || 'range' : 'range');
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

    setActualClientBudgetInput(
      initialFinancials?.actual_client_budget !== null &&
        initialFinancials?.actual_client_budget !== undefined
        ? String(initialFinancials.actual_client_budget)
        : ''
    );
    setFinancialNotesInput(initialFinancials?.notes || '');
    setPlatformMarginInput(
      initialMargins?.platform_margin !== null && initialMargins?.platform_margin !== undefined
        ? String(initialMargins.platform_margin)
        : ''
    );
    setMarginTypeInput(initialMargins?.margin_type || 'percentage');
  }, [
    open,
    initialRequirement,
    initialFinancials,
    initialMargins,
    userOrgId,
    clientOrgs,
    defaultSlaHours,
    isHq,
  ]);

  // If clientOrgs loads asynchronously while modal is open and clientOrgId is still empty, default to first org
  useEffect(() => {
    if (open && !clientOrgId && clientOrgs.length > 0) {
      setClientOrgId(clientOrgs[0].id);
    }
  }, [open, clientOrgId, clientOrgs]);

  // If editing an existing requirement and initialFinancials finishes loading asynchronously,
  // populate financial fields without resetting the user's other form inputs.
  useEffect(() => {
    if (open && initialRequirement && initialFinancials && !financialsTouchedRef.current) {
      if (
        initialFinancials.actual_client_budget !== null &&
        initialFinancials.actual_client_budget !== undefined
      ) {
        setActualClientBudgetInput(String(initialFinancials.actual_client_budget));
      }
      if (initialFinancials.notes) {
        setFinancialNotesInput(initialFinancials.notes);
      }
    }
  }, [open, initialRequirement, initialFinancials]);

  useEffect(() => {
    if (open && initialRequirement && initialMargins && !marginsTouchedRef.current) {
      if (
        initialMargins.platform_margin !== null &&
        initialMargins.platform_margin !== undefined
      ) {
        setPlatformMarginInput(String(initialMargins.platform_margin));
      }
      if (initialMargins.margin_type) {
        setMarginTypeInput(initialMargins.margin_type);
      }
    }
  }, [open, initialRequirement, initialMargins]);

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
    baseCurrency: currency || 'INR',
  });

  const parsedInternalBudgetNum =
    actualClientBudgetInput.trim() !== '' && !Number.isNaN(Number(actualClientBudgetInput))
      ? Number(actualClientBudgetInput)
      : null;

  const handleSuggestSkills = async () => {
    setAiLoading('skills');
    setAiError(null);
    try {
      const res = await suggestSkillsFromJd({
        title,
        description,
      });
      setAiMeta({ label: res.label, source: res.source, reason: res.reason });
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
        title,
        description,
        skills,
      });
      setAiMeta({ label: res.label, source: res.source, reason: res.reason });
      setAiImprovedJd(res.text);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI assistant unavailable right now');
    } finally {
      setAiLoading(null);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = requirementSchema.safeParse({
      client_org_id: clientOrgId,
      title,
      description,
      min_experience: minExpInput,
      max_experience: maxExpInput,
      location,
      work_mode: workMode,
      employment_type: employmentType,
      openings: openingsInput,
      currency: currency || 'INR',
      submission_sla_hours: slaHoursInput,
    });

    if (!validation.success) {
      const nextErrors: Partial<Record<string, string>> = {};
      for (const issue of validation.error.issues) {
        const key = String(issue.path[0] || '');
        if (key && !nextErrors[key]) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});

    const values = validation.data;

    if (skills.length === 0) {
      setSkillsError('Add at least one required skill.');
      return;
    }
    setSkillsError(null);

    // Validate Client Mapping
    const effectiveClientOrgId = (values.client_org_id || userOrgId || '').trim();
    if (isClientMapped && !effectiveClientOrgId) {
      setClientMapError('Select a client organization to map this requirement to.');
      return;
    }
    setClientMapError(null);

    // Validate LPA / LPM Budget
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
    if (parsedInternalBudgetNum !== null && parsedInternalBudgetNum < 0) {
      setBudgetError('Internal client budget must be a positive number.');
      return;
    }
    setBudgetError(null);

    setSubmitting(true);

    try {
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

      let savedReq: Requirement & { wasDuplicatePrevented?: boolean };
      const existingTargetId = initialRequirement?.id || savedRequirementRef.current?.id;
      if (existingTargetId) {
        savedReq = await updateRequirement(existingTargetId, {
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
      savedRequirementRef.current = savedReq;

      if (isHq && publishForVendors) {
        await publishAndShareRequirementWithAllVendors({
          requirementId: savedReq.id,
          slaHours: values.submission_sla_hours,
        });
        savedReq = { ...savedReq, status: 'open' };
      }

      await upsertRequirementFinancials({
        requirement_id: savedReq.id,
        actual_client_budget: parsedInternalBudgetNum,
        notes: financialNotesInput.trim() || null,
      });

      if (isAdmin) {
        const marginNum =
          platformMarginInput.trim() !== '' && !Number.isNaN(Number(platformMarginInput))
            ? Number(platformMarginInput)
            : null;
        await upsertRequirementMargins({
          requirement_id: savedReq.id,
          platform_margin: marginNum,
          margin_type: marginTypeInput,
        });
      }

      toast({
        title: isEditing
          ? 'Requirement updated'
          : savedReq.wasDuplicatePrevented
            ? 'Duplicate prevented — existing requirement retained'
            : 'Requirement created',
        description: savedReq.wasDuplicatePrevented
          ? `An identical active requirement (${savedReq.title}) already exists for this client and location. Linked to canonical ID ${savedReq.id.slice(0, 8).toUpperCase()}.`
          : `${savedReq.title} · ${liveBudgetPreview.formatted}${
              parsedInternalBudgetNum !== null
                ? ` (Internal: ₹${parsedInternalBudgetNum} ${budgetUnit})`
                : ''
            }`,
        tone: savedReq.wasDuplicatePrevented ? 'info' : 'success',
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
      <form onSubmit={handleFormSubmit} className="space-y-4">
        {/* Admin / HQ Explicit Client Mapping & Vendor Sourcing Section */}
        {isHq && (
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[12px] leading-[16px] font-semibold text-[var(--text-primary)] block">
                  Client visibility &amp; vendor publication
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
                value={clientOrgId}
                onChange={(e) => {
                  setClientOrgId(e.target.value);
                  setClientMapError(null);
                }}
                error={clientMapError || fieldErrors.client_org_id}
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
                  Publish as Open &amp; share with vendor agencies immediately
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
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (fieldErrors.title) {
              setFieldErrors((prev) => ({ ...prev, title: undefined }));
            }
          }}
          error={fieldErrors.title}
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
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (fieldErrors.description) {
                setFieldErrors((prev) => ({ ...prev, description: undefined }));
              }
            }}
            error={fieldErrors.description}
          />

          {aiError && (
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">{aiError}</p>
          )}

          {/* Inline Suggestion Block for JD */}
          {aiImprovedJd && (
            <div className="rounded-[6px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3 space-y-2">
              <AiSuggestionBanner
                label={aiMeta.label}
                source={aiMeta.source}
                reason={aiMeta.reason}
                onUse={() => {
                  setDescription(aiImprovedJd);
                  setFieldErrors((prev) => ({ ...prev, description: undefined }));
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
                label={aiMeta.label}
                source={aiMeta.source}
                reason={aiMeta.reason}
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
            value={minExpInput}
            onChange={(e) => {
              setMinExpInput(e.target.value);
              if (fieldErrors.min_experience) {
                setFieldErrors((prev) => ({ ...prev, min_experience: undefined }));
              }
            }}
            error={fieldErrors.min_experience}
          />
          <Input
            label="Max exp (yrs)"
            type="number"
            step="0.5"
            value={maxExpInput}
            onChange={(e) => {
              setMaxExpInput(e.target.value);
              if (fieldErrors.max_experience) {
                setFieldErrors((prev) => ({ ...prev, max_experience: undefined }));
              }
            }}
            error={fieldErrors.max_experience}
          />
          <Input
            label="Openings"
            type="number"
            value={openingsInput}
            onChange={(e) => {
              setOpeningsInput(e.target.value);
              if (fieldErrors.openings) {
                setFieldErrors((prev) => ({ ...prev, openings: undefined }));
              }
            }}
            error={fieldErrors.openings}
          />
          <Input
            label="SLA (hours)"
            type="number"
            value={slaHoursInput}
            onChange={(e) => {
              setSlaHoursInput(e.target.value);
              if (fieldErrors.submission_sla_hours) {
                setFieldErrors((prev) => ({ ...prev, submission_sla_hours: undefined }));
              }
            }}
            error={fieldErrors.submission_sla_hours}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label="Location"
            placeholder="e.g. Bengaluru / Mumbai"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              if (fieldErrors.location) {
                setFieldErrors((prev) => ({ ...prev, location: undefined }));
              }
            }}
            error={fieldErrors.location}
          />
          <Select
            label="Work mode"
            value={workMode}
            onChange={(e) => setWorkMode(e.target.value as WorkMode)}
            error={fieldErrors.work_mode}
            options={[
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'onsite', label: 'Onsite' },
              { value: 'remote', label: 'Remote' },
            ]}
          />
          <Select
            label="Employment type"
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
            error={fieldErrors.employment_type}
            options={[
              { value: 'full_time', label: 'Full time' },
              { value: 'contract', label: 'Contract' },
              { value: 'contract_to_hire', label: 'Contract to hire' },
              { value: 'part_time', label: 'Part time' },
            ]}
          />
        </div>

        {/* Budget Unit Selection (LPA — annual / LPM — monthly) & Financial Governance */}
        <div className="pt-3 border-t border-[var(--border)] space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Requirement budget &amp; financial governance
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
              min="0"
              placeholder={budgetUnit === 'LPA' ? 'Private (e.g. 16)' : 'Private (e.g. 1.8)'}
              value={actualClientBudgetInput}
              onChange={(e) => {
                financialsTouchedRef.current = true;
                setActualClientBudgetInput(e.target.value);
                setBudgetError(null);
              }}
              hint={
                parsedInternalBudgetNum !== null
                  ? `Internal cap: ₹${parsedInternalBudgetNum} ${budgetUnit} (${BUDGET_UNIT_METADATA[budgetUnit].fullLabel}) · Private to Client & HQ`
                  : 'Private ceiling visible only to Client & HireNest HQ (never shared with vendors)'
              }
            />
            <Input
              label="Internal financial notes"
              placeholder="Billing terms, rate card notes..."
              value={financialNotesInput}
              onChange={(e) => {
                financialsTouchedRef.current = true;
                setFinancialNotesInput(e.target.value);
              }}
              hint={
                financialNotesInput.trim()
                  ? 'Saved to private requirement financials (Client & HQ only)'
                  : 'Optional commercial terms, PO reference, or billing notes'
              }
            />
          </div>

          {isAdmin && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Platform margin (admin)"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 12"
                value={platformMarginInput}
                onChange={(e) => {
                  marginsTouchedRef.current = true;
                  setPlatformMarginInput(e.target.value);
                }}
              />
              <Select
                label="Margin type (admin)"
                value={marginTypeInput}
                onChange={(e) => {
                  marginsTouchedRef.current = true;
                  setMarginTypeInput(e.target.value as MarginType);
                }}
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
