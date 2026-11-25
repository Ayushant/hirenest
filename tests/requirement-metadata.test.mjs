import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdir, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const artifact = path.join(
  root,
  "node_modules/.cache/requirement-metadata-test.mjs",
);
await mkdir(path.dirname(artifact), { recursive: true });
let sequence = 0;
let rows = new Map();
let rejectMetadata = false;
let writes = [];
class Query {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.filters = [];
  }
  select() {
    return this;
  }
  insert(payload) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }
  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }
  eq(key, value) {
    this.filters.push([key, value]);
    return this;
  }
  order() {
    return this;
  }
  async execute(single = false) {
    if (this.table !== "requirements")
      throw new Error(`Unexpected table: ${this.table}`);
    if (this.operation !== "select") {
      writes.push(structuredClone(this.payload));
      if (rejectMetadata && this.payload.currency?.includes("|"))
        return {
          data: null,
          error: { code: "23514", message: "Database rejected metadata" },
        };
      const id =
        this.operation === "insert"
          ? `requirement-${++sequence}`
          : this.filters.find(([k]) => k === "id")[1];
      rows.set(id, { ...rows.get(id), ...this.payload, id, status: "open" });
      return { data: structuredClone(rows.get(id)), error: null };
    }
    const found = [...rows.values()].filter((row) =>
      this.filters.every(([k, v]) => row[k] === v),
    );
    return {
      data: single ? structuredClone(found[0]) || null : structuredClone(found),
      error: null,
    };
  }
  single() {
    return this.execute(true);
  }
  maybeSingle() {
    return this.execute(true);
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}
globalThis.__requirementsSupabase = {
  from: (table) => new Query(table),
  auth: { getSession: async () => ({ data: { session: null } }) },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => ({
  ok: !String(url).endsWith("/update"),
  json: async () => ({
    duplicate: false,
    requirements: [],
    shares: [],
    deleted: [],
  }),
});
await build({
  stdin: {
    contents: `export * from ${JSON.stringify(path.join(root, "src/api/requirements.ts"))};
export * from ${JSON.stringify(path.join(root, "src/lib/enterpriseLifecycle.ts"))};
export {getRequirementBgvChecks} from ${JSON.stringify(path.join(root, "src/lib/bgv.ts"))};
import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
import {RequirementRibbon} from ${JSON.stringify(path.join(root, "src/components/domain/RequirementRibbon.tsx"))};
export const renderRibbon = requirement => renderToStaticMarkup(React.createElement(RequirementRibbon,{requirement}));`,
    resolveDir: root,
  },
  outfile: artifact,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "isolated-supabase",
      setup(b) {
        b.onResolve({ filter: /lib\/supabase$/ }, () => ({
          path: "supabase",
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents:
            "export const supabase = globalThis.__requirementsSupabase;",
          loader: "js",
        }));
      },
    },
  ],
});
const api = await import(pathToFileURL(artifact).href);
function input(extra = {}) {
  return {
    client_org_id: "client-1",
    title: `SAP Finance Analyst ${sequence}`,
    description: "An experienced SAP finance analyst is required.",
    skills: ["SAP"],
    min_experience: 3,
    max_experience: 6,
    location: "Remote",
    work_mode: "remote",
    employment_type: "contract",
    openings: 1,
    vendor_visible_budget: 2,
    submission_sla_hours: 48,
    currency: api.encodeRequirementMetaToCurrency({
      baseCurrency: "INR",
      isClientMapped: true,
      mappedClientOrgId: "client-1",
      profileType: "bench",
      hasBgv: true,
      bgvChecks: ["UAN Required"],
      ...extra,
    }),
  };
}
function reset() {
  rows = new Map();
  writes = [];
  rejectMetadata = false;
}
try {
  await test("first create persists Bench and custom BGV in the database, not only browser cache", async () => {
    reset();
    const payload = input();
    const created = await api.createRequirement(payload);
    const stored = rows.get(created.id);
    assert.equal(stored.currency, payload.currency);
    const cold = { ...stored, id: "cold-create" };
    assert.equal(api.parseRequirementMeta(cold).profileType, "bench");
    assert.deepEqual(api.getRequirementBgvChecks(cold), ["UAN Required"]);
    assert.match(api.renderRibbon(cold), />Bench profile</);
    assert.match(api.renderRibbon(cold), />BGV</);
    const fetched = await api.fetchRequirementById(created.id);
    assert.equal(fetched.currency, payload.currency);
  });
  await test("first edit immediately returns and reloads new Bench/BGV settings", async () => {
    reset();
    const created = await api.createRequirement(
      input({ profileType: "market", hasBgv: false, bgvChecks: [] }),
    );
    const payload = input();
    const updated = await api.updateRequirement(created.id, payload);
    const fetched = await api.fetchRequirementById(created.id);
    assert.equal(updated.currency, payload.currency);
    assert.equal(fetched.currency, payload.currency);
    assert.match(api.renderRibbon(fetched), />Bench profile</);
    assert.deepEqual(api.getRequirementBgvChecks(fetched), ["UAN Required"]);
  });
  await test("clearing profile type and disabling BGV removes badges on the first save", async () => {
    reset();
    const created = await api.createRequirement(input());
    const updated = await api.updateRequirement(
      created.id,
      input({ profileType: null, hasBgv: false, bgvChecks: [] }),
    );
    const fetched = await api.fetchRequirementById(updated.id);
    assert.doesNotMatch(api.renderRibbon(fetched), />Bench profile</);
    assert.doesNotMatch(api.renderRibbon(fetched), />BGV</);
    assert.deepEqual(api.getRequirementBgvChecks(fetched), []);
  });
  await test("legacy plain-currency records display metadata already available to the edit form", () => {
    reset();
    const id = "legacy-cache";
    const payload = input();
    api.saveRequirementExtendedCache(
      id,
      api.parseRequirementMeta(payload.currency),
    );
    const ribbon = api.renderRibbon({
      id,
      currency: "INR",
      title: "SAP Analyst",
    });
    assert.match(ribbon, />Bench profile</);
    assert.match(ribbon, />BGV</);
  });
  await test("mapping and archival copies preserve custom BGV checks and other requirement extras", () => {
    const currency = api.encodeRequirementMetaToCurrency({
      baseCurrency: "INR",
      isClientMapped: false,
      profileType: "both",
      hasBgv: true,
      bgvChecks: ["UAN Required", "Education Verification"],
      unregisteredSource: "Agency",
      unregisteredSourceCode: "HN-SRC-1",
      unregisteredSourceContact: "Representative",
    });
    const original = api.parseRequirementMeta(currency);
    const rebuilt = api.parseRequirementMeta(
      api.encodeRequirementMetaToCurrency({
        baseCurrency: "INR",
        isClientMapped: true,
        mappedClientOrgId: "client-2",
        ...api.extrasFromMeta(original),
      }),
    );
    assert.deepEqual(rebuilt.bgvChecks, original.bgvChecks);
    assert.equal(
      rebuilt.unregisteredSourceCode,
      original.unregisteredSourceCode,
    );
  });
  await test("a rejected metadata write never reports a successful save of plain currency", async () => {
    reset();
    const created = await api.createRequirement(
      input({ profileType: "market", hasBgv: false, bgvChecks: [] }),
    );
    const before = rows.get(created.id).currency;
    writes = [];
    rejectMetadata = true;
    await assert.rejects(() => api.updateRequirement(created.id, input()));
    assert.equal(rows.get(created.id).currency, before);
    assert.ok(writes.every((payload) => payload.currency?.includes("|")));
  });
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__requirementsSupabase;
  await unlink(artifact);
}
