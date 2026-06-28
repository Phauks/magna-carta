---
number: 158
slug: scan-firm-policy
status: Accepted
date: 2026-06-27
area: Untrusted-file pipeline / Malware scanning
summary: Per-firm scan-policy settings (tier + suspiciousScoreFloor compound, flagged-file treatment, step-up re-auth flag) stored in the generic setting table; computeVerdict applies the resolved policy at ingest and rescan; a treatment menu (block/informed-access/allow-and-flag) is enforced at both ingest and access; one persisted flagged verdict replaces the prior infected/suspicious distinction; step-up re-auth enforcement is deferred to a future auth slice.
---

**Per-firm scan-policy settings and flagged-file treatment (Slice B1).**

**Context:** the raw-facts substrate (Slice A) moved the per-firm verdict decision out of the Container and into `computeVerdict(raw, policy)` in the application, parameterised on a `ScanPolicy`. Before Slice B1 that policy was always the hard-coded default (`{ tier: "extended", suspiciousScoreFloor: 75 }`). Additionally, the safe-delivery slice (2·3) introduced an informed-access gate, but only for files already committed with the now-retired `suspicious` verdict — making the gate verdict-specific and impossible to generalise. Two capabilities were missing: (a) firms cannot tune how aggressively files are flagged; (b) the response to a flagged file at ingest and at access is fixed to quarantine, with no operator-configurable alternatives.

**Decision:** three firm-level settings are introduced, stored in the existing `setting` table via the `FirmSettingDefinition` mechanism (no per-firm schema migration — a missing row is the in-code default):

- **`scan.policy`** — a compound JSON value `{ tier: "core"|"extended"|"full", suspiciousScoreFloor: 0–100 }`. `tier` controls which YARA rules are eligible (core only, extended, or full corpus); `suspiciousScoreFloor` is the minimum score a heuristic `_SUSP_` rule must reach before it counts as a hit. Default: `{ tier: "extended", suspiciousScoreFloor: 75 }` — identical to the prior hard-coded value, so no behaviour change at defaults.
- **`scan.flagged_treatment`** — `"block"` (quarantine at ingest, gate at access) | `"informed-access"` (commit at ingest with `scanVerdict: "flagged"`, warn at access + require acknowledgement) | `"allow-and-flag"` (commit at ingest with `scanVerdict: "flagged"`, serve at access with a banner). Default: `"block"`.
- **`scan.step_up_reauth_on_flagged`** — boolean; when true, the `informed-access` treatment additionally surfaces `stepUpRequired: true` in the 409 access response. Default: `false`.

**Treatment is enforced at two chokepoints.** At ingest, `computeVerdict` applies the resolved tier/floor to the raw container facts; a `flagged` result is then routed by `flaggedTreatment`: `block` quarantines (the prior behaviour), `informed-access` and `allow-and-flag` commit the version with `scanVerdict: "flagged"` so the file is committed but access-gated. At access (download/preview, `downloads.ts`), the treatment is re-read at request time, so a policy change takes effect on the next request without re-ingesting.

**One persisted `flagged` verdict.** Slice A collapsed the four prior verdicts (`infected`/`suspicious`) into one `scan-flagged` quarantine state. Slice B1 continues that simplification: the `file_version` column stores one state — `scanVerdict: "flagged"` — regardless of whether the file is quarantined (`block`) or committed (`informed-access`/`allow-and-flag`). The treatment governs access behaviour; the quarantine status (`status` column) governs whether the version is servable. The full raw engine result survives in `scan_cache`, so the persistence state is stable across schema changes.

**Step-up re-auth enforcement is deferred.** The setting is stored and `stepUpRequired: true` is surfaced in the 409 access response, but the actual session-age / re-verify challenge requires session-age inspection and a re-verify flow that does not exist yet (the auth layer is greenfield). A dedicated auth slice builds the challenge; until then the flag is advisory.

**API.** `GET /api/v1/firm/scan-policy` returns the resolved three settings. `PATCH /api/v1/firm/scan-policy` writes them. Both require the `firm:manageScanPolicy` permission (Owner + Admin), seeded in migration `0025_seed-scan-policy-permission`. Reading the policy requires no special permission — `readFirmScanPolicy`/`readFlaggedTreatment`/`readStepUpReauthOnFlagged` are internal helpers called from the ingest consumer and the download gate.

**Considered and rejected.** Storing tier and suspiciousScoreFloor as two separate setting keys (rejected — they are always read together and a compound JSON value is one resolved row). Per-matter or per-client scan-policy overrides (deferred — the scoped-setting resolver leaves the matter/client tiers as a future no-migration seam; B1 stores the policy firm-flat). Surfacing the `_SUSP_` score histogram to inform the floor slider (deferred to B2 — B1 accepts any integer floor 0–100).

**Consequences:** `computeVerdict` gains a second argument; the ingest consumer and rescan path call `readFirmScanPolicy` before invoking it. The download/preview gate calls `readFlaggedTreatment` at access time. Default behaviour is preserved exactly — `extended/75/block/off` matches the prior hard-coded path in every test and in production. The B2 slice (UI for these settings + the floor histogram) builds on this backend rail with no schema change.
