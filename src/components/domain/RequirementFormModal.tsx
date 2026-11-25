import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, X, Plus, ChevronDown, Check } from 'lucide-react';
import { classifyRequirement } from '../../lib/requirementCategory';
import { hasBgvRequired } from './RequirementRibbon';
import {
  DEFAULT_BASIC_BGV_CHECKS,
  getRequirementBgvChecks,
  getSavedBgvSuggestions,
  saveBgvSuggestion,
} from '../../lib/bgv';
import { parseExperienceInput } from '../../lib/format';
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
  ensureUnmappedClientOrg,
} from '../../api/requirements';
import { suggestSkillsFromJd, improveJdWording } from '../../api/ai';
import {
  type BudgetMode,
  type BudgetUnit,
  type RequirementProfileType,
  BUDGET_UNIT_METADATA,
  encodeRequirementMetaToCurrency,
  extrasFromMeta,
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
  const experienceToInput = (min?: number | null, max?: number | null) => {
    if (min === undefined || min === null) return '';
    if (max === null || max === undefined) return `${min}+`;
    return max === min ? String(min) : `${min}-${max}`;
  };
  const [expInput, setExpInput] = useState<string>(
    initialRequirement
      ? experienceToInput(initialRequirement.min_experience, initialRequirement.max_experience)
      : ''
  );
  const [goodToHave, setGoodToHave] = useState<string[]>(initialMeta.goodToHaveSkills || []);
  const [categoryChoice, setCategoryChoice] = useState<'it' | 'non_it' | null>(
    initialMeta.category ?? null
  );
  const [profileType, setProfileType] = useState<'' | RequirementProfileType>(
    initialMeta.profileType || ''
  );
  const [hasBgv, setHasBgv] = useState<boolean>(() => {
    if (initialMeta.hasBgv !== undefined && initialMeta.hasBgv !== null) return initialMeta.hasBgv;
    return hasBgvRequired(initialRequirement);
  });
  const [bgvChecks, setBgvChecks] = useState<string[]>(() => {
    const existing = getRequirementBgvChecks(initialRequirement);
    return existing.length > 0 ? existing : [...DEFAULT_BASIC_BGV_CHECKS];
  });
  const [bgvInput, setBgvInput] = useState<string>('');
  const [showBgvDropdown, setShowBgvDropdown] = useState<boolean>(false);
  const [workingDaysInput, setWorkingDaysInput] = useState<string>(
    initialMeta.workingDaysPerMonth !== null && initialMeta.workingDaysPerMonth !== undefined
      ? String(initialMeta.workingDaysPerMonth)
      : ''
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
  const [vendorChargePct, setVendorChargePct] = useState<string>(
    initialRequirement?.vendor_charge_pct != null ? String(initialRequirement.vendor_charge_pct) : ''
  );
  const [totalClientFeePct, setTotalClientFeePct] = useState<string>(
    initialRequirement?.vendor_charge_pct != null
      ? initialMargins?.platform_margin != null && initialMargins?.margin_type === 'percentage'
        ? String(Number(initialRequirement.vendor_charge_pct) + Number(initialMargins.platform_margin))
        : String(Number(initialRequirement.vendor_charge_pct) * 2)
      : ''
  );
  const [importantNotesInput, setImportantNotesInput] = useState<string>(
    initialMeta.notes || ''
  );
  const [joiningTimelineInput, setJoiningTimelineInput] = useState<string>(
    initialMeta.joiningTimeline || ''
  );
  const [contractDurationInput, setContractDurationInput] = useState<string>(
    initialMeta.contractDuration || ''
  );
  const [travelRequirementInput, setTravelRequirementInput] = useState<string>(
    initialMeta.travelRequirement || ''
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

  // Unregistered client / vendor source (confidential to HQ Admin / Gopal)
  const [unregisteredSource, setUnregisteredSource] = useState<string>(
    initialMeta.unregisteredSource || ''
  );
  const [unregisteredSourceCode, setUnregisteredSourceCode] = useState<string>(
    initialMeta.unregisteredSourceCode || ''
  );
  const [unregisteredSourceContact, setUnregisteredSourceContact] = useState<string>(
    initialMeta.unregisteredSourceContact || ''
  );
  const [showUnregisteredModal, setShowUnregisteredModal] = useState<boolean>(false);

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
    setExpInput(
      initialRequirement
        ? experienceToInput(initialRequirement.min_experience, initialRequirement.max_experience)
        : ''
    );
    setGoodToHave(parsed.goodToHaveSkills || []);
    setCategoryChoice(parsed.category ?? null);
    setProfileType(parsed.profileType || '');
    setHasBgv(
      parsed.hasBgv !== undefined && parsed.hasBgv !== null
        ? parsed.hasBgv
        : hasBgvRequired(initialRequirement)
    );
    const existingBgvChecks = getRequirementBgvChecks(initialRequirement);
    setBgvChecks(existingBgvChecks.length > 0 ? existingBgvChecks : [...DEFAULT_BASIC_BGV_CHECKS]);
    setBgvInput('');
    setShowBgvDropdown(false);
    setWorkingDaysInput(parsed.workingDaysPerMonth != null ? String(parsed.workingDaysPerMonth) : '');
    setOpeningsInput(String(initialRequirement?.openings ?? 1));
    setSlaHoursInput(String(initialRequirement?.submission_sla_hours ?? defaultSlaHours));
    setLocation(initialRequirement?.location || '');
    setWorkMode(initialRequirement?.work_mode || 'hybrid');
    setEmploymentType(initialRequirement?.employment_type || 'full_time');
    setVendorChargePct(
      initialRequirement?.vendor_charge_pct != null ? String(initialRequirement.vendor_charge_pct) : ''
    );
    const feeVendor = initialRequirement?.vendor_charge_pct;
    const feeMargin = initialMargins?.platform_margin;
    setTotalClientFeePct(
      feeVendor != null
        ? feeMargin != null && initialMargins?.margin_type === 'percentage'
          ? String(Number(feeVendor) + Number(feeMargin))
          : String(Number(feeVendor) * 2)
        : ''
    );
    setImportantNotesInput(parsed.notes || '');
    setJoiningTimelineInput(parsed.joiningTimeline || '');
    setContractDurationInput(parsed.contractDuration || '');
    setTravelRequirementInput(parsed.travelRequirement || '');
    setUnregisteredSource(parsed.unregisteredSource || '');
    setUnregisteredSourceCode(parsed.unregisteredSourceCode || '');
    setUnregisteredSourceContact(parsed.unregisteredSourceContact || '');
    setShowUnregisteredModal(false);
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
    setFinancialNotesInput(initialFinancials?.notes || parsed.paymentTerms || '');
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

  const effectiveCategory: 'it' | 'non_it' =
    categoryChoice ?? classifyRequirement({ title, skills, description });

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const expParsed = parseExperienceInput(expInput);
    if ('error' in expParsed) {
      setFieldErrors({ experience: expParsed.error });
      return;
    }
    const validation = requirementSchema.safeParse({
      client_org_id: clientOrgId,
      title,
      description,
      min_experience: expParsed.min,
      max_experience: expParsed.max ?? expParsed.min,
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

    // Must-have skills are optional: a requirement can be created without them.
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
    if (budgetUnit === 'HOURLY') {
      const d = Number(workingDaysInput);
      if (!workingDaysInput.trim() || !Number.isFinite(d) || d < 1 || d > 31) {
        setBudgetError('Enter the number of working days per month (1-31) for an hourly rate.');
        return;
      }
    }
    if (parsedInternalBudgetNum !== null && parsedInternalBudgetNum < 0) {
      setBudgetError('Internal client budget must be a positive number.');
      return;
    }
    setBudgetError(null);

    setSubmitting(true);

    try {
      let dbClientOrgId =
        effectiveClientOrgId ||
        initialRequirement?.client_org_id ||
        clientOrgs[0]?.id ||
        userOrgId ||
        '';

      if (!dbClientOrgId || !isClientMapped) {
        dbClientOrgId = await ensureUnmappedClientOrg();
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
        goodToHaveSkills: goodToHave,
        category: effectiveCategory,
        profileType: profileType || null,
        hasBgv,
        bgvChecks: hasBgv ? bgvChecks : [],
        paymentTerms: financialNotesInput.trim() || null,
        notes: importantNotesInput.trim() || null,
        joiningTimeline: joiningTimelineInput.trim() || null,
        contractDuration: contractDurationInput.trim() || null,
        travelRequirement: travelRequirementInput.trim() || null,
        unregisteredSource: unregisteredSource.trim() || null,
        unregisteredSourceCode: unregisteredSourceCode.trim() || null,
        unregisteredSourceContact: unregisteredSourceContact.trim() || null,
        hourlyRate: null,
        workingDaysPerMonth:
          budgetUnit === 'HOURLY' && workingDaysInput.trim() !== '' && Number.isFinite(Number(workingDaysInput))
            ? Number(workingDaysInput)
            : null,
      });

      if (hasBgv) {
        bgvChecks.forEach((c) => saveBgvSuggestion(c));
      }

      let savedReq: Requirement & { wasDuplicatePrevented?: boolean };
      const existingTargetId = initialRequirement?.id || savedRequirementRef.current?.id;
      if (existingTargetId) {
        savedReq = await updateRequirement(existingTargetId, {
          title: values.title,
          description: values.description,
          skills,
          min_experience: expParsed.min,
          max_experience: expParsed.max,
          location: values.location,
          work_mode: values.work_mode,
          employment_type: values.employment_type,
          openings: values.openings,
          vendor_visible_budget: vendorVisibleNumeric,
          currency: encodedCurrency,
          submission_sla_hours: values.submission_sla_hours,
          vendor_charge_pct: values.employment_type === 'full_time' && vendorChargePct !== '' ? Number(vendorChargePct) : null,
        });
      } else {
        savedReq = await createRequirement({
          client_org_id: dbClientOrgId,
          title: values.title,
          description: values.description,
          skills,
          min_experience: expParsed.min,
          max_experience: expParsed.max,
          location: values.location,
          work_mode: values.work_mode,
          employment_type: values.employment_type,
          openings: values.openings,
          vendor_visible_budget: vendorVisibleNumeric,
          currency: encodedCurrency,
          submission_sla_hours: values.submission_sla_hours,
          vendor_charge_pct: values.employment_type === 'full_time' && vendorChargePct !== '' ? Number(vendorChargePct) : null,
        });
      }
      savedRequirementRef.current = savedReq;

      if (isHq && publishForVendors) {
        savedReq = { ...savedReq, status: 'open' };
        // Trigger vendor distribution & match computation in background (non-blocking)
        void publishAndShareRequirementWithAllVendors({
          requirementId: savedReq.id,
          slaHours: values.submission_sla_hours,
        });
      }

      // Fire-and-forget financials/margins — non-blocking, don't delay the form close
      void upsertRequirementFinancials({
        requirement_id: savedReq.id,
        actual_client_budget: parsedInternalBudgetNum,
        notes: financialNotesInput.trim() || null,
      });

      if (isAdmin) {
        const marginNum =
          platformMarginInput.trim() !== '' && !Number.isNaN(Number(platformMarginInput))
            ? Number(platformMarginInput)
            : null;
        void upsertRequirementMargins({
          requirement_id: savedReq.id,
          platform_margin: marginNum,
          margin_type: marginTypeInput,
        });
      }

      toast({
        title: isEditing
          ? 'Requirement updated'
          : savedReq.wasDuplicatePrevented
            ? 'Duplicate prevented - existing requirement retained'
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
    <>
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
              <div className="space-y-2">
                <Select
                  label="Mapped client organization"
                  value={clientOrgId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setClientOrgId(val);
                    setClientMapError(null);
                    const selOrg = clientOrgs.find((o) => o.id === val);
                    if (selOrg && /hirenest|hire nest/i.test(selOrg.name)) {
                      setShowUnregisteredModal(true);
                      if (!unregisteredSourceCode) {
                        setUnregisteredSourceCode(`HN-SRC-${Math.floor(1000 + Math.random() * 9000)}`);
                      }
                    }
                  }}
                  error={clientMapError || fieldErrors.client_org_id}
                  options={[
                    { value: '', label: 'Select client organization...' },
                    ...clientOrgs.map((o) => ({ value: o.id, label: o.name })),
                  ]}
                />

                {/* Confidential Unregistered Vendor/Client Source & Pop-up Code (HQ Admin only) */}
                {isHq && (
                  <div>
                    {unregisteredSourceCode || unregisteredSource ? (
                      <div className="p-3 rounded-[8px] border bg-[#FEF3C7]/40 border-[#FDE68A] flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 rounded border border-[#FDE68A]">
                              🔒 {unregisteredSourceCode || 'POPUP CODE'}
                            </span>
                            <span className="text-[12px] font-semibold text-[#78350F] truncate">
                              {unregisteredSource || 'Unregistered Partner'}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#92400E] mt-0.5 truncate">
                            Confidential Originating Source (Visible only to HQ Admin · Masked for vendors)
                            {unregisteredSourceContact ? ` · ${unregisteredSourceContact}` : ''}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setShowUnregisteredModal(true)}
                        >
                          Edit Code
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setShowUnregisteredModal(true);
                          if (!unregisteredSourceCode) {
                            setUnregisteredSourceCode(`HN-SRC-${Math.floor(1000 + Math.random() * 9000)}`);
                          }
                        }}
                        className="text-[12px] font-medium text-[#1D5FD1] hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        + Tag Unregistered Vendor / Client Source & Pop-up Code (HQ Admin only)
                      </button>
                    )}
                  </div>
                )}
              </div>
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
                <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                  Makes this requirement visible in Vendor Shared Requirements with SLA countdown.
                </div>
              </div>
              <input
                type="checkbox"
                checked={publishForVendors}
                onChange={(e) => setPublishForVendors(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[#1D5FD1] cursor-pointer"
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
            label="Must-have skills (optional)"
            skills={skills}
            onChange={(next) => {
              setSkills(next);
              if (next.length > 0) setSkillsError(null);
            }}
            error={skillsError || undefined}
          />

          <SkillsChipInput
            label="Good-to-have skills (optional)"
            skills={goodToHave}
            onChange={setGoodToHave}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <span className="block text-[12px] font-medium text-[var(--text-secondary)]">Requirement category</span>
              <div className="inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-0.5">
                {(['it', 'non_it'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryChoice(c)}
                    className={`px-3 py-1 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
                      effectiveCategory === c
                        ? 'bg-[var(--primary-bg)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {c === 'it' ? 'IT' : 'Non-IT'}
                  </button>
                ))}
              </div>
              {categoryChoice === null && (
                <span className="block text-[11px] text-[var(--text-tertiary)]">Auto-detected. Tap to set.</span>
              )}
            </div>
            <Select
              label="Profile type"
              value={profileType}
              onChange={(e) => setProfileType(e.target.value as '' | RequirementProfileType)}
              options={[
                { value: '', label: 'Not specified' },
                { value: 'bench', label: 'Bench profile' },
                { value: 'market', label: 'Market profile' },
                { value: 'both', label: 'Both (Bench & Market)' },
              ]}
            />
            <div className="space-y-1">
              <span className="block text-[12px] font-medium text-[var(--text-secondary)]">Verification process</span>
              <button
                type="button"
                onClick={() => {
                  const next = !hasBgv;
                  setHasBgv(next);
                  if (next && bgvChecks.length === 0) {
                    setBgvChecks([...DEFAULT_BASIC_BGV_CHECKS]);
                  }
                }}
                className={`w-full flex items-center justify-between h-[34px] px-2.5 rounded-[6px] border text-[12px] transition-colors cursor-pointer ${
                  hasBgv
                    ? 'border-sky-500 bg-sky-500/10 text-sky-800 dark:text-sky-300 font-medium'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                }`}
                title="Toggle background verification mandatory process (Employment Check & Police Clearance Certificate)"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${hasBgv ? 'text-sky-600' : 'text-[var(--text-tertiary)]'}`} />
                  <span className="truncate">BGV process</span>
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-full shrink-0 ${
                  hasBgv ? 'bg-sky-600 text-white' : 'bg-[var(--border)] text-[var(--text-tertiary)]'
                }`}>
                  {hasBgv ? 'Required' : 'Off'}
                </span>
              </button>
            </div>
          </div>

          {hasBgv && (
            <div className="rounded-[8px] border border-sky-500/30 bg-sky-500/5 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-sky-900 dark:text-sky-200">
                  <ShieldCheck className="h-4 w-4 text-sky-600 shrink-0" />
                  <span>Mandatory BGV Checks &amp; Requirements</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setBgvChecks([...DEFAULT_BASIC_BGV_CHECKS]);
                    }}
                    className="text-sky-700 dark:text-sky-300 hover:underline px-1.5 py-0.5 rounded cursor-pointer font-medium"
                    title="Reset to default Basic BGV checks: Employment History Check & Police Clearance Certificate (PCC)"
                  >
                    Reset Basic BGV
                  </button>
                  <span className="text-[var(--text-tertiary)]">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      const full = [
                        'Employment History Check',
                        'Police Clearance Certificate (PCC)',
                        'Education Verification',
                        'Identity Verification (Aadhaar / Passport)',
                      ];
                      setBgvChecks(full);
                      full.forEach((c) => saveBgvSuggestion(c));
                    }}
                    className="text-sky-700 dark:text-sky-300 hover:underline px-1.5 py-0.5 rounded cursor-pointer font-medium"
                    title="Apply Full BGV preset: Emp, PCC, Education, and Identity"
                  >
                    + Full BGV
                  </button>
                  <span className="text-[var(--text-tertiary)]">·</span>
                  <button
                    type="button"
                    onClick={() => setBgvChecks([])}
                    className="text-[var(--text-tertiary)] hover:text-red-600 px-1.5 py-0.5 rounded cursor-pointer"
                    title="Clear all checks"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Selected checks tags */}
              <div className="flex flex-wrap items-center gap-1.5 min-h-[30px] p-2 rounded-[6px] bg-[var(--surface)] border border-sky-500/20">
                {bgvChecks.map((check) => (
                  <span
                    key={check}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200 border border-sky-300 dark:border-sky-800 shadow-xs"
                  >
                    <span>{check}</span>
                    <button
                      type="button"
                      onClick={() => setBgvChecks(bgvChecks.filter((c) => c !== check))}
                      className="text-sky-700 hover:text-red-600 dark:text-sky-300 dark:hover:text-red-400 cursor-pointer p-0.5 rounded-full"
                      title={`Remove check: ${check}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {bgvChecks.length === 0 && (
                  <span className="text-[12px] text-[var(--text-tertiary)] italic">
                    No checks specified yet. Select from suggestions below or type a custom check.
                  </span>
                )}
              </div>

              {/* Autocomplete / Dropdown Input */}
              <div className="relative">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={bgvInput}
                      onChange={(e) => {
                        setBgvInput(e.target.value);
                        setShowBgvDropdown(true);
                      }}
                      onFocus={() => setShowBgvDropdown(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const trimmed = bgvInput.trim();
                          if (trimmed && !bgvChecks.includes(trimmed)) {
                            setBgvChecks([...bgvChecks, trimmed]);
                            saveBgvSuggestion(trimmed);
                            setBgvInput('');
                            setShowBgvDropdown(false);
                          }
                        }
                      }}
                      placeholder="Type or select required check (e.g. Police Clearance, Education, Drug Test...)"
                      className="w-full h-[32px] px-2.5 text-[12px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-1 focus:ring-sky-500 placeholder:text-[var(--text-tertiary)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBgvDropdown(!showBgvDropdown)}
                      className="absolute right-2 top-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!bgvInput.trim()}
                    onClick={() => {
                      const trimmed = bgvInput.trim();
                      if (trimmed && !bgvChecks.includes(trimmed)) {
                        setBgvChecks([...bgvChecks, trimmed]);
                        saveBgvSuggestion(trimmed);
                        setBgvInput('');
                        setShowBgvDropdown(false);
                      }
                    }}
                    className="h-[32px] px-3 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>

                {/* Dropdown Menu */}
                {showBgvDropdown && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] shadow-xl p-1.5 space-y-1"
                    tabIndex={-1}
                  >
                    <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-[var(--text-tertiary)] border-b border-[var(--border)]">
                      <span>Suggested &amp; Saved BGV Checks</span>
                      <button
                        type="button"
                        onClick={() => setShowBgvDropdown(false)}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>

                    {bgvInput.trim() &&
                      !getSavedBgvSuggestions().some(
                        (s) => s.toLowerCase() === bgvInput.trim().toLowerCase()
                      ) && (
                        <button
                          type="button"
                          onClick={() => {
                            const trimmed = bgvInput.trim();
                            if (!bgvChecks.includes(trimmed)) {
                              setBgvChecks([...bgvChecks, trimmed]);
                              saveBgvSuggestion(trimmed);
                            }
                            setBgvInput('');
                            setShowBgvDropdown(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded-[4px] text-[12px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/50 flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add custom check: <strong>"{bgvInput.trim()}"</strong></span>
                        </button>
                      )}

                    {getSavedBgvSuggestions()
                      .filter(
                        (s) =>
                          !bgvInput.trim() ||
                          s.toLowerCase().includes(bgvInput.trim().toLowerCase())
                      )
                      .map((suggestion) => {
                        const isAlreadySelected = bgvChecks.includes(suggestion);
                        return (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => {
                              if (!isAlreadySelected) {
                                setBgvChecks([...bgvChecks, suggestion]);
                                saveBgvSuggestion(suggestion);
                              }
                              setBgvInput('');
                              setShowBgvDropdown(false);
                            }}
                            className={`w-full text-left px-2.5 py-1.5 rounded-[4px] text-[12px] flex items-center justify-between transition-colors cursor-pointer ${
                              isAlreadySelected
                                ? 'bg-sky-500/10 text-sky-800 dark:text-sky-300 font-medium'
                                : 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                            }`}
                          >
                            <span>{suggestion}</span>
                            {isAlreadySelected && (
                              <Check className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Quick suggestion chips */}
              <div className="flex flex-wrap items-center gap-1 pt-1 text-[11px] text-[var(--text-tertiary)]">
                <span className="font-medium mr-1">Suggestions:</span>
                {getSavedBgvSuggestions()
                  .filter((s) => !bgvChecks.includes(s))
                  .slice(0, 5)
                  .map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setBgvChecks([...bgvChecks, suggestion]);
                        saveBgvSuggestion(suggestion);
                      }}
                      className="px-2 py-0.5 rounded-[4px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-sky-400 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 transition-colors cursor-pointer"
                    >
                      + {suggestion}
                    </button>
                  ))}
              </div>
            </div>
          )}

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

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input
            label="Experience (yrs)"
            placeholder="e.g. 8+  or  10  or  8-12"
            value={expInput}
            onChange={(e) => {
              setExpInput(e.target.value);
              if (fieldErrors.experience) {
                setFieldErrors((prev) => ({ ...prev, experience: undefined }));
              }
            }}
            error={fieldErrors.experience}
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

        {/* Joining timeline, Contract period & Travel requirements */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label="Joining timeline"
            placeholder="e.g. Immediate, 15 days, 30 days"
            value={joiningTimelineInput}
            onChange={(e) => setJoiningTimelineInput(e.target.value)}
            hint="Expected notice period or joining speed."
          />
          <Input
            label="Contract period"
            placeholder="e.g. 1+ year and long-term, 6 Months"
            value={contractDurationInput}
            onChange={(e) => setContractDurationInput(e.target.value)}
            hint="Tenure / engagement duration."
          />
          <Input
            label="Work / travel requirement"
            placeholder="e.g. Mandatory 2–3 days travel to client office"
            value={travelRequirementInput}
            onChange={(e) => setTravelRequirementInput(e.target.value)}
            hint="Client travel or in-office attendance rules."
          />
        </div>
        {/* Vendor Placement Fee & Commercial Margins — only for FTE requirements */}
        {employmentType === 'full_time' && (
          <div className="mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                FTE Placement Fee &amp; Margins
              </span>
              <span className="text-[11px] text-[var(--text-secondary)]">
                50% Vendor share · 50% HireNest Platform margin
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Total client fee (% of CTC)"
                type="number"
                min={0}
                max={100}
                step={0.5}
                placeholder="e.g. 4"
                value={totalClientFeePct}
                onChange={(e) => {
                  const val = e.target.value;
                  setTotalClientFeePct(val);
                  if (val.trim() !== '' && !Number.isNaN(Number(val))) {
                    const half = (Number(val) / 2).toFixed(2).replace(/\.00$/, '');
                    setVendorChargePct(half);
                    setPlatformMarginInput(half);
                    setMarginTypeInput('percentage');
                    marginsTouchedRef.current = true;
                  }
                }}
                hint="Total agreed client placement fee (e.g. 4%). Calculates 50/50 split."
              />
              <Input
                label="Vendor service fee (% of CTC)"
                type="number"
                min={0}
                max={100}
                step={0.5}
                placeholder="e.g. 2"
                value={vendorChargePct}
                onChange={(e) => setVendorChargePct(e.target.value)}
                hint="Vendor share (shown in vendor workspace as Vendor service fee)."
              />
              <Input
                label="HireNest Platform margin (% of CTC)"
                type="number"
                min={0}
                max={100}
                step={0.5}
                placeholder="e.g. 2"
                value={platformMarginInput}
                onChange={(e) => {
                  marginsTouchedRef.current = true;
                  setPlatformMarginInput(e.target.value);
                  setMarginTypeInput('percentage');
                }}
                hint="HireNest internal margin on candidate CTC upon successful hire."
              />
            </div>
          </div>
        )}

        {/* Budget Unit Selection (LPA - annual / LPM - monthly) & Financial Governance */}
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

          {/* Budget Unit Selector: LPA - annual vs LPM - monthly */}
          <div className="space-y-1.5">
            <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              Budget unit
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {(['LPA', 'LPM', 'HOURLY'] as const).map((unitCode) => {
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
                    <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                      {info.fullLabel}
                    </div>
                  </button>
                );
              })}
            </div>
            {budgetUnit === 'HOURLY' && (
              <div className="mt-2.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                <Input
                  label="Working days per month"
                  type="number"
                  min="1"
                  max="31"
                  placeholder="e.g. 22"
                  value={workingDaysInput}
                  onChange={(e) => {
                    setWorkingDaysInput(e.target.value);
                    setBudgetError(null);
                  }}
                />
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                  Used to show the approximate monthly cost of the hourly rate (8 hours per day).
                </p>
              </div>
            )}
          </div>

          {/* Minimum / Maximum Budget + Preview Only */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
            {budgetMode === 'range' ? (
              <>
                <Input
                  label={`Minimum budget (${budgetUnit === 'HOURLY' ? '₹ per hour' : budgetUnit})`}
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={budgetUnit === 'LPA' ? 'e.g. 12' : budgetUnit === 'HOURLY' ? 'e.g. 1200' : 'e.g. 1.2'}
                  value={budgetMinInput}
                  onChange={(e) => {
                    setBudgetMinInput(e.target.value);
                    setBudgetError(null);
                  }}
                />
                <Input
                  label={`Maximum budget (${budgetUnit === 'HOURLY' ? '₹ per hour' : budgetUnit})`}
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={budgetUnit === 'LPA' ? 'e.g. 15' : budgetUnit === 'HOURLY' ? 'e.g. 1500' : 'e.g. 1.8'}
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
                  label={`Fixed budget (${budgetUnit === 'HOURLY' ? '₹ per hour' : budgetUnit})`}
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={budgetUnit === 'LPA' ? 'e.g. 14' : budgetUnit === 'HOURLY' ? 'e.g. 1300' : 'e.g. 1.5'}
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
              <div className="text-[12px] leading-[16px] font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
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
              label="Payment terms & financial notes (visible to vendors)"
              placeholder="e.g. Net 30days, Net 45days, Net 60days..."
              value={financialNotesInput}
              onChange={(e) => {
                financialsTouchedRef.current = true;
                setFinancialNotesInput(e.target.value);
              }}
              hint={
                financialNotesInput.trim()
                  ? 'Shown in vendor workspace right-side key facts under Payment terms & notes'
                  : 'Standard vendor payment cycle (e.g. Net 30, Net 45, Net 60 days)'
              }
            />
          </div>

          <Textarea
            rows={2}
            label="Important notes & instructions (visible to vendors & candidates)"
            placeholder="e.g. Candidate should be your inhouse bench resource; immediate joining required; 2 technical rounds..."
            value={importantNotesInput}
            onChange={(e) => setImportantNotesInput(e.target.value)}
            hint="Shown in the right-side extra details column in both vendor workspace and job boards."
          />

          {isAdmin && employmentType !== 'full_time' && (
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

    {showUnregisteredModal && (
      <Dialog
        open={showUnregisteredModal}
        onClose={() => setShowUnregisteredModal(false)}
        title="Unregistered Client / Vendor Source & Pop-up Code"
        description="Requirement managed under HireNest Workforce Private Limited on behalf of an offline or unregistered client/vendor. This information is confidential and visible ONLY to HQ Admin (Gopal)."
      >
        <div className="space-y-4 pt-2">
          <Input
            label="Originating Partner / Agency Name"
            placeholder="e.g. Acme Tech Solutions / External Client"
            value={unregisteredSource}
            onChange={(e) => setUnregisteredSource(e.target.value)}
          />

          <div className="space-y-1">
            <label className="block text-[12px] font-medium text-[var(--text-secondary)]">
              Internal Pop-up Tracking Code
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. HN-SRC-8349"
                value={unregisteredSourceCode}
                onChange={(e) => setUnregisteredSourceCode(e.target.value.toUpperCase())}
                className="w-full h-9 px-3 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[13px] font-mono font-semibold text-[var(--text-primary)]"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setUnregisteredSourceCode(`HN-SRC-${Math.floor(1000 + Math.random() * 9000)}`);
                }}
              >
                Generate
              </Button>
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Unique tracking code shown only to HQ Admin (Gopal) to identify this requirement.
            </p>
          </div>

          <Input
            label="Contact Person & Phone / Email (Optional)"
            placeholder="e.g. Rajesh Kumar (+91 98765 43210)"
            value={unregisteredSourceContact}
            onChange={(e) => setUnregisteredSourceContact(e.target.value)}
          />

          <div className="flex justify-between items-center pt-4 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={() => {
                setUnregisteredSource('');
                setUnregisteredSourceCode('');
                setUnregisteredSourceContact('');
                setShowUnregisteredModal(false);
              }}
              className="text-[12px] text-red-600 hover:underline cursor-pointer"
            >
              Clear / Remove Source
            </button>
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowUnregisteredModal(false)}
            >
              Save Source Code
            </Button>
          </div>
        </div>
      </Dialog>
    )}
    </>
  );
};
