# Release Channels — Backend Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete backend mechanism for per-firm release channels (`stable / beta / alpha`) — the column, the permission, both write doors, the flag-evaluation package, `/me` delivery, and audit — gating zero product features, proven by one throwaway flag.

**Architecture:** A firm's channel is one control-plane attribute (`firm.release_channel`). A firm-admin door (RBAC + consent) writes `{stable, beta}`; a secret-guarded platform door writes any value including `alpha`. At request time the worker builds a flag-evaluation context `{ targetingKey, firmId, channel }` and resolves boolean flags through a thin `@magna-carta/feature-flags` wrapper over the Cloudflare Flagship `FLAGS` binding, with a default-off evaluator when the binding is absent (fail-safe). The resolved flag set ships to the SPA via `/me`.

**Tech Stack:** TypeScript, Cloudflare Workers + Hono + `@hono/zod-openapi`, Drizzle (D1), Vitest + Miniflare (`cloudflare:test`), pnpm workspace, Vite+ (`vp`).

## Global Constraints

- **Full names, no shorthand** — `@magna-carta/feature-flags`, `newIdentifier()`, "release channel". (CLAUDE.md golden rule 12)
- **No emojis** anywhere (code, docs, commits). (golden rule 2)
- **No process-doc references in source/tests/config/consumer strings** — no "ADR-NNNN", "spec", "slice N", "Phase N" in shipped code or OpenAPI `description`s. Explain reasoning inline or cite a file path. (golden rule 13; CI `pnpm run lint:process-refs`)
- **Channels gate behavior, never schema.** New schema is additive to the single fleet; no per-firm divergence.
- **Audit metadata carries IDs + non-privileged fields only** — `refuseUnredactedMetadata` rejects any key containing "password". (golden rule 4)
- **Expand-contract migrations** — an added `NOT NULL` column MUST carry a `DEFAULT` (enforced by `packages/database/test/expand-contract.test.ts`).
- **Channel value set:** `ReleaseChannel = "stable" | "beta" | "alpha"`; default `"stable"`.
- **Quality gate:** `pnpm check` (fmt+lint+typecheck+svelte) and `vp test` (Vitest) must pass. After any worker route change, regenerate the contract: `pnpm --filter @magna-carta/worker run emit-openapi` then `pnpm run generate-client`, and commit both outputs.
- **Base/worktree:** branch `release-channels` at `C:/dev/magna-carta-worktrees/release-channels` (off `main`).

---

### Task 1: `@magna-carta/feature-flags` package

A dependency-light leaf package: the channel type, the flag catalog, the evaluator interface, a Flagship adapter, a default-off evaluator, and a catalog-evaluation helper.

**Files:**

- Create: `packages/feature-flags/package.json`
- Create: `packages/feature-flags/tsconfig.json`
- Create: `packages/feature-flags/vitest.config.ts`
- Create: `packages/feature-flags/src/port.ts`
- Create: `packages/feature-flags/src/catalog.ts`
- Create: `packages/feature-flags/src/flagship-adapter.ts`
- Create: `packages/feature-flags/src/default-off-adapter.ts`
- Create: `packages/feature-flags/src/index.ts`
- Test: `packages/feature-flags/test/evaluate-catalog.test.ts`
- Test: `packages/feature-flags/test/default-off-adapter.test.ts`

**Interfaces:**

- Produces:
  - `type ReleaseChannel = "stable" | "beta" | "alpha"` and `const RELEASE_CHANNELS: readonly ReleaseChannel[]`
  - `interface FlagContext { targetingKey: string; firmId: string; channel: ReleaseChannel }`
  - `interface FlagEvaluator { getBoolean(flagKey: string, defaultValue: boolean, context: FlagContext): Promise<boolean> }`
  - `type FlagStage = "alpha" | "beta" | "stable"`
  - `const FLAG_CATALOG: Record<string, { defaultValue: boolean; stage: FlagStage; description: string }>` (v1 holds one throwaway flag `"release-channels.smoke"`). `stage` lets the SPA mark any enabled-but-not-yet-`stable` feature as in active development; it lives in this shared package so the web app reads it statically.
  - `function evaluateCatalog(evaluator: FlagEvaluator, context: FlagContext): Promise<Record<string, boolean>>`
  - `interface FlagshipBinding { getBooleanValue(flagKey: string, defaultValue: boolean, context: Record<string, string>): Promise<boolean> }`
  - `function flagshipEvaluator(binding: FlagshipBinding): FlagEvaluator`
  - `const defaultOffEvaluator: FlagEvaluator`

- [ ] **Step 1: Scaffold the package files (no test cycle — config only)**

Create `packages/feature-flags/package.json`:

```json
{
  "name": "@magna-carta/feature-flags",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./port": "./src/port.ts",
    "./catalog": "./src/catalog.ts",
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

Create `packages/feature-flags/tsconfig.json`:

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `packages/feature-flags/vitest.config.ts`:

```typescript
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 2: Write the port and catalog source**

Create `packages/feature-flags/src/port.ts`:

```typescript
// A release channel is a firm-level attribute that decides which behavior is lit. Channels nest
// alpha (broadest) over beta over stable: an alpha firm also sees beta behavior. The value lives in
// the control-plane firm row; this type is the single shared definition every layer imports.
export type ReleaseChannel = "stable" | "beta" | "alpha";

export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["stable", "beta", "alpha"];

export function isReleaseChannel(value: string): value is ReleaseChannel {
  return (RELEASE_CHANNELS as readonly string[]).includes(value);
}

// The attributes a flag rule may target on. targetingKey is the stable per-user identity Flagship
// hashes for consistent percentage bucketing; firmId and channel drive the channel-targeting rules.
// Only non-privileged identifiers travel here — never firm content.
export interface FlagContext {
  readonly targetingKey: string;
  readonly firmId: string;
  readonly channel: ReleaseChannel;
}

// Every evaluation supplies a default; an unreachable provider or missing flag yields the default.
// Defaults always equal stable behavior, so a flag outage degrades to stable, never to exposure.
export interface FlagEvaluator {
  getBoolean(flagKey: string, defaultValue: boolean, context: FlagContext): Promise<boolean>;
}
```

Create `packages/feature-flags/src/catalog.ts`:

```typescript
// A feature's maturity. The client marks anything enabled whose stage is not "stable" as in active
// development; graduating a feature to "stable" (or removing its flag) clears that marker — the
// visibility lifecycle is the rollout lifecycle.
export type FlagStage = "alpha" | "beta" | "stable";

// The known boolean flags the bootstrap evaluates and ships to the client. Each entry names its
// safe default (stable behavior) and its stage. v1 carries one throwaway flag that proves the
// evaluation path end to end; real features add their own entry here as they adopt the rails.
export const FLAG_CATALOG: Record<
  string,
  { readonly defaultValue: boolean; readonly stage: FlagStage; readonly description: string }
> = {
  "release-channels.smoke": {
    defaultValue: false,
    stage: "beta",
    description:
      "Wiring smoke test for the release-channels evaluation path; not a product feature.",
  },
};
```

- [ ] **Step 3: Write the failing evaluate-catalog test**

Create `packages/feature-flags/test/evaluate-catalog.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { evaluateCatalog } from "../src/index.ts";
import type { FlagContext, FlagEvaluator } from "../src/port.ts";

// A fake evaluator that lights "release-channels.smoke" only for beta/alpha firms — the shape a real
// channel-targeting rule takes — so the test proves evaluateCatalog returns the evaluator's verdict,
// not just the default.
function channelTargetingEvaluator(): FlagEvaluator {
  return {
    getBoolean: (flagKey, defaultValue, context) =>
      Promise.resolve(
        flagKey === "release-channels.smoke" ? context.channel !== "stable" : defaultValue,
      ),
  };
}

const betaContext: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "beta" };
const stableContext: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "stable" };

describe("evaluateCatalog", () => {
  it("returns every catalog flag's evaluated value", async () => {
    const flags = await evaluateCatalog(channelTargetingEvaluator(), betaContext);
    expect(flags).toEqual({ "release-channels.smoke": true });
  });

  it("returns the safe default for a stable firm", async () => {
    const flags = await evaluateCatalog(channelTargetingEvaluator(), stableContext);
    expect(flags).toEqual({ "release-channels.smoke": false });
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `vp test run packages/feature-flags/test/evaluate-catalog.test.ts`
Expected: FAIL — `evaluateCatalog` not exported / module not found.

- [ ] **Step 5: Implement the adapters, helper, and index**

Create `packages/feature-flags/src/flagship-adapter.ts`:

```typescript
import type { FlagContext, FlagEvaluator } from "./port.ts";

// The subset of the Cloudflare Flagship Worker binding we use. Kept as a local interface so the
// package has no build-time dependency on the platform binding type and stays unit-testable with a
// plain fake.
export interface FlagshipBinding {
  getBooleanValue(
    flagKey: string,
    defaultValue: boolean,
    context: Record<string, string>,
  ): Promise<boolean>;
}

// Flagship evaluates inside the Worker against propagated config (no outbound HTTP). We pass only
// non-privileged identifiers. If the binding throws, we fall back to the supplied default so a
// provider fault degrades to stable behavior.
export function flagshipEvaluator(binding: FlagshipBinding): FlagEvaluator {
  return {
    async getBoolean(flagKey, defaultValue, context: FlagContext): Promise<boolean> {
      try {
        return await binding.getBooleanValue(flagKey, defaultValue, {
          targetingKey: context.targetingKey,
          firmId: context.firmId,
          channel: context.channel,
        });
      } catch {
        return defaultValue;
      }
    },
  };
}
```

Create `packages/feature-flags/src/default-off-adapter.ts`:

```typescript
import type { FlagEvaluator } from "./port.ts";

// Used when no Flagship binding is configured (local dev, tests, or a deployment before the flag
// provider is wired). Every flag resolves to its supplied default — i.e. stable behavior.
export const defaultOffEvaluator: FlagEvaluator = {
  getBoolean: (_flagKey, defaultValue) => Promise.resolve(defaultValue),
};
```

Create `packages/feature-flags/src/index.ts`:

```typescript
import { FLAG_CATALOG } from "./catalog.ts";
import type { FlagContext, FlagEvaluator } from "./port.ts";

export * from "./port.ts";
export * from "./catalog.ts";
export * from "./flagship-adapter.ts";
export * from "./default-off-adapter.ts";

// Evaluate every catalog flag for one context and return a plain map the bootstrap ships to the SPA.
export async function evaluateCatalog(
  evaluator: FlagEvaluator,
  context: FlagContext,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    Object.entries(FLAG_CATALOG).map(
      async ([flagKey, { defaultValue }]) =>
        [flagKey, await evaluator.getBoolean(flagKey, defaultValue, context)] as const,
    ),
  );
  return Object.fromEntries(entries);
}
```

- [ ] **Step 6: Run the evaluate-catalog test, verify it passes**

Run: `vp test run packages/feature-flags/test/evaluate-catalog.test.ts`
Expected: PASS (both cases).

- [ ] **Step 7: Write and run the default-off test**

Create `packages/feature-flags/test/default-off-adapter.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { defaultOffEvaluator } from "../src/index.ts";
import type { FlagContext } from "../src/port.ts";

const context: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "alpha" };

describe("defaultOffEvaluator", () => {
  it("returns the supplied default regardless of channel", async () => {
    expect(await defaultOffEvaluator.getBoolean("anything", false, context)).toBe(false);
    expect(await defaultOffEvaluator.getBoolean("anything", true, context)).toBe(true);
  });
});
```

Run: `vp test run packages/feature-flags/test/default-off-adapter.test.ts`
Expected: PASS.

- [ ] **Step 8: Install workspace + quality gate + commit**

Run: `vp install` (registers the new package), then `pnpm check`.
Expected: both succeed.

```bash
git add packages/feature-flags pnpm-lock.yaml
git commit -m "feat(release-channels): add @magna-carta/feature-flags package"
```

---

### Task 2: Register the `firm:manageReleaseChannel` permission

**Files:**

- Modify: `packages/access-control/src/registry.ts` (the `PERMISSIONS` array)
- Test: `packages/access-control/test/registry.test.ts`

**Interfaces:**

- Produces: the registered permission key `"firm:manageReleaseChannel"`.

- [ ] **Step 1: Add the failing test assertion**

Append to `packages/access-control/test/registry.test.ts` (inside the existing top-level `describe`):

```typescript
it("registers firm:manageReleaseChannel", () => {
  expect(isPermission("firm:manageReleaseChannel")).toBe(true);
});
```

(If `isPermission` is not already imported in that file, add it to the existing import from `../src/registry.ts`.)

- [ ] **Step 2: Run the test, verify it fails**

Run: `vp test run packages/access-control/test/registry.test.ts`
Expected: FAIL — `isPermission("firm:manageReleaseChannel")` is `false`.

- [ ] **Step 3: Add the permission to the registry**

In `packages/access-control/src/registry.ts`, add to the `PERMISSIONS` array next to the other `firm:` keys:

```typescript
  "firm:manageReleaseChannel", // set the firm's release channel between {stable, beta}; alpha is platform-only
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `vp test run packages/access-control/test/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/access-control/src/registry.ts packages/access-control/test/registry.test.ts
git commit -m "feat(release-channels): register firm:manageReleaseChannel permission"
```

---

### Task 3: Seed `firm:manageReleaseChannel` to Owner/Admin (per-firm migration 0022)

Hand-written seed migration (drizzle-kit does not emit data seeds), mirroring `packages/database/drizzle/per-firm/0019_seed-scan-file-permission.sql`. Owner/Admin only — managing the channel is an admin action like `firm:manageMembers`.

**Files:**

- Create: `packages/database/drizzle/per-firm/0022_seed-release-channel-permission.sql`
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json` (append the 0022 entry)
- Modify: `apps/worker/src/per-firm-migrations.ts` (import + map entry)
- Modify: `apps/worker/test/auth-provisioning-e2e.test.ts` (the Owner/Admin permission union)
- Test (existing, must stay green): `packages/database/test/generated-migrations.test.ts`

**Interfaces:**

- Consumes: the registered permission from Task 2; the default role id `role_Gw-zKO8hOHQuNv2bWokMp` (Owner/Admin, from `0002_member-rbac.sql`).
- Produces: Owner/Admin holds `firm:manageReleaseChannel` in every newly provisioned firm.

- [ ] **Step 1: Write the migration SQL**

Create `packages/database/drizzle/per-firm/0022_seed-release-channel-permission.sql`:

```sql
-- Seed firm:manageReleaseChannel onto the Owner/Admin role only — choosing the firm's release
-- channel between {stable, beta} is an administrative action, like firm:manageMembers. The platform
-- (alpha) door is secret-guarded and needs no role grant. Role id is the deterministic Owner/Admin
-- default seeded in 0002_member-rbac.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_releaseChanAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'firm:manageReleaseChannel');
```

(The `id` is a committed literal handle in the `rolePermission_` family, matching the readable padded style of `0019`. It only needs to be unique; keep it verbatim.)

- [ ] **Step 2: Append the journal entry**

In `packages/database/drizzle/per-firm/meta/_journal.json`, append to the `entries` array after the last entry (`0021_outgoing_talon`), mirroring the existing entry shape. Use the next `idx` (22) and a fixed millisecond timestamp greater than the previous entry's:

```json
{
  "idx": 22,
  "version": "6",
  "when": 1782000000000,
  "tag": "0022_seed-release-channel-permission",
  "breakpoints": true
}
```

(Add a comma after the previous closing brace. `version` and `breakpoints` mirror every existing per-firm entry.)

- [ ] **Step 3: Wire the migration into the worker bundle**

In `apps/worker/src/per-firm-migrations.ts`, add the import after the `0021` line:

```typescript
import seedReleaseChannelPermissionSql from "@magna-carta/database/drizzle/per-firm/0022_seed-release-channel-permission.sql";
```

And add to the `migrationsFromJournal` map after the `"0021_outgoing_talon"` entry:

```typescript
    "0022_seed-release-channel-permission": seedReleaseChannelPermissionSql,
```

- [ ] **Step 4: Run the migration fitness tests, verify they pass**

Run: `vp test run packages/database/test/generated-migrations.test.ts`
Expected: PASS — the permission-union test sees `firm:manageReleaseChannel` is registered (Task 2), and the lineage loads with the new 0022 tag present in both journal and map.

- [ ] **Step 5: Update the Owner/Admin permission union in the e2e test**

In `apps/worker/test/auth-provisioning-e2e.test.ts`, find the assertion listing the Owner/Admin `permissions:` array (alphabetically sorted) and insert `"firm:manageReleaseChannel"` in sorted position (after `firm:manageMembers`, before `firm:manageSecrets`). Update the explanatory comment above the array to mention the 0022 seed.

- [ ] **Step 6: Run the e2e test, verify it passes**

Run: `vp test run apps/worker/test/auth-provisioning-e2e.test.ts`
Expected: PASS — the provisioned Owner/Admin now reports the new permission.

- [ ] **Step 7: Commit**

```bash
git add packages/database/drizzle/per-firm/0022_seed-release-channel-permission.sql packages/database/drizzle/per-firm/meta/_journal.json apps/worker/src/per-firm-migrations.ts apps/worker/test/auth-provisioning-e2e.test.ts
git commit -m "feat(release-channels): seed firm:manageReleaseChannel onto Owner/Admin"
```

---

### Task 4: Add the `release_channel` control-plane column (migration 0003)

**Files:**

- Modify: `packages/database/src/control-plane-schema.ts` (the `firm` table)
- Create: `packages/database/drizzle/control-plane/0003_*.sql` (drizzle-kit names it)
- Modify: `packages/database/drizzle/control-plane/meta/_journal.json` (drizzle-kit updates it)
- Modify: `apps/worker/test/support/apply-control-plane-migrations.ts` (import + map entry)
- Test: `packages/database/test/control-plane-schema.test.ts`

**Interfaces:**

- Produces: `firm.release_channel` (`text NOT NULL DEFAULT 'stable'`) on the control-plane firm registry.

- [ ] **Step 1: Add the failing schema-conformance test**

In `packages/database/test/control-plane-schema.test.ts`, add inside the `firm` table `describe`:

```typescript
it("carries release_channel as TEXT NOT NULL defaulting to stable", () => {
  const column = columnOf(firm, "release_channel");
  expect(column.notNull).toBe(true);
  expect(column.getSQLType()).toBe("text");
  expect(column.default).toBe("stable");
});
```

(Reuse the file's existing `columnOf` helper and `firm` import.)

- [ ] **Step 2: Run the test, verify it fails**

Run: `vp test run packages/database/test/control-plane-schema.test.ts`
Expected: FAIL — `columnOf(firm, "release_channel")` throws / column absent.

- [ ] **Step 3: Add the column to the schema**

In `packages/database/src/control-plane-schema.ts`, inside the `firm = sqliteTable("firm", { ... })` definition, add after `status`:

```typescript
  // The firm's release channel — which behavior is lit for this tenant. stable (default) is the
  // vetted line; beta is firm-admin opt-in; alpha is a platform-only grant. Channels gate behavior
  // through feature flags, never schema. DEFAULT keeps pre-channel rows valid (expand-contract).
  releaseChannel: text("release_channel").notNull().default("stable"),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @magna-carta/database run generate-control-plane-migrations`
(Fallback if that script is named differently: `pnpm --filter @magna-carta/database exec drizzle-kit generate --config=drizzle-control-plane.config.ts`.)
Expected: creates `packages/database/drizzle/control-plane/0003_<name>.sql` containing `ALTER TABLE \`firm\` ADD \`release*channel\` text DEFAULT 'stable' NOT NULL;`and appends an`idx: 3`entry to the control-plane`\_journal.json`. Note the exact generated tag (e.g. `0003*<name>`).

- [ ] **Step 5: Register the migration in the test applier**

In `apps/worker/test/support/apply-control-plane-migrations.ts`, add an import using the generated tag:

```typescript
import releaseChannelSql from "@magna-carta/database/drizzle/control-plane/0003_<name>.sql";
```

and add to the `migrationsFromJournal` map:

```typescript
    "0003_<name>": releaseChannelSql,
```

(Replace `<name>` with the exact generated suffix.)

- [ ] **Step 6: Run the schema + expand-contract + migration tests, verify they pass**

Run: `vp test run packages/database/test/control-plane-schema.test.ts packages/database/test/expand-contract.test.ts packages/database/test/generated-migrations.test.ts`
Expected: PASS — the column exists; the `ADD COLUMN NOT NULL ... DEFAULT` statement is non-destructive (has a DEFAULT), so expand-contract is satisfied.

- [ ] **Step 7: Commit**

```bash
git add packages/database/src/control-plane-schema.ts packages/database/drizzle/control-plane apps/worker/test/support/apply-control-plane-migrations.ts packages/database/test/control-plane-schema.test.ts
git commit -m "feat(release-channels): add firm.release_channel control-plane column"
```

---

### Task 5: Data-access statements for the channel column

**Files:**

- Create: `packages/data-access/src/firm-release-channel-statements.ts`
- Test: `packages/data-access/test/firm-release-channel-statements.test.ts`

**Interfaces:**

- Consumes: `ReleaseChannel` from `@magna-carta/feature-flags/port`; `firm.release_channel` column (Task 4); the `SqlDatabase`/`SqlStatement` types used by the sibling statement modules (see `packages/data-access/src/audit-statements.ts` for the exact import).
- Produces:
  - `writeFirmReleaseChannelStatement(database, firmId, channel): SqlStatement` — `UPDATE firm SET release_channel = ?2 WHERE id = ?1`
  - `readFirmReleaseChannelStatement(database, firmId): SqlStatement` — `SELECT release_channel FROM firm WHERE id = ?1`

- [ ] **Step 1: Add `@magna-carta/feature-flags` as a dependency**

In `packages/data-access/package.json`, add to `dependencies`:

```json
    "@magna-carta/feature-flags": "workspace:*",
```

Run: `vp install`.

- [ ] **Step 2: Write the failing test**

Create `packages/data-access/test/firm-release-channel-statements.test.ts`. Model setup on the existing `packages/database/test/node-sqlite.test.ts` / a sibling statements test for how an in-memory SQLite `SqlDatabase` is constructed in this repo (use the same helper those tests use). The behavioral assertions:

```typescript
import { describe, expect, it } from "vitest";
import {
  readFirmReleaseChannelStatement,
  writeFirmReleaseChannelStatement,
} from "../src/firm-release-channel-statements.ts";
// Build `database` (an in-memory control-plane SqlDatabase with the firm table + one firm row seeded
// to release_channel 'stable') using the SAME in-memory-SQLite test helper the neighboring
// data-access statement tests use. The firm id below is a placeholder for the seeded row's id.

describe("firm release-channel statements", () => {
  it("writes then reads back the channel", async () => {
    await writeFirmReleaseChannelStatement(database, firmId, "beta").run();
    const row = await readFirmReleaseChannelStatement(database, firmId).first<{
      release_channel: string;
    }>();
    expect(row?.release_channel).toBe("beta");
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `vp test run packages/data-access/test/firm-release-channel-statements.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the statements**

Create `packages/data-access/src/firm-release-channel-statements.ts`. Copy the exact `SqlDatabase` / `SqlStatement` import line and `FirmId` import from `packages/data-access/src/audit-statements.ts`, then:

```typescript
import type { ReleaseChannel } from "@magna-carta/feature-flags/port";

const FIRM_TABLE = "firm";

// The firm's release channel lives in the control-plane firm registry — one row of truth for both
// write doors (firm-admin beta toggle and the platform alpha grant).
export function writeFirmReleaseChannelStatement(
  database: SqlDatabase,
  firmId: FirmId,
  channel: ReleaseChannel,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FIRM_TABLE} SET release_channel = ?2 WHERE id = ?1`)
    .bind(firmId, channel);
}

export function readFirmReleaseChannelStatement(
  database: SqlDatabase,
  firmId: FirmId,
): SqlStatement {
  return database.prepare(`SELECT release_channel FROM ${FIRM_TABLE} WHERE id = ?1`).bind(firmId);
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `vp test run packages/data-access/test/firm-release-channel-statements.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/data-access/src/firm-release-channel-statements.ts packages/data-access/test/firm-release-channel-statements.test.ts packages/data-access/package.json pnpm-lock.yaml
git commit -m "feat(release-channels): data-access statements for firm.release_channel"
```

---

### Task 6: Wire the `FLAGS` binding and the worker-side evaluator resolver

**Files:**

- Modify: `apps/worker/wrangler.jsonc` (add the `flagship` binding)
- Modify: `apps/worker/src/app.ts` (the `Bindings` type)
- Create: `apps/worker/src/flags/flag-evaluator.ts`
- Test: `apps/worker/test/flags/flag-evaluator.test.ts`

**Interfaces:**

- Consumes: `flagshipEvaluator`, `defaultOffEvaluator`, `FlagshipBinding` from `@magna-carta/feature-flags`.
- Produces: `resolveFlagEvaluator(env: Bindings): FlagEvaluator` — returns the Flagship-backed evaluator when `env.FLAGS` is present, else `defaultOffEvaluator`.

- [ ] **Step 1: Add the binding to the worker config and types**

In `apps/worker/wrangler.jsonc`, add a top-level binding mirroring the platform-binding shape (next to `"ai": { "binding": "AI" }`):

```jsonc
  "flagship": { "binding": "FLAGS" },
```

In `apps/worker/src/app.ts`, add to the `Bindings` type (optional — absent until the provider is wired, which keeps local dev and tests fail-safe):

```typescript
  FLAGS?: import("@magna-carta/feature-flags").FlagshipBinding;
```

Add `"@magna-carta/feature-flags": "workspace:*"` to `apps/worker/package.json` `dependencies`, then run `vp install`.

- [ ] **Step 2: Write the failing resolver test**

Create `apps/worker/test/flags/flag-evaluator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Bindings } from "../../src/app.ts";
import { resolveFlagEvaluator } from "../../src/flags/flag-evaluator.ts";
import type { FlagContext } from "@magna-carta/feature-flags/port";

const context: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "beta" };

describe("resolveFlagEvaluator", () => {
  it("returns a default-off evaluator when no FLAGS binding is configured", async () => {
    const evaluator = resolveFlagEvaluator({} as Bindings);
    expect(await evaluator.getBoolean("release-channels.smoke", false, context)).toBe(false);
  });

  it("delegates to the FLAGS binding when present", async () => {
    const env = {
      FLAGS: {
        getBooleanValue: (flagKey: string) => Promise.resolve(flagKey === "release-channels.smoke"),
      },
    } as unknown as Bindings;
    const evaluator = resolveFlagEvaluator(env);
    expect(await evaluator.getBoolean("release-channels.smoke", false, context)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `vp test run apps/worker/test/flags/flag-evaluator.test.ts`
Expected: FAIL — `resolveFlagEvaluator` not found.

- [ ] **Step 4: Implement the resolver**

Create `apps/worker/src/flags/flag-evaluator.ts`:

```typescript
import {
  defaultOffEvaluator,
  flagshipEvaluator,
  type FlagEvaluator,
} from "@magna-carta/feature-flags";
import type { Bindings } from "../app.ts";

// Resolve the flag evaluator for a request. With the Flagship binding present, flags evaluate at the
// edge against propagated config; without it (local dev, tests, or pre-provider deployments), every
// flag resolves to its safe default — stable behavior. The binding is never load-bearing.
export function resolveFlagEvaluator(env: Bindings): FlagEvaluator {
  return env.FLAGS === undefined ? defaultOffEvaluator : flagshipEvaluator(env.FLAGS);
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `vp test run apps/worker/test/flags/flag-evaluator.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the binding does not break the Miniflare test pool**

Run: `vp test run apps/worker/test/me.test.ts`
Expected: PASS (the worker still boots under `cloudflare:test` with the new config).
If Miniflare rejects the unknown `flagship` binding type at config load, REMOVE the `"flagship"` line from `wrangler.jsonc` (the `FLAGS?` optional type and the resolver already handle its absence — the binding is then a production-only wiring step documented in Task 10's ops note). Re-run the command to confirm green.

- [ ] **Step 7: Quality gate + commit**

Run: `pnpm check`.

```bash
git add apps/worker/wrangler.jsonc apps/worker/src/app.ts apps/worker/src/flags apps/worker/test/flags apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(release-channels): FLAGS binding + worker flag-evaluator resolver"
```

---

### Task 7: Beta door — `PUT /api/v1/firm/release-channel`

Firm-admin endpoint, RBAC-gated, accepting only `{stable, beta}`, requiring a consent acknowledgment when moving to `beta`, writing the control-plane column and a per-firm `audit_log` row.

**Files:**

- Create: `apps/worker/src/routes/firm/release-channel.ts`
- Modify: `apps/worker/src/app.ts` (register the route)
- Test: `apps/worker/test/release-channel.test.ts`
- Regenerate: `apps/worker/openapi/openapi.json`, `packages/api-client/src/*.gen.ts`

**Interfaces:**

- Consumes: `writeFirmReleaseChannelStatement` (Task 5); `insertAuditLogStatement` from `@magna-carta/data-access` (per-firm `audit_log`); `RELEASE_CHANNELS`/`isReleaseChannel` from `@magna-carta/feature-flags`; the chokepoint context accessors and `defineOpenAPIRoute`/`RouteMeta` (see `apps/worker/src/routes/session/members.ts`).
- Produces: `registerReleaseChannelRoute(app, chokepoint, authForEnv)` (match the registration signature `members.ts` uses).

- [ ] **Step 1: Write the failing route tests**

Create `apps/worker/test/release-channel.test.ts`, modeled on `apps/worker/test/members.test.ts` (reuse `applyControlPlaneMigrations`, `applyPerFirmMigrations`, `seedFirm`, `seedCredentialedUser`, `mirrorMemberWithOwnerRole`, `signInForSessionCookie`). Cover:

```typescript
// 1. Unauthenticated -> 401.
// 2. Authenticated Owner/Admin, body { channel: "beta", consentAcknowledged: true } + Idempotency-Key
//    -> 200; then GET /api/v1/me reports firm.channel "beta".
// 3. Body { channel: "beta", consentAcknowledged: false } -> 400 problem (consent required).
// 4. Body { channel: "alpha", consentAcknowledged: true } -> 400 problem (alpha is platform-only).
// 5. Body { channel: "stable", consentAcknowledged: false } -> 200 (leaving beta needs no consent).
```

Use the `members.test.ts` request-helper shape (origin header, cookie, `Idempotency-Key`), `PUT` to `https://example.com/api/v1/firm/release-channel`.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `vp test run apps/worker/test/release-channel.test.ts`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Implement the route**

Create `apps/worker/src/routes/firm/release-channel.ts`. Mirror `members.ts` structure. The request schema:

```typescript
const SetReleaseChannelRequest = z
  .object({
    channel: z.enum(["stable", "beta"]),
    // The firm acknowledges running pre-release behavior on live data. Required to enter beta;
    // ignored when returning to stable.
    consentAcknowledged: z.boolean().default(false),
  })
  .openapi("SetReleaseChannelRequest");

const SetReleaseChannelResponse = z
  .object({ channel: z.enum(["stable", "beta"]) })
  .openapi("SetReleaseChannelResponse");
```

Metadata:

```typescript
export const setReleaseChannelMeta: RouteMeta = {
  operationId: "firm.setReleaseChannel",
  surface: "app",
  authenticated: true,
  permission: "firm:manageReleaseChannel",
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "control",
  rateLimit: "default",
};
```

Handler logic (after the chokepoint passes): read `userId`, `firmId`, `firmContext`; reject `{ channel: "beta", consentAcknowledged: false }` with a 400 problem (`Problem`/`problemJson` as `members.ts` uses); write the column via `writeFirmReleaseChannelStatement(c.env.DB_CONTROL, firmId, channel)`; write a per-firm audit row:

```typescript
insertAuditLogStatement(firmContext.firmDatabase, {
  id: newIdentifier("auditLog"),
  event: "firm.release_channel_changed",
  actorUserId: userId,
  subjectId: firmId,
  metadata: { firmId, oldChannel, newChannel: channel, consentAcknowledged: channel === "beta" },
  now: new Date().toISOString(),
}),
```

Read `oldChannel` first via `readFirmReleaseChannelStatement`. Return `c.json({ channel }, 200)`. Register in `app.ts` next to `registerMembersRoute(...)`:

```typescript
registerReleaseChannelRoute(app, chokepoint, authForEnv);
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `vp test run apps/worker/test/release-channel.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Regenerate the contract + client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi` then `pnpm run generate-client`.
Expected: `apps/worker/openapi/openapi.json` gains the `firm.setReleaseChannel` operation; the api-client `*.gen.ts` files update.

- [ ] **Step 6: Conformance + quality gate**

Run: `vp test run apps/worker/test/conformance.test.ts` then `pnpm check`.
Expected: PASS. (A mutating `PUT` with a permission and idempotency needs no allow-list entry.)

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/firm/release-channel.ts apps/worker/src/app.ts apps/worker/test/release-channel.test.ts apps/worker/openapi/openapi.json packages/api-client/src
git commit -m "feat(release-channels): beta door — PUT /api/v1/firm/release-channel"
```

---

### Task 8: Alpha door — secret-guarded platform endpoint

Platform-only endpoint to set any firm's channel (including `alpha`), mirroring the firm-provisioning guard in `apps/worker/src/routes/platform/firms.ts`.

**Files:**

- Create: `apps/worker/src/routes/platform/platform-release-channel.ts`
- Modify: `apps/worker/src/app.ts` (register the route)
- Test: `apps/worker/test/platform-release-channel.test.ts`
- Regenerate: `apps/worker/openapi/openapi.json`, `packages/api-client/src/*.gen.ts`

**Interfaces:**

- Consumes: `platformAdminGuard` from `apps/worker/src/routes/platform/firms.ts` (export it if not already exported); `writeFirmReleaseChannelStatement` (Task 5); `insertAuthAuditStatement` from `@magna-carta/data-access`; `isReleaseChannel`/`RELEASE_CHANNELS`.
- Produces: `registerPlatformReleaseChannelRoute(app, chokepoint)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/test/platform-release-channel.test.ts`, modeled on the provisioning guard test (find the existing `firms.ts` provision test for the `X-Platform-Admin-Key` header pattern and how `PLATFORM_ADMIN_KEY` is set in `cloudflare:test` env). Cover:

```typescript
// 1. Missing/empty X-Platform-Admin-Key -> 401.
// 2. Wrong key -> 401.
// 3. Correct key, body { channel: "alpha" } on a seeded firm -> 200; GET /me for a member of that
//    firm reports channel "alpha".
// 4. Correct key, body { channel: "nonsense" } -> 400 problem.
```

`POST https://example.com/api/v1/platform/firms/{firmId}/release-channel`.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `vp test run apps/worker/test/platform-release-channel.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the route**

Create `apps/worker/src/routes/platform/platform-release-channel.ts`, mirroring the `provisionFirm` registration in `firms.ts`: `surface: "public"`, `permission: "firm:provision"` (nominal — public routes skip the RBAC gate; the `platformAdminGuard` is the real guard), `audited: true`, `idempotency: "required"`, `rateLimit: "auth"`. Request body `{ channel: z.enum(["stable", "beta", "alpha"]) }`; `firmId` from the path. Handler: validate the firm exists (404 problem if not), write the column via `writeFirmReleaseChannelStatement(c.env.DB_CONTROL, firmId, channel)`, write a control-plane auth-audit row:

```typescript
insertAuthAuditStatement(c.env.DB_CONTROL, {
  id: newIdentifier("authAudit"),
  event: "firm.release_channel_set_alpha",
  userId: null,
  metadata: { firmId, oldChannel, newChannel: channel },
  now: new Date().toISOString(),
}).run();
```

Register with the guard, mirroring `firms.ts`:

```typescript
app.openapi(
  {
    ...platformSetReleaseChannelRoute,
    middleware: chokepointMiddleware(chokepoint, platformSetReleaseChannelRoute, [
      platformAdminGuard as MiddlewareHandler,
    ]),
  },
  async (c) => {
    /* handler */
  },
);
```

and call `registerPlatformReleaseChannelRoute(app, chokepoint)` in `app.ts`.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `vp test run apps/worker/test/platform-release-channel.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the contract + client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi` then `pnpm run generate-client`.

- [ ] **Step 6: Conformance + quality gate**

Run: `vp test run apps/worker/test/conformance.test.ts` then `pnpm check`.
Expected: PASS. If conformance flags the public route, mirror exactly the allow-list treatment `firms.provision` already has in `apps/worker/test/conformance.test.ts` (add an analogous entry with a one-line justification).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/platform/platform-release-channel.ts apps/worker/src/routes/platform/firms.ts apps/worker/src/app.ts apps/worker/test/platform-release-channel.test.ts apps/worker/test/conformance.test.ts apps/worker/openapi/openapi.json packages/api-client/src
git commit -m "feat(release-channels): alpha door — secret-guarded platform endpoint"
```

---

### Task 9: Deliver channel + flags through `/me`

**Files:**

- Modify: `apps/worker/src/routes/session/me.ts`
- Test: `apps/worker/test/me.test.ts`
- Regenerate: `apps/worker/openapi/openapi.json`, `packages/api-client/src/*.gen.ts`

**Interfaces:**

- Consumes: `resolveFlagEvaluator` (Task 6); `evaluateCatalog`, `isReleaseChannel` from `@magna-carta/feature-flags`; `readFirmReleaseChannelStatement` (Task 5).
- Produces: `MeResponse` gains `channel: ReleaseChannel` and `flags: Record<string, boolean>`.

- [ ] **Step 1: Extend the failing test**

In `apps/worker/test/me.test.ts`, add/extend a case asserting the bootstrap shape for a stable firm:

```typescript
expect(body.channel).toBe("stable");
expect(body.flags).toEqual({ "release-channels.smoke": false });
```

(With no `FLAGS` binding in the test pool, every flag resolves to its default — `false`.)

- [ ] **Step 2: Run the test, verify it fails**

Run: `vp test run apps/worker/test/me.test.ts`
Expected: FAIL — `channel`/`flags` undefined.

- [ ] **Step 3: Extend the route**

In `apps/worker/src/routes/session/me.ts`:

Add to the `MeResponse` schema:

```typescript
    channel: z.enum(["stable", "beta", "alpha"]),
    flags: z.record(z.string(), z.boolean()),
```

In the handler, after loading permissions, read the channel and evaluate the catalog:

```typescript
const channelRow = await readFirmReleaseChannelStatement(c.env.DB_CONTROL, firmId).first<{
  release_channel: string;
}>();
const channel = isReleaseChannel(channelRow?.release_channel ?? "stable")
  ? (channelRow!.release_channel as ReleaseChannel)
  : "stable";
const flags = await evaluateCatalog(resolveFlagEvaluator(c.env), {
  targetingKey: userId,
  firmId,
  channel,
});
```

Add `channel` and `flags` to the `c.json({...}, 200)` body. (Import `readFirmReleaseChannelStatement` from `@magna-carta/data-access`, the flag helpers from `@magna-carta/feature-flags`, and `resolveFlagEvaluator` from `../flags/flag-evaluator.ts`.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `vp test run apps/worker/test/me.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the contract + client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi` then `pnpm run generate-client`.

- [ ] **Step 6: Full quality gate + full test run**

Run: `pnpm check` then `vp test`.
Expected: PASS across the monorepo.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/session/me.ts apps/worker/test/me.test.ts apps/worker/openapi/openapi.json packages/api-client/src
git commit -m "feat(release-channels): deliver channel + flags via /me"
```

---

### Task 10: Documentation, ADRs, and changelog

**Files:**

- Modify: `docs/Magna-Carta-White-Paper.md` (new _Release channels_ topic)
- Create: `docs/decisions/pending/release-channels-flagship.md`
- Create: `docs/decisions/pending/release-channels-gate-behavior-not-schema.md`
- Create: `changelog.d/release-channels-backend-rails.md`
- Modify: `ROADMAP.md` and `STATUS.md` (this slice's row only)
- Modify: `apps/worker/CLAUDE.md` (local note: how to add a flag + the two channel doors)
- Modify: `docs/active-work/release-channels.md` (status → backend rails built)

Before editing the cross-cutting files (`white paper`, `ROADMAP.md`, `STATUS.md`), run `vp run worktrees` and sync `main` (`git merge main`) to avoid collisions.

- [ ] **Step 1: White-paper topic**

Add a _Release channels_ topic under the delivery/operations area: the `stable/beta/alpha` model, behavior-not-schema principle, the two doors, Flagship + the `@magna-carta/feature-flags` wrapper, fail-safe defaults, and the firm-level (not per-user) decision. Reference other topics by name, never by section number. No process-doc citations.

- [ ] **Step 2: ADR fragments**

Write the two pending ADR fragments following the repo's fragment frontmatter convention (copy an existing file in `docs/decisions/pending/` as the template):

- `release-channels-flagship.md` — adopt Cloudflare Flagship as the feature-flag engine, wrapped in `@magna-carta/feature-flags`; context carries only non-privileged identifiers; defaults are stable behavior.
- `release-channels-gate-behavior-not-schema.md` — channels gate behavior, never schema; feature code ships dark to the single fleet; the alpha grant is a secret-guarded platform door, beta is firm RBAC + consent.

- [ ] **Step 3: Changelog fragment**

Create `changelog.d/release-channels-backend-rails.md` describing the new firm release-channel mechanism (backend), following an existing fragment's format.

- [ ] **Step 4: ROADMAP / STATUS / area CLAUDE.md / active-work**

Add the slice to `ROADMAP.md`; add/refresh this slice's `STATUS.md` row only; add an `apps/worker/CLAUDE.md` note on the two doors and how a feature adds a flag to `FLAG_CATALOG`; update `docs/active-work/release-channels.md` to "backend rails built; Plan 2 (frontend opt-in UI) pending."

- [ ] **Step 5: Quality gate + commit**

Run: `pnpm check` (docs-only, but confirms no `lint:process-refs` violations crept into edited code comments).

```bash
git add docs changelog.d ROADMAP.md STATUS.md apps/worker/CLAUDE.md
git commit -m "docs(release-channels): white paper, ADR fragments, changelog, status"
```

---

## Self-Review

**Spec coverage:**

- Model (`firm.release_channel`, firm-level, nesting) → Tasks 4, 5; `ReleaseChannel` in Task 1.
- Beta door (RBAC + consent + control-plane write + per-firm audit) → Tasks 2, 3, 7.
- Alpha door (secret-guarded platform write + control-plane audit) → Task 8.
- Flagship wrapper + safe defaults + fail-safe → Tasks 1, 6.
- `/me` delivery (channel + flags) → Task 9.
- Throwaway proof flag → Task 1 (`release-channels.smoke`), exercised in Tasks 1, 9.
- Audit homes split by door → Tasks 7 (per-firm `audit_log`), 8 (control-plane `auth_audit`).
- Docs/ADRs → Task 10.
- Out of scope (Plan 2): the beta opt-in Settings UI + consent dialog, and a UI element gated on the flag. The backend records consent (Task 7); the UI renders it later.

**Placeholder scan:** The only intentional `<name>` placeholders are the drizzle-kit-generated control-plane migration tag in Task 4 (the exact suffix is only known after generation) and the in-memory-SQLite test harness reference in Task 5 (the repo's existing helper, to be matched to its siblings) — both are explicitly flagged with how to resolve them, not left vague.

**Type consistency:** `ReleaseChannel`, `FlagContext`, `FlagEvaluator`, `evaluateCatalog`, `flagshipEvaluator`, `defaultOffEvaluator`, `resolveFlagEvaluator`, `writeFirmReleaseChannelStatement`, `readFirmReleaseChannelStatement` are defined once (Tasks 1, 5, 6) and consumed with the same signatures in Tasks 7–9. The control-plane column is `release_channel` (snake_case SQL) / `releaseChannel` (Drizzle field) consistently. Audit events: `firm.release_channel_changed` (per-firm) and `firm.release_channel_set_alpha` (control-plane).
