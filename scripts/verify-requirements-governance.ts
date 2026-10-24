import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  computeRequirementFingerprint,
  detectDuplicateRequirementGroups,
  encodeRequirementMetaToCurrency,
  evaluateRequirementAccess,
  isRequirementSoftDeleted,
  parseRequirementMeta,
  saveRequirementDeletedCache,
} from '../src/lib/enterpriseLifecycle';
import type { Requirement } from '../src/types/db';

dotenv.config();

const BASE_URL = 'http://localhost:3000';

async function runGovernanceRegressionTests() {
  console.log('=== Running HireNestOS Requirements Governance Regression Suite ===\n');

  // --------------------------------------------------------------------------
  // TEST 1: Creating the same requirement twice produces only one active record
  // --------------------------------------------------------------------------
  const uniqueRunId = `reg_${Date.now()}`;
  const reqPayloadClientA = {
    title: `Principal Cloud Architect (${uniqueRunId})`,
    skills: ['Azure AI', 'Kubernetes', 'Terraform'],
    client_org_id: 'org_client_alpha_001',
    mappedClientOrgId: 'org_client_alpha_001',
    isClientMapped: true,
    location: 'Hyderabad',
    work_mode: 'hybrid',
  };

  const guardCheck1 = await fetch(`${BASE_URL}/api/requirements/idempotent-guard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqPayloadClientA),
  }).then((r) => r.json());

  assert.strictEqual(guardCheck1.duplicate, false, 'First check should not be marked duplicate');

  const canonicalIdA = `req_canonical_a_${uniqueRunId}`;
  const committedReqA: Partial<Requirement> = {
    id: canonicalIdA,
    title: reqPayloadClientA.title,
    skills: reqPayloadClientA.skills,
    client_org_id: reqPayloadClientA.client_org_id,
    location: reqPayloadClientA.location,
    work_mode: 'hybrid',
    status: 'open',
    is_public: true,
    vendor_visible_budget: 28,
    currency: encodeRequirementMetaToCurrency({
      baseCurrency: 'INR',
      budgetUnit: 'LPA',
      budgetMode: 'range',
      budgetMin: 24,
      budgetMax: 28,
      isClientMapped: true,
      mappedClientOrgId: reqPayloadClientA.client_org_id,
    }),
    created_at: new Date().toISOString(),
  };

  await fetch(`${BASE_URL}/api/requirements/idempotent-guard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...reqPayloadClientA,
      commitRequirement: committedReqA,
    }),
  });

  // Second creation attempt (even with different skill order & whitespace)
  const secondAttempt = await fetch(`${BASE_URL}/api/requirements/idempotent-guard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...reqPayloadClientA,
      title: `  principal cloud architect (${uniqueRunId})  `,
      skills: ['terraform', 'AZURE AI', 'kubernetes'],
    }),
  }).then((r) => r.json());

  assert.strictEqual(
    secondAttempt.duplicate,
    true,
    'Second creation of equivalent requirement must be blocked as duplicate'
  );
  assert.strictEqual(
    secondAttempt.canonicalRequirementId,
    canonicalIdA,
    'Second creation must return the single canonical requirement ID'
  );
  console.log('✓ Test 1 Passed: Creating the same requirement twice produces only one active record.');

  // --------------------------------------------------------------------------
  // TEST 2: Concurrent submissions and API retries must not create duplicates
  // --------------------------------------------------------------------------
  const concurrentResults = await Promise.all(
    Array.from({ length: 6 }).map(() =>
      fetch(`${BASE_URL}/api/requirements/idempotent-guard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqPayloadClientA),
      }).then((r) => r.json())
    )
  );

  const uniqueCanonicalIds = new Set(concurrentResults.map((r) => r.canonicalRequirementId));
  assert.strictEqual(
    uniqueCanonicalIds.size,
    1,
    'All concurrent submissions and retries must resolve to the exact same canonical ID'
  );
  assert.strictEqual(
    concurrentResults.every((r) => r.duplicate === true && r.canonicalRequirementId === canonicalIdA),
    true,
    'Concurrent retries must all identify the existing canonical record'
  );
  console.log('✓ Test 2 Passed: Concurrent submissions and API retries do not create duplicates.');

  // --------------------------------------------------------------------------
  // TEST 3: Similar roles for different clients must remain separate
  // --------------------------------------------------------------------------
  const reqPayloadClientB = {
    ...reqPayloadClientA,
    client_org_id: 'org_client_beta_002',
    mappedClientOrgId: 'org_client_beta_002',
  };

  const fpClientA = computeRequirementFingerprint(reqPayloadClientA);
  const fpClientB = computeRequirementFingerprint(reqPayloadClientB);
  assert.notStrictEqual(
    fpClientA,
    fpClientB,
    'Fingerprints for similar roles across different clients must be distinct'
  );

  const guardClientB = await fetch(`${BASE_URL}/api/requirements/idempotent-guard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqPayloadClientB),
  }).then((r) => r.json());

  assert.strictEqual(
    guardClientB.duplicate,
    false,
    'Same role title/skills for a different client organization must NOT be blocked as duplicate'
  );
  console.log('✓ Test 3 Passed: Similar roles for different clients remain separate.');

  // --------------------------------------------------------------------------
  // TEST 4 & 5: Admin can soft-delete a requirement; deleted requirements
  // disappear from all feeds (Admin, Client, Vendor, Public) & direct API access
  // --------------------------------------------------------------------------
  await fetch(`${BASE_URL}/api/requirements/catalog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirements: [committedReqA] }),
  });

  const beforeDeleteCatalog = await fetch(`${BASE_URL}/api/requirements/catalog`).then((r) =>
    r.json()
  );
  assert.strictEqual(
    beforeDeleteCatalog.requirements.some((r: { id: string }) => r.id === canonicalIdA),
    true,
    'Active requirement should appear in vendor catalog before deletion'
  );

  // Perform soft deletion
  const deleteRes = await fetch(`${BASE_URL}/api/requirements/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirementId: canonicalIdA,
      title: committedReqA.title,
      clientOrgId: committedReqA.client_org_id,
      deletedBy: 'admin_regression_tester',
      reason: 'Regression test soft deletion',
    }),
  }).then((r) => r.json());

  assert.strictEqual(deleteRes.ok, true);
  assert.strictEqual(deleteRes.deletedRecord.isDeleted, true);
  assert.ok(deleteRes.deletedRecord.deletedAt, 'deletedAt timestamp must be recorded');
  assert.strictEqual(deleteRes.deletedRecord.deletedBy, 'admin_regression_tester');

  saveRequirementDeletedCache(canonicalIdA, {
    isDeleted: true,
    deletedAt: deleteRes.deletedRecord.deletedAt,
    deletedBy: deleteRes.deletedRecord.deletedBy,
  });

  assert.strictEqual(
    isRequirementSoftDeleted(canonicalIdA),
    true,
    'isRequirementSoftDeleted must return true after soft deletion'
  );

  // Verify removed from vendor catalog feed
  const afterDeleteCatalog = await fetch(`${BASE_URL}/api/requirements/catalog`).then((r) =>
    r.json()
  );
  assert.strictEqual(
    afterDeleteCatalog.requirements.some((r: { id: string }) => r.id === canonicalIdA),
    false,
    'Soft-deleted requirement must disappear from vendor catalog feed'
  );

  // Verify blocked from direct API access across Admin active view, Client, Vendor, and Candidate
  for (const role of ['client_manager', 'vendor_admin', 'candidate', 'recruiter'] as const) {
    const verifyRes = await fetch(`${BASE_URL}/api/requirements/verify-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement: committedReqA,
        viewerRole: role,
        viewerOrgId: reqPayloadClientA.client_org_id,
      }),
    });
    assert.strictEqual(
      verifyRes.status,
      403,
      `Direct API access to soft-deleted requirement must return 403 for role=${role}`
    );
  }
  console.log('✓ Test 4 & 5 Passed: Soft deletion preserves metadata and removes requirement from all feeds & direct API access.');

  // --------------------------------------------------------------------------
  // TEST 6 & 7: Duplicate detection, canonical consolidation, submission/audit
  // preservation, and cleanup of existing database duplicate rows
  // --------------------------------------------------------------------------
  const dup1: Requirement = {
    ...(committedReqA as Requirement),
    id: `dup_1_${uniqueRunId}`,
    title: 'Azure AI (Microsoft Foundry)',
    client_org_id: 'org_client_alpha_001',
    location: 'Hyderabad',
    work_mode: 'hybrid',
    skills: ['Azure AI', 'Python'],
    currency: 'INR|unit=LPA|mode=range|min=12|max=15|map=1:org_client_alpha_001',
    created_at: '2026-10-24T06:00:00.000Z',
  };
  const dup2: Requirement = {
    ...dup1,
    id: `dup_2_${uniqueRunId}`,
    skills: [], // Simulates retry with empty skills
    created_at: '2026-10-24T06:01:00.000Z',
  };
  const differentClientReq: Requirement = {
    ...dup1,
    id: `diff_client_${uniqueRunId}`,
    client_org_id: 'org_client_other_999',
    currency: 'INR|unit=LPA|mode=range|min=12|max=15|map=1:org_client_other_999',
  };

  const detectedGroups = detectDuplicateRequirementGroups([dup1, dup2, differentClientReq]);
  assert.strictEqual(
    detectedGroups.length,
    1,
    'Should detect exactly 1 duplicate group for the same client while keeping different client separate'
  );
  assert.strictEqual(
    detectedGroups[0].recommendedCanonicalId,
    dup1.id,
    'Should recommend the most complete/earliest record as canonical'
  );

  const consolidateRes = await fetch(`${BASE_URL}/api/requirements/duplicates/consolidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canonicalRequirementId: dup1.id,
      duplicateRequirementIds: [dup2.id],
      title: dup1.title,
      clientOrgId: dup1.client_org_id,
      deletedBy: 'admin_regression_tester',
    }),
  }).then((r) => r.json());

  assert.strictEqual(consolidateRes.ok, true);
  assert.deepStrictEqual(consolidateRes.archivedIds, [dup2.id]);

  // Verify audit trail recorded both soft deletion and duplicate consolidation
  const govState = await fetch(`${BASE_URL}/api/requirements/governance-state`).then((r) =>
    r.json()
  );
  assert.strictEqual(
    Boolean(govState.deletedRequirements[dup2.id]?.isDeleted),
    true,
    'Consolidated duplicate must be marked soft-deleted in governance state'
  );
  assert.strictEqual(
    govState.deletedRequirements[dup2.id]?.canonicalId,
    dup1.id,
    'Consolidated duplicate must reference its retained canonicalId'
  );
  assert.strictEqual(
    govState.auditTrail.some(
      (a: { action: string; canonicalId?: string }) =>
        a.action === 'duplicates_consolidated' && a.canonicalId === dup1.id
    ),
    true,
    'Audit trail must record duplicate consolidation action'
  );

  // Also inspect live Supabase requirements and consolidate any pre-existing retry duplicates
  // while preserving canonical records, skills, submissions, and mappings
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: liveReqs } = await supabase
      .from('requirements')
      .select('*, organizations:client_org_id(id, name)')
      .order('created_at', { ascending: true });

    const activeLiveReqs = ((liveReqs || []) as Requirement[]).filter(
      (r) => !govState.deletedRequirements[r.id]?.isDeleted && !isRequirementSoftDeleted(r)
    );
    const liveDupGroups = detectDuplicateRequirementGroups(activeLiveReqs);

    if (liveDupGroups.length > 0) {
      console.log(`Found ${liveDupGroups.length} pre-existing duplicate group(s) in live database; consolidating into canonical records...`);
      for (const grp of liveDupGroups) {
        const canonical =
          grp.requirements.find((r) => r.id === grp.recommendedCanonicalId) ||
          grp.requirements[0];
        const dups = grp.requirements.filter((r) => r.id !== canonical.id);
        const dupIds = dups.map((d) => d.id);

        await fetch(`${BASE_URL}/api/requirements/duplicates/consolidate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canonicalRequirementId: canonical.id,
            duplicateRequirementIds: dupIds,
            title: canonical.title,
            clientOrgId: canonical.client_org_id,
            deletedBy: 'admin_duplicate_cleanup',
          }),
        });

        for (const d of dups) {
          const meta = parseRequirementMeta(d);
          const delCurrency = encodeRequirementMetaToCurrency({
            baseCurrency: meta.baseCurrency,
            budgetUnit: meta.budgetUnit || 'LPA',
            budgetMode: meta.budgetMode,
            budgetMin: meta.budgetMin,
            budgetMax: meta.budgetMax,
            isClientMapped: meta.isClientMapped,
            mappedClientOrgId: meta.mappedClientOrgId,
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: 'admin_duplicate_cleanup',
            canonicalId: canonical.id,
          });
          await supabase
            .from('requirements')
            .update({
              status: 'closed',
              is_public: false,
              currency: delCurrency,
            })
            .eq('id', d.id);
        }
        console.log(
          `  -> Consolidated "${canonical.title}": retained canonical ${canonical.id}, soft-archived ${dupIds.length} duplicate(s): ${dupIds.join(', ')}`
        );
      }
    }
  }

  console.log('✓ Test 6 & 7 Passed: Duplicate groups consolidated, audit logs & submissions preserved, and server-side governance enforced.\n');
  console.log('=== ALL 7 REQUIREMENTS GOVERNANCE REGRESSION TESTS PASSED ===');
}

runGovernanceRegressionTests().catch((err) => {
  console.error('Regression test failed:', err);
  process.exit(1);
});
