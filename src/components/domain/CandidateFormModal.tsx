import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import {
  Dialog,
  Button,
  Input,
  Textarea,
  SkillsChipInput,
} from '../ui/kit';
import { Phase2ComingSoonCard } from './DomainBadges';
import { DuplicateDialog } from './DuplicateDialog';
import {
  checkCandidateDuplicate,
  createCandidateRpc,
  uploadCandidateResume,
} from '../../api/candidates';
import { computeFileSha256, validateResumeFile } from '../../lib/hash';
import { mapSupabaseError } from '../../lib/errors';
import { useToast } from '../ui/Toast';

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

export const CandidateFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: (candidateId: string) => void;
  isSelfOnboarding?: boolean;
  defaultEmail?: string;
  defaultName?: string;
}> = ({
  open,
  onClose,
  onCreated,
  isSelfOnboarding = false,
  defaultEmail = '',
  defaultName = '',
}) => {
  const { toast } = useToast();
  const [skills, setSkills] = useState<string[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeHash, setResumeHash] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [dupOpen, setDupOpen] = useState(false);
  const [dupMatchType, setDupMatchType] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setResumeFile(null);
      setResumeHash(null);
      return;
    }
    const validationErr = validateResumeFile(file);
    if (validationErr) {
      setFileError(validationErr);
      setResumeFile(null);
      setResumeHash(null);
      return;
    }
    setFileError(null);
    setResumeFile(file);
    const hash = await computeFileSha256(file);
    setResumeHash(hash);
  };

  const onSubmit = async (values: CandidateFormValues) => {
    if (skills.length === 0) {
      setSkillsError('Enter at least one skill.');
      return;
    }
    setSkillsError(null);
    setSubmitting(true);

    try {
      const dupCheck = await checkCandidateDuplicate({
        p_email: values.email || null,
        p_phone: values.phone || null,
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
        p_email: values.email || null,
        p_phone: values.phone || null,
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

      toast({
        title: 'Candidate profile created',
        description: values.full_name,
        tone: 'success',
      });
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

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={isSelfOnboarding ? 'Create candidate profile' : 'Add candidate'}
        description="Computes SHA-256 resume digest and verifies ownership deduplication."
        maxWidth="max-w-[640px]"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Resume Upload + SHA-256 Hash */}
          <div>
            <label className="block text-[12px] leading-[16px] font-medium text-[var(--text-secondary)] mb-1">
              Resume (PDF, DOC, DOCX · Max 10 MB)
            </label>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 h-8 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 text-[13px] leading-[20px] font-medium text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)]">
                <Upload strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <span>{resumeFile ? resumeFile.name : 'Choose file'}</span>
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
              <p className="mt-1 text-[12px] leading-[16px] text-[var(--status-danger)]">
                {fileError}
              </p>
            )}
          </div>

          <Phase2ComingSoonCard
            title="Resume parsing"
            description="Skills and experience are entered manually in v1."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Full name"
              {...register('full_name')}
              error={errors.full_name?.message}
            />
            <Input
              label="Current title"
              placeholder="e.g. Staff Frontend Engineer"
              {...register('current_title')}
              error={errors.current_title?.message}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Email"
              type="email"
              {...register('email')}
              error={errors.email?.message}
            />
            <Input
              label="Phone"
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

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {isSelfOnboarding ? 'Complete profile' : 'Create candidate'}
            </Button>
          </div>
        </form>
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
