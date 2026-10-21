import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const schemaPath = process.argv[2];
const db = new PGlite();

const stubs = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
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
`;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function expectError(label, fn, match) {
  try { await fn(); ok(false, label + ' (expected error, got success)'); }
  catch (e) { ok(!match || e.message.includes(match), label + ' -> ' + e.message.split('\n')[0]); }
}

const U = {
  admin: '00000000-0000-0000-0000-000000000001',
  recruiter: '00000000-0000-0000-0000-000000000002',
  clientA: '00000000-0000-0000-0000-000000000003',
  clientB: '00000000-0000-0000-0000-000000000004',
  vendorX: '00000000-0000-0000-0000-000000000005',
  vendorY: '00000000-0000-0000-0000-000000000006',
  cand: '00000000-0000-0000-0000-000000000007',
  pending: '00000000-0000-0000-0000-000000000008',
  clientAMember: '00000000-0000-0000-0000-000000000009',
};

await db.exec(stubs);
console.log('Schema:');
await db.exec(readFileSync(schemaPath, 'utf8'));
console.log('  applied OK');

// Sign-ups
for (const [k, id] of Object.entries(U)) {
  const intent = k === 'cand' || k === 'admin' ? 'candidate' : 'vendor';
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [id, `${k}@test.dev`, JSON.stringify({ full_name: k, signup_intent: intent, role: 'admin' })]);
}
const prof = await q(`select role, status from public.profiles where id = $1`, [U.pending]);
ok(prof[0].role === 'pending' && prof[0].status === 'pending_approval', 'vendor sign-up becomes pending (metadata role ignored)');
const candProf = await q(`select role from public.profiles where id = $1`, [U.cand]);
ok(candProf[0].role === 'candidate', 'candidate sign-up becomes candidate');

// Bootstrap admin (02 script equivalent)
await q(`update public.profiles set role = 'admin', org_id = (select id from public.organizations where type = 'internal') where id = $1`, [U.admin]);

console.log('Admin setup:');
const orgs = await as(U.admin, async () => {
  const mk = async (name, type) => (await q(`insert into public.organizations (name, type, status) values ($1, $2, 'approved') returning id`, [name, type]))[0].id;
  const o = { A: await mk('Client A', 'client'), B: await mk('Client B', 'client'), X: await mk('Vendor X', 'vendor'), Y: await mk('Vendor Y', 'vendor') };
  const internal = (await q(`select id from public.organizations where type = 'internal'`))[0].id;
  await q(`select public.admin_assign_user($1, 'recruiter', $2)`, [U.recruiter, internal]);
  await q(`select public.admin_assign_user($1, 'client_manager', $2)`, [U.clientA, o.A]);
  await q(`select public.admin_assign_user($1, 'client_member', $2)`, [U.clientAMember, o.A]);
  await q(`select public.admin_assign_user($1, 'client_manager', $2)`, [U.clientB, o.B]);
  await q(`select public.admin_assign_user($1, 'vendor_admin', $2)`, [U.vendorX, o.X]);
  await q(`select public.admin_assign_user($1, 'vendor_recruiter', $2)`, [U.vendorY, o.Y]);
  return o;
});
ok(true, 'orgs created and users assigned');
await as(U.admin, () => expectError('admin cannot assign client role to vendor org', () =>
  q(`select public.admin_assign_user($1, 'client_manager', $2)`, [U.pending, orgs.X]), 'requires a client organization'));
await as(U.recruiter, () => expectError('recruiter cannot assign roles', () =>
  q(`select public.admin_assign_user($1, 'admin', null)`, [U.pending]), 'FORBIDDEN'));
await as(U.vendorX, () => expectError('user cannot change own role via update', () =>
  q(`update public.profiles set role = 'admin' where id = $1`, [U.vendorX]), 'permission denied'));

console.log('Requirements:');
const req = await as(U.clientA, async () => {
  const r = (await q(`insert into public.requirements (client_org_id, title, description, skills, min_experience, max_experience, vendor_visible_budget)
    values ($1, 'Senior React Developer', 'Build and maintain enterprise React applications.', '{React,TypeScript,Node,AWS}', 4, 8, 150000) returning id, status`, [orgs.A]))[0];
  ok(r.status === 'draft', 'client requirement starts as draft');
  await q(`insert into public.requirement_financials (requirement_id, actual_client_budget) values ($1, 200000)`, [r.id]);
  await q(`select public.set_requirement_status($1, 'pending_approval')`, [r.id]);
  await expectError('client cannot open own requirement', () => q(`select public.set_requirement_status($1, 'open')`, [r.id]), 'FORBIDDEN');
  return r.id;
});
await as(U.clientA, () => expectError('client cannot insert requirement for other client', () =>
  q(`insert into public.requirements (client_org_id, title, description) values ($1, 'Hack job', 'This should never be allowed to insert')`, [orgs.B]), 'row-level security'));
await as(U.clientB, async () => ok((await q(`select * from public.requirements`)).length === 0, 'Client B cannot see Client A requirement'));
await as(U.admin, async () => {
  await q(`select public.set_requirement_status($1, 'open')`, [req]);
  await q(`select public.set_requirement_public($1, true)`, [req]);
  const n = (await q(`select public.share_requirement_with_vendors($1, $2) as n`, [req, [orgs.X]]))[0].n;
  ok(n === 1, 'shared with Vendor X');
  const again = (await q(`select public.share_requirement_with_vendors($1, $2) as n`, [req, [orgs.X]]))[0].n;
  ok(again === 0, 're-sharing an active share is a no-op (SLA clock not reset)');
});
await as(U.vendorY, async () => ok((await q(`select * from public.requirements`)).length === 0, 'Vendor Y cannot see unshared requirement'));
await as(U.vendorX, async () => {
  ok((await q(`select * from public.requirements`)).length === 1, 'Vendor X sees shared requirement');
  ok((await q(`select * from public.requirement_financials`)).length === 0, 'Vendor X cannot see client budget');
  ok((await q(`select * from public.requirement_margins`)).length === 0, 'Vendor X cannot see margin');
  await q(`select public.acknowledge_requirement($1)`, [req]);
  ok((await q(`select count(*)::int n from public.notifications`))[0].n >= 1, 'Vendor X got share notification');
});

console.log('Candidates & matching:');
const vcand = await as(U.vendorX, async () => {
  const res = (await q(`select public.create_candidate('Ravi Kumar', 'ravi@example.com', '+91 98765 43210', null, 'Frontend Engineer', 'Pune', 5, '{react,typescript,css}', null, 'hash1') as r`))[0].r;
  ok(res.status === 'created', 'vendor creates candidate');
  const c = (await q(`select original_source, source_vendor_org_id, owner_vendor_org_id from public.candidates where id = $1`, [res.candidate_id]))[0];
  ok(c.original_source === 'vendor' && c.owner_vendor_org_id === orgs.X, 'source = vendor, owner = Vendor X');
  const m = await q(`select final_score, matched_skills, unproven_skills from public.candidate_matches where candidate_id = $1`, [res.candidate_id]);
  ok(m.length === 1 && Number(m[0].final_score) > 0, `match computed (score ${m[0]?.final_score}, matched ${m[0]?.matched_skills}, unproven ${m[0]?.unproven_skills})`);
  await q(`insert into storage.objects (bucket_id, name) values ('resumes', $1)`, [`${res.candidate_id}/resume.pdf`]);
  ok(true, 'vendor uploads resume to own candidate folder');
  return res.candidate_id;
});
await as(U.vendorY, async () => {
  ok((await q(`select * from public.candidates`)).length === 0, 'Vendor Y cannot see Vendor X candidate');
  ok((await q(`select * from public.candidate_matches`)).length === 0, 'Vendor Y cannot see Vendor X matches');
  const dup = (await q(`select public.create_candidate('Ravi K', 'RAVI@example.com ') as r`))[0].r;
  ok(dup.status === 'duplicate' && dup.match_type === 'email' && dup.existing_candidate_id === null, 'Vendor Y duplicate detected without revealing owner');
  await expectError('Vendor Y cannot upload into Vendor X candidate folder', () =>
    q(`insert into storage.objects (bucket_id, name) values ('resumes', $1)`, [`${vcand}/x.pdf`]), 'row-level security');
});
await as(U.admin, async () => ok((await q(`select count(*)::int n from public.duplicate_flags where status = 'open'`))[0].n === 1, 'admin sees duplicate flag'));

console.log('Submissions:');
const vsub = await as(U.vendorX, async () => {
  const r = (await q(`select public.submit_candidate($1, $2) as r`, [req, vcand]))[0].r;
  ok(r.status === 'created', 'Vendor X submits candidate');
  const d = (await q(`select public.submit_candidate($1, $2) as r`, [req, vcand]))[0].r;
  ok(d.status === 'duplicate', 'duplicate submission blocked');
  const s = (await q(`select source, vendor_org_id, stage from public.submissions where id = $1`, [r.submission_id]))[0];
  ok(s.source === 'vendor' && s.vendor_org_id === orgs.X && s.stage === 'recruiter_review', 'submission records vendor attribution');
  await expectError('vendor cannot insert submissions directly', () =>
    q(`insert into public.submissions (requirement_id, candidate_id, source, submitted_by, stage) values ($1, $2, 'direct', $3, 'offered')`, [req, vcand, U.vendorX]), 'permission denied');
  return r.submission_id;
});
await as(U.vendorY, () => expectError('Vendor Y cannot submit to unshared requirement', () =>
  q(`select public.submit_candidate($1, $2)`, [req, vcand]), 'FORBIDDEN'));

const dsub = await as(U.cand, async () => {
  const c = (await q(`select public.create_candidate('Direct Dev', 'direct@example.com', null, null, 'Engineer', null, 6, '{React,Node,AWS,TypeScript}') as r`))[0].r;
  ok(c.status === 'created', 'direct candidate creates own profile');
  const m = await q(`select final_score from public.candidate_matches`);
  ok(m.length === 1, 'direct candidate sees potential match');
  ok((await q(`select count(*)::int n from public.submissions`))[0].n === 0, 'potential match did NOT create an application');
  const a = (await q(`select public.apply_to_requirement($1) as r`, [req]))[0].r;
  ok(a.status === 'created', 'explicit apply creates application');
  const s = (await q(`select source, vendor_org_id, stage from public.submissions`))[0];
  ok(s.source === 'direct' && s.vendor_org_id === null && s.stage === 'applied', 'direct application has no vendor');
  return a.submission_id;
});

await as(U.clientA, async () => ok((await q(`select * from public.submissions`)).length === 0, 'client sees nothing before HQ shares'));
await as(U.recruiter, async () => {
  await q(`select public.transition_submission($1, 'client_review', 'Strong profile')`, [vsub]);
  await expectError('invalid transition rejected', () => q(`select public.transition_submission($1, 'offered')`, [dsub]), 'Invalid transition');
  await expectError('reject requires reason', () => q(`select public.transition_submission($1, 'rejected')`, [dsub]), 'reason is required');
});
await as(U.clientA, async () => {
  ok((await q(`select * from public.submissions`)).length === 1, 'client sees shared submission only');
  ok((await q(`select * from public.candidates`)).length === 1, 'client sees shared candidate profile');
  ok((await q(`select * from public.candidate_contacts`)).length === 0, 'client cannot see candidate contact PII');
  ok((await q(`select name from public.organizations where id = $1`, [orgs.X])).length === 1, 'client sees vendor name');
  ok((await q(`select * from storage.objects`)).length === 0, 'client cannot read resume file (default strict)');
});
await as(U.clientB, async () => ok((await q(`select * from public.submissions`)).length === 0, 'Client B sees no submissions'));

console.log('Interviews & ratings:');
const iv = await as(U.clientA, async () => {
  const id = (await q(`select public.schedule_interview($1, 'technical', now() + interval '1 day') as id`, [vsub]))[0].id;
  ok((await q(`select stage from public.submissions where id = $1`, [vsub]))[0].stage === 'interviewing', 'scheduling moves stage to interviewing');
  await expectError('cannot rate before interview completed', () =>
    q(`insert into public.interview_feedback (interview_id, skill_rating, communication_rating, overall_rating, decision, feedback) values ($1, 4, 4, 4, 'advance', 'Good technical depth')`, [id]), 'row-level security');
  await q(`select public.update_interview_status($1, 'completed')`, [id]);
  return id;
});
await as(U.clientAMember, async () => {
  ok((await q(`select * from public.my_pending_feedback()`)).length === 1, 'client member has pending feedback');
  await q(`insert into public.interview_feedback (interview_id, skill_rating, communication_rating, overall_rating, decision, feedback) values ($1, 4, 3, 4, 'advance', 'Good technical depth, clear answers')`, [iv]);
  await q(`insert into public.candidate_quality_feedback (submission_id, jd_skill_alignment, relevant_experience, resume_accuracy, communication, interview_readiness, overall_suitability) values ($1, 4, 4, 5, 3, 4, 4)`, [vsub]);
  const f = (await q(`select rated_by, visible_to_vendor from public.interview_feedback`))[0];
  ok(f.rated_by === U.clientAMember && f.visible_to_vendor === false, 'rater stamped server-side, hidden from vendor by default');
  await expectError('feedback is immutable', () => q(`update public.interview_feedback set overall_rating = 5`), 'permission denied');
});
await as(U.vendorX, async () => ok((await q(`select * from public.interview_feedback`)).length === 0, 'vendor cannot see unapproved feedback'));
const fid = await as(U.admin, async () => {
  const id = (await q(`select id from public.interview_feedback`))[0].id;
  await q(`select public.set_feedback_vendor_visibility('interview', $1, true)`, [id]);
  return id;
});
await as(U.vendorX, async () => {
  ok((await q(`select * from public.interview_feedback`)).length === 1, 'vendor sees approved feedback');
  const d = (await q(`select public.raise_rating_dispute('interview', $1, 'Candidate was asked questions outside the JD scope') as id`, [fid]))[0].id;
  ok(!!d, 'vendor admin raises dispute');
  const perf = (await q(`select public.get_vendor_performance($1) as p`, [orgs.X]))[0].p;
  ok(perf.overall.status === 'weights_not_approved', 'overall score withheld until weights approved');
  ok(perf.quality.status === 'not_enough_data', 'quality shows not_enough_data with 1 sample');
  ok(perf.timing.avg_response_hours !== undefined, 'timing metrics present');
});
await as(U.vendorY, () => expectError('Vendor Y cannot read Vendor X performance', () =>
  q(`select public.get_vendor_performance($1)`, [orgs.X]), 'FORBIDDEN'));
await as(U.admin, async () => {
  const d = (await q(`select id from public.rating_disputes`))[0].id;
  await q(`select public.resolve_rating_dispute($1, true, 'Out of scope questions confirmed')`, [d]);
  ok((await q(`select excluded_from_score from public.interview_feedback`))[0].excluded_from_score === true, 'upheld dispute excludes feedback from score');
  await q(`update public.platform_settings set weights_approved = true`);
  ok((await q(`select weights_approved_by from public.platform_settings`))[0].weights_approved_by === U.admin, 'weights approval stamped with admin');
  await expectError('weights must sum to 100', () => q(`update public.platform_settings set timing_weight = 50`), 'check constraint');
  const list = await q(`select * from public.admin_vendor_performance()`);
  ok(list.length === 2, 'admin vendor performance list');
  const sum = (await q(`select public.admin_dashboard_summary() as s`))[0].s;
  ok(sum.candidates_by_source.vendor === 1 && sum.candidates_by_source.direct === 1, 'dashboard counts by source');
  await q(`select public.override_match($1, $2, 92, 'Strong open-source React work')`, [req, vcand]);
  ok(Number((await q(`select final_score from public.candidate_matches where candidate_id = $1`, [vcand]))[0].final_score) === 92, 'recruiter override wins');
  ok((await q(`select count(*)::int n from public.audit_logs`))[0].n > 10, 'audit log populated');
  const leaked = await q(`select count(*)::int n from public.audit_logs where table_name = 'candidate_contacts' and new_data::text like '%@%'`);
  ok(leaked[0].n === 0, 'audit log does not store contact PII');
});
await as(U.pending, async () => {
  ok((await q(`select * from public.requirements`)).length === 0, 'pending user sees no requirements');
  await expectError('pending user cannot create candidates', () => q(`select public.create_candidate('X Y')`), 'FORBIDDEN');
});
await as(U.recruiter, async () => {
  await expectError('recruiter cannot read audit log rows? (should return 0, not error)', async () => {
    const r = await q(`select * from public.audit_logs`);
    if (r.length === 0) throw new Error('returned 0 rows as expected');
  }, '0 rows');
});
await expectError('anon cannot read tables', async () => {
  await db.exec(`set role anon`);
  try { await q(`select * from public.requirements`); } finally { await db.exec('reset role'); }
}, 'permission denied');
await expectError('AI provider pinned to ollama', () => q(`update public.platform_settings set ai_provider = 'gemini'`), 'check constraint');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
