import React from "react";
import { Input, Select } from "../ui/kit";
import {
  NOTICE_OPTIONS,
  type OnboardingDetails,
  type RegistrationKind,
} from "../../lib/onboarding";

export function OnboardingFields({
  value,
  onChange,
  kind,
  employmentOnly = false,
}: {
  value: OnboardingDetails;
  onChange: (value: OnboardingDetails) => void;
  kind: RegistrationKind;
  employmentOnly?: boolean;
}) {
  const set = (key: keyof OnboardingDetails, next: string | string[]) =>
    onChange({ ...value, [key]: next });
  const input = (
    key: keyof OnboardingDetails,
    label: string,
    type = "text",
  ) => (
    <Input
      key={key}
      label={label}
      type={type}
      value={String(value[key] ?? "")}
      onChange={(e) => set(key, e.target.value)}
      {...(type === "number" ? { min: 0, step: "0.01" } : {})}
    />
  );
  const checks = (
    key: "staffing_capabilities" | "engagement_models",
    label: string,
    options: string[],
  ) => (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-4">
        {options.map((option) => (
          <label key={option} className="flex gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={value[key].includes(option)}
              onChange={(e) =>
                set(
                  key,
                  e.target.checked
                    ? [...value[key], option]
                    : value[key].filter((v) => v !== option),
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="space-y-4">
      {!employmentOnly && (
        <div className="grid gap-4 sm:grid-cols-2">
          {input("phone", "Mobile number", "tel")}
          {input(
            "designation",
            kind === "candidate"
              ? "Current designation (if applicable)"
              : "Designation",
          )}
          {kind === "candidate" ? (
            input("location", "Current location")
          ) : (
            <>
              {input("department", "Department")}
              {input("business_role", "Business role / responsibility")}
            </>
          )}
        </div>
      )}
      {kind === "candidate" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {input("current_company", "Current / last company (if applicable)")}
            <Select
              label="Employment type"
              value={value.employment_type}
              onChange={(e) => set("employment_type", e.target.value)}
              options={["FTE", "C2C", "C2H"].map((v) => ({
                value: v,
                label: v,
              }))}
            />
            <Input
              label="Currency (e.g. INR, USD)"
              value={value.currency}
              maxLength={3}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
            />
            {value.employment_type === "FTE" ? (
              <>
                {input(
                  "current_ctc",
                  "Current annual CTC (optional)",
                  "number",
                )}
                {input(
                  "expected_ctc",
                  "Expected annual CTC (optional)",
                  "number",
                )}
                <Select
                  label="Notice period"
                  value={value.notice_period}
                  onChange={(e) => set("notice_period", e.target.value)}
                  options={[
                    { value: "", label: "Select if applicable" },
                    ...NOTICE_OPTIONS,
                  ]}
                />
                {value.notice_period === "serving" &&
                  input("last_working_day", "Last working day", "date")}
              </>
            ) : (
              <>
                {input(
                  "current_rate",
                  "Current contract rate (optional)",
                  "number",
                )}
                {input(
                  "expected_rate",
                  "Expected contract rate (optional)",
                  "number",
                )}
                <Select
                  label="Rate per"
                  value={value.rate_period}
                  onChange={(e) => set("rate_period", e.target.value)}
                  options={["hour", "day", "month", "year"].map((v) => ({
                    value: v,
                    label: v,
                  }))}
                />
              </>
            )}
            {input(
              "expected_joining_date",
              "Expected joining date (if known)",
              "date",
            )}
            {input("joining_availability", "How soon can you join?")}
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Leave current company and current salary/rate blank if you are a
            fresher or they do not apply.
          </p>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {input("company_website", "Company website (optional)", "url")}
            {input("company_location", "Company location")}
            {input("industry", "Industry / business type")}
            {kind === "vendor" &&
              input("business_classification", "Business classification")}
          </div>
          {kind === "vendor" && (
            <>
              {checks("staffing_capabilities", "Staffing capabilities", [
                "IT",
                "Non-IT",
              ])}
              {checks("engagement_models", "Engagement models supported", [
                "FTE",
                "C2C",
                "C2H",
              ])}
              <p className="text-[12px] text-[var(--text-secondary)]">
                The primary contact is the authorised organisation
                representative. HQ assigns agency administrator access after
                verification.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
