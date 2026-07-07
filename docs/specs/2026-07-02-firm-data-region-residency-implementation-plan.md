# Per-firm data-region (residency) seam — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-firm `data_region` attribute and thread it through provisioning so a firm's storage can be pinned to a jurisdiction — the `eu` path built on Cloudflare's `eu` jurisdiction (R2 bucket + firm-database Durable Object), `us` (default) as North-America placement. Set once at provisioning; no cross-region moves.

**Architecture:** A `data_region` column on the control-plane `firm` table drives two placement decisions at provisioning time: the R2 bucket's jurisdiction/location, and the firm-database Durable Object's jurisdiction. A pure `@magna-carta/database` helper maps a region to a Cloudflare jurisdiction so both the R2 adapter and the DO addressor share one source of truth. Region is immutable (a jurisdiction-bound DO id differs from the bare id).

**Tech Stack:** TypeScript (strict), Vitest, Drizzle ORM + drizzle-kit (control-plane migrations), Cloudflare Workers (R2 REST, Durable Objects).

**Design:** `docs/specs/2026-07-02-data-subject-attribution-erasure-residency-design.md` (§7).

## Global Constraints

- **No name shorthand**; **no process-doc references in source** (`lint:process-refs`) — cite reasoning or `docs/conventions/…` by path, never `ADR-NNNN`/spec §.
- **Quality gate** `pnpm check` + affected package tests pass before each commit.
- **Region values:** `"us" | "eu"` (`us` the primary-market default; `canada` reserved, NOT built — Cloudflare has no CA jurisdiction). `eu` is a hard jurisdiction lock; `us` is North-America placement via location hint.
- **Immutable after provisioning** — never expose a region-change path; a jurisdiction-bound DO id differs from the bare id, so changing region would orphan the firm's data.
- **Control-plane migration** (schema change on the `firm` table), NOT a per-firm migration. Generate via drizzle-kit; wire into `apps/worker/src/control-plane-migrations.ts`.
- **Scope boundary (seam, not full activation):** this plan makes the DO layer _jurisdiction-capable_ and fully wires **R2** placement + the region column. Threading the region-derived jurisdiction into _every_ `firmDatabaseFor` call site (so an `eu` firm's ~185 statement modules all address the EU DO) is the **activation step deferred to when the first `eu` firm provisions** — until then every firm is `us` and addresses the bare DO, so there is no behavior change to wire now. This is called out in Task 5.

---

### Task 1: The `DataRegion` type + jurisdiction helper

**Files:**

- Create: `packages/database/src/data-region.ts`
- Test: `packages/database/test/data-region.test.ts`

**Interfaces:**

- Produces: `type DataRegion = "us" | "eu"`; `jurisdictionForRegion(region): "eu" | undefined`; `locationHintForRegion(region): "enam" | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/database/test/data-region.test.ts
import { describe, expect, it } from "vitest";
import { jurisdictionForRegion, locationHintForRegion } from "../src/data-region.ts";

describe("data-region → Cloudflare placement", () => {
  it("eu maps to the hard eu jurisdiction", () => {
    expect(jurisdictionForRegion("eu")).toBe("eu");
  });
  it("us has no jurisdiction (North-America placement, soft)", () => {
    expect(jurisdictionForRegion("us")).toBeUndefined();
  });
  it("us carries a North-America location hint; eu does not need one (jurisdiction is hard)", () => {
    expect(locationHintForRegion("us")).toBe("enam");
    expect(locationHintForRegion("eu")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @magna-carta/database test data-region`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/database/src/data-region.ts
// A firm's data-residency region — where its per-firm storage (R2 bucket + firm-database Durable
// Object) physically lives. `us` (the primary market and column default) is North-America placement,
// a soft location hint; `eu` pins storage to Cloudflare's EU jurisdiction, a hard guarantee. There is
// no general US jurisdiction primitive on Cloudflare (only FedRAMP, a government-only tier), which is
// adequate because no cross-border transfer restriction binds US-resident data. Region is set once at
// provisioning and never changes: a jurisdiction-bound Durable Object id differs from the bare id.
export type DataRegion = "us" | "eu";

// The Cloudflare jurisdiction for a region, or undefined for unconstrained (US) placement. Shared by
// the R2 bucket creator and the firm-database Durable Object addressor so both agree.
export function jurisdictionForRegion(region: DataRegion): "eu" | undefined {
  return region === "eu" ? "eu" : undefined;
}

// The R2 location hint for an unconstrained region (US → North-America). `eu` returns undefined
// because its hard jurisdiction already fixes placement.
export function locationHintForRegion(region: DataRegion): "enam" | undefined {
  return region === "us" ? "enam" : undefined;
}
```

- [ ] **Step 4: Green + commit**

Run: `pnpm --filter @magna-carta/database test data-region` → PASS.

```bash
git add packages/database/src/data-region.ts packages/database/test/data-region.test.ts
git commit -m "feat(database): DataRegion type + Cloudflare jurisdiction mapping"
```

---

### Task 2: The `firm.data_region` column + control-plane migration

**Files:**

- Modify: `packages/database/src/control-plane-schema.ts` (add the column; import `DataRegion`)
- Generate: `packages/database/drizzle/control-plane/000X_<tag>.sql` (drizzle-kit) + its `meta/_journal.json` entry
- Modify: `apps/worker/src/control-plane-migrations.ts` (import + map the new SQL)
- Test: `packages/database/test/control-plane-schema.test.ts` (add an assertion)

- [ ] **Step 1: Add the failing schema assertion**

Append inside the `firm` describe block of `packages/database/test/control-plane-schema.test.ts` (it already defines the `columnOf` helper):

```ts
it("firm.data_region defaults to us and is not null", () => {
  expect(columnOf(firm, "data_region").default).toBe("us");
  expect(columnOf(firm, "data_region").notNull).toBe(true);
});
```

Run: `pnpm --filter @magna-carta/database test control-plane-schema`
Expected: FAIL — no `data_region` column.

- [ ] **Step 2: Add the column to the schema**

In `packages/database/src/control-plane-schema.ts`, add the import and the column (after `createdAt` or near `releaseChannel`):

```ts
import type { DataRegion } from "./data-region.ts";
```

```ts
  // The firm's data-residency region — where its per-firm storage physically lives. `us` (default)
  // is North-America placement; `eu` pins storage to Cloudflare's EU jurisdiction. Immutable after
  // provisioning (a jurisdiction-bound Durable Object id differs from the bare id, so a region change
  // would orphan the firm's data). DEFAULT keeps pre-region rows valid (expand-contract).
  dataRegion: text("data_region").notNull().default("us").$type<DataRegion>(),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @magna-carta/database run generate-control-plane-migrations`
Expected: creates `packages/database/drizzle/control-plane/0005_<tag>.sql` containing:
`ALTER TABLE \`firm\` ADD \`data*region\` text DEFAULT 'us' NOT NULL;`and appends a`0005*<tag>`entry to`drizzle/control-plane/meta/\_journal.json`. Note the exact `<tag>`.

- [ ] **Step 4: Wire the migration into the worker bundle**

In `apps/worker/src/control-plane-migrations.ts`, add the import alongside the others and the map entry (use the real `<tag>` from Step 3):

```ts
import dataRegionSql from "@magna-carta/database/drizzle/control-plane/0005_<tag>.sql";
```

```ts
    "0004_support-access": supportAccessSql,
    "0005_<tag>": dataRegionSql,
```

(`migrationsFromJournal` throws if the journal gains a tag this map lacks — so this step is mandatory.)

- [ ] **Step 5: Green + commit**

Run: `pnpm --filter @magna-carta/database test control-plane-schema` → PASS.
Run: `pnpm --filter @magna-carta/worker test` (exercises the migration bundle loader) → PASS.

```bash
git add packages/database/src/control-plane-schema.ts packages/database/drizzle/control-plane apps/worker/src/control-plane-migrations.ts packages/database/test/control-plane-schema.test.ts
git commit -m "feat(database): add firm.data_region column (control-plane migration)"
```

---

### Task 3: Thread the region into R2 bucket creation

**Files:**

- Modify: `apps/worker/src/firm-resource-provider.ts` (widen the `createBucket` port + both adapters)
- Test: `apps/worker/test/firm-resource-provider.test.ts` (or the existing provider test file)

**Interfaces:**

- Consumes: `DataRegion`, `jurisdictionForRegion`, `locationHintForRegion` (Task 1).
- Produces: `createBucket(firmId: FirmId, region: DataRegion): Promise<{ bucketName: string }>`.

- [ ] **Step 1: Write the failing test (REST adapter applies the eu jurisdiction)**

Add a test that constructs the Cloudflare REST adapter with a fake `fetch` and asserts an `eu` firm's bucket create carries the `cf-r2-jurisdiction: eu` header, while a `us` firm's create sends a North-America `locationHint` and no jurisdiction header. Mirror the existing provider test's fake-fetch setup.

```ts
// packages/…/apps/worker/test/firm-resource-provider.test.ts  (add to the REST-adapter describe)
it("eu firm creates its bucket under the eu jurisdiction; us firm uses a North-America hint", async () => {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImplementation = fakeFetch((url, init) => {
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    // probe misses (404) then create succeeds — mirror the existing find-first fake.
    return url.endsWith("/r2/buckets") ? okEnvelope() : missEnvelope();
  });
  const provider = cloudflareRestFirmResourceProvider({
    accountId: "a",
    apiToken: "t",
    fetchImplementation,
  });

  await provider.createBucket("firm_eu" as FirmId, "eu");
  await provider.createBucket("firm_us" as FirmId, "us");

  const euCreate = calls.find((call) => call.url.endsWith("/r2/buckets") && /* eu firm */ true);
  expect(euCreate?.headers["cf-r2-jurisdiction"]).toBe("eu");
  const usCreate = calls.findLast((call) => call.url.endsWith("/r2/buckets"));
  expect(usCreate?.headers["cf-r2-jurisdiction"]).toBeUndefined();
  expect((usCreate?.body as { locationHint?: string }).locationHint).toBe("enam");
});
```

(Use the file's existing fake-fetch helpers — `fakeFetch`, `okEnvelope`, `missEnvelope` — matching their real names in that test.)

Run: `pnpm --filter @magna-carta/worker test firm-resource-provider`
Expected: FAIL — `createBucket` takes one argument; no jurisdiction header/locationHint.

- [ ] **Step 2: Widen the port + dev adapter**

In `apps/worker/src/firm-resource-provider.ts`, change the interface and the dev adapter:

```ts
import type { DataRegion } from "@magna-carta/database/data-region";
import { jurisdictionForRegion, locationHintForRegion } from "@magna-carta/database/data-region";
```

```ts
export interface FirmResourceProvider {
  createBucket(firmId: FirmId, region: DataRegion): Promise<{ bucketName: string }>;
  configureBucketNotifications(firmId: FirmId): Promise<void>;
}
```

Dev adapter (region is irrelevant to the deterministic name):

```ts
    async createBucket(firmId: FirmId, _region: DataRegion): Promise<{ bucketName: string }> {
      return { bucketName: await firmResourceName(firmId) };
    },
```

- [ ] **Step 3: Thread region through the REST adapter**

In the Cloudflare REST adapter's `createBucket`, derive the jurisdiction/hint and pass them to the create call. First confirm `callApi`'s signature at the top of the file; if it does not already accept per-call headers, add an optional trailing `headers?: Record<string, string>` parameter and spread it into the `fetch` `headers`. Then:

```ts
    async createBucket(firmId: FirmId, region: DataRegion): Promise<{ bucketName: string }> {
      const name = await firmResourceName(firmId);
      const jurisdiction = jurisdictionForRegion(region);
      const headers = jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined;
      const probed = await callApi<unknown>(
        "createBucket",
        "GET",
        `${accountBase}/r2/buckets/${name}`,
        undefined,
        headers,
      );
      if (probed.envelope.success) return { bucketName: name };

      const locationHint = locationHintForRegion(region);
      const created = await callApi<unknown>(
        "createBucket",
        "POST",
        `${accountBase}/r2/buckets`,
        locationHint ? { name, locationHint } : { name },
        headers,
      );
      if (created.envelope.success || isAlreadyExists(created.envelope)) return { bucketName: name };
      throw describeFailure("createBucket", created.status, created.envelope);
    },
```

(The probe read must use the same jurisdiction header, or it queries the wrong jurisdiction and always misses.)

- [ ] **Step 4: Green + commit**

Run: `pnpm --filter @magna-carta/worker test firm-resource-provider` → PASS.

```bash
git add apps/worker/src/firm-resource-provider.ts apps/worker/test/firm-resource-provider.test.ts
git commit -m "feat(worker): thread data_region into R2 bucket creation (eu jurisdiction, us location hint)"
```

---

### Task 4: Read `data_region` in the provisioner and pass it to `createBucket`

**Files:**

- Modify: `apps/worker/src/firm-provisioner.ts`
- Test: `apps/worker/test/firm-provisioner.test.ts` (add a region assertion using the fake provider)

- [ ] **Step 1: Failing test — the provisioner passes the firm's region to `createBucket`**

Extend the fake resource provider in the provisioner test to record the `region` argument, seed a firm row with `data_region = 'eu'`, run provisioning, and assert `createBucket` was called with `"eu"`. (Mirror the existing provisioner test's fake-provider + seed helpers.)

```ts
it("passes the firm's data_region to createBucket", async () => {
  const regions: string[] = [];
  const resourceProvider = fakeResourceProvider({
    onCreateBucket: (_firmId, region) => regions.push(region),
  });
  await seedFirm({ name: "EU LLP", data_region: "eu" });
  await provisionFirm({ name: "EU LLP" }, { resourceProvider /* …other deps… */ });
  expect(regions).toContain("eu");
});
```

Run: `pnpm --filter @magna-carta/worker test firm-provisioner`
Expected: FAIL — `createBucket` is called with one argument; the fake records `undefined`.

- [ ] **Step 2: Read the column and pass it**

In `apps/worker/src/firm-provisioner.ts`, add `data_region` to the row type and select, then pass it to `createBucket`:

```ts
interface FirmRow {
  readonly id: FirmId;
  readonly status: string;
  readonly bucket_name: string | null;
  readonly wrapped_firm_key: string | null;
  readonly data_region: DataRegion;
}

const SELECT_FIRM_BY_NAME =
  "SELECT id, status, bucket_name, wrapped_firm_key, data_region FROM firm WHERE name = ?1";
```

```ts
// Step 2 — create (or re-claim) the firm's bucket in its data region, then record it.
if (firmRow.bucket_name === null) {
  const { bucketName } = await dependencies.resourceProvider.createBucket(
    firmId,
    firmRow.data_region,
  );
  await database
    .prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1 AND bucket_name IS NULL")
    .bind(firmId, bucketName)
    .run();
}
```

Add `import type { DataRegion } from "@magna-carta/database/data-region";`. (A firm row created before the column existed reads `data_region = 'us'` via the column default — no null handling needed.)

- [ ] **Step 3: Green + commit**

Run: `pnpm --filter @magna-carta/worker test firm-provisioner` → PASS.

```bash
git add apps/worker/src/firm-provisioner.ts apps/worker/test/firm-provisioner.test.ts
git commit -m "feat(worker): provision the firm R2 bucket in its data_region"
```

---

### Task 5: Make `firmDatabaseFor` jurisdiction-capable (DO placement seam)

Makes the firm-database Durable Object addressor able to place/address a firm's DO under a jurisdiction, **backward-compatibly** (existing callers pass nothing → bare `idFromName`, unchanged). Full threading of region to every call site is the deferred activation step (see Global Constraints).

**Files:**

- Modify: `apps/worker/src/firm-database/firm-database-proxy.ts`
- Test: `apps/worker/src/firm-database/firm-database-proxy.test.ts` (or the co-located test)

- [ ] **Step 1: Failing test — an eu jurisdiction addresses via the jurisdiction subnamespace**

```ts
it("addresses the DO under the eu jurisdiction when given one", () => {
  const seen: string[] = [];
  const euSub = {
    idFromName: (name: string) => ({ name, jurisdiction: "eu" }) as unknown as DurableObjectId,
    get: (id: unknown) => ({ id }),
  };
  const namespace = {
    idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
    get: (id: unknown) => ({ id }),
    jurisdiction: (j: string) => {
      seen.push(j);
      return euSub;
    },
  };
  firmDatabaseFor(namespace as never, "firm_1", "eu");
  expect(seen).toEqual(["eu"]);
});

it("uses the bare namespace when no jurisdiction is given (unchanged for us firms)", () => {
  const namespace = {
    idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
    get: (id: unknown) => ({ id }),
    jurisdiction: () => {
      throw new Error("must not be called");
    },
  };
  expect(() => firmDatabaseFor(namespace as never, "firm_1")).not.toThrow();
});
```

Run: `pnpm --filter @magna-carta/worker test firm-database-proxy`
Expected: FAIL — `firmDatabaseFor` takes two args; ignores jurisdiction.

- [ ] **Step 2: Add the optional jurisdiction**

```ts
interface FirmDatabaseNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): unknown;
  // A jurisdiction-constrained view of the same namespace (Cloudflare DO jurisdictions: "eu",
  // "fedramp"). Present on the real binding; optional here so tests can omit it.
  jurisdiction?(jurisdiction: "eu" | "fedramp"): FirmDatabaseNamespace;
}

export function firmDatabaseFor(
  namespace: FirmDatabaseNamespace,
  firmId: string,
  jurisdiction?: "eu" | "fedramp",
): ProxyBatchDatabase {
  // A jurisdiction-bound id differs from the bare id, so a firm must always be addressed under the
  // same jurisdiction it was provisioned in — never mix the two for one firm.
  const resolver =
    jurisdiction !== undefined && namespace.jurisdiction !== undefined
      ? namespace.jurisdiction(jurisdiction)
      : namespace;
  const stub = resolver.get(resolver.idFromName(firmId)) as DurableObjectStub<FirmDatabase>;
  return firmDatabaseProxy(stub);
}
```

- [ ] **Step 3: Green + confirm existing callers still pass**

Run: `pnpm --filter @magna-carta/worker test firm-database-proxy` → PASS.
Run: `pnpm --filter @magna-carta/worker test` → PASS (the new third parameter is optional; all ~185 existing `firmDatabaseFor(namespace, firmId)` call sites compile and behave unchanged).

- [ ] **Step 4: Record the deferred activation**

Add a comment at the `firmDatabaseFor` call boundary (the tenancy chokepoint that resolves firm context) noting the activation seam — WITHOUT wiring it (no `eu` firm exists yet):

```ts
// Residency activation seam: when the first eu-region firm is provisioned, resolve the firm's
// data_region at the tenancy chokepoint and pass jurisdictionForRegion(region) here so every
// statement addresses the firm's DO under its jurisdiction. Until then all firms are us (bare id).
```

- [ ] **Step 5: Commit + changelog + gate**

```bash
git add apps/worker/src/firm-database/firm-database-proxy.ts apps/worker/src/firm-database/firm-database-proxy.test.ts
git commit -m "feat(worker): make firmDatabaseFor jurisdiction-capable (DO residency seam)"
```

Create `changelog.d/firm-data-region.md`:

```markdown
---
category: Added
---

**Firms now carry a `data_region` that pins their storage jurisdiction.** A new control-plane column
(`us` default, `eu` supported) is threaded through provisioning: an `eu` firm's R2 bucket is created
under Cloudflare's EU jurisdiction and its firm-database Durable Object is jurisdiction-capable, giving
a hard EU-residency guarantee. Set once at provisioning; no cross-region moves. `us` is North-America
placement; Canada is reserved.
```

```bash
git add changelog.d/firm-data-region.md && git commit -m "docs(changelog): firm data_region residency seam"
pnpm check
```

Expected: `pnpm check` PASS.

## Self-review notes

- **Spec coverage (§7):** column → Task 2; R2 `eu` jurisdiction + `us` hint → Task 3; provisioner threading → Task 4; DO jurisdiction capability → Task 5; the region→placement helper → Task 1. The full call-site threading is the spec's implied activation, explicitly deferred (no `eu` firm exists), flagged in Task 5 Step 4.
- **Type consistency:** `DataRegion` (`"us" | "eu"`) is defined in Task 1 and consumed identically in Tasks 2–4; `jurisdictionForRegion` returns `"eu" | undefined`, matching `firmDatabaseFor`'s `"eu" | "fedramp"` param and R2's `cf-r2-jurisdiction` header value.
- **No placeholders:** the one confirm-at-implementation point (the exact `callApi` header-threading, Task 3 Step 3) is a bounded instruction against a function that exists in the file, not a vague TODO. The migration `<tag>` is drizzle-kit-assigned and captured in Task 2 Step 3.
