import assert from 'node:assert/strict';
import {
  encodeRequirementMetaToCurrency,
  parseRequirementMeta,
  validateBudgetValues,
  formatBudgetDisplay,
  evaluateRequirementAccess,
  computeServerTrialDaysRemaining,
  getMilestoneForDaysRemaining,
  computePlanPricingWithTax,
} from '../src/lib/enterpriseLifecycle';
import { formatCurrency, formatRequirementBudgetWithSubtitle } from '../src/lib/format';

async function runTests() {
  console.log('=== HireNestOS Consolidated Verification Suite ===\n');

  // --------------------------------------------------------------------------
  // TEST 1: Update 1 — Requirement Visibility & Client Mapping Acceptance Test
  // --------------------------------------------------------------------------
  console.log('[1/4] Running Update 1: Requirement Visibility & Client Mapping Acceptance Tests...');

  const unmappedOpenSharedReq = {
    id: 'req_unmapped_001',
    status: 'open' as const,
    is_public: false,
    vendor_visible_budget: 15,
    client_org_id: 'org_client_fincore',
    currency: encodeRequirementMetaToCurrency({
      baseCurrency: 'INR',
      budgetUnit: 'LPA',
      budgetMode: 'range',
      budgetMin: 12,
      budgetMax: 15,
      isClientMapped: false,
      mappedClientOrgId: null,
    }),
  };

  // 1a. Admin sees unmapped requirement
  const adminAccess = evaluateRequirementAccess({
    requirement: unmappedOpenSharedReq,
    viewerRole: 'admin',
    viewerOrgId: 'org_hq',
  });
  assert.equal(adminAccess.allowed, true, 'Admin must have full access to unmapped requirements');
  assert.equal(adminAccess.isClientMapped, false);

  // 1b. Client MUST NOT see unmapped requirement
  const clientAccessUnmapped = evaluateRequirementAccess({
    requirement: unmappedOpenSharedReq,
    viewerRole: 'client_manager',
    viewerOrgId: 'org_client_fincore',
  });
  assert.equal(
    clientAccessUnmapped.allowed,
    false,
    'Unmapped requirement MUST be hidden from clients'
  );

  // 1c. Authorized Vendor MUST see eligible, active ('open'), shared requirement even when unmapped from client
  const vendorAccessUnmapped = evaluateRequirementAccess({
    requirement: unmappedOpenSharedReq,
    viewerRole: 'vendor_admin',
    viewerOrgId: 'org_vendor_alpha',
    sharedVendorOrgIds: ['org_vendor_alpha'],
  });
  assert.equal(
    vendorAccessUnmapped.allowed,
    true,
    'Client mapping must NOT restrict eligible vendor visibility when vendor publication rules are satisfied'
  );

  // 1d. Explicitly map the requirement to client 'org_client_fincore'
  const mappedReq = {
    ...unmappedOpenSharedReq,
    currency: encodeRequirementMetaToCurrency({
      baseCurrency: 'INR',
      budgetUnit: 'LPA',
      budgetMode: 'range',
      budgetMin: 12,
      budgetMax: 15,
      isClientMapped: true,
      mappedClientOrgId: 'org_client_fincore',
    }),
  };

  const clientAccessMapped = evaluateRequirementAccess({
    requirement: mappedReq,
    viewerRole: 'client_manager',
    viewerOrgId: 'org_client_fincore',
  });
  assert.equal(
    clientAccessMapped.allowed,
    true,
    'Explicitly mapped requirement must be visible to the mapped client organization'
  );

  const otherClientAccess = evaluateRequirementAccess({
    requirement: mappedReq,
    viewerRole: 'client_manager',
    viewerOrgId: 'org_client_other',
  });
  assert.equal(
    otherClientAccess.allowed,
    false,
    'Mapped requirement must remain hidden from other client organizations'
  );

  console.log('  ✓ Passed Update 1 (Admin, Client & Vendor visibility rules verified)');

  // --------------------------------------------------------------------------
  // TEST 2: Update 2 — Budget Unit Selection (LPA & LPM) & Legacy Support
  // --------------------------------------------------------------------------
  console.log('[2/4] Running Update 2: LPA and LPM Budget Schema, Validation & Display Tests...');

  // 2a. LPA range formatting & separate min/max/unit storage
  const parsedLpa = parseRequirementMeta(mappedReq);
  assert.equal(parsedLpa.budgetUnit, 'LPA');
  assert.equal(parsedLpa.budgetMode, 'range');
  assert.equal(parsedLpa.budgetMin, 12);
  assert.equal(parsedLpa.budgetMax, 15);

  const lpaSubtitle = formatRequirementBudgetWithSubtitle(mappedReq);
  assert.equal(lpaSubtitle.formatted, '₹12–15 LPA');
  assert.equal(lpaSubtitle.subtitle, 'Lakhs per annum');
  assert.equal(formatCurrency(mappedReq.vendor_visible_budget, mappedReq.currency), '₹12–15 LPA');

  // 2b. LPM monthly formatting (no silent conversion from/to LPA)
  const lpmCurrency = encodeRequirementMetaToCurrency({
    baseCurrency: 'INR',
    budgetUnit: 'LPM',
    budgetMode: 'range',
    budgetMin: 1.5,
    budgetMax: 2.2,
    isClientMapped: true,
    mappedClientOrgId: 'org_client_fincore',
  });
  const parsedLpm = parseRequirementMeta(lpmCurrency, 2.2, 'org_client_fincore');
  assert.equal(parsedLpm.budgetUnit, 'LPM');
  assert.equal(parsedLpm.budgetMin, 1.5);
  assert.equal(parsedLpm.budgetMax, 2.2);
  const lpmDisplay = formatBudgetDisplay(parsedLpm);
  assert.equal(lpmDisplay.formatted, '₹1.5–2.2 LPM');
  assert.equal(lpmDisplay.subtitle, 'Lakhs per month');

  // 2c. Validation rules (max >= min > 0)
  assert.equal(
    validateBudgetValues({ budgetMode: 'range', budgetUnit: 'LPA', budgetMin: 18, budgetMax: 12 })
      .valid,
    false,
    'Should reject max < min'
  );
  assert.equal(
    validateBudgetValues({ budgetMode: 'range', budgetUnit: 'LPA', budgetMin: -5, budgetMax: 10 })
      .valid,
    false,
    'Should reject negative budget'
  );
  assert.equal(
    validateBudgetValues({ budgetMode: 'fixed', budgetUnit: 'LPM', budgetMin: 1.8, budgetMax: 1.8 })
      .valid,
    true,
    'Should accept valid fixed LPM budget'
  );

  // 2d. Backward compatibility for legacy records lacking unit field
  const legacyReq = {
    currency: 'INR',
    vendor_visible_budget: 1800000,
    client_org_id: 'org_client_fincore',
  };
  const parsedLegacy = parseRequirementMeta(legacyReq);
  assert.equal(parsedLegacy.budgetUnit, null, 'Legacy record must have null budgetUnit');
  assert.equal(parsedLegacy.isClientMapped, true, 'Legacy record with client_org_id remains mapped');
  assert.equal(formatCurrency(legacyReq.vendor_visible_budget, legacyReq.currency), '₹18,00,000');

  console.log('  ✓ Passed Update 2 (LPA/LPM storage, display, validation & legacy records verified)');

  // --------------------------------------------------------------------------
  // TEST 3: Update 3 — Trial Activation, 10/8/5/2/1d Idempotent Reminders & Expiry
  // --------------------------------------------------------------------------
  console.log('[3/4] Running Update 3: Trial Lifecycle, Automated Reminders & Expiry Enforcement...');

  // Database lifecycle/idempotency is covered by test:onboarding. This pure test
  // checks date arithmetic and the current reminder schedule without opening a server.
  const expiry = '2027-02-20T12:00:00.000Z';
  for (const days of [10, 8, 5, 2, 1]) {
    const now = new Date(Date.parse(expiry) - days * 86400000).toISOString();
    assert.equal(computeServerTrialDaysRemaining(now, expiry), days);
    assert.equal(getMilestoneForDaysRemaining(days), `${days}d`);
  }
  assert.equal(getMilestoneForDaysRemaining(14), null);
  assert.equal(computeServerTrialDaysRemaining('2027-02-21T12:00:00.000Z',expiry), 0);
  console.log('  ✓ Passed trial date arithmetic and 10/8/5/2/1-day reminder schedule');

  // --------------------------------------------------------------------------
  // TEST 4: Update 3C — Pricing + 18% GST
  // --------------------------------------------------------------------------
  console.log('[4/4] Running Update 3C: Plan Pricing and 18% GST...');

  const scaleAnnual = computePlanPricingWithTax('scale', 'annual');
  assert.equal(scaleAnnual.baseAmountInr, 95988);
  assert.equal(scaleAnnual.gstPercent, 18);
  assert.equal(scaleAnnual.gstAmountInr, 17278);
  assert.equal(scaleAnnual.totalAmountInr, 113266);

  console.log('  ✓ Passed Update 3C (Plan pricing and 18% GST arithmetic)');
  console.log('\nALL CONSOLIDATED VERIFICATION TESTS PASSED SUCCESSFULLY.');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
