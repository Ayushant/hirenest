import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import {
  Button,
  Dialog,
  ErrorState,
  Input,
  Select,
  TableSkeleton,
} from "../ui/kit";
import { useToast } from "../ui/Toast";
interface Member {
  id: string;
  full_name: string;
  phone: string | null;
  email: string;
  designation: string | null;
  department: string | null;
  business_role: string | null;
  role: string;
  system_role: string;
  status: string;
  reporting_manager_id: string | null;
  reporting_manager: string | null;
}
export function OrganizationTeam({
  orgId,
  internal = false,
}: {
  orgId: string;
  internal?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);
  const q = useQuery({
    queryKey: ["organization_team", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("organization_team", {
        p_org_id: orgId,
      });
      if (error) throw error;
      return (data || []) as Member[];
    },
  });
  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_organization_member", {
        p_user_id: editing.id,
        p_details: Object.fromEntries(
          [
            "full_name",
            "phone",
            "designation",
            "department",
            "business_role",
            "reporting_manager_id",
          ].map((k) => [k, editing[k as keyof Member]]),
        ),
      });
      if (error) throw error;
      await qc.invalidateQueries();
      setEditing(null);
      toast({ title: "Team member updated", tone: "success" });
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  if (q.isLoading) return <TableSkeleton rows={3} cols={6} />;
  if (q.error)
    return (
      <ErrorState
        message="Could not load organisation team."
        onRetry={() => q.refetch()}
      />
    );
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Organisation users / team</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              {[
                "Name",
                "Mobile",
                "Email",
                "Designation",
                "Department",
                "Business role",
                "System role",
                "Status",
                "Reporting manager",
                "Actions",
              ].map((v) => (
                <th key={v}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.id}>
                <td>{m.full_name}</td>
                <td>{m.phone || "—"}</td>
                <td>{m.email}</td>
                <td>{m.designation || "—"}</td>
                <td>{m.department || "—"}</td>
                <td>{m.business_role || "—"}</td>
                <td>{m.system_role}</td>
                <td>{m.status}</td>
                <td>{m.reporting_manager || "—"}</td>
                <td>
                  {!internal && (
                    <Button size="sm" onClick={() => setEditing(m)}>
                      Edit
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
        title="Team member details"
      >
        {editing && (
          <div className="space-y-3">
            {[
              "full_name",
              "phone",
              "designation",
              "department",
              "business_role",
            ].map((k) => (
              <Input
                key={k}
                label={k.replaceAll("_", " ")}
                value={editing[k as keyof Member] || ""}
                onChange={(e) =>
                  setEditing({ ...editing, [k]: e.target.value })
                }
              />
            ))}
            <Select
              label="Reporting manager"
              value={editing.reporting_manager_id || ""}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  reporting_manager_id: e.target.value || null,
                })
              }
              options={[
                { value: "", label: "None" },
                ...(q.data || [])
                  .filter((m) => m.id !== editing.id && m.status === "active")
                  .map((m) => ({ value: m.id, label: m.full_name })),
              ]}
            />
            <Button onClick={save} loading={saving}>
              Save details
            </Button>
          </div>
        )}
      </Dialog>
    </section>
  );
}
