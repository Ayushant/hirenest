import type { SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmailViaSmtp } from "./emailService";

/** Uses the existing transactional outbox. Missing email configuration leaves work pending. */
export async function runTrialNotificationJob(sb: SupabaseClient) {
  const queued = await sb.rpc("enqueue_trial_reminders");
  if (queued.error) throw queued.error;
  const claimed = await sb.rpc("claim_trial_notifications", { p_limit: 25 });
  if (claimed.error) throw claimed.error;
  for (const event of claimed.data || []) {
    const { data: subscription, error } = await sb
      .from("account_subscriptions")
      .select("trial_ends_at,subscription_status,plan_id")
      .eq("account_id", event.entity_id)
      .maybeSingle();
    if (error) throw error;
    const stale =
      (event.event_type === "TRIAL_REMINDER_REQUESTED" &&
        subscription &&
        Math.ceil(
          (Date.parse(subscription.trial_ends_at) - Date.now()) / 86_400_000,
        ) !== Number(event.payload.days_remaining)) ||
      !subscription ||
      subscription.plan_id !== "free_trial" ||
      subscription.subscription_status === "active" ||
      Date.parse(subscription.trial_ends_at) !==
        Date.parse(event.payload.trial_ends_at);
    if (stale) {
      await sb
        .from("event_outbox")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          last_error: "Cancelled: trial changed",
        })
        .eq("id", event.id);
      continue;
    }
    const { data: recipients, error: recipientError } = await sb
      .from("profiles")
      .select("email")
      .eq("org_id", event.entity_id)
      .eq("status", "active")
      .in("role", ["vendor_admin", "client_manager"]);
    if (recipientError) throw recipientError;
    const emails = [
      ...new Set(
        (recipients || []).map((r) => r.email as string).filter(Boolean),
      ),
    ];
    const expiry = new Date(subscription.trial_ends_at).toUTCString();
    const subject =
      event.event_type === "TRIAL_EXTENSION_APPROVED"
        ? "Your HireNestOS trial extension is approved"
        : `${Number(event.payload.days_remaining)} days left in your HireNestOS trial`;
    // Recheck immediately before sending: approvals/conversions can happen after a claim.
    const current = await sb
      .from("event_outbox")
      .select("processed_at")
      .eq("id", event.id)
      .single();
    if (current.error) throw current.error;
    if (current.data.processed_at) continue;
    const sent = await sendNotificationEmailViaSmtp({
      to: emails,
      subject,
      html: `<p>${subject}</p><p>Your current trial expiry is ${expiry}.</p><p>Open your HireNestOS subscription page for details.</p>`,
      from: "admin",
    });
    const result = await sb
      .from("event_outbox")
      .update(
        sent.ok
          ? {
              status: "processed",
              processed_at: new Date().toISOString(),
              last_error: null,
              trial_claimed_until: null,
            }
          : {
              last_error: sent.error || "Email delivery failed",
              trial_claimed_until: null,
            },
      )
      .eq("id", event.id);
    if (result.error) throw result.error;
  }
}
