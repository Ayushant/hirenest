import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabase";
import { Button, Dialog, Input } from "../ui/kit";
import { useToast } from "../ui/Toast";
export function UserProfileEditor() {
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const internal = profile?.role === "admin" || profile?.role === "recruiter";
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState({
    full_name: "",
    phone: "",
    designation: "",
    department: "",
    business_role: "",
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update(
          internal ? { full_name: value.full_name, phone: value.phone } : value,
        )
        .eq("id", profile.id);
      if (error) throw error;
      await refreshProfile();
      await qc.invalidateQueries();
      setOpen(false);
      toast({ title: "Profile updated", tone: "success" });
    } catch (e) {
      toast({
        title: "Profile update failed",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <button
        className="px-3 py-2 text-left text-[13px] hover:bg-[var(--bg-hover)]"
        onClick={() => {
          if (profile) {
            setValue({
              full_name: profile.full_name,
              phone: profile.phone || "",
              designation: profile.designation || "",
              department: profile.department || "",
              business_role: profile.business_role || "",
            });
            setOpen(true);
          }
        }}
      >
        My profile
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="My contact profile"
      >
        <form onSubmit={save} className="space-y-4">
          <p className="text-[12px]">
            Login email: {profile?.email}. Contact an Admin for organisation,
            system role or reporting changes.
          </p>
          {Object.entries(value)
            .filter(([k]) => !internal || ["full_name", "phone"].includes(k))
            .map(([k, v]) => (
              <Input
                key={k}
                label={k.replaceAll("_", " ")}
                value={v}
                required={k === "full_name"}
                minLength={k === "full_name" ? 2 : undefined}
                onChange={(e) => setValue({ ...value, [k]: e.target.value })}
              />
            ))}
          <Button type="submit" loading={saving}>
            Save profile
          </Button>
        </form>
      </Dialog>
    </>
  );
}
