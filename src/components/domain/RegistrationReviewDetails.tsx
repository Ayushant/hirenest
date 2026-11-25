import { NOTICE_OPTIONS } from "../../lib/onboarding";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { Profile } from "../../types/db";
import { ErrorState } from "../ui/kit";

export function RegistrationReviewDetails({ user }: { user: Profile }) {
  const q = useQuery({
    queryKey: ["signup_candidate", user.id],
    enabled: user.requested_role === "candidate",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id,location,current_title,candidate_employment(*)")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { id, candidate_employment, ...candidate } = q.data || {};
  const employment = Array.isArray(candidate_employment)
    ? candidate_employment[0]
    : candidate_employment;
  const details: Record<string, unknown> = {
    mobile: user.phone,
    designation: user.designation,
    department: user.department,
    business_role: user.business_role,
    ...user.registration_details?.details,
    ...candidate,
    ...employment,
  };
  for (const key of ["candidate_id", "updated_at"]) delete details[key];
  return (
    <div className="space-y-3">
      {q.error && (
        <ErrorState
          message="Could not load candidate employment details."
          onRetry={() => q.refetch()}
        />
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        {Object.entries(details)
          .filter(
            ([, v]) => v != null && v !== "" && (!Array.isArray(v) || v.length),
          )
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12px] text-[var(--text-secondary)]">
                {k.replaceAll("_", " ")}
              </dt>
              <dd className="text-[13px] break-words">
                {Array.isArray(v)
                  ? v.join(", ")
                  : k === "notice_period"
                    ? NOTICE_OPTIONS.find((option) => option.value === v)
                        ?.label || String(v)
                    : String(v)}
              </dd>
            </div>
          ))}
      </dl>
      <p className="text-[12px]">
        Verification:{" "}
        {user.registration_details?.verification_status || "Not recorded"}
      </p>
      {user.registration_details?.review_reason && (
        <p className="text-[12px]">
          Review reason: {user.registration_details.review_reason}
        </p>
      )}
    </div>
  );
}
