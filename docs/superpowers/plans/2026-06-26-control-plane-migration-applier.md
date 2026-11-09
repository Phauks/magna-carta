# Control-plane migration applier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply control-plane D1 migrations automatically in production via the single-flighted scheduled (Cron) handler, and make `/me` fail-safe so the brief post-deploy window cannot 500 the bootstrap.

**Architecture:** Bundle the control-plane migration lineage into the worker (`controlPlaneMigrations()`, mirroring `per-firm-migrations.ts`); the existing `scheduled()` handler becomes the **sole** runtime applier (single-flighted by construction — Cloudflare fires one invocation per tick — so the verified concurrency hazard of racing isolates never arises); `/me`'s channel + flags become best-effort enrichments that degrade to `stable` + default flags on any read error.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Drizzle journals, Vitest + Miniflare (`cloudflare:test`), Vite+ (`vp`).

## Global Constraints

- **Full names, no shorthand**; **no emojis** anywhere; **no process-doc references** in source/tests/OpenAPI descriptions (no "ADR", "spec", "slice N", "Phase N", "Task N") — explain reasoning inline or cite a file path. (CLAUDE.md golden rules 12, 2, 13)
- **The Cron scheduled handler is the SOLE runtime applier of control-plane migrations** — no other runtime path applies them, so there is exactly one applier and no concurrency. (Verified: `runPendingMigrations` fails loud and each migration is one atomic `batch()` with a `_migrations` PK, so two isolates racing the same pending migration would throw.)
- **Control-plane migrations stay additive** (already enforced by `packages/database/test/expand-contract.test.ts`); request reads of a new additive column **fail-safe to a default**, never 500.
- **One source of truth for the control-plane migration map**: the test applier and the production bundle share `controlPlaneMigrations()`.
- **Quality gate:** `pnpm check` and `vp test` must pass. No worker route shape changes here, so no OpenAPI contract regeneration is required (the `/me` change is handler-internal; the response schema is unchanged).
- **Worktree:** branch `release-channels` at `C:/dev/magna-carta-worktrees/release-channels`.

---

### Task 1: Bundle the control-plane lineage + share it with the test applier

**Files:**

- Create: `apps/worker/src/control-plane-migrations.ts`
- Modify: `apps/worker/test/support/apply-control-plane-migrations.ts`
- Test: `apps/worker/test/control-plane-migrations.test.ts`

**Interfaces:**

- Consumes: `migrationsFromJournal`, `type Migration` from `@magna-carta/database/migration`; the control-plane journal + SQL text imports under `@magna-carta/database/drizzle/control-plane/`; `runPendingMigrations` from `@magna-carta/database/migration-runner`; `d1MigrationTarget` from `@magna-carta/database/d1-migration-target`.
- Produces: `controlPlaneMigrations(): Migration[]` and `controlPlaneHeadSchemaVersion(): string`.

- [ ] **Step 1: Write the bundle module**

Create `apps/worker/src/control-plane-migrations.ts`, mirroring `apps/worker/src/per-firm-migrations.ts` exactly (same imports-as-text + `migrationsFromJournal` map + head-version helper). Use the four current control-plane tags:

```typescript
import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import controlPlaneJournal from "@magna-carta/database/drizzle/control-plane/meta/_journal.json";
import firmRegistrySql from "@magna-carta/database/drizzle/control-plane/0000_firm-registry.sql";
import authAndProvisioningSql from "@magna-carta/database/drizzle/control-plane/0001_auth-and-provisioning.sql";
import firmKeyColumnsSql from "@magna-carta/database/drizzle/control-plane/0002_firm-key-columns.sql";
import releaseChannelSql from "@magna-carta/database/drizzle/control-plane/0003_handy_rattler.sql";

// The control-plane migration lineage bundled INTO the worker (no filesystem at runtime): the
// scheduled handler is the single-flighted sole applier of these against DB_CONTROL. Mirrors
// per-firm-migrations.ts; the same plain .sql text-import bundling contract (src/sql-modules.d.ts).
// migrationsFromJournal fails loud when the journal gains a migration this map does not carry —
// add the new import alongside its journal entry.
export function controlPlaneMigrations(): Migration[] {
  return migrationsFromJournal(controlPlaneJournal, {
    "0000_firm-registry": firmRegistrySql,
    "0001_auth-and-provisioning": authAndProvisioningSql,
    "0002_firm-key-columns": firmKeyColumnsSql,
    "0003_handy_rattler": releaseChannelSql,
  });
}

// The lineage head (latest journal tag).
export function controlPlaneHeadSchemaVersion(): string {
  const lastEntry = [...controlPlaneJournal.entries].sort((a, b) => a.idx - b.idx).at(-1);
  if (lastEntry === undefined) throw new Error("control-plane migration journal is empty");
  return lastEntry.tag;
}
```

(Confirm the four SQL filenames against `packages/database/drizzle/control-plane/` before writing — `0003_handy_rattler.sql` is the release-channel column migration.)

- [ ] **Step 2: Refactor the test applier to share the bundle**

Replace the inline map in `apps/worker/test/support/apply-control-plane-migrations.ts` so it delegates to the bundle (one source of truth). The whole file becomes:

```typescript
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { controlPlaneMigrations } from "../../src/control-plane-migrations.ts";

export async function applyControlPlaneMigrations(database: D1Database): Promise<void> {
  await runPendingMigrations(d1MigrationTarget(database), controlPlaneMigrations());
}
```

(Match the existing `D1Database` type import style the file/`apply-per-firm-migrations.ts` use — `apply-per-firm-migrations.ts` is the exact precedent for this shape.)

- [ ] **Step 3: Write the failing test**

Create `apps/worker/test/control-plane-migrations.test.ts`. This file deliberately does NOT migrate `DB_CONTROL` in a hook — under `cloudflare:test` isolated storage, `DB_CONTROL` starts empty here, which lets the test prove a from-empty apply:

```typescript
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import {
  controlPlaneMigrations,
  controlPlaneHeadSchemaVersion,
} from "../src/control-plane-migrations.ts";

describe("controlPlaneMigrations bundle", () => {
  it("covers the journal and reports the head tag", () => {
    const migrations = controlPlaneMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(4);
    expect(migrations.at(-1)?.tag).toBe(controlPlaneHeadSchemaVersion());
    expect(controlPlaneHeadSchemaVersion()).toMatch(/^0003_/);
  });

  it("applies the whole lineage from empty, then is a no-op when re-run", async () => {
    const target = d1MigrationTarget(env.DB_CONTROL);
    const first = await runPendingMigrations(target, controlPlaneMigrations());
    expect(first.appliedTags).toContain("0003_handy_rattler");
    // The release-channel column exists -> the control-plane schema is at head.
    const probe = await env.DB_CONTROL.prepare("SELECT release_channel FROM firm LIMIT 1").all();
    expect(probe.success).toBe(true);
    // Idempotent: a second run applies nothing.
    const second = await runPendingMigrations(target, controlPlaneMigrations());
    expect(second.appliedTags).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `cd C:/dev/magna-carta-worktrees/release-channels && vp test run apps/worker/test/control-plane-migrations.test.ts`
Expected: FAIL — `control-plane-migrations.ts` not found.

- [ ] **Step 5: (module + applier already written in Steps 1–2) run the test, verify it passes**

Run: `cd C:/dev/magna-carta-worktrees/release-channels && vp test run apps/worker/test/control-plane-migrations.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Confirm the test-applier refactor did not break existing control-plane-backed tests**

Run: `cd C:/dev/magna-carta-worktrees/release-channels && vp test run apps/worker/test/me.test.ts apps/worker/test/scheduled.test.ts apps/worker/test/auth-provisioning-e2e.test.ts`
Expected: PASS — these call `applyControlPlaneMigrations`, now delegating to the bundle.

- [ ] **Step 7: Quality gate + commit**

Run: `pnpm check`.

```bash
git add apps/worker/src/control-plane-migrations.ts apps/worker/test/support/apply-control-plane-migrations.ts apps/worker/test/control-plane-migrations.test.ts
git commit -m "feat(migrations): bundle control-plane lineage + share with test applier"
```

---

### Task 2: Apply control-plane migrations from the scheduled handler

**Files:**

- Modify: `apps/worker/src/scheduled.ts` (inside `runScheduledSweep`, before the control-plane outbox sweep)
- Test: `apps/worker/test/scheduled.test.ts`

**Interfaces:**

- Consumes: `controlPlaneMigrations()` (Task 1); `runPendingMigrations`, `d1MigrationTarget`; the handler's existing `logger` + `correlationId`; `logOperationFailed` from `@magna-carta/telemetry/operation` (already imported in `scheduled.ts`).
- Produces: control-plane `DB_CONTROL` is brought to head on each scheduled pass, error-isolated.

- [ ] **Step 1: Write the failing test**

Add to `apps/worker/test/scheduled.test.ts` a test asserting the sweep keeps the control plane at head and does not error (the file's `beforeAll` already migrates `DB_CONTROL` to head, so this proves the wiring + idempotency; the from-empty apply is proven in Task 1 against the same runner the handler calls):

```typescript
describe("runScheduledSweep — control-plane migrations", () => {
  it("runs the control-plane migration step without error and leaves DB_CONTROL at head", async () => {
    await runScheduledSweep(env);
    const probe = await env.DB_CONTROL.prepare("SELECT release_channel FROM firm LIMIT 1").all();
    expect(probe.success).toBe(true);
    const applied = await env.DB_CONTROL.prepare(
      "SELECT tag FROM _migrations WHERE tag = '0003_handy_rattler'",
    ).first<{ tag: string }>();
    expect(applied?.tag).toBe("0003_handy_rattler");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd C:/dev/magna-carta-worktrees/release-channels && vp test run apps/worker/test/scheduled.test.ts -t "control-plane migrations"`
Expected: This specific test currently passes trivially only if the column already exists; to make it a real RED, first confirm the migration step is NOT yet wired by checking `scheduled.ts` has no `controlPlaneMigrations` reference. (If the assertion passes before wiring because `beforeAll` migrated, that is acceptable — the meaningful verification is Step 4 plus that `runScheduledSweep` now invokes the applier; proceed to implement.)

- [ ] **Step 3: Wire the migration step into `runScheduledSweep`**

In `apps/worker/src/scheduled.ts`, add the imports:

```typescript
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import { controlPlaneMigrations } from "./control-plane-migrations.ts";
```

Inside `runScheduledSweep(env)`, immediately AFTER `logger`/`correlationId` are created and BEFORE the `const controlPlane = await sweepOutbox({...})` line, add the migration step, error-isolated so a failure is observable but does not starve the rest of the pass (mirror the `logOperationFailed` usage already present elsewhere in this file — find an existing `logOperationFailed(` call and copy its argument shape):

```typescript
// The control plane has no provision-time migration gate (unlike per-firm DBs, which migrate when
// a firm is provisioned), so the scheduled pass is the single-flighted applier that brings the
// control-plane schema to head. Idempotent: a no-op once at head. Error-isolated: a migration
// failure is logged and the rest of the pass still runs.
try {
  await runPendingMigrations(d1MigrationTarget(env.DB_CONTROL), controlPlaneMigrations());
} catch (error) {
  logger.log(
    logOperationFailed(
      { correlationId, now: new Date().toISOString() },
      { operation: "control-plane-migrations", error },
    ),
  );
}
```

(Match `logOperationFailed`'s real signature to the existing call site in this file — adjust the second argument's field names to whatever that call uses; do not invent fields.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd C:/dev/magna-carta-worktrees/release-channels && vp test run apps/worker/test/scheduled.test.ts`
Expected: PASS (the new test and all existing scheduled tests).

- [ ] **Step 5: Quality gate + commit**

Run: `pnpm check`.

```bash
git add apps/worker/src/scheduled.ts apps/worker/test/scheduled.test.ts
git commit -m "feat(migrations): apply control-plane migrations from the scheduled handler"
```

---

### Task 3: Make `/me` channel + flags fail-safe

**Files:**

- Modify: `apps/worker/src/routes/session/me.ts`
- Test: `apps/worker/test/me-channel-failsafe.test.ts` (new unit test); `apps/worker/test/me.test.ts` (must still pass)

**Interfaces:**

- Consumes: `readFirmReleaseChannelStatement`, `evaluateCatalog`, `isReleaseChannel`, `defaultOffEvaluator`, `type ReleaseChannel` (`@magna-carta/feature-flags`); `resolveFlagEvaluator` (`../flags/flag-evaluator.ts`); `type Bindings`; `type FirmId` (`@magna-carta/identifiers/types`).
- Produces: `resolveChannelAndFlags(env: Bindings, userId: string, firmId: FirmId): Promise<{ channel: ReleaseChannel; flags: Record<string, boolean> }>` — exported from `me.ts`, used by the handler.

- [ ] **Step 1: Write the failing unit test**

Create `apps/worker/test/me-channel-failsafe.test.ts`. It injects a fake `Bindings` whose control-plane read throws (the post-deploy window where the additive column is briefly absent), and asserts the helper degrades to `stable` + the catalog defaults rather than throwing:

```typescript
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { resolveChannelAndFlags } from "../src/routes/session/me.ts";
import type { FirmId } from "@magna-carta/identifiers/types";

// A control-plane binding whose channel read throws (e.g. "no such column: release_channel").
const throwingControlPlane = {
  prepare: () => ({
    bind: () => ({
      first: () => Promise.reject(new Error("no such column: release_channel")),
    }),
  }),
};
// No FLAGS binding -> default-off evaluator; firmId is a placeholder branded id.
const env = { DB_CONTROL: throwingControlPlane } as unknown as Bindings;
const firmId = "firm_failsafe_test" as unknown as FirmId;

describe("resolveChannelAndFlags fail-safe", () => {
  it("degrades to stable + default flags when the channel read throws", async () => {
    const result = await resolveChannelAndFlags(env, "usr_1", firmId);
    expect(result.channel).toBe("stable");
    expect(result.flags).toEqual({ "release-channels.smoke": false });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd C:/dev/magna-carta-worktrees/release-channels && vp test run apps/worker/test/me-channel-failsafe.test.ts`
Expected: FAIL — `resolveChannelAndFlags` is not exported from `me.ts`.

- [ ] **Step 3: Extract the fail-safe helper and wire the handler**

In `apps/worker/src/routes/session/me.ts`, add `defaultOffEvaluator` to the `@magna-carta/feature-flags` import and add `import type { FirmId } from "@magna-carta/identifiers/types";`. Add the exported helper above `registerMeRoute`:

```typescript
// The channel + flags are best-effort bootstrap enrichments. A failure to read them — most plausibly
// the additive release_channel column briefly absent right after a deploy, before the scheduled
// applier lands it (see src/control-plane-migrations.ts) — degrades to the stable channel and the
// catalog defaults rather than failing the whole bootstrap. This is the same fail-safe-to-stable
// posture an absent FLAGS binding already takes.
export async function resolveChannelAndFlags(
  env: Bindings,
  userId: string,
  firmId: FirmId,
): Promise<{ channel: ReleaseChannel; flags: Record<string, boolean> }> {
  try {
    const channelRow = await readFirmReleaseChannelStatement(env.DB_CONTROL, firmId).first<{
      release_channel: string;
    }>();
    const rawChannel = channelRow?.release_channel ?? "stable";
    const channel: ReleaseChannel = isReleaseChannel(rawChannel) ? rawChannel : "stable";
    const flags = await evaluateCatalog(resolveFlagEvaluator(env), {
      targetingKey: userId,
      firmId,
      channel,
    });
    return { channel, flags };
  } catch {
    const flags = await evaluateCatalog(defaultOffEvaluator, {
      targetingKey: userId,
      firmId,
      channel: "stable",
    });
    return { channel: "stable", flags };
  }
}
```

Then replace the inline channel/flags block in the handler (the `const channelRow … const flags = await evaluateCatalog(…)` lines) with:

```typescript
const { channel, flags } = await resolveChannelAndFlags(c.env, userId, firmId);
```

(The `c.json({ …, channel, flags }, 200)` body stays the same.)

- [ ] **Step 4: Run both tests, verify they pass**

Run: `cd C:/dev/magna-carta-worktrees/release-channels && vp test run apps/worker/test/me-channel-failsafe.test.ts apps/worker/test/me.test.ts`
Expected: PASS — the fail-safe unit test and the existing `/me` happy-path test (a stable firm still reports `channel: "stable"` + `{ "release-channels.smoke": false }`).

- [ ] **Step 5: Quality gate + commit**

Run: `pnpm check`.

```bash
git add apps/worker/src/routes/session/me.ts apps/worker/test/me-channel-failsafe.test.ts
git commit -m "fix(release-channels): make /me channel + flags fail-safe to stable"
```

---

### Task 4: Documentation

**Files:**

- Modify: `docs/conventions/operations.md` (new control-plane-migrations section)
- Create: `docs/decisions/pending/control-plane-migration-applier.md`
- Create: `changelog.d/control-plane-migration-applier.md`
- Modify: `docs/active-work/release-channels.md` (the deploy precondition is now automated)

Before editing the cross-cutting `operations.md`, run `vp run worktrees` and (if `main` has advanced) `git merge main` to avoid collisions.

- [ ] **Step 1: operations.md section**

Add a "Control-plane database migrations" section to `docs/conventions/operations.md`: application is automatic via the scheduled (Cron) handler, which is the single-flighted sole applier (state the verified reason: the runner fails loud and each migration is one atomic batch with a `_migrations` PK, so racing isolates would throw — hence one applier); the additive + fail-safe-read discipline; and **deploy-time application as the future zero-window hardening** (run the migrations in the Workers Builds command before `wrangler deploy`, single-flight by construction — adopt when production firms make a zero-width window matter). Reference files by path, no process-doc citations.

- [ ] **Step 2: ADR fragment**

Create `docs/decisions/pending/control-plane-migration-applier.md` following the frontmatter convention of an existing `docs/decisions/pending/` file: control-plane migrations apply at runtime via the single-flighted scheduled handler (mirroring the per-firm runtime-bundled model); reads of new additive columns fail-safe; deploy-time application is the documented future hardening; a cold-start gate was rejected (verified concurrency hazard without a coordinator).

- [ ] **Step 3: changelog fragment**

Create `changelog.d/control-plane-migration-applier.md` following an existing fragment's format: control-plane migrations now apply automatically via the scheduled handler; the previous manual deploy step is gone.

- [ ] **Step 4: Update active-work**

In `docs/active-work/release-channels.md`, change the "Deploy precondition" note: control-plane `0003` now applies automatically within one cron cycle, and `/me` fail-safes to stable meanwhile — the manual step is removed. (Keep a one-line note that an operator who needs the schema immediately can wait one cron cycle or invoke the scheduled handler.)

- [ ] **Step 5: Quality gate + commit**

Run: `pnpm check` (confirms no `lint:process-refs` violation in edited code comments).

```bash
git add docs/conventions/operations.md docs/decisions/pending/control-plane-migration-applier.md changelog.d/control-plane-migration-applier.md docs/active-work/release-channels.md
git commit -m "docs(migrations): control-plane migration applier ops + ADR + changelog"
```

---

## Self-Review

**Spec coverage:**

- Bundle `controlPlaneMigrations()` + share with test applier → Task 1.
- Cron sweep as sole single-flighted applier → Task 2.
- `/me` fail-safe read discipline → Task 3.
- Docs/ADR/changelog + deploy-time future-hardening note + active-work update → Task 4.
- The verified single-flight constraint is encoded in Global Constraints and the Task 2 comment.

**Placeholder scan:** The only deliberate "match the existing call site" instructions are for `logOperationFailed`'s argument shape (Task 2) and the `D1Database` import style (Task 1) — both name the exact precedent file to copy, not vague directives. No TBD/TODO.

**Type consistency:** `controlPlaneMigrations()`/`controlPlaneHeadSchemaVersion()` (Task 1) are consumed with those names in Tasks 1–2. `resolveChannelAndFlags(env, userId, firmId)` (Task 3) returns `{ channel: ReleaseChannel; flags: Record<string, boolean> }`, matching the `/me` response fields. The migration tag `0003_handy_rattler` is used consistently. No OpenAPI regeneration (the `/me` response schema is unchanged — only the handler internals).
