import React from 'react';
import type { Candidate } from '../../types/db';
import { NOTICE_OPTIONS } from '../../lib/onboarding';

export function CandidateEmploymentSummary({ candidate }: { candidate?: Candidate | null }) {
  const raw = candidate?.candidate_employment;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return <span className="text-[12px] text-[var(--text-tertiary)]">Employment details unavailable</span>;
  const money = (n: number | null) => n == null ? 'Not provided' : `${value.currency} ${Number(n).toLocaleString()}`;
  return <div className="space-y-1 text-[12px] min-w-[210px]">
    <div className="font-semibold">{value.employment_type}{value.current_company ? ` · ${value.current_company}` : ''}</div>
    {value.employment_type === 'FTE' ? <>
      <div>CTC: {money(value.current_ctc)} · ECTC: {money(value.expected_ctc)}</div>
      <div>Notice: {NOTICE_OPTIONS.find(o => o.value === value.notice_period)?.label || 'Not provided'}</div>
      {value.last_working_day && <div>LWD: {value.last_working_day}</div>}
    </> : <div>Current rate: {money(value.current_rate)} · Expected: {money(value.expected_rate)}{value.rate_period ? ` / ${value.rate_period}` : ''}</div>}
    {value.expected_joining_date && <div>Joining: {value.expected_joining_date}</div>}
    {value.joining_availability && <div>Availability: {value.joining_availability}</div>}
  </div>;
}
