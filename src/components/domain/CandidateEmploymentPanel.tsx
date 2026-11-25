import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import {
  emptyOnboarding,
  candidateEmploymentPayload,
  validateCandidateEmployment,
  type OnboardingDetails,
} from "../../lib/onboarding";
import { OnboardingFields } from "./OnboardingFields";
import { Button, ErrorState, TableSkeleton } from "../ui/kit";
import { useToast } from "../ui/Toast";

export function CandidateEmploymentPanel({
  candidateId,
}: {
  candidateId: string;
}) {
  const [value, setValue] = useState<OnboardingDetails>({ ...emptyOnboarding });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["candidate_employment", candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidate_employment")
        .select("*")
        .eq("candidate_id", candidateId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    setValue(() => ({
        ...emptyOnboarding,
        ...Object.fromEntries(
          Object.entries(q.data || {})
            .filter(([k]) => k in emptyOnboarding)
            .map(([k, v]) => [k, v == null ? "" : String(v)]),
        ),
      }));
  }, [q.data, candidateId]);
  async function save() {
    setSaving(true);
    try {
      validateCandidateEmployment(value);
      const payload = candidateEmploymentPayload(value);
      const { error } = await supabase
        .from("candidate_employment")
        .upsert(
          { candidate_id: candidateId, ...payload },
          { onConflict: "candidate_id" },
        );
      if (error) throw error;
      await qc.invalidateQueries();
      toast({ title: "Employment details saved", tone: "success" });
    } catch (e) {
      toast({
        title: "Could not save employment details",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border border-[var(--border)] p-4">
      <h3 className="font-semibold">Employment and commercial details</h3>
      <p className="text-[12px] text-[var(--text-secondary)]">
        Private to you and recruitment users authorised to manage this
        candidate.
      </p>
      {q.isLoading ? (
        <TableSkeleton rows={3} cols={2} />
      ) : q.error ? (
        <ErrorState message={q.error.message} />
      ) : (
        <>
          <OnboardingFields
            value={value}
            onChange={setValue}
            kind="candidate"
            employmentOnly
          />
          <Button onClick={save} loading={saving}>
            Save employment details
          </Button>
        </>
      )}
    </section>
  );
}
