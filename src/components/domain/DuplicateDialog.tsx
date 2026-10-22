import React from 'react';
import { Dialog, Button } from '../ui/kit';

export const DuplicateDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  matchType?: string | null;
  reason?: string | null;
  isCandidateSelfOnboarding?: boolean;
}> = ({
  open,
  onClose,
  matchType,
  reason,
  isCandidateSelfOnboarding = false,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    title="Duplicate record detected"
    description="Ownership governance safeguard"
  >
    <div className="space-y-4">
      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-1.5 text-[13px] leading-[20px]">
        <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)] shrink-0" />
          <span>
            {isCandidateSelfOnboarding
              ? 'We found an existing profile. HireNest will link it to your account.'
              : 'HireNest has been notified to review ownership. Nothing was merged.'}
          </span>
        </div>
        {matchType && (
          <p className="text-[var(--text-secondary)]">
            Matched attribute: <span className="font-mono">{matchType}</span>
          </p>
        )}
        {reason && <p className="text-[var(--text-secondary)]">Details: {reason}</p>}
      </div>

      <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
        HireNestOS never auto-merges candidate profiles or overrides source attribution. An
        ownership review flag has been logged for HireNest HQ.
      </p>

      <div className="flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  </Dialog>
);
