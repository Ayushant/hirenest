export type RegistrationKind = "candidate" | "client" | "vendor";
export const NOTICE_OPTIONS = [
  { value: "immediate", label: "Immediate Joiner" },
  { value: "15_30", label: "15–30 Days" },
  { value: "30_plus", label: "30 Days+" },
  { value: "serving", label: "Serving Notice Period" },
];
export interface OnboardingDetails {
  phone: string;
  designation: string;
  department: string;
  business_role: string;
  location: string;
  current_company: string;
  employment_type: string;
  current_ctc: string;
  expected_ctc: string;
  notice_period: string;
  last_working_day: string;
  expected_joining_date: string;
  joining_availability: string;
  current_rate: string;
  expected_rate: string;
  currency: string;
  rate_period: string;
  company_website: string;
  company_location: string;
  industry: string;
  business_classification: string;
  staffing_capabilities: string[];
  engagement_models: string[];
}
export const emptyOnboarding: OnboardingDetails = {
  phone: "",
  designation: "",
  department: "",
  business_role: "",
  location: "",
  current_company: "",
  employment_type: "FTE",
  current_ctc: "",
  expected_ctc: "",
  notice_period: "",
  last_working_day: "",
  expected_joining_date: "",
  joining_availability: "",
  current_rate: "",
  expected_rate: "",
  currency: "INR",
  rate_period: "month",
  company_website: "",
  company_location: "",
  industry: "",
  business_classification: "",
  staffing_capabilities: [],
  engagement_models: [],
};
export function cleanOnboarding(d: OnboardingDetails, kind: RegistrationKind) {
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(d).map(([k, v]) => [
      k,
      typeof v === "string" ? v.trim() || null : v,
    ]),
  );
  if (kind === "candidate") {
    for (const key of [
      "department",
      "business_role",
      "company_website",
      "company_location",
      "industry",
      "business_classification",
      "staffing_capabilities",
      "engagement_models",
    ])
      delete out[key];
    if (d.employment_type === "FTE") {
      for (const key of ["current_rate", "expected_rate", "rate_period"])
        out[key] = null;
      if (d.notice_period !== "serving") out.last_working_day = null;
    } else
      for (const key of [
        "current_ctc",
        "expected_ctc",
        "notice_period",
        "last_working_day",
      ])
        out[key] = null;
  } else
    for (const key of [
      "location",
      "current_company",
      "employment_type",
      "current_ctc",
      "expected_ctc",
      "notice_period",
      "last_working_day",
      "expected_joining_date",
      "joining_availability",
      "current_rate",
      "expected_rate",
      "currency",
      "rate_period",
    ])
      delete out[key];
  return out;
}
export function validateOnboarding(
  d: OnboardingDetails,
  kind: RegistrationKind,
) {
  if (d.phone.replace(/\D/g, "").length < 7)
    throw new Error("Enter a valid mobile number.");
  if (kind === "candidate") {
    if (!d.location.trim()) throw new Error("Current location is required.");
    validateCandidateEmployment(d);
  } else {
    if (
      !d.designation.trim() ||
      !d.department.trim() ||
      !d.company_location.trim() ||
      !d.industry.trim()
    )
      throw new Error(
        "Complete designation, department, company location and industry.",
      );
    if (d.company_website && !/^https?:\/\//i.test(d.company_website))
      throw new Error("Company website must start with https:// or http://.");
    if (
      kind === "vendor" &&
      (!d.staffing_capabilities.length || !d.engagement_models.length)
    )
      throw new Error(
        "Select staffing capabilities and supported engagement models.",
      );
  }
}

export function candidateEmploymentPayload(value: OnboardingDetails) {
  const payload = cleanOnboarding(value, "candidate");
  for (const key of ["phone", "designation", "location"]) delete payload[key];
  return payload;
}

export function validateCandidateEmployment(d: OnboardingDetails) {
  if (!['FTE', 'C2C', 'C2H'].includes(d.employment_type)) throw new Error('Choose FTE, C2C or C2H.');
  for (const key of (d.employment_type === 'FTE' ? ['current_ctc','expected_ctc'] : ['current_rate','expected_rate']) as Array<'current_ctc'|'expected_ctc'|'current_rate'|'expected_rate'>) {
    if (d[key] && (!Number.isFinite(Number(d[key])) || Number(d[key]) < 0)) throw new Error('Salary and rates must be non-negative numbers.');
  }
  if (d.employment_type === 'FTE' && d.notice_period === 'serving' && !d.last_working_day) throw new Error('Enter the last working day when serving notice.');
}
