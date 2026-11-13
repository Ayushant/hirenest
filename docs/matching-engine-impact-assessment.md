# HireNestOS — Deterministic Matching Engine: Phase 1 Audit, Impact Assessment and Plan

Status: **proposal for approval. No engine code was changed for this document.**
Scope: Phases 1 and 2 of the delivery plan. Phases 3 to 5 need sign-off first.

## 1. Disclosure: production changes made before this brief

Two commits changed the live client-side engine *before* this brief arrived: `eaa469b` (score from requirement-defined
skills, skill-coverage cap, IT/Non-IT cap) and `80e6c69` (role alignment, criteria-based domain, location deduction).
Both are deployed. They reduce false positives but are heuristic (regex classifiers) and do not meet this brief.
**Decision needed:** keep them as an interim guard until the new engine passes acceptance, or revert them now.
Recommendation: keep, because reverting reopens the false positives; replace them when the new engine ships behind its flag.

## 2. Phase 1 — what actually produces scores today

There are **two** matching implementations, not one:

| | Where | Version label | What it does |
|---|---|---|---|
| A. Database | `supabase/01_schema.sql` `private.upsert_match`, fired by triggers on `requirements` (skills, experience, status) and `candidates` (skills, experience) | `deterministic-v1` | Exact lowercase skill equality, 70% skills + 30% experience. Writes `candidate_matches`. |
| B. Client | `src/lib/matchingEngine.ts` `computeFineTunedCandidateMatch`, called from `src/api/candidates.ts` (requirement side ~L344, candidate side ~L552) and `src/lib/recruiterValidation.ts` L408 | `v2.2-4d-weighted` | Four weighted dimensions. **This is what the Matches screens display.** It recomputes in the browser and keeps only the DB row's `override_score`. |

The two can disagree, and B is not stored with its evidence in a versioned, replayable way. This already conflicts with
"do not introduce a second matching engine": the first job of the new engine is to retire one of the two paths.

## 3. Root causes of the reported false positives (engine B, before the interim guards)

1. **Dimensions that do not depend on skills carried the score.** Experience 25%, seniority 15% and domain 20% could add
   about 50 points with zero skill overlap. A senior engineer therefore scored well against Field Sales on experience and seniority alone.
2. **Domain defaulted to 75** when the requirement matched no domain cluster (`computeDomainMatchScore`, empty `reqDomains`). Field Sales has no cluster, so every candidate got a free 15 points.
3. **Skills were inferred, not evidenced.** `extractCandidateProfileSignals` runs regex detectors over title, summary and the whole `parsed_data` JSON, then adds "inferred" skills. `extractRequirementAtomicSkills` also inferred skills from the title and description.
4. **Loose matching credit.** `evaluateSingleSkillMatch` gives 0.94 for substring matches, 0.68 to 0.86 for "ecosystem cluster" equivalents, and up to 0.85 for single-token overlap ("Azure" matches "Azure AI Search"). Generic overlap therefore reads as a match.
5. **No role-family concept.** Nothing stopped an IT profile ranking against a Non-IT requirement. The AI Delivery Architect vs Siemens Opcenter MES case is the same mechanism: shared generic technical tokens, no MES-specific evidence required.
6. **Engine A has no role logic at all** (exact skill match plus years), and the `skills` array on the candidate is trusted as-is.

## 4. Gaps against the brief (what the schema cannot express today)

`requirements` has: title, description, `skills[]`, min/max experience, location, work mode, employment type.
It has **no**: role family, primary role, mandatory vs preferred vs excluded skills, strict-gate flags, industry/domain, other eligibility conditions.
`candidates` has no employment history, no per-job titles/responsibilities, and no resume **version** id
(`resume_path` / `resume_hash` hold only the latest file). `candidate_matches` has no rule version beyond `engine_version`, no eligibility status, no per-evidence rows.
The resume parser (`src/lib/resumeParser.ts`) returns only name, title, contact, location, total years, skills, summary. It does not extract job history, so
"relevant experience evidence" and "domain evidence" cannot yet be produced from the resume.

## 5. Proposed deterministic specification (Phase 2 draft)

**Pipeline (fixed order):** validate records, role-family check, eligibility gates, mandatory skills, preferred skills, relevant experience, domain, location/work mode, score, store evidence, present.

**Score (default weights, configurable and versioned):** mandatory skills 50, preferred skills 20, role and experience 15, domain 10, location and work mode 5.

**Eligibility outcomes:** `eligible`, `review_required`, `ineligible`. Strict mandatory skill missing => `ineligible` (or `review_required` per rule), never rescued by preferred skills or experience. Excluded skill present => per rule. Role-family mismatch => `ineligible` by default.
**Presentation bands:** Strong (eligible, score at or above X), Potential, Recruiter review required, Ineligible (shown in a separate list). Thresholds X are configuration, to be set from historical outcomes.

**Role families (controlled list, v1 proposal):** Software Engineering, DevOps/Cloud/SRE, Data/AI, QA/Testing, Enterprise Applications (SAP/Salesforce/ServiceNow/MES), Network/Security/Infra, IT Support, Product/Project (IT), Sales, Business Development, Marketing, HR/Recruitment, Finance/Accounting, Operations/Logistics, Customer Support/BPO, Admin/Office, Healthcare, Education, Manufacturing/Engineering (non-IT), Other. Each family carries `it | non_it`. Cross-match only through an explicit `role_family_compatibility` table (default: none between IT and Non-IT).

**Skill dictionary:** `skill_id`, display name, category, role-family applicability, active flag, and `skill_synonyms` (reviewable, versioned, approved_by). Generic skills (communication, leadership, Excel, SQL, project management) are flagged `generic = true` and can never establish role compatibility or satisfy a strict mandatory skill on their own. No equivalence unless a synonym row exists; no ecosystem clusters, no substring or token matching.

**Evidence:** every match stores candidate id, resume version id, requirement id, matched/missing mandatory, matched preferred, experience evidence (source text span), domain evidence, role-family result, eligibility result with reasons, score breakdown, rule version, timestamp. Absent evidence is shown as "not found / unverified".

**Determinism:** pure function of (requirement criteria, resume-extracted facts, rule version). No AI, embeddings, previous match scores or other candidates' data.

## 6. Impact assessment

| Area | Impact | Needs approval |
|---|---|---|
| Database | New tables: skill dictionary, synonyms, role families + compatibility, rule versions, resume versions, match evidence. New columns on `requirements` (role family, mandatory/preferred/excluded skills, strict flags, domain) and `candidate_matches` (eligibility status, rule version, evidence). | **Yes — brief forbids unapproved migrations** |
| Requirement creation UI/API | Must capture the new criteria; existing requirements need a one-time classification review. | Yes |
| Resume parsing | Must extract job history (titles, responsibilities, dates) and be versioned per upload. Deterministic parsing only (no LLM), so quality depends on resume format; unparseable resumes become `review_required`. | Yes |
| Matches UI | New status bands, evidence panel, ineligible list, override with mandatory reason (already supported by `override_match`; audit exists via event outbox). | Low |
| Existing engines | Retire engine B's recompute in the browser; make one server-side function the single writer to `candidate_matches`. Keep `deterministic-v1` rows until cutover. | Yes |
| Submission, ownership, tenancy, RBAC | Unchanged. The engine only reads candidates/requirements and writes match rows; submission orchestration and ownership are untouched. | No |
| Vendors / clients | No new data exposure. Evidence access reuses existing candidate visibility rules; cross-tenant denial must be re-tested (acceptance test 13). | No |
| Performance | Recompute on resume-version change for open requirements only; batched. | No |

## 7. Implementation plan

- **Phase 3 (behind a flag `MATCH_ENGINE=deterministic_v2`, default off):** build the engine as one pure module plus one server entry point; shadow-run alongside the current path and store results separately (no UI change).
- **Phase 4:** acceptance tests 1 to 14 as automated tests with fixture candidates/requirements (Field Sales vs Senior Software Engineer / AWS DevOps; Siemens Opcenter MES vs generic Java and AI Delivery Architect; strict-gate and synonym cases; determinism and resume-version recompute; override reason; cross-tenant denial). Run old vs new on manually verified historical pairs.
- **Phase 5:** side-by-side comparison report for HireNest approval; progressive rollout per organisation; the current path stays until explicit sign-off.

## 8. Decisions needed from HireNest before Phase 3

1. Approve the schema changes in section 6 (or restrict to a smaller first release).
2. Keep or revert interim commits `eaa469b` / `80e6c69`.
3. Who maintains the skill dictionary and role-family compatibility (Platform Admin only?).
4. Default eligibility outcome when a strict skill is missing: `ineligible` or `review_required`.
5. Provide a sample of verified historical requirement-candidate pairs (including the three reported cases).
6. Confirm deterministic job-history extraction from resumes is acceptable (reduced coverage vs an AI parser).
