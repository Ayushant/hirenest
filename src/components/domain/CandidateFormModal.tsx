import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, FileText, Loader2, Trash2, Upload, Users } from 'lucide-react';
import {
  Dialog,
  Button,
  Input,
  Textarea,
  SkillsChipInput,
  Badge,
} from '../ui/kit';
import { DuplicateDialog } from './DuplicateDialog';
import {
  checkCandidateDuplicate,
  createCandidateRpc,
  uploadCandidateResume,
} from '../../api/candidates';
import { computeFileSha256, validateResumeFile } from '../../lib/hash';
import { parseResumeFile } from '../../lib/resumeParser';
import { recordPrivacyAcknowledgementApi } from '../../lib/dpdpPrivacy';
import { getContractContactPolicy } from '../../lib/offerOnboarding';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../ui/Toast';
import type { EmploymentType } from '../../types/db';

const candidateSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Valid email is required').or(z.literal('')),
  phone: z.string().min(6, 'Phone number is required').or(z.literal('')),
  linkedin_url: z.string().optional(),
  current_title: z.string().min(2, 'Current title is required'),
  location: z.string().min(2, 'Location is required'),
  total_experience_years: z.coerce.number().min(0, 'Experience must be >= 0'),
  summary: z.string().optional(),
});

type CandidateFormValues = z.infer<typeof candidateSchema>;

interface BulkCandidateItem {
  id: string;
  file: File;
  resumeHash: string;
  full_name: string;
  current_title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  location: string;
  total_experience_years: number;
  skills: string[];
  summary: string;
  status: 'parsing' | 'ready' | 'creating' | 'created' | 'duplicate' | 'error';
  statusMessage?: string;
}

export const CandidateFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: (candidateId: string) => void;
  isSelfOnboarding?: boolean;
  defaultEmail?: string;
  defaultName?: string;
  defaultMode?: 'single' | 'bulk';
  defaultEmploymentType?: EmploymentType;
}> = ({
  open,
  onClose,
  onCreated,
  isSelfOnboarding = false,
  defaultEmail = '',
  defaultName = '',
  defaultMode = 'single',
  defaultEmploymentType = 'full_time',
}) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<'single' | 'bulk'>(defaultMode);
  const [engagementType, setEngagementType] = useState<EmploymentType>(defaultEmploymentType);
  const contactPolicy = getContractContactPolicy(engagementType);

  // Single candidate state
  const [skills, setSkills] = useState<string[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeHash, setResumeHash] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsingSingle, setParsingSingle] = useState(false);
  const [parsedSuccessBanner, setParsedSuccessBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dpdpNoticeAccepted, setDpdpNoticeAccepted] = useState(true);

  // Bulk upload state
  const [bulkItems, setBulkItems] = useState<BulkCandidateItem[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [dupOpen, setDupOpen] = useState(false);
  const [dupMatchType, setDupMatchType] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    clearErrors,
    formState: { errors },
  } = useForm<CandidateFormValues>({
    resolver: zodResolver(candidateSchema) as never,
    defaultValues: {
      full_name: defaultName,
      email: defaultEmail,
      phone: '',
      linkedin_url: '',
      current_title: '',
      location: '',
      total_experience_years: 3,
      summary: '',
    },
  });

  useEffect(() => {
    if (open) {
      setMode(isSelfOnboarding ? 'single' : defaultMode);
      setEngagementType(defaultEmploymentType);
      setParsedSuccessBanner(null);
      setFileError(null);
      setSkillsError(null);
      setContactError(null);
    }
  }, [open, defaultMode, isSelfOnboarding, defaultEmploymentType]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setResumeFile(null);
      setResumeHash(null);
      setParsedSuccessBanner(null);
      return;
    }
    const validationErr = validateResumeFile(file);
    if (validationErr) {
      setFileError(validationErr);
      setResumeFile(null);
      setResumeHash(null);
      setParsedSuccessBanner(null);
      return;
    }

    setFileError(null);
    setResumeFile(file);
    setParsingSingle(true);
    setParsedSuccessBanner(null);

    try {
      const [hash, parsed] = await Promise.all([
        computeFileSha256(file),
        parseResumeFile(file),
      ]);
      setResumeHash(hash);

      // Auto-populate all candidate form fields & clear any existing validation errors
      setValue('full_name', parsed.full_name, { shouldValidate: true, shouldDirty: true });
      setValue('current_title', parsed.current_title, { shouldValidate: true, shouldDirty: true });
      setValue('location', parsed.location, { shouldValidate: true, shouldDirty: true });
      setValue('total_experience_years', parsed.total_experience_years, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue('summary', parsed.summary, { shouldValidate: true, shouldDirty: true });

      if (!contactPolicy.hideAndOmitContactFieldsByDefault) {
        if (parsed.email) {
          setValue('email', parsed.email, { shouldValidate: true, shouldDirty: true });
        }
        if (parsed.phone) {
          setValue('phone', parsed.phone, { shouldValidate: true, shouldDirty: true });
        }
      } else {
        setValue('email', '', { shouldValidate: false });
        setValue('phone', '', { shouldValidate: false });
      }
      if (parsed.linkedin_url) {
        setValue('linkedin_url', parsed.linkedin_url, { shouldValidate: true, shouldDirty: true });
      }

      if (parsed.skills.length > 0) {
        setSkills(parsed.skills);
        setSkillsError(null);
      }

      clearErrors();
      setParsedSuccessBanner(
        `Resume parsed — auto-filled ${parsed.full_name} (${parsed.current_title}) and ${parsed.skills.length} skill(s).`
      );
    } catch {
      setFileError('Could not parse resume automatically; please review fields.');
    } finally {
      setParsingSingle(false);
    }
  };

  const handleBulkFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files: File[] = Array.from(fileList);
    const validFiles: File[] = [];

    for (const f of files) {
      const err = validateResumeFile(f);
      if (err) {
        toast({
          title: `Skipped ${f.name}`,
          description: err,
          tone: 'error',
        });
      } else {
        validFiles.push(f);
      }
    }

    if (validFiles.length === 0) return;

    // Add placeholders in 'parsing' status
    const placeholders: BulkCandidateItem[] = validFiles.map((file, idx) => ({
      id: `bulk_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      file,
      resumeHash: '',
      full_name: file.name.replace(/\.[a-zA-Z0-9]+$/, ''),
      current_title: 'Parsing...',
      email: '',
      phone: '',
      linkedin_url: '',
      location: 'Hyderabad, India',
      total_experience_years: 3,
      skills: [],
      summary: '',
      status: 'parsing',
    }));

    setBulkItems((prev) => [...prev, ...placeholders]);

    // Parse all selected files in parallel
    await Promise.all(
      placeholders.map(async (item) => {
        try {
          const [hash, parsed] = await Promise.all([
            computeFileSha256(item.file),
            parseResumeFile(item.file),
          ]);
          setBulkItems((prev) =>
            prev.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    resumeHash: hash,
                    full_name: parsed.full_name,
                    current_title: parsed.current_title,
                    email: parsed.email,
                    phone: parsed.phone,
                    linkedin_url: parsed.linkedin_url,
                    location: parsed.location,
                    total_experience_years: parsed.total_experience_years,
                    skills: parsed.skills,
                    summary: parsed.summary,
                    status: 'ready',
                  }
                : row
            )
          );
        } catch {
          setBulkItems((prev) =>
            prev.map((row) =>
              row.id === item.id
                ? {
                    ...row,
                    status: 'error',
                    statusMessage: 'Parse error',
                  }
                : row
            )
          );
        }
      })
    );

    e.target.value = '';
  };

  const updateBulkItemField = <K extends keyof BulkCandidateItem>(
    id: string,
    field: K,
    value: BulkCandidateItem[K]
  ) => {
    setBulkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeBulkItem = (id: string) => {
    setBulkItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleBulkSubmit = async () => {
    const readyItems = bulkItems.filter((i) => i.status === 'ready');
    if (readyItems.length === 0) return;

    setBulkSubmitting(true);
    let createdCount = 0;
    let duplicateCount = 0;
    let lastCreatedId = '';

    for (const item of readyItems) {
      setBulkItems((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, status: 'creating' } : r))
      );

      try {
        const omitContact = contactPolicy.hideAndOmitContactFieldsByDefault;
        const dupCheck = await checkCandidateDuplicate({
          p_email: omitContact ? null : item.email || null,
          p_phone: omitContact ? null : item.phone || null,
          p_resume_hash: item.resumeHash || null,
        });

        if (dupCheck?.is_duplicate) {
          duplicateCount += 1;
          setBulkItems((prev) =>
            prev.map((r) =>
              r.id === item.id
                ? {
                    ...r,
                    status: 'duplicate',
                    statusMessage: `Duplicate (${dupCheck.match_type || 'hash/contact'})`,
                  }
                : r
            )
          );
          continue;
        }

        const result = await createCandidateRpc({
          p_full_name: item.full_name.trim() || 'Candidate',
          p_email: omitContact ? null : item.email.trim() || null,
          p_phone: omitContact ? null : item.phone.trim() || null,
          p_linkedin_url: item.linkedin_url.trim() || null,
          p_current_title: item.current_title.trim() || 'Software Engineer',
          p_location: item.location.trim() || 'Hyderabad, India',
          p_total_experience_years: Number(item.total_experience_years) || 3,
          p_skills: item.skills.length > 0 ? item.skills : ['SQL', 'System Design'],
          p_summary: item.summary.trim() || null,
          p_resume_hash: item.resumeHash || null,
        });

        if (result.status === 'duplicate') {
          duplicateCount += 1;
          setBulkItems((prev) =>
            prev.map((r) =>
              r.id === item.id
                ? {
                    ...r,
                    status: 'duplicate',
                    statusMessage: `Duplicate (${result.match_type || 'record'})`,
                  }
                : r
            )
          );
          continue;
        }

        if (item.file && item.resumeHash) {
          await uploadCandidateResume(result.candidate_id, item.file, item.resumeHash).catch(
            () => undefined
          );
        }

        createdCount += 1;
        lastCreatedId = result.candidate_id;
        setBulkItems((prev) =>
          prev.map((r) =>
            r.id === item.id
              ? { ...r, status: 'created', statusMessage: 'Created' }
              : r
          )
        );
      } catch (err) {
        setBulkItems((prev) =>
          prev.map((r) =>
            r.id === item.id
              ? {
                  ...r,
                  status: 'error',
                  statusMessage: mapSupabaseError(err),
                }
              : r
          )
        );
      }
    }

    setBulkSubmitting(false);

    if (createdCount > 0) {
      toast({
        title: `Bulk upload complete: ${createdCount} candidate(s) created`,
        description:
          duplicateCount > 0
            ? `${duplicateCount} duplicate resume(s) skipped.`
            : 'All parsed candidates added to your pool.',
        tone: 'success',
      });
      onCreated(lastCreatedId);
      if (duplicateCount === 0) {
        setBulkItems([]);
        onClose();
      }
    } else if (duplicateCount > 0) {
      toast({
        title: 'Duplicate candidates detected',
        description: `${duplicateCount} candidate(s) matched existing SHA-256 resume digests or contacts.`,
        tone: 'info',
      });
    }
  };

  const onSubmit = async (values: CandidateFormValues) => {
    if (skills.length === 0) {
      setSkillsError('Enter at least one skill.');
      return;
    }
    setSkillsError(null);

    const omitContact = contactPolicy.hideAndOmitContactFieldsByDefault;
    if (contactPolicy.requireCandidateEmailAndPhone && !omitContact) {
      if (!values.email.trim() || !values.phone.trim()) {
        setContactError(
          'FTE Engagement Requirement: Candidate Email and Phone are required for direct Full-Time submissions.'
        );
        return;
      }
    }
    setContactError(null);
    setSubmitting(true);

    try {
      const effectiveEmail = omitContact ? null : values.email.trim() || null;
      const effectivePhone = omitContact ? null : values.phone.trim() || null;

      const dupCheck = await checkCandidateDuplicate({
        p_email: effectiveEmail,
        p_phone: effectivePhone,
        p_resume_hash: resumeHash || null,
      });

      if (dupCheck?.is_duplicate) {
        setDupMatchType(dupCheck.match_type || 'email / phone / resume_hash');
        setDupOpen(true);
        setSubmitting(false);
        return;
      }

      const result = await createCandidateRpc({
        p_full_name: values.full_name,
        p_email: effectiveEmail,
        p_phone: effectivePhone,
        p_linkedin_url: values.linkedin_url || null,
        p_current_title: values.current_title,
        p_location: values.location,
        p_total_experience_years: values.total_experience_years,
        p_skills: skills,
        p_summary: values.summary || null,
        p_resume_hash: resumeHash || null,
      });

      if (result.status === 'duplicate') {
        setDupMatchType(result.match_type || 'record match');
        setDupOpen(true);
        setSubmitting(false);
        return;
      }

      if (resumeFile && resumeHash) {
        await uploadCandidateResume(result.candidate_id, resumeFile, resumeHash);
      }

      if (dpdpNoticeAccepted) {
        await recordPrivacyAcknowledgementApi({
          subjectRef: `cand_${result.candidate_id}`,
          subjectName: values.full_name,
          noticeId: isSelfOnboarding ? 'HN-DPDP-NOTICE-2026-V2' : 'HN-DPDP-VENDOR-2026-V1',
          version: isSelfOnboarding ? '2.4.0' : '1.2.0',
          purpose: isSelfOnboarding
            ? 'Candidate profile creation, resume parsing, 4-dimension JD matching & authorised client submission'
            : 'Recruiter/Vendor candidate onboarding & DPDP notice representation attestation',
          processingBasis: 'consent',
          action: 'consented',
          captureSource: isSelfOnboarding ? 'candidate_portal' : 'resume_upload',
        }).catch(() => undefined);
      }

      toast({
        title: 'Candidate profile created',
        description: values.full_name,
        tone: 'success',
      });
      reset();
      setSkills([]);
      setResumeFile(null);
      setResumeHash(null);
      setParsedSuccessBanner(null);
      onCreated(result.candidate_id);
      onClose();
    } catch (err) {
      toast({
        title: 'Could not create candidate',
        description: mapSupabaseError(err),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const readyBulkCount = bulkItems.filter((i) => i.status === 'ready').length;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={
          isSelfOnboarding
            ? 'Create candidate profile'
            : mode === 'bulk'
              ? 'Bulk upload & parse candidates'
              : 'Add candidate'
        }
        description="Computes SHA-256 resume digest, auto-parses resume fields, and verifies ownership deduplication."
        maxWidth={mode === 'bulk' ? 'max-w-[920px]' : 'max-w-[660px]'}
      >
        {/* Mode Switcher: Single Upload vs Bulk Upload */}
        {!isSelfOnboarding && (
          <div className="mb-4 flex items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
            <div className="inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-0.5">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`px-3 py-1.5 rounded-[4px] text-[12px] leading-[16px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  mode === 'single'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Single resume upload
              </button>
              <button
                type="button"
                onClick={() => setMode('bulk')}
                className={`px-3 py-1.5 rounded-[4px] text-[12px] leading-[16px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  mode === 'bulk'
                    ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Bulk resume upload ({bulkItems.length})
              </button>
            </div>
            <span className="text-[11px] leading-[14px] text-[var(--text-tertiary)]">
              Auto-extracts Name, Role, Location, Experience &amp; Skills
            </span>
          </div>
        )}

        {mode === 'single' ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Single Resume Upload + Auto-Parse + SHA-256 Hash */}
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-[12px] leading-[16px] font-semibold text-[var(--text-primary)]">
                  Resume upload &amp; auto-parse (PDF, DOC, DOCX · Max 10 MB)
                </label>
                {parsingSingle && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1F4CC4]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Parsing resume fields...
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 h-8 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] leading-[20px] font-medium text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)] shadow-2xs">
                  <Upload strokeWidth={1.75} className="h-3.5 w-3.5 text-[#1F4CC4]" />
                  <span className="truncate max-w-[260px]">
                    {resumeFile ? resumeFile.name : 'Upload resume to auto-fill fields'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {resumeHash && (
                  <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)] truncate max-w-xs">
                    SHA-256 · {resumeHash.slice(0, 16)}…
                  </span>
                )}
              </div>

              {fileError && (
                <p className="text-[12px] leading-[16px] text-[var(--status-danger)]">
                  {fileError}
                </p>
              )}

              {parsedSuccessBanner && (
                <div className="flex items-center gap-2 rounded-[6px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] leading-[16px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{parsedSuccessBanner}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Full name"
                placeholder="e.g. Shivam Kumar"
                {...register('full_name')}
                error={errors.full_name?.message}
              />
              <Input
                label="Current title"
                placeholder="e.g. Senior Database Designer Rearchitect"
                {...register('current_title')}
                error={errors.current_title?.message}
              />
            </div>

            {/* Contract-Specific Contact Governance Selector (FTE vs C2C / C2H) */}
            {!isSelfOnboarding && (
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                    Target Requirement Engagement Type (Contact Governance)
                  </span>
                  <div className="inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-0.5">
                    {(
                      [
                        { id: 'full_time', label: 'FTE (Full-Time)' },
                        { id: 'contract', label: 'C2C (Contract)' },
                        { id: 'contract_to_hire', label: 'C2H (Contract-to-Hire)' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setEngagementType(opt.id);
                          setContactError(null);
                          if (opt.id === 'contract' || opt.id === 'contract_to_hire') {
                            setValue('email', '');
                            setValue('phone', '');
                          }
                        }}
                        className={`px-2.5 py-1 rounded-[4px] text-[11px] font-medium transition-colors cursor-pointer ${
                          engagementType === opt.id
                            ? 'bg-[#1F4CC4] text-white'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] leading-[16px] text-[var(--text-secondary)]">
                  {contactPolicy.policyExplanation}
                </p>
              </div>
            )}

            {contactError && (
              <div className="rounded-[6px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-[var(--status-danger)]">
                {contactError}
              </div>
            )}

            {contactPolicy.hideAndOmitContactFieldsByDefault && !isSelfOnboarding ? (
              <div className="grid grid-cols-1 gap-3">
                <Input
                  label="LinkedIn URL (Direct candidate email & phone omitted per C2C/C2H policy)"
                  placeholder="https://linkedin.com/in/..."
                  {...register('linkedin_url')}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  label="Email (Required for FTE)"
                  type="email"
                  placeholder="candidate@email.com"
                  {...register('email')}
                  error={errors.email?.message}
                />
                <Input
                  label="Phone (Required for FTE)"
                  placeholder="+91 9876543210"
                  {...register('phone')}
                  error={errors.phone?.message}
                />
                <Input
                  label="LinkedIn URL"
                  placeholder="https://linkedin.com/in/..."
                  {...register('linkedin_url')}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Location"
                placeholder="e.g. Hyderabad, India"
                {...register('location')}
                error={errors.location?.message}
              />
              <Input
                label="Total experience (years)"
                type="number"
                step="0.5"
                {...register('total_experience_years')}
                error={errors.total_experience_years?.message}
              />
            </div>

            <SkillsChipInput
              label="Skills"
              skills={skills}
              onChange={(next) => {
                setSkills(next);
                if (next.length > 0) setSkillsError(null);
              }}
              error={skillsError || undefined}
            />

            <Textarea
              label="Professional summary"
              rows={3}
              placeholder="Domain expertise, systems built, availability..."
              {...register('summary')}
            />

            {/* DPDP Act, 2023 Notice & Consent / Representation Attestation */}
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-[12px] leading-[18px] text-[var(--text-secondary)]">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dpdpNoticeAccepted}
                  onChange={(e) => setDpdpNoticeAccepted(e.target.checked)}
                  className="mt-1 rounded border-[var(--border)]"
                />
                <span>
                  <strong className="text-[var(--text-primary)]">
                    DPDP Act, 2023 Privacy Notice &amp; Consent ({isSelfOnboarding ? 'v2.4.0' : 'v1.2.0'}):
                  </strong>{' '}
                  {isSelfOnboarding
                    ? 'I acknowledge the HireNestOS Personal Data Protection Notice and consent to processing my resume, contact details, and skills for recruitment matching, screening, and authorised client submissions. I understand I may withdraw consent or request erasure at any time.'
                    : 'I attest that the candidate has been provided the HireNestOS DPDP Act, 2023 Personal Data Protection Notice and has authorised profile creation and recruitment matching.'}
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting} disabled={!dpdpNoticeAccepted}>
                {isSelfOnboarding ? 'Complete profile' : 'Create candidate'}
              </Button>
            </div>
          </form>
        ) : (
          /* Bulk Resume Upload & Auto-Parsing Queue */
          <div className="space-y-4">
            <div className="rounded-[8px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)] p-5 text-center space-y-2">
              <div className="mx-auto h-9 w-9 rounded-[8px] bg-[#1F4CC4]/10 text-[#1F4CC4] flex items-center justify-center">
                <Upload className="h-4 w-4" />
              </div>
              <div className="text-[13px] leading-[18px] font-semibold text-[var(--text-primary)]">
                Select multiple resumes for bulk auto-parsing
              </div>
              <p className="text-[12px] leading-[16px] text-[var(--text-secondary)] max-w-md mx-auto">
                Upload multiple PDF, DOC, or DOCX files at once. Each file is hashed with SHA-256 and parsed into structured candidate fields automatically.
              </p>
              <div className="pt-1">
                <label className="inline-flex items-center gap-1.5 h-8 rounded-[6px] bg-[#1F4CC4] px-3.5 text-[12px] leading-[16px] font-medium text-white cursor-pointer hover:bg-[#193EA3] transition-colors">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Select resume files (Multi-select)</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx"
                    onChange={handleBulkFilesChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {bulkItems.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[12px] leading-[16px]">
                  <span className="font-semibold text-[var(--text-primary)]">
                    Parsed candidates queue ({bulkItems.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setBulkItems([])}
                    className="text-[var(--text-secondary)] hover:text-[var(--status-danger)] cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>

                <div className="max-h-[360px] overflow-y-auto rounded-[8px] border border-[var(--border)] divide-y divide-[var(--border)] bg-[var(--surface)]">
                  {bulkItems.map((item) => (
                    <div key={item.id} className="p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0" />
                          <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">
                            {item.file.name}
                          </span>
                          {item.resumeHash && (
                            <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                              SHA-256: {item.resumeHash.slice(0, 10)}…
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'parsing' && (
                            <Badge tone="sky">Parsing...</Badge>
                          )}
                          {item.status === 'ready' && (
                            <Badge tone="emerald">Ready to import</Badge>
                          )}
                          {item.status === 'creating' && (
                            <Badge tone="sky">Importing...</Badge>
                          )}
                          {item.status === 'created' && (
                            <Badge tone="emerald">Imported</Badge>
                          )}
                          {item.status === 'duplicate' && (
                            <Badge tone="amber">{item.statusMessage || 'Duplicate'}</Badge>
                          )}
                          {item.status === 'error' && (
                            <Badge tone="danger">{item.statusMessage || 'Error'}</Badge>
                          )}
                          <button
                            type="button"
                            onClick={() => removeBulkItem(item.id)}
                            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--status-danger)] cursor-pointer"
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <Input
                          label="Full name"
                          value={item.full_name}
                          onChange={(e) =>
                            updateBulkItemField(item.id, 'full_name', e.target.value)
                          }
                        />
                        <Input
                          label="Current title"
                          value={item.current_title}
                          onChange={(e) =>
                            updateBulkItemField(item.id, 'current_title', e.target.value)
                          }
                        />
                        <Input
                          label="Location"
                          value={item.location}
                          onChange={(e) =>
                            updateBulkItemField(item.id, 'location', e.target.value)
                          }
                        />
                        <Input
                          label="Exp (yrs)"
                          type="number"
                          step="0.5"
                          value={String(item.total_experience_years)}
                          onChange={(e) =>
                            updateBulkItemField(
                              item.id,
                              'total_experience_years',
                              Number(e.target.value) || 0
                            )
                          }
                        />
                      </div>

                      {contactPolicy.hideAndOmitContactFieldsByDefault ? (
                        <div className="grid grid-cols-1 gap-2">
                          <Input
                            label="Skills (comma-separated) · Email & Phone omitted per C2C/C2H policy"
                            value={item.skills.join(', ')}
                            onChange={(e) =>
                              updateBulkItemField(
                                item.id,
                                'skills',
                                e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              )
                            }
                          />
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <Input
                            label="Email"
                            placeholder="Required for FTE"
                            value={item.email}
                            onChange={(e) =>
                              updateBulkItemField(item.id, 'email', e.target.value)
                            }
                          />
                          <Input
                            label="Phone"
                            placeholder="Required for FTE"
                            value={item.phone}
                            onChange={(e) =>
                              updateBulkItemField(item.id, 'phone', e.target.value)
                            }
                          />
                          <Input
                            label="Skills (comma-separated)"
                            value={item.skills.join(', ')}
                            onChange={(e) =>
                              updateBulkItemField(
                                item.id,
                                'skills',
                                e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              )
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--border)]">
              <span className="text-[12px] text-[var(--text-secondary)]">
                {readyBulkCount} candidate(s) ready to import
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  loading={bulkSubmitting}
                  disabled={readyBulkCount === 0}
                  onClick={handleBulkSubmit}
                >
                  Import {readyBulkCount > 0 ? `${readyBulkCount} ` : ''}candidate(s)
                </Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <DuplicateDialog
        open={dupOpen}
        onClose={() => {
          setDupOpen(false);
          onClose();
        }}
        matchType={dupMatchType}
        isCandidateSelfOnboarding={isSelfOnboarding}
      />
    </>
  );
};
