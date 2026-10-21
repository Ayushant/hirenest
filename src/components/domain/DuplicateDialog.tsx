import React from 'react';
import { ShieldAlert } from 'lucide-react';
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
    title="Duplicate Record Detected"
    description="Ownership governance safeguard triggered"
  >
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4">
        <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs text-slate-800 dark:text-slate-200">
          {isCandidateSelfOnboarding ? (
            <p className="font-medium">
              We found an existing profile. HireNest will link it to your account.
            </p>
          ) : (
            <p className="font-medium">
              HireNest has been notified to review ownership. Nothing was merged.
            </p>
          )}
          {matchType && (
            <p className="text-slate-600 dark:text-slate-400">
              Matched attribute: <span className="font-mono">{matchType}</span>
            </p>
          )}
          {reason && (
            <p className="text-slate-600 dark:text-slate-400">Details: {reason}</p>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        HireNestOS never auto-merges candidate profiles or overrides source attribution. An
        ownership review flag has been logged for HireNest HQ.
      </p>

      <div className="flex justify-end">
        <Button onClick={onClose}>Understood</Button>
      </div>
    </div>
  </Dialog>
);
