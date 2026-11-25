import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', email_confirmed_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
`);

const root = new URL("../", import.meta.url);
for (const file of readdirSync(root)
  .filter(
    (f) => f.endsWith(".sql") && !f.startsWith("02_") && !f.includes("_seed"),
  )
  .sort())
  await db.exec(readFileSync(new URL(file, root), "utf8"));
const q = async (sql, params) => (await db.query(sql, params)).rows;
let count = 0;
function check(value, message) {
  assert.ok(value, message);
  count++;
  console.log("PASS", message);
}
async function denied(fn, message) {
  await assert.rejects(fn);
  count++;
  console.log("PASS", message);
}
async function as(id, fn) {
  await db.exec("set role authenticated");
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await fn();
  } finally {
    await db.exec(
      "reset role;select set_config('request.jwt.claim.sub','',false)",
    );
  }
}
async function signup(name, intent, details = {}) {
  const id = crypto.randomUUID();
  await q(
    "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
    [
      id,
      name + "@test.invalid",
      {
        full_name: name,
        signup_intent: intent,
        company_name: name + " Company",
        ...(Object.keys(details).length
          ? { onboarding_version: "1", onboarding: details }
          : {}),
      },
    ],
  );
  return id;
}
const details = {
  phone: "9876543210",
  designation: "Engineer",
  location: "Nagpur",
  current_company: "Last Company",
  employment_type: "FTE",
  current_ctc: "500000",
  expected_ctc: "700000",
  notice_period: "serving",
  last_working_day: "2027-01-01",
  currency: "INR",
};
const admin = await signup("Admin", "candidate");
await q(
  "update public.profiles set role='admin',org_id=(select id from public.organizations where type='internal') where id=$1",
  [admin],
);
const candidate = await signup("Candidate", "candidate", details);
const cand = (
  await q("select * from public.candidates where user_id=$1", [candidate])
)[0];
check(!!cand, "candidate signup creates linked candidate upfront");
check(
  (
    await q(
      "select current_ctc from public.candidate_employment where candidate_id=$1",
      [cand.id],
    )
  )[0].current_ctc === "500000.00",
  "salary is stored in private employment record",
);
check(
  !(
    await q("select raw_user_meta_data from auth.users where id=$1", [
      candidate,
    ])
  )[0].raw_user_meta_data.onboarding,
  "onboarding payload removed from mutable auth metadata",
);
await as(candidate, () =>
  q(
    "update public.profiles set phone='9876543211',full_name='Candidate Updated' where id=$1",
    [candidate],
  ),
);
check(
  (
    await q(
      "select phone from public.candidate_contacts where candidate_id=$1",
      [cand.id],
    )
  )[0].phone === "9876543211",
  "profile mobile synchronises linked candidate contacts",
);
check(
  (await q("select full_name from public.candidates where id=$1", [cand.id]))[0]
    .full_name === "Candidate Updated",
  "profile name synchronises linked candidate",
);
await as(candidate, () =>
  denied(
    () => q("update public.profiles set role='admin' where id=$1", [candidate]),
    "candidate cannot self-promote",
  ),
);
const vendorDetails = {
  phone: "9876543222",
  designation: "Agency Director",
  department: "Recruitment",
  business_role: "Agency representative",
  company_website: "https://agency.test",
  company_location: "Nagpur",
  industry: "Staffing",
  business_classification: "Staffing agency",
  staffing_capabilities: ["IT", "Non-IT"],
  engagement_models: ["FTE", "C2C"],
};
const vendor = await signup("Vendor", "vendor", vendorDetails);
const review = async (user, role, name, type, org = null) =>
  as(admin, () =>
    q(
      "select public.admin_review_registration($1,'approved','Verified company',$2,$3,$4,$5) as id",
      [user, role, org, name, type],
    ),
  );
const org = (
  await review(vendor, "vendor_admin", "Vendor Company", "vendor")
)[0].id;
check(
  (
    await q(
      "select primary_contact_user_id,website from public.organizations where id=$1",
      [org],
    )
  )[0].primary_contact_user_id === vendor,
  "approved organisation links primary contact",
);
check(
  (await q("select website from public.organizations where id=$1", [org]))[0]
    .website === "https://agency.test",
  "company fields populate organisation automatically",
);
const before = (
  await q("select count(*)::int as n from public.organizations")
)[0].n;
await review(vendor, "vendor_admin", "Vendor Company", "vendor");
check(
  (await q("select count(*)::int as n from public.organizations"))[0].n ===
    before,
  "approval retry creates no duplicate organisation",
);
const bad = await signup("BadVendor", "vendor");
await denied(
  () => review(bad, "vendor_admin", "WrongType", "client"),
  "mismatched role and organisation rejected",
);
check(
  (await q("select count(*)::int as n from public.organizations"))[0].n ===
    before,
  "failed approval rolls back organisation creation",
);
await as(candidate, () =>
  denied(
    () => q("select public.organization_team($1)", [org]),
    "candidate cannot read another organisation team",
  ),
);
await as(candidate, () =>
  denied(
    () => q("select public.organization_team(null)"),
    "null organisation cannot bypass team permission",
  ),
);
const client = await signup("Client", "client");
const clientOrg = (
  await review(client, "client_manager", "Client Company", "client")
)[0].id;
await as(client, async () => {
  check(
    (await q("select * from public.candidate_employment")).length === 0,
    "client cannot read candidate commercial fields",
  );
  check(
    (
      await q("select * from public.registration_details where user_id=$1", [
        vendor,
      ])
    ).length === 0,
    "client cannot read signup verification details",
  );
  await denied(
    () => q("select public.get_org_subscription($1)", [org]),
    "cross-organisation subscription access denied",
  );
});
await as(vendor, async () => {
  const team = (
    await q("select public.organization_team($1) as team", [org])
  )[0].team;
  check(
    team.length === 1 && team[0].id === vendor,
    "organisation admin sees own team",
  );
  await denied(
    () =>
      q("select public.admin_review_registration($1,'rejected','No access')", [
        bad,
      ]),
    "vendor cannot review signups",
  );
  await denied(
    () =>
      q("select public.update_organization_member($1,$2)", [
        client,
        { full_name: "Hijacked" },
      ]),
    "vendor cannot edit another organisation user",
  );
});
const request = async (days) =>
  as(
    vendor,
    async () =>
      (
        await q("select public.request_trial_extension($1,$2,$3) as id", [
          org,
          days,
          "Need more evaluation time",
        ])
      )[0].id,
  );
const approve = async (id, exception = false) =>
  as(admin, () =>
    q(
      "select public.review_trial_extension($1,'approved','Usage reviewed','Internal note','2027-01-10',$2)",
      [id, exception],
    ),
  );
const initial = (
  await q(
    "select trial_ends_at from public.account_subscriptions where account_id=$1",
    [org],
  )
)[0].trial_ends_at;
const requestId = await request(14);
await approve(requestId);
let expiry = (
  await q(
    "select trial_ends_at from public.account_subscriptions where account_id=$1",
    [org],
  )
)[0].trial_ends_at;
check(
  Date.parse(expiry) - Date.parse(initial) === 14 * 86400000,
  "extension adds days to existing expiry",
);
await approve(requestId);
check(
  (
    await q(
      "select trial_ends_at from public.account_subscriptions where account_id=$1",
      [org],
    )
  )[0].trial_ends_at.toISOString() === expiry.toISOString(),
  "review retry cannot extend twice",
);
const second = await request(21);
await denied(
  () => approve(second),
  "repeated extension requires explicit exception",
);
await approve(second, true);
check(
  (
    await q(
      "select trial_ends_at from public.account_subscriptions where account_id=$1",
      [org],
    )
  )[0].trial_ends_at -
    initial ===
    35 * 86400000,
  "approved exception adds exactly requested days",
);
await as(vendor, async () => {
  const rows = (
    await q("select public.list_trial_extension_requests($1) as rows", [org])
  )[0].rows;
  check(
    rows.length === 2 && !("internal_notes" in rows[0]),
    "organisation history excludes internal approval notes",
  );
});
const recruiter = await signup("Recruiter", "vendor");
await q(
  "update public.profiles set role='recruiter',status='active',org_id=(select id from public.organizations where type='internal') where id=$1",
  [recruiter],
);
await q(
  "insert into public.staff_members(user_id,system_role) values($1,'recruiter')",
  [recruiter],
);
await as(recruiter, () => checkAccess());
await as(recruiter, async () =>
  check(
    (await q("select id from public.profiles where id=$1", [admin])).length ===
      0,
    "recruiter cannot inspect other employee contacts without user-management permission",
  ),
);

async function checkAccess() {
  check(
    (await q("select * from public.candidate_employment")).length === 0,
    "unassigned recruiter cannot read candidate commercial fields",
  );
}
await q(
  "update public.account_subscriptions set trial_ends_at=now()+interval '10 days',subscription_status='trialing' where account_id=$1",
  [org],
);
await q("select public.enqueue_trial_reminders()");
await q("select public.enqueue_trial_reminders()");
check(
  (
    await q(
      "select count(*)::int as n from public.event_outbox where event_type='TRIAL_REMINDER_REQUESTED' and entity_id=$1",
      [org],
    )
  )[0].n === 1,
  "reminder scheduler deduplicates current expiry milestone",
);
await q(
  "update public.account_subscriptions set subscription_status='active',plan_id='growth' where account_id=$1",
  [org],
);
check(
  (
    await q(
      "select count(*)::int as n from public.event_outbox where entity_id=$1 and event_type='TRIAL_REMINDER_REQUESTED' and processed_at is null",
      [org],
    )
  )[0].n === 0,
  "paid conversion cancels pending reminders",
);
await denied(
  () => request(14),
  "paid organisation cannot request trial extension",
);
await db.exec("set role anon");
await denied(
  () => q("select * from public.candidate_employment"),
  "anonymous commercial reads denied",
);
await db.exec("reset role");

await as(admin, async () => {
  const before = (
    await q("select public.get_org_subscription($1) as sub", [org])
  )[0].sub.trial_ends_at;
  await q(
    "insert into public.organization_pricing_offers(org_id,plan_id,billing_cycle,amount_inr,reason,expires_at) values($1,'growth','monthly',2500,'Active feedback participant',now()+interval '30 days')",
    [org],
  );
  check(
    (await q("select public.get_org_subscription($1) as sub", [org]))[0].sub
      .trial_ends_at === before,
    "pricing offer does not change trial expiry",
  );
});
await as(vendor, async () => {
  check(
    (await q("select * from public.organization_pricing_offers")).length === 1,
    "organisation admin can read own pricing offer",
  );
  await denied(
    () =>
      q(
        "insert into public.organization_pricing_offers(org_id,plan_id,billing_cycle,amount_inr,reason,expires_at) values($1,'enterprise','monthly',1,'Forged offer',now()+interval '1 day')",
        [org],
      ),
    "vendor cannot approve its own discount",
  );
});
await as(client, () => checkOtherPricing());
async function checkOtherPricing() {
  check(
    (
      await q(
        "select * from public.organization_pricing_offers where org_id=$1",
        [org],
      )
    ).length === 0,
    "another organisation cannot see negotiated pricing",
  );
}
const pending = await signup("PendingUser", "vendor");
await as(pending, async () => {
  await denied(
    () => q("select public.list_trial_extension_requests(null)"),
    "pending user cannot bypass request visibility with null organisation",
  );
  await denied(
    () =>
      q("select public.request_trial_extension($1,14,'Forged request')", [org]),
    "pending user cannot request extension for another organisation",
  );
});
await as(admin, () =>
  q(
    "select public.admin_review_registration($1,'rejected','Unable to verify details')",
    [pending],
  ),
);
check(
  (
    await q(
      "select verification_status,review_reason from public.registration_details where user_id=$1",
      [pending],
    )
  )[0].verification_status === "rejected",
  "rejection persists review decision",
);
check(
  (
    await q(
      "select count(*)::int as n from public.audit_logs where table_name='registration_details' and new_data->>'user_id'=$1",
      [pending],
    )
  )[0].n >= 2,
  "registration and review changes are audited",
);
await as(candidate, () =>
  denied(
    () =>
      q(
        "update public.candidate_contacts set email='other@test.invalid' where candidate_id=$1",
        [cand.id],
      ),
    "linked candidate email cannot diverge from verified login email",
  ),
);
const contractor = await signup("Contractor", "candidate", {
  phone: "9876543999",
  designation: "Consultant",
  location: "Nagpur",
  employment_type: "C2C",
  currency: "USD",
  current_rate: "50",
  expected_rate: "65",
  rate_period: "hour",
});
const contractRow = (
  await q(
    "select e.* from public.candidate_employment e join public.candidates c on c.id=e.candidate_id where c.user_id=$1",
    [contractor],
  )
)[0];
check(
  contractRow.employment_type === "C2C" &&
    contractRow.expected_rate === "65.00" &&
    contractRow.currency === "USD",
  "contract signup captures rate, currency and billing period",
);
check(
  contractRow.current_ctc === null && contractRow.notice_period === null,
  "contract signup does not require FTE salary or notice fields",
);
await denied(
  () =>
    signup("InvalidContract", "candidate", {
      phone: "9876543888",
      designation: "Consultant",
      location: "Nagpur",
      employment_type: "C2H",
      currency: "INR",
      current_ctc: "500000",
    }),
  "server rejects FTE salary fields on a contract registration",
);
await as(admin, () =>
  denied(
    () => q("delete from public.trial_extension_policy"),
    "normal extension policy cannot be deleted through the application",
  ),
);
{
// Uploads must persist private employment atomically and apply joining policy per job.
const clientOrg = (await q("insert into public.organizations(type,name) values('client','Availability Client') returning id"))[0].id;
await q("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
const reqId = (await q("insert into public.requirements(client_org_id,title,description,status,created_by) values($1,'Immediate Role','SQL developer. Immediately only.','open',$2) returning id",[clientOrg,admin]))[0].id;
await q("insert into public.requirement_vendor_shares(requirement_id,vendor_org_id,shared_by,due_at) values($1,$2,$3,now()+interval '2 days')",[reqId,org,admin]);
await q("select set_config('request.jwt.claim.sub','',false)");
async function uploadEmployment(type, notice, extra={}) {
  return as(vendor,async()=> (await q("select public.create_candidate_with_employment($1,$2) as result",[
    {p_full_name:'Upload '+crypto.randomUUID(),p_current_title:'SQL Developer',p_location:'Nagpur',p_skills:['SQL']},
    {employment_type:type,currency:'INR',...(type==='FTE' ? {current_ctc:500000,expected_ctc:700000,notice_period:notice} : {current_rate:2000,expected_rate:2500,rate_period:'day'}),...extra}
  ]))[0].result);
}
const uploadFte = await uploadEmployment('FTE','15_30');
check(uploadFte.status==='created' && (await q("select employment_type,current_ctc from public.candidate_employment where candidate_id=$1",[uploadFte.candidate_id]))[0].current_ctc==='500000.00','single/bulk RPC stores FTE salary alongside the candidate');
for (const type of ['C2C','C2H']) {
 const result = await uploadEmployment(type,null);
 check((await q("select employment_type,expected_rate from public.candidate_employment where candidate_id=$1",[result.candidate_id]))[0].employment_type===type,type+' uploads retain contract rate instead of FTE fields');
}
const beforeInvalid=(await q("select count(*)::int as n from public.candidates"))[0].n;
await denied(()=>uploadEmployment('FTE','immediate',{current_ctc:-1}),'invalid employment rejects the whole candidate creation');
check((await q("select count(*)::int as n from public.candidates"))[0].n===beforeInvalid,'failed employment save leaves no partial candidate');
async function assessment(candidateId, requirement=reqId) {
 return as(vendor,async()=> (await q("select public.candidate_availability_for_requirement($1,$2) as result",[requirement,[candidateId]]))[0].result[candidateId]);
}
check((await assessment(uploadFte.candidate_id)).status==='ineligible','15–30 days fails explicit immediate-only joining');
const longNotice=await uploadEmployment('FTE','30_plus');
check((await assessment(longNotice.candidate_id)).status==='ineligible','30 days+ fails explicit immediate-only joining');
const immediate=await uploadEmployment('FTE','immediate');
check((await assessment(immediate.candidate_id)).status==='eligible','immediate candidate passes joining policy');
const adminSubmitted=(await as(admin,()=>q("select public.submit_candidate($1,$2) as result",[reqId,immediate.candidate_id])))[0].result;
check((await q("select vendor_org_id from public.submissions where id=$1",[adminSubmitted.submission_id]))[0].vendor_org_id===org,'HQ submission preserves the owning vendor association');
const unknown=await uploadEmployment('FTE',null);
check((await assessment(unknown.candidate_id)).status==='needs_review','unknown joining availability is not guessed or auto-rejected');
const serving=await uploadEmployment('FTE','serving',{last_working_day:'2099-01-01'});
check((await assessment(serving.candidate_id)).status==='ineligible','future last working day fails immediate-only policy');
const served=await uploadEmployment('FTE','serving',{last_working_day:'2000-01-01'});
check((await assessment(served.candidate_id)).status==='eligible','completed notice passes joining policy');
const contradictory=await uploadEmployment('FTE','immediate',{expected_joining_date:'2099-01-01'});
check((await assessment(contradictory.candidate_id)).status==='ineligible','future joining date overrides an immediate label');
const rejected=(await as(vendor,()=>q("select public.submit_candidate($1,$2) as result",[reqId,uploadFte.candidate_id])))[0].result;
const savedRejected=(await q("select stage,validation_state,rejection_reason from public.submissions where id=$1",[rejected.submission_id]))[0];
check(rejected.auto_rejected && savedRejected.stage==='rejected' && savedRejected.validation_state==='rejected_by_recruiter' && savedRejected.rejection_reason.includes('15–30'),'database records automatic rejection with vendor-visible reason');
check((await q("select to_stage from public.submission_stage_history where submission_id=$1",[rejected.submission_id]))[0].to_stage==='rejected','automatic rejection stage history is accurate');
check((await q("select count(*)::int as n from public.submission_assessments where submission_id=$1",[rejected.submission_id]))[0].n===0,'auto-rejected submission does not enter recruiter assessment');
await as(vendor,()=>q("update public.candidate_employment set notice_period='immediate' where candidate_id=$1",[uploadFte.candidate_id]));
const retried=(await as(vendor,()=>q("select public.submit_candidate($1,$2) as result",[reqId,uploadFte.candidate_id])))[0].result;
check(!retried.auto_rejected && retried.submission_id===rejected.submission_id,'corrected availability reuses existing submission without duplicates');
await q("update public.requirements set description='SQL developer. Immediate joiners preferred.' where id=$1",[reqId]);
check((await assessment(longNotice.candidate_id)).status==='not_applicable','immediate preferred never becomes mandatory rejection');
await q("update public.requirements set currency='INR|join=Immediate%20joiners%20only' where id=$1",[reqId]);
check((await assessment(longNotice.candidate_id)).status==='ineligible','existing encoded joining timeline enforces immediate-only policy');
await denied(()=>as(vendor,()=>q("select public.candidate_availability_for_requirement($1,$2)",[reqId,[cand.id]])),'vendor cannot inspect another owner candidate availability');
await denied(()=>as(candidate,()=>q("select public.create_candidate_with_employment($1,$2)",[{p_full_name:'Bad'}, {employment_type:'FTE',currency:'INR'}])),'existing candidate cannot create a duplicate self profile through upload wrapper');
}
{
 // A verified link must transfer the signup draft into the existing candidate.
 const existing=(await as(vendor,()=>q("select public.create_candidate_with_employment($1,$2) as result",[
  {p_full_name:'Existing Link Candidate',p_email:'LinkExisting@test.invalid',p_phone:'9000000001',p_current_title:'Old title'},
  {employment_type:'FTE',currency:'INR',current_ctc:100000,expected_ctc:200000,notice_period:'immediate'}
 ])))[0].result.candidate_id;
 const linkUser=await signup('LinkExisting','candidate',{...details,phone:'9000000002',designation:'New Engineer',location:'Mumbai',current_ctc:'300000'});
 check((await q('select count(*)::int as n from public.candidates where user_id=$1',[linkUser]))[0].n===0,'matching registration does not create another candidate');
 await denied(()=>as(vendor,()=>q('select public.admin_link_candidate_account($1,$2)',[existing,linkUser])),'vendor cannot link candidate accounts');
 await as(admin,()=>q('select public.admin_link_candidate_account($1,$2)',[existing,linkUser]));
 const linked=(await q('select c.user_id,c.location,c.current_title,e.current_ctc from public.candidates c join public.candidate_employment e on e.candidate_id=c.id where c.id=$1',[existing]))[0];
 check(linked.user_id===linkUser && linked.location==='Mumbai' && linked.current_title==='New Engineer' && Number(linked.current_ctc)===300000,'verified link populates employment and identity on the existing candidate');
 check(Object.keys((await q('select details from public.registration_details where user_id=$1',[linkUser]))[0].details).length===0,'linked signup draft is cleared after transfer');
 await as(admin,()=>q('select public.admin_link_candidate_account($1,$2)',[existing,linkUser]));
 check((await q('select count(*)::int as n from public.candidates where user_id=$1',[linkUser]))[0].n===1,'repeated linking is idempotent and never duplicates candidates');
 await denied(()=>as(admin,()=>q('select public.admin_link_candidate_account($1,$2)',[existing,candidate])),'link cannot take over another candidate account');

 await q("update public.profiles set phone=null where id=$1",[linkUser]);
 const before=(await as(linkUser,()=>q('select public.my_onboarding_details() as result')))[0].result;
 check(before.needs_completion && before.kind==='candidate','legacy candidate with missing data gets completion prompt');
 const candidateCount=(await q('select count(*)::int as n from public.candidates'))[0].n;
 await as(linkUser,()=>q('select public.complete_my_onboarding($1)',[{...details,full_name:'Completed Candidate',phone:'9000000003',designation:'Lead Engineer',location:'Pune',current_ctc:'400000'}]));
 const after=(await as(linkUser,()=>q('select public.my_onboarding_details() as result')))[0].result;
 check(!after.needs_completion && after.details.phone==='9000000003' && after.details.location==='Pune','candidate completion updates canonical fields and clears prompt');
 check((await q('select count(*)::int as n from public.candidates'))[0].n===candidateCount,'candidate completion never creates duplicate candidates');
 await denied(()=>as(linkUser,()=>q('select public.complete_my_onboarding($1)',[{...details,full_name:'Invalid Salary',current_ctc:-1}])),'invalid completion is rejected atomically');
 check((await q('select full_name from public.profiles where id=$1',[linkUser]))[0].full_name==='Completed Candidate','invalid completion rolls back identity updates');

 await as(vendor,()=>q('select public.complete_my_onboarding($1)',[{...vendorDetails,full_name:'Completed Vendor',company_location:'Pune',industry:'IT staffing',role:'admin',org_id:clientOrg}]));
 const own=(await q('select role,org_id from public.profiles where id=$1',[vendor]))[0];
 check(own.role==='vendor_admin' && own.org_id===org,'completion cannot change system role or organisation');
 check((await q('select location from public.organizations where id=$1',[org]))[0].location==='Pune','vendor completion populates its own organisation');
 const member=await signup('MemberCompletion','vendor');
 await q("update public.profiles set role='vendor_recruiter',org_id=$1,status='active' where id=$2",[org,member]);
 await as(member,()=>q('select public.complete_my_onboarding($1)',[{full_name:'Vendor Recruiter',phone:'9000000004',designation:'Recruiter',department:'Delivery',business_role:'Talent Acquisition',company_location:'Wrong Company Location'}]));
 check((await q('select location from public.organizations where id=$1',[org]))[0].location==='Pune','ordinary organisation member cannot edit company information');
 await denied(()=>as(pending,()=>q('select public.my_onboarding_details()')),'pending account cannot access active profile completion');

 // Requested days remain immutable history; reviewer chooses actual approved duration.
 const reqId=(await as(client,()=>q('select public.request_trial_extension($1,14,$2) as id',[clientOrg,'Need more time for evaluation'])))[0].id;
 const prev=(await q('select trial_ends_at from public.account_subscriptions where account_id=$1',[clientOrg]))[0].trial_ends_at;
 await denied(()=>as(client,()=>q("select public.review_trial_extension($1,'approved','Self approval',null,null,false,21)",[reqId])),'organisation cannot approve its own adjusted trial duration');
 await denied(()=>as(admin,()=>q("select public.review_trial_extension($1,'approved','Invalid days',null,null,false,99)",[reqId])),'review rejects unsupported extension duration');
 const approval=(await as(admin,()=>q("select public.review_trial_extension($1,'approved','Approve twenty one',null,null,false,21) as result",[reqId])))[0].result;
 check(approval.requested_days===14 && approval.approved_days===21 && Date.parse(approval.new_expiry)-new Date(prev).getTime()===21*86400000,'Admin can approve 21 days for a 14-day request while preserving original request');
 await as(admin,()=>q("select public.review_trial_extension($1,'approved','Retry with different days',null,null,false,30)",[reqId]));
 check((await q('select trial_ends_at from public.account_subscriptions where account_id=$1',[clientOrg]))[0].trial_ends_at.toISOString()===new Date(approval.new_expiry).toISOString(),'retry with changed days cannot extend an approved request twice');
 const nextRequest=(await as(client,()=>q('select public.request_trial_extension($1,14,$2) as id',[clientOrg,'Another evaluation request'])))[0].id;
 await q("insert into public.staff_members(user_id,system_role) values($1,'hr') on conflict(user_id) do update set system_role='hr'",[admin]);
 await denied(()=>as(admin,()=>q("select public.review_trial_extension($1,'approved','Escalated duration',null,null,true,30)",[nextRequest])),'adjusting a request to 30 days still requires higher approval');
 await q("update public.staff_members set system_role='platform_admin' where user_id=$1",[admin]);
 const elevated=(await as(admin,()=>q("select public.review_trial_extension($1,'approved','Platform exception approval',null,null,true,30) as result",[nextRequest])))[0].result;
 check(elevated.approved_days===30 && elevated.exception_approved,'Platform Admin can approve an adjusted 30-day exception');

}
console.log(`${count} onboarding/trial checks passed`);
await db.close();
