import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { Button, Input, Select } from "../ui/kit";
import { useToast } from "../ui/Toast";
export function PricingOffers({
  orgs,
}: {
  orgs: Array<{ id: string; name: string }>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState({
    org_id: "",
    plan_id: "growth",
    billing_cycle: "monthly",
    amount_inr: "",
    reason: "",
    expires_at: "",
  });
  const q = useQuery({
    queryKey: ["pricing_offers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_pricing_offers")
        .select("*");
      if (error) throw error;
      return data || [];
    },
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("organization_pricing_offers")
        .upsert(
          {
            ...value,
            amount_inr: Number(value.amount_inr),
            expires_at: new Date(value.expires_at).toISOString(),
            approved_by: data.user?.id,
          },
          { onConflict: "org_id,plan_id,billing_cycle" },
        );
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["pricing_offers"] });
      toast({ title: "Pricing offer saved", tone: "success" });
    } catch (e) {
      toast({
        title: "Offer failed",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-3 border rounded-lg p-4">
      <h2 className="font-semibold">Early-adopter / negotiated pricing</h2>
      <p className="text-[12px]">
        Separate from trial extensions. Uses the selected plan’s existing
        features and entitlements.
      </p>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Organisation"
          required
          value={value.org_id}
          onChange={(e) => setValue({ ...value, org_id: e.target.value })}
          options={[
            { value: "", label: "Select organisation" },
            ...orgs.map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
        <Select
          label="Existing plan"
          value={value.plan_id}
          onChange={(e) => setValue({ ...value, plan_id: e.target.value })}
          options={["growth", "scale", "enterprise"].map((v) => ({
            value: v,
            label: v,
          }))}
        />
        <Select
          label="Billing cycle"
          value={value.billing_cycle}
          onChange={(e) =>
            setValue({ ...value, billing_cycle: e.target.value })
          }
          options={["monthly", "annual"].map((v) => ({ value: v, label: v }))}
        />
        <Input
          label="Approved price per billing cycle (INR, excluding GST)"
          required
          type="number"
          min="0.01"
          step="0.01"
          value={value.amount_inr}
          onChange={(e) => setValue({ ...value, amount_inr: e.target.value })}
        />
        <Input
          label="Approval reason / feedback received"
          required
          minLength={3}
          value={value.reason}
          onChange={(e) => setValue({ ...value, reason: e.target.value })}
        />
        <Input
          label="Offer expiry"
          required
          type="datetime-local"
          value={value.expires_at}
          onChange={(e) => setValue({ ...value, expires_at: e.target.value })}
        />
        <Button type="submit" loading={saving}>
          Save approved offer
        </Button>
      </form>
      {q.error && <p role="alert">Could not load pricing offers.</p>}
      <ul className="text-[13px] space-y-2">
        {q.data?.map((o) => (
          <li key={`${o.org_id}:${o.plan_id}:${o.billing_cycle}`}>
            {orgs.find((org) => org.id === o.org_id)?.name}: {o.plan_id}, INR{" "}
            {o.amount_inr}/{o.billing_cycle}, valid until{" "}
            {new Date(o.expires_at).toLocaleString()}
          </li>
        ))}
      </ul>
    </section>
  );
}
