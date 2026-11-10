# Product-usage analytics — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build always-on, opt-out product-usage analytics — `reached`/`completed` events on the slice 0·6 telemetry path, Analytics Engine live counts, and an R2 Data Catalog Iceberg tier for retention/BI — so we can see, cross-firm, which features are used and which are not.

**Architecture:** A new `usage.feature` allowlist event rides the existing `@magna-carta/telemetry` path (structural redaction, one logging path). `reached` emits server-side from a global outbound-pass middleware (route→feature map); `completed` emits from the per-firm outbox sweep (topic→feature map); a `POST /api/v1/usage` beacon covers pure-client surfaces. Consent (firm-enable + per-user opt-out) resolves off the hot path via an isolate-local cache. Live queries read Analytics Engine counters; full-fidelity rows flow Logpush → Pipelines → R2 Data Catalog (Iceberg/Parquet) for retention/BI.

**Tech Stack:** TypeScript, Cloudflare Workers + Hono + `@hono/zod-openapi`, D1 (per-firm + control-plane), Analytics Engine, Logpush, Cloudflare Pipelines, R2 Data Catalog (Apache Iceberg), Vitest, Web Crypto (HMAC-SHA-256).

## Global Constraints

- **Spec home:** `docs/specs/2026-06-18-usage-analytics-design.md` (`ADR-0106`). Every task implements part of it.
- **One logging path.** All emission goes through `logger.log(...)` / `logger.count(...)` — never `console.*`. The console-ban fitness (`packages/telemetry/test/console-ban.test.ts`) enforces this; do not add to its allowlist.
- **Structural redaction.** Usage events carry only the `usage.feature` allowlist (`feature`, `phase`, `surface`, `firmIdHash`, `userIdHash`, `appVersion`) plus the implicit `correlationId` + `at`. No entity IDs, no free text, no content. `FieldValue` is `string | number | boolean | null` only.
- **Full names — no shorthand** (golden rule 12): `@magna-carta/...` in full, `newIdentifier`, "the data-access layer". `Id`/`URL`/`JSON`/`SQL` are the allowed universal terms.
- **No process-doc references in source/tests/config** (golden rule 13): no `ADR-NNNN`, no "spec §N", no "slice 0·N" in code comments or OpenAPI `description`s. State the reasoning inline or cite a file by path. (Forward-looking "built in a later slice" schedule notes are allowed.)
- **Pseudonymous hashes fail closed.** A missing/empty `USAGE_ANALYTICS_PEPPER` suppresses the event entirely — never emit an unhashed identifier.
- **Cross-firm aggregate only, small-n suppressed.** Per-firm/per-user analysis comes only from the Iceberg layer; AE counters are aggregate totals never shaped to a single firm. Suppress query cells below `k = 5`.
- **Docs same commit** (golden rule 5): the relevant ROADMAP/STATUS/CHANGELOG/white-paper/Decision-Log/operating-costs updates land in Task G, in the same commit as the code they describe where a task produces user-visible behavior.
- **Sub-slice independence:** Tasks A–E deliver a working MVP on the Analytics Engine query path. Task F (Iceberg/Pipelines) ships afterward without blocking A–E.
- **Run the full gate before each commit:** `pnpm check` (fmt + lint + typecheck + svelte-check) and the relevant `vp test` scope.

---

## File structure

| File                                                                           | Responsibility                                                              | Task  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----- |
| `packages/telemetry/src/events.ts` (modify)                                    | Add the `usageFeature` builder + `EVENT_NAMES` entry                        | A1    |
| `packages/telemetry/src/usage-features.ts` (create)                            | The feature-key taxonomy registry (`FEATURE_KEYS`, `FeatureKey`)            | A2    |
| `packages/telemetry/src/pseudonymize.ts` (create)                              | HMAC-SHA-256 hash helper, fail-closed                                       | A3    |
| `packages/database/src/per-firm-schema.ts` (modify)                            | Add the `optedOutOfUsageAnalytics` member-row column                        | B1    |
| `packages/database/drizzle/per-firm/0007_usage-analytics-opt-out.sql` (create) | The opt-out column migration                                                | B1    |
| `packages/data-access/src/usage-consent-statements.ts` (create)                | `usageAnalyticsEnabled` setting definition + `readMemberOptedOut`           | B2    |
| `apps/worker/src/usage/consent.ts` (create)                                    | Cached effective-consent resolver                                           | B3    |
| `apps/worker/src/usage/feature-map.ts` (create)                                | `routeFeature(routePath)` + `topicFeature(topic)` maps                      | C1    |
| `apps/worker/src/usage/emit.ts` (create)                                       | `emitUsage(...)` — the shared log+count emitter (consent + hash + suppress) | C2    |
| `apps/worker/src/usage/reached-middleware.ts` (create)                         | Global outbound-pass `reached` middleware                                   | C2    |
| `apps/worker/src/scheduled.ts` (modify)                                        | `completed` emit in the per-firm sweep publish path                         | C3    |
| `apps/worker/src/routes/usage.ts` (create)                                     | `POST /api/v1/usage` beacon                                                 | D2    |
| `apps/worker/src/contracts/route-meta.ts` (modify)                             | Add `"usage-beacon"` to `RateLimitBucket`                                   | D1    |
| `packages/access-control/src/registry.ts` (modify)                             | Add `firm:recordUsage`                                                      | D1    |
| `apps/worker/src/app.ts` (modify)                                              | Register the middleware + beacon; add `USAGE_ANALYTICS_PEPPER` binding      | C2/D2 |
| `packages/telemetry/src/usage-suppression.ts` (create)                         | Small-n (k-anonymity) suppressor                                            | E1    |
| `docs/analytics/usage-queries.md` (create)                                     | Canonical DuckDB query set                                                  | E2/F3 |
| `apps/worker/wrangler.jsonc` + Cloudflare config (modify)                      | Logpush → Pipelines → R2 Data Catalog                                       | F1/F2 |
| Docs (ADR, white paper, ROADMAP, STATUS, CHANGELOG, operating-costs)           | Same-commit doc updates                                                     | G     |

---

## Sub-slice A — Event foundation

### Task A1: The `usage.feature` event builder

**Files:**

- Modify: `packages/telemetry/src/events.ts`
- Test: `packages/telemetry/test/events.test.ts`

**Interfaces:**

- Produces: `usageFeature(context: EventContext, fields: { feature, phase, surface, firmIdHash, userIdHash, appVersion }): TelemetryEvent` where every field is `string | null` (and `phase` is `"reached" | "completed"` by convention, typed `string`). Added to `EVENT_NAMES`.

- [ ] **Step 1: Write the failing test** — append to `packages/telemetry/test/events.test.ts`:

```typescript
import { usageFeature } from "../src/events.ts";

it("usageFeature carries exactly its allowlist and strips undeclared keys", () => {
  const event = usageFeature(
    { correlationId: "correlation_x", now: "2026-06-18T00:00:00.000Z" },
    {
      feature: "matters.list",
      phase: "reached",
      surface: null,
      firmIdHash: "abc123",
      userIdHash: null,
      appVersion: null,
    },
  );
  expect(event.name).toBe("usage.feature");
  expect(event.fields).toEqual({
    feature: "matters.list",
    phase: "reached",
    surface: null,
    firmIdHash: "abc123",
    userIdHash: null,
    appVersion: null,
  });
});

it("includes usage.feature in EVENT_NAMES exactly once", () => {
  const usageNames = EVENT_NAMES.filter((name) => name === "usage.feature");
  expect(usageNames).toHaveLength(1);
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter @magna-carta/telemetry test events`
Expected: FAIL — `usageFeature` is not exported.

- [ ] **Step 3: Add the builder** — in `packages/telemetry/src/events.ts`, after the `authDenied` builder and before `EVENT_NAMES`:

```typescript
// usage.feature — a product-usage signal: a feature was reached (an authorized route mapped to it
// was served) or completed (an authoritative domain mutation for it occurred). Identifiers are
// pseudonymous HMAC handles, never raw ids; surface/userIdHash/appVersion are null when the emit
// site cannot supply them (server-derived reached/completed). No content slot exists.
export const usageFeature = defineEvent("usage.feature", [
  "feature",
  "phase",
  "surface",
  "firmIdHash",
  "userIdHash",
  "appVersion",
] as const);
```

Then add `usageFeature,` to the `EVENT_NAMES` array (after `authDenied,`).

- [ ] **Step 4: Run it, expect pass**

Run: `pnpm --filter @magna-carta/telemetry test events`
Expected: PASS (including the existing uniqueness fitness, which now covers `usage.feature`).

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/events.ts packages/telemetry/test/events.test.ts
git commit -m "feat(telemetry): add usage.feature event builder"
```

### Task A2: The feature-key taxonomy

**Files:**

- Create: `packages/telemetry/src/usage-features.ts`
- Test: `packages/telemetry/test/usage-features.test.ts`

**Interfaces:**

- Produces: `FEATURE_KEYS: readonly string[]` (a `const` tuple), `type FeatureKey = (typeof FEATURE_KEYS)[number]`, `isFeatureKey(value: string): value is FeatureKey`.

- [ ] **Step 1: Write the failing test** — `packages/telemetry/test/usage-features.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, isFeatureKey } from "../src/usage-features.ts";

describe("feature taxonomy", () => {
  it("has no duplicate keys", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
  });
  it("every key is dot-separated subsystem.area", () => {
    for (const key of FEATURE_KEYS) expect(key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
  });
  it("recognizes a registered key and rejects an unknown one", () => {
    expect(isFeatureKey("matters.list")).toBe(true);
    expect(isFeatureKey("nope.nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter @magna-carta/telemetry test usage-features`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the registry** — `packages/telemetry/src/usage-features.ts`:

```typescript
// The product-usage feature taxonomy: one stable key per feature surface we measure adoption of.
// String literals only — this module takes no domain dependency. Adding a key here is how a new
// feature becomes measurable; the route->feature and topic->feature maps (in the worker) and the
// beacon request schema all resolve against this list, and a fitness test rejects any drift.
export const FEATURE_KEYS = [
  "matters.list",
  "matters.detail",
  "locations.manage",
  "files.manager",
  "files.upload",
  "billing.invoice",
  "ledger.posting",
  "tools.firmUsage",
  "tools.speedTest",
  "incidents.report",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

const featureKeySet: ReadonlySet<string> = new Set(FEATURE_KEYS);

export function isFeatureKey(value: string): value is FeatureKey {
  return featureKeySet.has(value);
}
```

(Seed the list with the features that exist today; later tasks add keys as surfaces ship.)

- [ ] **Step 4: Run it, expect pass**

Run: `pnpm --filter @magna-carta/telemetry test usage-features`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/usage-features.ts packages/telemetry/test/usage-features.test.ts
git commit -m "feat(telemetry): add product-usage feature taxonomy"
```

### Task A3: The pseudonymizing hash helper (fail-closed)

**Files:**

- Create: `packages/telemetry/src/pseudonymize.ts`
- Test: `packages/telemetry/test/pseudonymize.test.ts`

**Interfaces:**

- Produces: `async pseudonymize(pepper: string | undefined, identifier: string): Promise<string | null>` — HMAC-SHA-256 hex of `identifier` under `pepper`; returns `null` when `pepper` is missing/empty (fail-closed) so callers suppress the event.

- [ ] **Step 1: Write the failing test** — `packages/telemetry/test/pseudonymize.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pseudonymize } from "../src/pseudonymize.ts";

describe("pseudonymize", () => {
  it("is deterministic for the same pepper + identifier", async () => {
    const a = await pseudonymize("pepper", "firm_abc");
    const b = await pseudonymize("pepper", "firm_abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("depends on the pepper (different pepper -> different hash)", async () => {
    expect(await pseudonymize("p1", "firm_abc")).not.toBe(await pseudonymize("p2", "firm_abc"));
  });
  it("fails closed on a missing or empty pepper", async () => {
    expect(await pseudonymize(undefined, "firm_abc")).toBeNull();
    expect(await pseudonymize("", "firm_abc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter @magna-carta/telemetry test pseudonymize`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `packages/telemetry/src/pseudonymize.ts`:

```typescript
// Pseudonymous, stable identifier hashing for usage analytics. HMAC-SHA-256 under a long-lived
// server pepper: a bare SHA-256 of a low-entropy id (the firm-id space is small and enumerable) is
// reversible, so the keyed pepper is the privacy control. Fail-closed: with no pepper there is no
// privacy guarantee, so the caller must emit nothing rather than leak a raw or unsalted id.
export async function pseudonymize(
  pepper: string | undefined,
  identifier: string,
): Promise<string | null> {
  if (pepper === undefined || pepper === "") return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identifier));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `pnpm --filter @magna-carta/telemetry test pseudonymize`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/pseudonymize.ts packages/telemetry/test/pseudonymize.test.ts
git commit -m "feat(telemetry): add fail-closed HMAC pseudonymizer"
```

---

## Sub-slice B — Consent

### Task B1: The per-user opt-out column + migration

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts:86-93` (the `member` table)
- Create: `packages/database/drizzle/per-firm/0007_usage-analytics-opt-out.sql`
- Test: covered by B2's read test (a column alone has no behavior to unit-test).

**Interfaces:**

- Produces: `member.optedOutOfUsageAnalytics` (SQLite integer 0/1, default 0) — the per-user opt-out flag, on the member row per the white paper's member-row settings home.

- [ ] **Step 1: Add the column** — in `packages/database/src/per-firm-schema.ts`, extend the `member` table:

```typescript
export const member = sqliteTable("member", {
  userId: text("user_id").primaryKey().$type<UserId>(), // the global join key
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["active", "deactivated"] })
    .notNull()
    .default("active"),
  // Per-user opt-out of product-usage analytics (the per-user override; the firm-level enable lives
  // in the setting table). Default off (events flow) — a member sets this to opt themselves out.
  optedOutOfUsageAnalytics: integer("opted_out_of_usage_analytics", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(), // ISO-8601 instant
});
```

Ensure `integer` is imported from `drizzle-orm/sqlite-core` at the top of the file (it likely already is — check the existing imports).

- [ ] **Step 2: Write the migration** — `packages/database/drizzle/per-firm/0007_usage-analytics-opt-out.sql`:

```sql
-- Per-user product-usage-analytics opt-out, on the member row (the per-user settings home). Default
-- 0 (not opted out) so existing members keep emitting; an individual flips it to opt out.
ALTER TABLE member ADD COLUMN opted_out_of_usage_analytics INTEGER NOT NULL DEFAULT 0;
```

Update the drizzle journal/meta the same way `0006` did (follow the existing convention in `packages/database/drizzle/per-firm/meta/` if present; if migrations are hand-numbered SQL only, no journal edit is needed).

- [ ] **Step 3: Verify the migration applies** — run the worker integration test that migrates a fresh per-firm database to head:

Run: `vp test` (or the targeted `pnpm --filter @magna-carta/database test` if present)
Expected: PASS — fresh per-firm migration includes the new column.

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/0007_usage-analytics-opt-out.sql
git commit -m "feat(database): add per-user usage-analytics opt-out column"
```

### Task B2: The consent reads (firm setting + member opt-out)

**Files:**

- Create: `packages/data-access/src/usage-consent-statements.ts`
- Test: `packages/data-access/test/usage-consent-statements.test.ts`

**Interfaces:**

- Consumes: `readFirmSetting`, `FirmSettingDefinition` (`./setting-statements.ts`); `SqlDatabase` (`./idempotency-statements.ts`).
- Produces: `usageAnalyticsEnabledDefinition: FirmSettingDefinition<boolean>` (key `usage_analytics.enabled`, default `true`); `async readUsageAnalyticsEnabled(database): Promise<boolean>`; `async readMemberOptedOut(database, userId: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test** — `packages/data-access/test/usage-consent-statements.test.ts` (follow the package's existing node:sqlite fixture pattern used by other `*-statements.test.ts`):

```typescript
import { describe, expect, it } from "vitest";
import { readMemberOptedOut, readUsageAnalyticsEnabled } from "../src/usage-consent-statements.ts";
import { freshFirmDatabase } from "./helpers/fresh-firm-database.ts"; // existing per-package helper

describe("usage consent reads", () => {
  it("defaults firm usage analytics to enabled when unset", async () => {
    const database = await freshFirmDatabase();
    expect(await readUsageAnalyticsEnabled(database)).toBe(true);
  });
  it("reads a member opt-out flag (default false)", async () => {
    const database = await freshFirmDatabase();
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind("user_optout", "Opted Out", 1, "2026-06-18T00:00:00.000Z")
      .run();
    await database
      .prepare("INSERT INTO member (user_id, display_name, created_at) VALUES (?1, ?2, ?3)")
      .bind("user_in", "In", "2026-06-18T00:00:00.000Z")
      .run();
    expect(await readMemberOptedOut(database, "user_optout")).toBe(true);
    expect(await readMemberOptedOut(database, "user_in")).toBe(false);
    expect(await readMemberOptedOut(database, "user_absent")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter @magna-carta/data-access test usage-consent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `packages/data-access/src/usage-consent-statements.ts`:

```typescript
import { z } from "zod";
import { readFirmSetting, type FirmSettingDefinition } from "./setting-statements.ts";
import type { SqlDatabase } from "./idempotency-statements.ts";

// The firm-level product-usage-analytics switch. Default true: usage analytics is always-on and
// opt-out, so an unset firm is enabled. A firm admin writes false to disable it firm-wide.
export const usageAnalyticsEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "usage_analytics.enabled",
  schema: z.boolean(),
  defaultValue: true,
};

export function readUsageAnalyticsEnabled(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, usageAnalyticsEnabledDefinition);
}

// The per-user override, read from the member row. An absent member reads as not-opted-out (false):
// a request without a member row emits nothing for other reasons (no chokepoint context), so this
// default never widens emission.
export async function readMemberOptedOut(database: SqlDatabase, userId: string): Promise<boolean> {
  const { results } = await database
    .prepare("SELECT opted_out_of_usage_analytics AS optedOut FROM member WHERE user_id = ?1")
    .bind(userId)
    .all<{ optedOut: number }>();
  return results[0]?.optedOut === 1;
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `pnpm --filter @magna-carta/data-access test usage-consent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data-access/src/usage-consent-statements.ts packages/data-access/test/usage-consent-statements.test.ts
git commit -m "feat(data-access): add usage-analytics consent reads"
```

### Task B3: The cached effective-consent resolver

**Files:**

- Create: `apps/worker/src/usage/consent.ts`
- Test: `apps/worker/test/usage/consent.test.ts`

**Interfaces:**

- Consumes: `readUsageAnalyticsEnabled`, `readMemberOptedOut` (`@magna-carta/data-access/usage-consent-statements`); `SqlDatabase`.
- Produces: `createUsageConsentResolver(options?: { ttlMs?: number; clock?: () => number }): { resolve(database, firmId, userId): Promise<boolean> }` — effective consent (`firm.enabled && !member.optedOut`), isolate-local cached per `(firmId, userId)` with a 60 s TTL.

- [ ] **Step 1: Write the failing test** — `apps/worker/test/usage/consent.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createUsageConsentResolver } from "../../src/usage/consent.ts";

function fakeDatabase(enabled: boolean, optedOut: boolean) {
  return {
    prepare(sql: string) {
      const value = sql.includes("setting") ? JSON.stringify(enabled) : optedOut ? 1 : 0;
      return {
        bind: () => ({
          all: async () =>
            sql.includes("setting") ? { results: [{ value }] } : { results: [{ optedOut: value }] },
        }),
      };
    },
  } as never;
}

describe("usage consent resolver", () => {
  it("is true when firm enabled and user not opted out", async () => {
    const resolver = createUsageConsentResolver();
    expect(await resolver.resolve(fakeDatabase(true, false), "firm_a", "user_a")).toBe(true);
  });
  it("is false when the user opted out", async () => {
    const resolver = createUsageConsentResolver();
    expect(await resolver.resolve(fakeDatabase(true, true), "firm_a", "user_b")).toBe(false);
  });
  it("caches within the TTL (no second read)", async () => {
    let clock = 0;
    const resolver = createUsageConsentResolver({ ttlMs: 1000, clock: () => clock });
    const database = fakeDatabase(true, false);
    const spy = vi.spyOn(database as { prepare: unknown }, "prepare" as never);
    await resolver.resolve(database, "firm_a", "user_c");
    await resolver.resolve(database, "firm_a", "user_c");
    expect(spy).toHaveBeenCalledTimes(2); // firm + member, once; second resolve is a cache hit
    clock = 2000;
    await resolver.resolve(database, "firm_a", "user_c");
    expect(spy).toHaveBeenCalledTimes(4); // TTL expired -> re-read
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter @magna-carta/worker test usage/consent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/worker/src/usage/consent.ts`:

```typescript
import {
  readMemberOptedOut,
  readUsageAnalyticsEnabled,
} from "@magna-carta/data-access/usage-consent-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// Effective usage-analytics consent, resolved off the hot path. The effective value is
// firm-enabled AND not-user-opted-out; either off suppresses the user's events. Reads are cached
// isolate-locally per (firmId, userId) for a short TTL, so after warmup the common request does no
// D1 read; a firm disable or a user opt-out takes effect within one TTL.
const DEFAULT_TTL_MILLISECONDS = 60_000;

interface CacheEntry {
  readonly value: boolean;
  readonly expiresAt: number;
}

export function createUsageConsentResolver(options?: { ttlMs?: number; clock?: () => number }): {
  resolve(database: SqlDatabase, firmId: string, userId: string): Promise<boolean>;
} {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MILLISECONDS;
  const clock = options?.clock ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  return {
    async resolve(database, firmId, userId) {
      const cacheKey = `${firmId}\0${userId}`;
      const now = clock();
      const cached = cache.get(cacheKey);
      if (cached !== undefined && cached.expiresAt > now) return cached.value;

      const [enabled, optedOut] = await Promise.all([
        readUsageAnalyticsEnabled(database),
        readMemberOptedOut(database, userId),
      ]);
      const value = enabled && !optedOut;
      cache.set(cacheKey, { value, expiresAt: now + ttlMs });
      return value;
    },
  };
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `pnpm --filter @magna-carta/worker test usage/consent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/usage/consent.ts apps/worker/test/usage/consent.test.ts
git commit -m "feat(worker): add cached usage-analytics consent resolver"
```

---

## Sub-slice C — Emit sites

### Task C1: The route→feature and topic→feature maps

**Files:**

- Create: `apps/worker/src/usage/feature-map.ts`
- Test: `apps/worker/test/usage/feature-map.test.ts`

**Interfaces:**

- Consumes: `FeatureKey`, `isFeatureKey` (`@magna-carta/telemetry/usage-features`).
- Produces: `routeFeature(routePath: string): FeatureKey | null`; `topicFeature(topic: string): FeatureKey | null`. Both many-to-one; an unmapped input returns `null` (no event).

- [ ] **Step 1: Write the failing test** — `apps/worker/test/usage/feature-map.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isFeatureKey } from "@magna-carta/telemetry/usage-features";
import {
  ROUTE_FEATURE,
  TOPIC_FEATURE,
  routeFeature,
  topicFeature,
} from "../../src/usage/feature-map.ts";

describe("feature maps", () => {
  it("maps a known route template to its feature", () => {
    expect(routeFeature("/api/v1/matters")).toBe("matters.list");
  });
  it("maps a known outbox topic to its feature", () => {
    expect(topicFeature("matter.closed")).toBe("matters.detail");
  });
  it("returns null for an unmapped route or topic", () => {
    expect(routeFeature("/api/v1/unmapped")).toBeNull();
    expect(topicFeature("nothing.here")).toBeNull();
  });
  it("only references registered feature keys", () => {
    for (const key of [...Object.values(ROUTE_FEATURE), ...Object.values(TOPIC_FEATURE)]) {
      expect(isFeatureKey(key)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter @magna-carta/worker test usage/feature-map`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/worker/src/usage/feature-map.ts`:

```typescript
import { type FeatureKey, isFeatureKey } from "@magna-carta/telemetry/usage-features";

// route TEMPLATE -> feature. Many routes may map to one feature; a route absent here emits no
// reached event (it is not a measured surface, or it is covered by the client beacon). Keep keys as
// the Hono routePath template, never a concrete path.
export const ROUTE_FEATURE: Readonly<Record<string, FeatureKey>> = {
  "/api/v1/matters": "matters.list",
  "/api/v1/matters/:matterId": "matters.detail",
  "/api/v1/locations": "locations.manage",
  "/api/v1/files": "files.manager",
  "/api/v1/firm-usage": "tools.firmUsage",
};

// outbox topic -> feature (the authoritative completion signal). firm-level; an unmapped topic emits
// no completed event.
export const TOPIC_FEATURE: Readonly<Record<string, FeatureKey>> = {
  "matter.closed": "matters.detail",
  "file.version_committed": "files.upload",
  "ledger.entry.posted": "ledger.posting",
  "location.created": "locations.manage",
  "incident.created": "incidents.report",
};

export function routeFeature(routePath: string): FeatureKey | null {
  const feature = ROUTE_FEATURE[routePath];
  return feature !== undefined && isFeatureKey(feature) ? feature : null;
}

export function topicFeature(topic: string): FeatureKey | null {
  const feature = TOPIC_FEATURE[topic];
  return feature !== undefined && isFeatureKey(feature) ? feature : null;
}
```

- [ ] **Step 4: Run it, expect pass** — Run: `pnpm --filter @magna-carta/worker test usage/feature-map`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/usage/feature-map.ts apps/worker/test/usage/feature-map.test.ts
git commit -m "feat(worker): add usage route/topic feature maps"
```

### Task C2: The shared emitter + the reached middleware

**Files:**

- Create: `apps/worker/src/usage/emit.ts`
- Create: `apps/worker/src/usage/reached-middleware.ts`
- Modify: `apps/worker/src/app.ts` (add `USAGE_ANALYTICS_PEPPER` to `Bindings`; install the middleware)
- Test: `apps/worker/test/usage/emit.test.ts`, `apps/worker/test/usage/reached-middleware.test.ts`

**Interfaces:**

- Consumes: `usageFeature` (`@magna-carta/telemetry/events`), `pseudonymize` (`@magna-carta/telemetry/pseudonymize`), `Logger`, the consent resolver (B3), `requireChokepointFirmContext`/`requireChokepointUserId` (`../chokepoint/context-accessors.ts`).
- Produces: `async emitUsage(params): Promise<void>` — the one place that checks consent, hashes ids fail-closed, and fires `logger.log(usageFeature(...))` + `logger.count("usage", {...})`; `usageReachedMiddleware(deps)` — a global outbound-pass middleware.

- [ ] **Step 1: Write the failing emitter test** — `apps/worker/test/usage/emit.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { emitUsage } from "../../src/usage/emit.ts";

function recordingLogger() {
  return { log: vi.fn(), count: vi.fn() };
}

const baseParams = {
  pepper: "pepper",
  correlationId: "correlation_x",
  now: "2026-06-18T00:00:00.000Z",
  feature: "matters.list" as const,
  phase: "reached" as const,
  surface: null,
  appVersion: null,
  firmId: "firm_a",
  userId: "user_a",
};

describe("emitUsage", () => {
  it("logs the event and counts the metric when consented", async () => {
    const logger = recordingLogger();
    await emitUsage({ ...baseParams, logger, consented: true });
    expect(logger.log).toHaveBeenCalledOnce();
    expect(logger.count).toHaveBeenCalledWith("usage", {
      feature: "matters.list",
      phase: "reached",
      surface: "none",
    });
    const event = logger.log.mock.calls[0][0];
    expect(event.fields.firmIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.fields.userIdHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("emits nothing when not consented", async () => {
    const logger = recordingLogger();
    await emitUsage({ ...baseParams, logger, consented: false });
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.count).not.toHaveBeenCalled();
  });
  it("fails closed when the pepper is missing (no event)", async () => {
    const logger = recordingLogger();
    await emitUsage({ ...baseParams, pepper: undefined, logger, consented: true });
    expect(logger.log).not.toHaveBeenCalled();
  });
  it("passes a null userId through as a null hash (firm-level completed)", async () => {
    const logger = recordingLogger();
    await emitUsage({ ...baseParams, phase: "completed", userId: null, logger, consented: true });
    const event = logger.log.mock.calls[0][0];
    expect(event.fields.userIdHash).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect failure** — Run: `pnpm --filter @magna-carta/worker test usage/emit`; Expected: FAIL.

- [ ] **Step 3: Implement the emitter** — `apps/worker/src/usage/emit.ts`:

```typescript
import { usageFeature } from "@magna-carta/telemetry/events";
import type { Logger } from "@magna-carta/telemetry/logger";
import { pseudonymize } from "@magna-carta/telemetry/pseudonymize";
import type { FeatureKey } from "@magna-carta/telemetry/usage-features";

export interface EmitUsageParams {
  readonly logger: Logger;
  readonly consented: boolean;
  readonly pepper: string | undefined;
  readonly correlationId: string;
  readonly now: string;
  readonly feature: FeatureKey;
  readonly phase: "reached" | "completed";
  readonly surface: "web" | "desktop" | "portal" | null;
  readonly appVersion: string | null;
  readonly firmId: string;
  readonly userId: string | null;
}

// The single usage emit point: consent gate, fail-closed hashing, then both sinks (the full-fidelity
// log row that flows to Iceberg, and the aggregate Analytics Engine counter). The firm id is always
// hashed; a missing pepper suppresses the event entirely (never emit a raw or unhashed id).
export async function emitUsage(params: EmitUsageParams): Promise<void> {
  if (!params.consented) return;
  const firmIdHash = await pseudonymize(params.pepper, params.firmId);
  if (firmIdHash === null) return; // fail-closed: no pepper, no event
  const userIdHash =
    params.userId === null ? null : await pseudonymize(params.pepper, params.userId);

  params.logger.log(
    usageFeature(
      { correlationId: params.correlationId, now: params.now },
      {
        feature: params.feature,
        phase: params.phase,
        surface: params.surface,
        firmIdHash,
        userIdHash,
        appVersion: params.appVersion,
      },
    ),
  );
  // count() dimensions are strings only — the aggregate, hash-free counter (feature x phase x
  // surface, all bounded low-cardinality). null surface becomes the literal "none".
  params.logger.count("usage", {
    feature: params.feature,
    phase: params.phase,
    surface: params.surface ?? "none",
  });
}
```

- [ ] **Step 4: Run it, expect pass** — Run: `pnpm --filter @magna-carta/worker test usage/emit`; Expected: PASS.

- [ ] **Step 5: Write the failing middleware test** — `apps/worker/test/usage/reached-middleware.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { usageReachedMiddleware } from "../../src/usage/reached-middleware.ts";

describe("usageReachedMiddleware", () => {
  it("emits a reached event for a mapped route with chokepoint context", async () => {
    const logger = { log: vi.fn(), count: vi.fn() };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("correlationId", "correlation_x");
      c.set("logger", logger);
      c.set("chokepointFirmContext", { firmId: "firm_a", firmDatabase: {} });
      c.set("chokepointUserId", "user_a");
      await next();
    });
    app.use(
      "*",
      usageReachedMiddleware({
        pepperFor: () => "pepper",
        consent: { resolve: async () => true },
        now: () => "2026-06-18T00:00:00.000Z",
      }),
    );
    app.get("/api/v1/matters", (c) => c.text("ok"));
    await app.request("/api/v1/matters");
    expect(logger.log).toHaveBeenCalledOnce();
    expect(logger.log.mock.calls[0][0].fields.feature).toBe("matters.list");
  });
  it("emits nothing for an unmapped route", async () => {
    const logger = { log: vi.fn(), count: vi.fn() };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("correlationId", "correlation_x");
      c.set("logger", logger);
      c.set("chokepointFirmContext", { firmId: "firm_a", firmDatabase: {} });
      c.set("chokepointUserId", "user_a");
      await next();
    });
    app.use(
      "*",
      usageReachedMiddleware({
        pepperFor: () => "pepper",
        consent: { resolve: async () => true },
        now: () => "t",
      }),
    );
    app.get("/api/v1/whatever", (c) => c.text("ok"));
    await app.request("/api/v1/whatever");
    expect(logger.log).not.toHaveBeenCalled();
  });
  it("emits nothing when chokepoint context is absent (public/401)", async () => {
    const logger = { log: vi.fn(), count: vi.fn() };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("correlationId", "correlation_x");
      c.set("logger", logger);
      await next();
    });
    app.use(
      "*",
      usageReachedMiddleware({
        pepperFor: () => "pepper",
        consent: { resolve: async () => true },
        now: () => "t",
      }),
    );
    app.get("/api/v1/matters", (c) => c.text("ok"));
    await app.request("/api/v1/matters");
    expect(logger.log).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Implement the middleware** — `apps/worker/src/usage/reached-middleware.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../app.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import {
  optionalChokepointFirmContext,
  optionalChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { emitUsage } from "./emit.ts";
import { routeFeature } from "./feature-map.ts";

interface ReachedDeps {
  readonly pepperFor: (env: Bindings) => string | undefined;
  readonly consent: {
    resolve(database: unknown, firmId: string, userId: string): Promise<boolean>;
  };
  readonly now?: () => string;
}

// Server-side "reached": runs on the OUTBOUND pass (after next()), once chokepoint context exists
// and the request authorized. A route absent from the feature map, or a request with no firm context
// (public/401/404), emits nothing. Mapped + authorized -> one reached event for the request.
export function usageReachedMiddleware(
  deps: ReachedDeps,
): MiddlewareHandler<{ Bindings: Bindings; Variables: AppVariables }> {
  const now = deps.now ?? (() => new Date().toISOString());
  return async (c, next) => {
    await next();
    const firmContext = optionalChokepointFirmContext(c);
    const userId = optionalChokepointUserId(c);
    if (firmContext === undefined || userId === undefined) return;
    const feature = routeFeature(c.req.routePath);
    if (feature === null) return;
    const logger = c.get("logger") as Logger | undefined;
    if (logger === undefined) return;

    const consented = await deps.consent.resolve(
      firmContext.firmDatabase,
      firmContext.firmId,
      userId,
    );
    await emitUsage({
      logger,
      consented,
      pepper: deps.pepperFor(c.env),
      correlationId: c.get("correlationId") ?? "",
      now: now(),
      feature,
      phase: "reached",
      surface: null,
      appVersion: null,
      firmId: firmContext.firmId,
      userId,
    });
  };
}
```

> **Note on context accessors:** this uses non-throwing `optionalChokepointFirmContext` / `optionalChokepointUserId`. If the chokepoint module exposes only the `require*` variants, add `optional*` siblings in `apps/worker/src/chokepoint/context-accessors.ts` that return `undefined` instead of throwing (a one-line wrapper each) as the first step of this task, with a unit test.

- [ ] **Step 7: Wire it in `app.ts`** — add the binding and install the middleware after the telemetry middleware:

```typescript
// in interface Bindings, beside TELEMETRY:
  USAGE_ANALYTICS_PEPPER?: string;
```

```typescript
// after app.use("*", telemetryMiddleware(loggerForEnv, options.clock));
import { createUsageConsentResolver } from "./usage/consent.ts";
import { usageReachedMiddleware } from "./usage/reached-middleware.ts";
// ...
const usageConsent = createUsageConsentResolver();
app.use(
  "*",
  usageReachedMiddleware({
    pepperFor: (env) => env.USAGE_ANALYTICS_PEPPER,
    consent: usageConsent,
  }),
);
```

- [ ] **Step 8: Run the worker suite** — Run: `pnpm --filter @magna-carta/worker test usage`; Expected: PASS. Then `pnpm check`.

- [ ] **Step 9: Commit**

```bash
git add apps/worker/src/usage/emit.ts apps/worker/src/usage/reached-middleware.ts apps/worker/src/app.ts apps/worker/src/chokepoint/context-accessors.ts apps/worker/test/usage/
git commit -m "feat(worker): emit usage reached events on the outbound pass"
```

### Task C3: The `completed` emit in the per-firm sweep

**Files:**

- Modify: `apps/worker/src/scheduled.ts` (the per-firm sweep loop + its `publish` callback)
- Test: `apps/worker/test/scheduled-usage-completed.test.ts`

**Interfaces:**

- Consumes: `topicFeature` (C1), `emitUsage` (C2), `readUsageAnalyticsEnabled` (B2), `pseudonymize` indirectly via `emitUsage`.
- Produces: a `completed` usage event per swept, mapped outbox row, firm-level (`userId: null`), consent-gated once per firm per pass.

- [ ] **Step 1: Write the failing test** — `apps/worker/test/scheduled-usage-completed.test.ts`. Drive `runScheduledSweep` (or extract the per-firm publish into a tested helper) with a firm whose outbox holds a `matter.closed` row and `USAGE_ANALYTICS_PEPPER` set; assert a `usage.feature` `completed` event for `matters.detail` was logged with a non-null `firmIdHash` and null `userIdHash`. Assert no completed event when `usage_analytics.enabled` is `false`. (Model the harness on the existing `scheduled.ts` sweep tests in `apps/worker/test/`.)

```typescript
import { describe, expect, it, vi } from "vitest";
// Use the existing scheduled-sweep test harness/fixtures in apps/worker/test for a seeded firm
// database with an outbox row, a recording logger, and env including USAGE_ANALYTICS_PEPPER.

describe("usage completed emission from the sweep", () => {
  it("emits a firm-level completed event for a mapped topic", async () => {
    // seed firm outbox with { topic: "matter.closed", payload: { matterId } }
    // run the per-firm sweep with consent enabled + pepper set
    // expect logger.log called with a usage.feature event: phase "completed", feature
    // "matters.detail", firmIdHash a 64-hex string, userIdHash null.
  });
  it("emits no completed event when the firm disabled usage analytics", async () => {
    // seed setting usage_analytics.enabled=false; expect no usage.feature completed event.
  });
});
```

- [ ] **Step 2: Run it, expect failure** — Run: `pnpm --filter @magna-carta/worker test scheduled-usage-completed`; Expected: FAIL.

- [ ] **Step 3: Implement** — in `apps/worker/src/scheduled.ts`, inside the per-firm `for (const firm of firms)` loop, resolve the firm's consent once, then emit a `completed` event inside the `publish` callback for mapped topics:

```typescript
// near the imports
import { readUsageAnalyticsEnabled } from "@magna-carta/data-access/usage-consent-statements";
import { emitUsage } from "./usage/emit.ts";
import { topicFeature } from "./usage/feature-map.ts";
```

```typescript
// inside the per-firm try block, before sweepOutbox:
const usageEnabled = await readUsageAnalyticsEnabled(firm.database);
const usagePepper = env.USAGE_ANALYTICS_PEPPER;
```

```typescript
// inside the existing publish callback, after the await env.QUEUE.send({...}):
const feature = topicFeature(row.topic);
if (feature !== null) {
  await emitUsage({
    logger,
    consented: usageEnabled,
    pepper: usagePepper,
    correlationId,
    now: new Date().toISOString(),
    feature,
    phase: "completed",
    surface: null,
    appVersion: null,
    firmId: firm.firmId,
    userId: null, // firm-level: the outbox payload does not carry the acting user
  });
}
```

> Completion is at-least-once (the relay re-publishes on retry), so completed counts are analytics-approximate; this is acceptable for adoption/funnel signals. A `// completed usage is approximate (at-least-once relay); dedupe in the query if exactness is ever needed.` comment documents it inline.

- [ ] **Step 4: Run it, expect pass** — Run: `pnpm --filter @magna-carta/worker test scheduled-usage-completed`; then `vp test`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scheduled.ts apps/worker/test/scheduled-usage-completed.test.ts
git commit -m "feat(worker): emit usage completed events from the outbox sweep"
```

---

## Sub-slice D — Client beacon

### Task D1: The permission + rate bucket

**Files:**

- Modify: `packages/access-control/src/registry.ts:9-39`
- Modify: `apps/worker/src/contracts/route-meta.ts:14`
- Test: `packages/access-control/test/registry.test.ts` (existing registry test covers the new key)

**Interfaces:**

- Produces: `firm:recordUsage` permission; `"usage-beacon"` rate-limit bucket.

- [ ] **Step 1: Add the permission** — in `packages/access-control/src/registry.ts`, in the `firm:` block of `PERMISSIONS`:

```typescript
  "firm:recordUsage", // accept client-batched product-usage beacons (seeded to every default role)
```

- [ ] **Step 2: Add the rate bucket** — in `apps/worker/src/contracts/route-meta.ts`:

```typescript
export type RateLimitBucket = "default" | "auth" | "expensive" | "incident-report" | "usage-beacon";
```

- [ ] **Step 3: Run the registry + route-meta tests** — Run: `pnpm --filter @magna-carta/access-control test && pnpm --filter @magna-carta/worker test route-meta`; Expected: PASS (the new permission is registry-valid; `firm` already binds to the `firm` resource in `RESOURCE_BY_PERMISSION_NAMESPACE`).

- [ ] **Step 4: Commit**

```bash
git add packages/access-control/src/registry.ts apps/worker/src/contracts/route-meta.ts
git commit -m "feat(access-control): add firm:recordUsage permission + usage-beacon bucket"
```

### Task D2: The `POST /api/v1/usage` beacon route

**Files:**

- Create: `apps/worker/src/routes/usage.ts`
- Modify: `apps/worker/src/app.ts` (register the route)
- Test: `apps/worker/test/routes/usage.test.ts`

**Interfaces:**

- Consumes: `FEATURE_KEYS` (`@magna-carta/telemetry/usage-features`), `emitUsage` (C2), the consent resolver, `requireChokepointFirmContext`/`requireChokepointUserId`, `defineOpenAPIRoute`/`RouteMeta`, `chokepointMiddleware`.
- Produces: `registerUsageRoute(app, chokepoint)` registering `POST /api/v1/usage`.

- [ ] **Step 1: Write the failing test** — `apps/worker/test/routes/usage.test.ts`: drive the registered route through the worker test harness (the one used by `incidents.test.ts`): a session for `firm_a`/`user_a`, body `{ events: [{ feature: "matters.list", phase: "reached", surface: "web" }] }`, `USAGE_ANALYTICS_PEPPER` set. Assert 202 and that a `usage.feature` event was logged with `surface: "web"` and `appVersion` carried if supplied. Assert an unknown `feature` yields 422. (Reuse the incidents-route harness.)

- [ ] **Step 2: Run it, expect failure** — Run: `pnpm --filter @magna-carta/worker test routes/usage`; Expected: FAIL.

- [ ] **Step 3: Implement** — `apps/worker/src/routes/usage.ts` (modelled on `routes/platform/incidents.ts`):

```typescript
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { FEATURE_KEYS } from "@magna-carta/telemetry/usage-features";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { createUsageConsentResolver } from "../usage/consent.ts";
import { emitUsage } from "../usage/emit.ts";

// The beacon's feature enum is DERIVED from the taxonomy, so the OpenAPI document and generated
// client carry the valid keys and validation is the schema (no client/server taxonomy drift).
const featureEnum = z.enum(FEATURE_KEYS as unknown as [string, ...string[]]);

const RecordUsageRequest = z
  .object({
    events: z
      .array(
        z.object({
          feature: featureEnum,
          phase: z.enum(["reached", "completed"]),
          surface: z.enum(["web", "desktop", "portal"]),
          appVersion: z.string().max(60).optional(),
        }),
      )
      .min(1)
      .max(50),
  })
  .openapi("RecordUsageRequest");

// audited: false — a usage beacon is not an auditable mutation; it records a content-free signal.
// firm:recordUsage is seeded to every default role so any member's client may beacon.
export const recordUsageMeta: RouteMeta = {
  operationId: "usage.record",
  surface: "app",
  authenticated: true,
  permission: "firm:recordUsage",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "usage-beacon",
};

export const recordUsageRoute = defineOpenAPIRoute(recordUsageMeta, {
  method: "post",
  path: "/api/v1/usage",
  description:
    "Records a batch of client-side product-usage signals (feature reached/completed) for the " +
    "session firm. Content-free and pseudonymous; honors the firm and per-user opt-out at receipt.",
  request: {
    body: { content: { "application/json": { schema: RecordUsageRequest } }, required: true },
  },
  responses: {
    202: { description: "Accepted (the beacon is fire-and-forget; no body)" },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks firm:recordUsage",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The session's firm is not reachable",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The body failed validation (unknown feature, over-cap batch, …)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerUsageRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  const consent = createUsageConsentResolver();
  app.openapi(
    { ...recordUsageRoute, middleware: chokepointMiddleware(chokepoint, recordUsageRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const { firmId, firmDatabase } = requireChokepointFirmContext(c);
      const { events } = c.req.valid("json");
      const consented = await consent.resolve(firmDatabase, firmId, userId);
      const logger = c.get("logger");
      const pepper = c.env.USAGE_ANALYTICS_PEPPER;
      const correlationId = c.get("correlationId") ?? "";
      for (const event of events) {
        if (logger === undefined) break;
        await emitUsage({
          logger,
          consented,
          pepper,
          correlationId,
          now: new Date().toISOString(),
          feature: event.feature as (typeof FEATURE_KEYS)[number],
          phase: event.phase,
          surface: event.surface,
          appVersion: event.appVersion ?? null,
          firmId,
          userId,
        });
      }
      return c.body(null, 202);
    },
  );
}
```

- [ ] **Step 4: Register in `app.ts`** — import and call `registerUsageRoute(app, chokepoint)` next to `registerIncidentsRoute(app, chokepoint)`.

- [ ] **Step 5: Regenerate the contract + client** — Run: `pnpm --filter @magna-carta/worker run emit-openapi && pnpm run generate-client` (use the repo's actual script names; check `package.json`). Commit the regenerated snapshot + client.

- [ ] **Step 6: Run the suites + conformance** — Run: `pnpm --filter @magna-carta/worker test routes/usage && pnpm --filter @magna-carta/worker test conformance`; then `pnpm check`; Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/usage.ts apps/worker/src/app.ts apps/worker/test/routes/usage.test.ts <regenerated openapi + client paths>
git commit -m "feat(worker): add POST /v1/usage product-usage beacon"
```

---

## Sub-slice E — Live reporting

### Task E1: The small-n (k-anonymity) suppressor

**Files:**

- Create: `packages/telemetry/src/usage-suppression.ts`
- Test: `packages/telemetry/test/usage-suppression.test.ts`

**Interfaces:**

- Produces: `suppressSmallCells<T extends { distinctCount: number }>(cells: T[], k?: number): { kept: T[]; suppressed: number }` — drops cells whose `distinctCount < k` (default 5) and reports how many were dropped.

- [ ] **Step 1: Write the failing test** — `packages/telemetry/test/usage-suppression.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { suppressSmallCells } from "../src/usage-suppression.ts";

describe("small-n suppression", () => {
  it("drops cells below k and reports the count", () => {
    const cells = [
      { feature: "a", distinctCount: 9 },
      { feature: "b", distinctCount: 4 },
      { feature: "c", distinctCount: 5 },
    ];
    const { kept, suppressed } = suppressSmallCells(cells);
    expect(kept.map((cell) => cell.feature)).toEqual(["a", "c"]);
    expect(suppressed).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, expect failure** — Run: `pnpm --filter @magna-carta/telemetry test usage-suppression`; Expected: FAIL.

- [ ] **Step 3: Implement** — `packages/telemetry/src/usage-suppression.ts`:

```typescript
// k-anonymity suppression for cross-firm usage reporting: a metric computed from fewer than k
// distinct firms (or users) could re-identify a tiny firm, so it is dropped. The caller logs the
// suppressed count — a suppressed cell is never silently hidden.
export const DEFAULT_SUPPRESSION_THRESHOLD = 5;

export function suppressSmallCells<T extends { distinctCount: number }>(
  cells: readonly T[],
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
): { kept: T[]; suppressed: number } {
  const kept = cells.filter((cell) => cell.distinctCount >= k);
  return { kept: [...kept], suppressed: cells.length - kept.length };
}
```

- [ ] **Step 4: Run it, expect pass** — Run: `pnpm --filter @magna-carta/telemetry test usage-suppression`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/usage-suppression.ts packages/telemetry/test/usage-suppression.test.ts
git commit -m "feat(telemetry): add small-n usage suppressor"
```

### Task E2: The canonical query set (Analytics Engine now)

**Files:**

- Create: `docs/analytics/usage-queries.md`

- [ ] **Step 1: Write the document** — record the live Analytics Engine SQL queries the builder uses against the `usage` counter dataset today (aggregate totals, never filtered to one firm), plus a note that the per-firm/per-user (retention/funnel) versions land against the Iceberg catalog in Task F3 with `k = 5` suppression. Include at minimum:
  - **Reached totals by feature (last 7 days):** `SELECT blob1 AS metric, blob2 AS feature, blob3 AS phase, SUM(_sample_interval) AS approx_count FROM usage WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY feature, phase` (adjust blob indexing to the `count("usage", { feature, phase, surface })` layout: `blob1='usage'`, `blob2=feature`, `blob3=phase`, `blob4=surface`).
  - **Dead-feature candidates:** features in `FEATURE_KEYS` with no `reached` rows in the window (compute the set difference in the query tool).

- [ ] **Step 2: Commit**

```bash
git add docs/analytics/usage-queries.md
git commit -m "docs(analytics): canonical usage queries (Analytics Engine)"
```

---

## Sub-slice F — Iceberg / Pipelines tier

> Config-and-verification, not TDD. Gated only on confirming the Pipelines volume budget (Free 1 GB/month vs Paid 50 GB/month). Verify the open-beta facts (R2 Data Catalog, Pipelines, compaction throughput, snapshot-expiration data-file cleanup) against current Cloudflare docs at build time before wiring.

### Task F1: Logpush of Workers trace events → Pipelines

- [ ] **Step 1:** Confirm the account's Pipelines plan/allowance fits expected usage volume; if not, move to Workers Paid.
- [ ] **Step 2:** Create a Cloudflare Pipeline whose source is Workers trace events (Logpush) and whose sink is an R2 Data Catalog (Apache Iceberg) table in **Parquet** (Parquet enables automatic compaction; do not use the JSON sink). Add the Pipeline SQL transform to filter to `name = 'usage.feature'` and project the allowlisted columns (`feature`, `phase`, `surface`, `firmIdHash`, `userIdHash`, `appVersion`, `at`, `correlationId`), partitioned by date and `feature`.
- [ ] **Step 3:** Create the Logpush job (Workers trace events dataset) with the Pipeline as destination. Record the job + pipeline ids.
- [ ] **Step 4: Verify** — emit a few `usage.feature` rows in production (or a staging deploy), then confirm rows land in the Iceberg table (query via DuckDB/PyIceberg using the R2 Data Catalog REST URI + an R2 API token holding **both R2 and catalog** permissions).
- [ ] **Step 5:** Commit the wrangler/config changes: `git commit -m "feat(worker): Logpush usage events to Pipelines -> R2 Data Catalog"`.

### Task F2: Enable automatic table maintenance

- [ ] **Step 1:** Enable **automatic compaction** on the R2 Data Catalog table.
- [ ] **Step 2:** Configure **snapshot expiration** (`--older-than-days`, `--retain-last`) to a chosen retention; confirm it also removes unreferenced data files (the automatic data-file cleanup). No Container/Cron orphan-cleanup Workflow is built.
- [ ] **Step 3: Verify** — check the R2 Data Catalog metrics (GraphQL Analytics API) show compaction running and storage bounded.
- [ ] **Step 4:** Commit the config/notes.

### Task F3: Retention/funnel queries against the catalog

- [ ] **Step 1:** Add to `docs/analytics/usage-queries.md` the DuckDB-over-the-catalog queries — **dead-feature** (zero distinct `userIdHash`), **funnel drop-off** (reached vs completed per feature, firm-level), **retention** (distinct `userIdHash` per feature per week) — each applying `suppressSmallCells` semantics (`k = 5`).
- [ ] **Step 2: Verify** each query runs against the live catalog and suppresses small cells.
- [ ] **Step 3:** Commit: `git commit -m "docs(analytics): retention/funnel queries over the Iceberg catalog"`.

---

## Task G: Documentation (same commit as the behavior it describes)

Per golden rule 5, fold these into the commits of the tasks that produce the behavior; this task is the checklist.

- [ ] **Decision fragment** — add `docs/decisions/pending/usage-analytics.md` (referenced as `ADR-0106`; `vp run decisions-build` numbers it at merge) for the product-usage analytics tier, and amend the **ADR-0056** per-file record to _adopted (realized by `ADR-0106`)_ with the Logpush→Pipelines→R2 Data Catalog path + the maturity note (compaction + snapshot-expiration data-file cleanup automated; Analytics Engine retention ~90 days as of 2026-06). The register regenerates from the per-file records.
- [ ] **White paper** — add the _Product-usage analytics_ subsection under _Observability and diagnostics_; amend the _Telemetry analytics tier_ subsection from deferred to built, correcting the stale facts (Parquet via Pipelines/JSON also available; "~92-day" → "~90-day, verify current"; compaction + data-file cleanup automated).
- [ ] **ROADMAP.md / STATUS.md / changelog fragment** — a ROADMAP narrative entry under the current phase, a new STATUS slice row, and an `Added` changelog fragment in `changelog.d/`.
- [ ] **`docs/operating-costs.md`** — Pipelines free/paid allowance (active/committed) and compaction `$0.005/GB + $2.00/M objects` (usage rates).
- [ ] **`packages/telemetry/CLAUDE.md`** (or create per the area template) — usage analytics is opt-out, per-firm + per-user override, resolved at emit time, hashes fail closed on a missing pepper.
- [ ] **`docs/user/admin/`** — scaffold a "what we measure" + opt-out-setting placeholder, to be authored when the settings UI ships (with the diagnostics-settings UI). Note the placeholder; do not write task walkthroughs for UI that does not exist yet.

---

## Self-review notes (author)

- **Spec coverage:** §1 scope → A/C/E (reached, completed, performance dimension is the existing `request.completed` + the new `feature` dimension is covered by emitting `reached` per route; the retention seam is the `userIdHash` in A1/C2). §2 consent → B. §3 event model → A1/A3/C2. §4 origins → C2/C3/D2. §5 taxonomy → A2 + C1 + D2 enum. §6 storage/query → E + F. §7 placement → all. §8 fitness → folded into each task's tests. §9 cost / §10 docs → G. §11 sequencing → the A–F structure. §12 risks → F notes.
- **Open dependency to confirm at execution time:** the exact chokepoint context-accessor names (`requireChokepointFirmContext`/`requireChokepointUserId` confirmed in `routes/platform/incidents.ts`; the non-throwing `optional*` variants used by the reached middleware may need to be added — flagged in Task C2 Step 6).
- **Type consistency:** `emitUsage` params, the `usageFeature` field set, and the beacon body all use `feature: FeatureKey`, `phase: "reached" | "completed"`, `surface: "web" | "desktop" | "portal" | null`, `userId: string | null`. The AE counter uses `surface ?? "none"` (string-only dimensions).
