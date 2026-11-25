import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { Button, Input, Select, Dialog, ErrorState } from "../ui/kit";
import { useToast } from "../ui/Toast";
interface TrialRequest {
  id: string;
  org_id: string;
  org_name: string;
  requested_days: number;
  approved_days?: number | null;
  request_reason: string;
  status: string;
  requested_at: string;
  review_reason: string | null;
  internal_notes: string | null;
  follow_up_date: string | null;
  previous_expiry: string | null;
  new_expiry: string | null;
}
export function TrialExtensionRequests({
  orgId,
  admin = false,
}: {
  orgId?: string;
  admin?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [approvedDays, setApprovedDays] = useState("14");
  const [days, setDays] = useState("14");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [exception, setException] = useState(false);
  const [editing, setEditing] = useState<TrialRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const q = useQuery({
    queryKey: ["trial_requests", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "list_trial_extension_requests",
        { p_org_id: orgId || null },
      );
      if (error) throw error;
      return (data || []) as TrialRequest[];
    },
  });
  const policy = useQuery({
    queryKey: ["trial_policy"],
    enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trial_extension_policy")
        .select("max_standard_extensions")
        .single();
      if (error) throw error;
      return data;
    },
  });
  async function run(decision?: "approved" | "rejected") {
    setSaving(true);
    try {
      const args = decision
        ? {
            p_request_id: editing!.id,
            p_decision: decision,
            p_reason: reason,
            p_notes: notes || null,
            p_follow_up: followUp || null,
            p_exception: exception,
            p_approved_days: Number(approvedDays),
          }
        : { p_org_id: orgId, p_days: Number(days), p_reason: reason };
      const { error } = await supabase.rpc(
        decision ? "review_trial_extension" : "request_trial_extension",
        args,
      );
      if (error) throw error;
      await qc.invalidateQueries();
      setEditing(null);
      setReason("");
      toast({
        title: decision ? "Trial request reviewed" : "Extension requested",
        tone: "success",
      });
    } catch (e) {
      toast({
        title: "Request failed",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border border-[var(--border)] p-4">
      <h2 className="font-semibold">Trial extension requests and history</h2>
      {admin && policy.data && (
        <label className="text-[13px]">
          Normal extension limit per organisation{" "}
          <input
            aria-label="Normal extension limit"
            type="number"
            min="0"
            max="20"
            className="border rounded p-1 w-20"
            defaultValue={policy.data.max_standard_extensions}
            onBlur={async (e) => {
              const n = Number(e.target.value);
              if (!Number.isInteger(n) || n < 0 || n > 20) return;
              const { error } = await supabase
                .from("trial_extension_policy")
                .update({ max_standard_extensions: n })
                .eq("id", true);
              if (error)
                toast({
                  title: "Policy update failed",
                  description: error.message,
                  tone: "error",
                });
              else await qc.invalidateQueries({ queryKey: ["trial_policy"] });
            }}
          />
        </label>
      )}
      {!admin && (
        <div className="space-y-3">
          <Select
            label="Additional days requested"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            options={[14, 21, 30].map((n) => ({
              value: String(n),
              label: `${n} additional days`,
            }))}
          />
          <Input
            label="Reason for extension"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            onClick={() => run()}
            loading={saving}
            disabled={
              reason.trim().length < 3 ||
              q.data?.some((r) => r.status === "pending")
            }
          >
            Request extension
          </Button>
        </div>
      )}
      {q.error && (
        <ErrorState
          message="Could not load extension requests."
          onRetry={() => q.refetch()}
        />
      )}
      {!q.isLoading && !q.error && !q.data?.length && (
        <p className="text-[13px]">No extension requests yet.</p>
      )}
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              {[
                "Organisation",
                "Requested",
                "Days",
                "Reason",
                "Status",
                "Expiry",
                "Follow-up",
                "Action",
              ].map((v) => (
                <th key={v}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.id}>
                <td>{r.org_name}</td>
                <td>{new Date(r.requested_at).toLocaleDateString()}</td>
                <td>Requested: +{r.requested_days}{r.approved_days != null && <div>Approved: +{r.approved_days}</div>}</td>
                <td>
                  {r.request_reason}
                  {admin && r.internal_notes && (
                    <p>Internal: {r.internal_notes}</p>
                  )}
                </td>
                <td>
                  {r.status}
                  {admin && r.review_reason && <p>{r.review_reason}</p>}
                </td>
                <td>
                  {r.new_expiry ? new Date(r.new_expiry).toLocaleString() : "—"}
                </td>
                <td>{r.follow_up_date || "—"}</td>
                <td>
                  {admin && r.status === "pending" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing(r);
                        setApprovedDays(String(r.requested_days));
                        setReason("");
                        setNotes("");
                        setFollowUp("");
                        setException(false);
                      }}
                    >
                      Review
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Review trial extension"
      >
        <div className="space-y-3">
          <p>
            {editing?.org_name} requested +{editing?.requested_days} days. The selected
            approved duration is added to the existing expiry. 30 days requires Platform/Super Admin approval. An old
            expired trial may remain expired after extension.
          </p>
          <Select label="Days to approve" value={approvedDays} onChange={e => setApprovedDays(e.target.value)} options={[14,21,30].map(n=>({value:String(n),label:`${n} days`}))} />
          <Input
            label="Approval / rejection reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Input
            label="Internal notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Input
            label="Follow-up date"
            type="date"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
          />
          <label className="flex gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={exception}
              onChange={(e) => setException(e.target.checked)}
            />
            Explicit exception to normal extension limit (higher approval
            required)
          </label>
          <div className="flex gap-2">
            <Button
              disabled={reason.trim().length < 3}
              loading={saving}
              onClick={() => run("approved")}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3 || saving}
              onClick={() => run("rejected")}
            >
              Reject
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
