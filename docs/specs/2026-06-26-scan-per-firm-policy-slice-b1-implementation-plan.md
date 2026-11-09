# Per-firm Scan Policy — Slice B1 (Backend Rails) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the malware scanner's tier/score and flagged-file treatment **firm-configurable** end to end on the backend — firm-scoped settings drive `computeVerdict` at ingest/rescan and a firm-chosen treatment (block / informed-access / allow-and-flag) governs flagged files at ingest _and_ download/preview — with **zero behaviour change at the default settings**.

**Architecture:** Three firm settings (`scan.policy` = `{tier, suspiciousScoreFloor}`, `scan.flagged_treatment`, `scan.step_up_reauth_on_flagged`) defined through the existing scoped-setting resolver. The ingest consumer + rescan handler resolve the firm policy and pass it to `computeVerdict` (replacing the hard-coded `DEFAULT_SCAN_POLICY`). The flagged branch becomes treatment-aware: `block` quarantines (today's behaviour), `informed-access`/`allow-and-flag` commit the version marked `scanVerdict: "flagged"`. The download/preview routes resolve the firm treatment and gate accordingly (generalizing slice 2·3's `acknowledgeMalware` gate). Step-up re-auth is stored but its challenge is a forward seam.

**Tech Stack:** TypeScript (Cloudflare Workers + Hono, Drizzle, zod, Vitest + `@cloudflare/vitest-pool-workers`).

## Global Constraints

- **Never silently clean** — a scan fault stays a retryable throw, never a fabricated clean/commit. Unchanged from Slice A. Copied verbatim from the spec.
- **Behaviour-preservation at defaults** — with `scan.policy = extended/75`, `scan.flagged_treatment = block`, `scan.step_up_reauth_on_flagged = false`, every ingest/rescan/download outcome MUST be byte-identical to current `main`. This is the slice's acceptance bar.
- **Redact-by-default** — settings, audit, and telemetry carry the policy/verdict/reason only, never file content or name.
- **Full names, no shorthand** — `suspiciousScoreFloor` not `floor`, `flaggedTreatment` not `treat`, in identifiers/keys.
- **No process-artifact references in source/tests/config** — no "Slice B1"/"ADR"/"spec §" in code/comments; state reasoning inline. A forward-looking seam reference ("step-up challenge lands in a later slice") IS allowed (golden rule 13 exception). CI: `node tooling/lint-process-references.mjs`.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Tier enum is `core | extended | full`** (NOT "strict"). Treatment enum is `block | informed-access | allow-and-flag`.
- **Quality gate:** `pnpm check` (root). Worker suite via `vp test` (run scan/ingest/download files individually — the full Miniflare pool OOMs locally). `pnpm install` after any main-sync before TS work.
- **Worktree:** all work in `C:/dev/magna-carta-worktrees/scan-firm-policy-settings` (branch `scan-firm-policy-settings`). Subagents MUST `cd` there and verify the branch before editing, and `git add` explicit paths only (never `-A`).

---

## File Structure

- `packages/file-manager/src/scan-policy-settings.ts` (NEW) — the three `FirmSettingDefinition`s + `FlaggedTreatment` type + `readFirmScanPolicy`/`readFlaggedTreatment`/`readStepUpReauthOnFlagged`. One home for "what a firm's scan policy is and how to read it."
- `packages/file-manager/src/ingest-core.ts` — `IngestInput` gains `scanPolicy: ScanPolicy` + `flaggedTreatment: FlaggedTreatment`; the flagged branch becomes treatment-aware (quarantine vs commit-as-flagged).
- `packages/file-manager/src/file-service.ts` — `commitVersion` accepts a flagged commit (persists `scanVerdict: "flagged"`).
- `apps/worker/src/files/ingest-consumer.ts` — resolve the firm policy + treatment before `runIngest` and before the rescan recompute.
- `packages/database/drizzle/per-firm/00NN_scan_verdict_flagged.sql` (NEW) + `per-firm-schema.ts` + `apps/worker/src/per-firm-migrations.ts` — rename the `file_version.scan_verdict` enum value `infected` → `flagged` (pre-production, no rows).
- `apps/worker/src/routes/files/files.ts` — the download + preview handlers resolve the firm treatment and gate a `flagged` version accordingly.
- `packages/file-manager/src/preview-policy.ts` — treat `scanVerdict: "flagged"` exactly as the old `infected`.
- `apps/worker/src/routes/firm/scan-policy.ts` (NEW) — `GET` + `PATCH /api/v1/firm/scan-policy` (read/write the three settings).
- `packages/access-control/src/registry.ts` + a seed migration — a `firm:manageScanPolicy` permission.
- Docs: `changelog.d/`, `docs/decisions/pending/`, `STATUS.md`, `apps/worker`/`file-manager` area `CLAUDE.md`.

---

## Task 1: `scan-policy-settings.ts` — the firm settings

**Files:**

- Create: `packages/file-manager/src/scan-policy-settings.ts`
- Test: `packages/file-manager/test/scan-policy-settings.test.ts`

**Interfaces:**

- Consumes: `ScanPolicy`, `DEFAULT_SCAN_POLICY` (from `./verdict.ts`); `FirmSettingDefinition`, `readFirmSetting`, `writeFirmSettingStatement` (from `@magna-carta/data-access/setting-statements`).
- Produces: `export type FlaggedTreatment = "block" | "informed-access" | "allow-and-flag"`; `export const DEFAULT_FLAGGED_TREATMENT: FlaggedTreatment = "block"`; `scanPolicyDefinition: FirmSettingDefinition<ScanPolicy>` (key `"scan.policy"`); `flaggedTreatmentDefinition: FirmSettingDefinition<FlaggedTreatment>` (key `"scan.flagged_treatment"`); `stepUpReauthDefinition: FirmSettingDefinition<boolean>` (key `"scan.step_up_reauth_on_flagged"`); `readFirmScanPolicy(db)`, `readFlaggedTreatment(db)`, `readStepUpReauthOnFlagged(db)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import {
  scanPolicyDefinition,
  flaggedTreatmentDefinition,
  stepUpReauthDefinition,
  DEFAULT_FLAGGED_TREATMENT,
} from "../src/scan-policy-settings.ts";
import { DEFAULT_SCAN_POLICY } from "../src/verdict.ts";

describe("scan policy settings", () => {
  it("defaults match the spec (extended/75, block, off)", () => {
    expect(scanPolicyDefinition.defaultValue).toEqual(DEFAULT_SCAN_POLICY);
    expect(flaggedTreatmentDefinition.defaultValue).toBe("block");
    expect(DEFAULT_FLAGGED_TREATMENT).toBe("block");
    expect(stepUpReauthDefinition.defaultValue).toBe(false);
  });
  it("policy schema accepts a valid policy and rejects an unknown tier / out-of-range floor", () => {
    expect(
      scanPolicyDefinition.schema.safeParse({ tier: "full", suspiciousScoreFloor: 0 }).success,
    ).toBe(true);
    expect(
      scanPolicyDefinition.schema.safeParse({ tier: "strict", suspiciousScoreFloor: 75 }).success,
    ).toBe(false);
    expect(
      scanPolicyDefinition.schema.safeParse({ tier: "core", suspiciousScoreFloor: 101 }).success,
    ).toBe(false);
    expect(
      scanPolicyDefinition.schema.safeParse({ tier: "core", suspiciousScoreFloor: -1 }).success,
    ).toBe(false);
  });
  it("treatment schema is the three-value enum", () => {
    expect(flaggedTreatmentDefinition.schema.safeParse("allow-and-flag").success).toBe(true);
    expect(flaggedTreatmentDefinition.schema.safeParse("delete").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @magna-carta/file-manager run test scan-policy-settings` → FAIL (module absent).

- [ ] **Step 3: Implement**

```typescript
import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";
import { DEFAULT_SCAN_POLICY, type ScanPolicy } from "./verdict.ts";
import type { SqlDatabase } from "@magna-carta/data-access";

/// How a firm's flagged files are treated — chosen per firm, applied at ingest AND access.
/// `block`: quarantine, inaccessible (today's behaviour). `informed-access`: commit but gate the raw
/// download behind an acknowledgment. `allow-and-flag`: commit and serve, visibly marked. No
/// reject/delete option, by design.
export type FlaggedTreatment = "block" | "informed-access" | "allow-and-flag";
export const DEFAULT_FLAGGED_TREATMENT: FlaggedTreatment = "block";

const scanPolicySchema: z.ZodType<ScanPolicy> = z.object({
  tier: z.enum(["core", "extended", "full"]),
  suspiciousScoreFloor: z.number().int().min(0).max(100),
});

export const scanPolicyDefinition: FirmSettingDefinition<ScanPolicy> = {
  key: "scan.policy",
  schema: scanPolicySchema,
  defaultValue: DEFAULT_SCAN_POLICY,
};

export const flaggedTreatmentDefinition: FirmSettingDefinition<FlaggedTreatment> = {
  key: "scan.flagged_treatment",
  schema: z.enum(["block", "informed-access", "allow-and-flag"]),
  defaultValue: DEFAULT_FLAGGED_TREATMENT,
};

// Stored now; the actual step-up challenge (a recent-auth check on a flagged download) is wired in a
// later auth slice — there is no session-age / re-verify mechanism yet.
export const stepUpReauthDefinition: FirmSettingDefinition<boolean> = {
  key: "scan.step_up_reauth_on_flagged",
  schema: z.boolean(),
  defaultValue: false,
};

export function readFirmScanPolicy(database: SqlDatabase): Promise<ScanPolicy> {
  return readFirmSetting(database, scanPolicyDefinition);
}
export function readFlaggedTreatment(database: SqlDatabase): Promise<FlaggedTreatment> {
  return readFirmSetting(database, flaggedTreatmentDefinition);
}
export function readStepUpReauthOnFlagged(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, stepUpReauthDefinition);
}
```

(Confirm the exact `SqlDatabase` import path against `setting-statements.ts`; match its style.)

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @magna-carta/file-manager run test scan-policy-settings` → PASS.
- [ ] **Step 5: Commit** — `git add packages/file-manager/src/scan-policy-settings.ts packages/file-manager/test/scan-policy-settings.test.ts && git commit -m "feat(file-manager): firm scan-policy settings (tier/floor, flagged treatment, step-up)"`

---

## Task 2: migration — rename `scan_verdict` enum `infected` → `flagged`

**Files:**

- Create: `packages/database/drizzle/per-firm/00NN_scan_verdict_flagged.sql` (NN = next free number — check `meta/_journal.json` head)
- Modify: `packages/database/src/per-firm-schema.ts` (the `fileVersion.scanVerdict` enum), `apps/worker/src/per-firm-migrations.ts`
- Modify any TS referencing the literal `"infected"` for a scan verdict: `packages/file-manager/src/queries.ts` (`CleanVersion`), `apps/worker/src/routes/files/files.ts`, `packages/file-manager/src/preview-policy.ts`, `apps/worker/src/files/ingest-consumer.ts` (rescan), `ingest-core.ts` (it already emits `scan-flagged` reason; check the committed verdict literal).

**Interfaces:**

- Produces: `file_version.scan_verdict` enum becomes `["unscanned", "clean", "flagged"]`. The persisted "a committed version is flagged" marker is `scan_verdict = "flagged"` (replacing `infected`). Pre-production: no firm DB has rows, so a `CREATE`-time enum change is safe; SQLite enums are CHECK constraints, so the migration rebuilds the column's CHECK (or the table) to the new value set.

- [ ] **Step 1: Write the failing test** — extend the existing migration/consistency test (the worker `firms.test.ts` asserts the journal head tag) OR add a focused assertion that a committed-flagged version round-trips. Simplest: a `file-service` test that commits a flagged version with `scanVerdict: "flagged"` and reads it back (this drives the schema). Place it in Task 4's test if the schema isn't independently testable; for this task, the deliverable is "the schema + migration accept `flagged` and reject `infected`".

```typescript
// in packages/database test (or a worker migration test): the new enum value is accepted, old rejected
it("file_version.scan_verdict accepts 'flagged' and no longer 'infected'", async () => {
  // insert a file_version row with scan_verdict='flagged' succeeds; 'infected' violates the CHECK
  // (use the existing per-firm test DB harness)
});
```

- [ ] **Step 2: Run to verify failure** — the insert with `'flagged'` fails the current CHECK (`infected`).
- [ ] **Step 3: Implement** — generate the migration via the repo's drizzle per-firm flow: change the `scanVerdict` enum in `per-firm-schema.ts` to `["unscanned", "clean", "flagged"]`, then `pnpm --filter @magna-carta/database exec drizzle-kit generate --config=drizzle-per-firm.config.ts --name=scan_verdict_flagged` (or the repo's documented generate command — check `package.json` scripts). Drizzle will emit a table-rebuild migration (SQLite can't ALTER a CHECK). Verify the SQL preserves all other `file_version` columns/indexes. Wire it into `per-firm-migrations.ts` (import + journal entry, next idx). Then update every TS reference from `"infected"` → `"flagged"` for the scan verdict (the download gate, preview policy, rescan handler, queries `CleanVersion` type). Grep `"infected"` across `packages/file-manager` + `apps/worker/src` and update each scan-verdict use (do NOT touch unrelated "infected" strings if any).
- [ ] **Step 4: Run to verify pass** — the schema test passes; `pnpm --filter @magna-carta/file-manager run test` green.
- [ ] **Step 5: Commit** — explicit add of the migration + schema + per-firm-migrations + the updated consumers.

> High review bar: this touches the slice 2·3 download/preview surfaces. The reviewer confirms every former-`infected` scan-verdict site became `flagged` and nothing else regressed.

---

## Task 3: ingest-core — treatment-aware flagged branch

**Files:**

- Modify: `packages/file-manager/src/ingest-core.ts`
- Test: `apps/worker/test/ingest-core.test.ts` (the existing ingest harness)

**Interfaces:**

- Consumes: `ScanPolicy` (verdict.ts), `FlaggedTreatment` (scan-policy-settings.ts), `computeVerdict`.
- Produces: `IngestInput` gains `readonly scanPolicy: ScanPolicy` and `readonly flaggedTreatment: FlaggedTreatment`. The flagged branch:
  - `flaggedTreatment === "block"` → `{ kind: "quarantine", reason: "scan-flagged", scanDetail: fileVerdict.reason }` (today's behaviour).
  - else (`informed-access` | `allow-and-flag`) → commit the version marked flagged: `{ kind: "commit", …, scanVerdict: "flagged", scanDetail: fileVerdict.reason, rawScanResult: raw }`.
  - `computeVerdict(raw, input.scanPolicy)` replaces `computeVerdict(raw, DEFAULT_SCAN_POLICY)`.

- [ ] **Step 1: Write the failing test** (truth table over treatment × verdict; defaults preserve behaviour)

```typescript
// flagged + block → quarantine (default behaviour preserved)
it("flagged upload with treatment=block quarantines (scan-flagged)", async () => {
  const raw = infectedRaw("Eicar");
  const outcome = await runIngestWithPolicyTreatment(raw, DEFAULT_SCAN_POLICY, "block");
  expect(outcome).toMatchObject({
    kind: "quarantine",
    reason: "scan-flagged",
    scanDetail: "Eicar",
  });
});
// flagged + informed-access → commit marked flagged
it("flagged upload with treatment=informed-access commits as flagged", async () => {
  const raw = infectedRaw("Eicar");
  const outcome = await runIngestWithPolicyTreatment(raw, DEFAULT_SCAN_POLICY, "informed-access");
  expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "flagged", scanDetail: "Eicar" });
});
// flagged + allow-and-flag → commit marked flagged (same persisted shape; access differs)
it("flagged upload with treatment=allow-and-flag commits as flagged", async () => {
  const outcome = await runIngestWithPolicyTreatment(
    infectedRaw("Eicar"),
    DEFAULT_SCAN_POLICY,
    "allow-and-flag",
  );
  expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "flagged" });
});
// policy is honored: a full-tier-only match under an extended policy is clean (no flag)
it("a full-tier match under an extended policy commits clean", async () => {
  const raw = matchRaw({ ruleId: "R", tier: "full", score: 90, isSuspicious: false });
  const outcome = await runIngestWithPolicyTreatment(raw, DEFAULT_SCAN_POLICY, "block");
  expect(outcome).toMatchObject({ kind: "commit", scanVerdict: "clean" });
});
// fault still throws regardless of treatment
it("a deployed-engine fault throws (never commits) under any treatment", async () => {
  await expect(
    runIngestWithPolicyTreatment(deployedUnavailableRaw(), DEFAULT_SCAN_POLICY, "allow-and-flag"),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify failure** — `IngestInput` has no `scanPolicy`/`flaggedTreatment`; FAIL.
- [ ] **Step 3: Implement** — add the two fields to `IngestInput`; replace the flagged branch (current ~lines 182-188) per the Interfaces above; thread `input.scanPolicy` into `computeVerdict`. Keep the `ScanFaultError` rethrow. The commit-as-flagged outcome reuses the existing commit `IngestOutcome` shape with `scanVerdict: "flagged"`.
- [ ] **Step 4: Run to verify pass** — `pnpm --filter @magna-carta/worker run test ingest-core` → PASS.
- [ ] **Step 5: Commit.**

---

## Task 4: file-service — commit a flagged version

**Files:**

- Modify: `packages/file-manager/src/file-service.ts`
- Test: `packages/file-manager/test/file-service.test.ts`

**Interfaces:**

- `commitVersion`'s `scanVerdict` input widens to `"unscanned" | "clean" | "flagged"`; a `"flagged"` commit sets `file_version.scan_verdict = "flagged"`, `status = "clean"` (committed + accessible-per-treatment), and still populates the scan cache from `rawScanResult` (the engine-version-keyed dedup, unchanged). A flagged commit is audited (`file.version_committed` with the flagged reason in metadata — redact-by-default: reason only).

- [ ] **Step 1: Write the failing test** — commit a version with `scanVerdict: "flagged"`; assert the row has `scan_verdict='flagged'`, `status='clean'`, the cache is populated, and an audit row exists carrying the reason (not content).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — widen the `CommitVersionInput.scanVerdict` union; ensure the `flagged` value flows to the column; confirm `status` stays `clean` (a flagged-but-committed version is downloadable subject to the access-time treatment gate). Keep the engine-version single-source (Slice A) intact.
- [ ] **Step 4: Run to verify pass** — `pnpm --filter @magna-carta/file-manager run test file-service` → PASS.
- [ ] **Step 5: Commit.**

---

## Task 5: ingest-consumer — resolve + thread firm policy/treatment

**Files:**

- Modify: `apps/worker/src/files/ingest-consumer.ts`
- Test: `apps/worker/test/ingest-consumer.test.ts`

**Interfaces:**

- Consumes: `readFirmScanPolicy`, `readFlaggedTreatment` (scan-policy-settings.ts).
- `handleIngestMessage`: alongside the existing `readUploadPolicy` / `readInspectableSizeCap` `Promise.all` (~lines 90-106), resolve `readFirmScanPolicy(firmDatabase)` + `readFlaggedTreatment(firmDatabase)` and pass `scanPolicy` + `flaggedTreatment` into `runIngest`.
- `handleRescanMessage` (~line 243): resolve the firm policy before `computeVerdict` and pass it; the rescan recompute now uses the firm's policy. (Rescan treatment for an already-committed re-flagged file: set `scan_verdict='flagged'`; the access gate applies the treatment — no quarantine of an already-committed version.)

- [ ] **Step 1: Write the failing test** — with a firm setting `scan.flagged_treatment = "informed-access"`, an infected upload COMMITS as flagged (not quarantined); with the default (unset → block), it quarantines. Use the existing consumer harness (writes a setting row, runs the message).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — add the two reads + thread them through both handlers.
- [ ] **Step 4: Run to verify pass** — `vp test run ingest-consumer` (run alone — Miniflare). PASS.
- [ ] **Step 5: Commit.**

---

## Task 6: download + preview — treatment-aware access gate

**Files:**

- Modify: `apps/worker/src/routes/files/files.ts` (download ~728-739, preview ~782-846)
- Modify: `packages/file-manager/src/preview-policy.ts`
- Test: `apps/worker/test/` download/preview tests (find the existing files-route test)

**Interfaces:**

- Consumes: `readFlaggedTreatment`, `readStepUpReauthOnFlagged`.
- Download handler: for a `scanVerdict === "flagged"` version, resolve `readFlaggedTreatment(firm.firmDatabase)`:
  - `informed-access` → today's gate: 409 `malware-flagged` unless `acknowledgeMalware=true`; the acknowledged download is audited (`file.downloaded_malware_acknowledged`).
  - `allow-and-flag` → serve it; audit `file.downloaded` with a `flagged: true` metadata marker (so the access is recorded). No 409.
  - `block` → a blocked file is `status: "quarantined"`, which the download route already refuses (it serves committed versions only) — assert this path returns not-found/forbidden as today; no flagged version with `block` should be committed (Task 3), so this is defensive.
  - **Step-up seam:** if `informed-access` AND `readStepUpReauthOnFlagged(db)` is true, the acknowledged download additionally requires a recent step-up — **the challenge is built in a later auth slice**; for now resolve the flag and, when true, include it in the 409/response metadata (`stepUpRequired: true`) so the client/UI is forewarned, but do NOT block on it (no mechanism yet). State this inline as a forward seam.
- Preview: `decidePreview` already downgrades a non-clean verdict to `download-only`; ensure `"flagged"` is treated as the old `"infected"` (download-only), so a flagged version never previews inline regardless of treatment.

- [ ] **Step 1: Write the failing test** — (a) flagged version + firm treatment `informed-access` → 409 without ack, 200 + audit with ack; (b) flagged version + `allow-and-flag` → 200 without ack + audit `flagged:true`; (c) preview of a flagged version → download-only.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the treatment branch + the preview-policy flagged handling + the step-up seam metadata.
- [ ] **Step 4: Run to verify pass** — run the files-route test alone. PASS.
- [ ] **Step 5: Commit.**

---

## Task 7: write API + permission — `GET`/`PATCH /api/v1/firm/scan-policy`

**Files:**

- Create: `apps/worker/src/routes/firm/scan-policy.ts`
- Modify: the route registry (where routes mount in `apps/worker/src/app.ts`), `packages/access-control/src/registry.ts`
- Create: `packages/database/drizzle/per-firm/00NN_seed-scan-policy-permission.sql` (seed `firm:manageScanPolicy` to Owner/Admin roles) + wire in `per-firm-migrations.ts`
- Test: `apps/worker/test/scan-policy.test.ts`

**Interfaces:**

- Consumes: `scanPolicyDefinition`, `flaggedTreatmentDefinition`, `stepUpReauthDefinition`, `writeFirmSettingStatement`, the read helpers.
- `GET /api/v1/firm/scan-policy` → `{ policy: ScanPolicy, flaggedTreatment, stepUpReauthOnFlagged }` (resolved, with defaults). Permission `firm:manageScanPolicy` (read also allowed to admins; reuse the read-side permission pattern of a firm-settings route).
- `PATCH /api/v1/firm/scan-policy` → accepts a partial `{ policy?, flaggedTreatment?, stepUpReauthOnFlagged? }`, validates each through its definition's schema, writes via `writeFirmSettingStatement`, audits `firm.scan_policy_updated` (redact-by-default: the new values are policy, not content). Mutating → needs the permission + `audited: true` (conformance fitness functions require a non-null permission + audited for a mutating POST/PATCH — Slice A hit this; follow the `firm:scanFile` precedent).

- [ ] **Step 1: Write the failing test** — `GET` returns defaults for a fresh firm; `PATCH {flaggedTreatment:"informed-access"}` then `GET` reflects it; `PATCH` with an invalid tier → 422; without the permission → 403.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the route (zod-openapi, matching an existing settings/route's shape), add the permission to the registry, add+wire the seed migration, regenerate the OpenAPI snapshot + api-client (the repo's `vp run` contract step — check how other route additions regenerate it).
- [ ] **Step 4: Run to verify pass** — `vp test run scan-policy` + the conformance/openapi tests. PASS.
- [ ] **Step 5: Commit.**

---

## Task 8: docs + final gate

**Files:** `changelog.d/scan-firm-policy-backend.md`, `docs/decisions/pending/scan-firm-policy.md` (decision: per-firm tier/floor + treatment, applied via the scoped-setting resolver, treatment generalizing the informed-access gate, step-up deferred), `STATUS.md` (scan slice row only), `apps/worker`/`packages/file-manager` area `CLAUDE.md` (document the new firm settings + the treatment-at-access behaviour + the persisted `flagged` verdict).

- [ ] **Step 1:** add the fragments + STATUS row + area CLAUDE.md notes.
- [ ] **Step 2:** run the whole gate — `pnpm check`, `node tooling/lint-process-references.mjs`, and the scan/ingest/download/scan-policy test files individually (full Miniflare suite OOMs). Expected: clean/green for the touched surface.
- [ ] **Step 3: Commit** (explicit adds).

---

## Notes / deferred seams (state these when handing off)

- **Step-up re-auth enforcement is deferred.** B1 stores + reads `scan.step_up_reauth_on_flagged` and surfaces `stepUpRequired` metadata, but the actual recent-auth challenge needs a session-age / re-verify mechanism that does not exist yet (greenfield, Better Auth). A dedicated auth slice builds the challenge; until then the flag is advisory.
- **The `_SUSP_` score histogram is log-only** in `build-yara-rules`. B2's custom-floor slider needs it surfaced (bake a JSON file into the image + expose via the scan service, or embed a build-time constant). Recorded for B2; B1 accepts any integer floor 0–100.
- **Matter/client overrides** are out of scope — B1 stores the policy firm-flat; the scoped-setting resolver leaves per-matter override as a future no-migration seam.

## Self-Review

**Spec coverage:** firm tier/floor setting (T1) ✓; flagged treatment setting (T1) ✓; step-up setting stored, challenge deferred (T1, T6, notes) ✓; per-firm verdict at ingest (T3, T5) + rescan (T5) ✓; treatment at ingest — block/informed-access/allow-and-flag (T3) ✓; treatment at access — download gate + preview (T6) ✓; one flagged state persisted (`scanVerdict: "flagged"`, T2) ✓; write API + permission (T7) ✓; behaviour-preservation at defaults (T3/T5/T6 tests assert block+default == today) ✓; never-silently-clean (T3 fault test) ✓. **Out of scope by design:** UI (B2), histogram surfacing (B2), step-up challenge (later auth slice), matter overrides.

**Placeholder scan:** the migration number (`00NN`) and the exact OpenAPI-regen command are the two "confirm against the repo" points (the implementer reads the journal head + the repo's generate script) — every code step otherwise carries real code; no TBDs.

**Type consistency:** `FlaggedTreatment` (block/informed-access/allow-and-flag), `ScanPolicy` (tier core|extended|full × suspiciousScoreFloor), `scanVerdict: "flagged"`, the three setting keys (`scan.policy`/`scan.flagged_treatment`/`scan.step_up_reauth_on_flagged`), and `readFirmScanPolicy`/`readFlaggedTreatment`/`readStepUpReauthOnFlagged` are consistent T1↔T3↔T5↔T6↔T7.
