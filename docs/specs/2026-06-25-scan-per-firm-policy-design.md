# Per-firm scan policy — design

**Date:** 2026-06-25 · **Branch:** `scan-per-firm-policy` · **Status:** designing (spec for review)

## Problem

The malware scanner has two behaviours that are currently **hard-coded** but should be **firm
decisions**:

1. **Which YARA rules apply.** The image bakes one tier (`YARA_FORGE_TIER=extended`, FP-filtered) for
   every firm. Different firms want different precision/coverage trade-offs — a high-FP-tolerance firm
   may want `full`, a conservative one `core`, and some want to tune the heuristic-suspicious cutoff
   directly.
2. **What happens to a flagged file.** Today every flagged file is quarantined at upload and gated
   behind informed-access post-commit — fixed, identical for all firms. A firm should choose how its
   own flagged files are treated.

Both must change **without** weakening the engine's correctness invariants (never silently clean,
informed access, per-firm dedup, redact-by-default) and without losing cross-firm content dedup.

## Current state (what we build on)

- The scan Container (`containers/scan`) runs **clamd + yara-x + structural heuristics** and today
  returns a decided `ScanResult` (`clean | infected | suspicious | unscanned`). Engines run
  **sequentially** — clamd `await`s first, then yara/heuristics in `spawn_blocking`.
- `build-yara-rules` + `forge.rs` fetch one YARA Forge tier at image build, **drop** the FP-prone
  `_SUSP_` pocket below score 75, compile with yara-x, and bake a serialized blob.
- `scan_cache` (per-firm content dedup) keys `(content_sha256, engineVersion)` → a decided verdict.
- `ingest-core.ts` quarantines a `infected`/`suspicious` upload; committed files later flagged by
  re-scan are gated behind informed access (the `malware-flagged` 409).
- The container is **multi-tenant** (one shared `magna-carta-scan` worker, one `ScanContainer`,
  `enableInternet = false`, a single global `engineVersion`). There is no per-firm dimension anywhere
  in the scan path.
- A **scoped-setting resolver** already exists (built for time-tracking) — the intended home for the
  new policy values (exact firm-scope wiring confirmed in the plan).

## Decisions (settled in brainstorming)

- **Scan-all, gate-after.** Bake the _full_ corpus and decide per-firm at verdict time, rather than
  scanning a per-firm subset. Confirmed acceptable because extended≈10k and full≈11k rules (~10% more)
  and, once engines run concurrently, the yara scan hides under clamd's ~15 MiB/s floor.
- **Concurrency over corpus-restriction.** Running only a firm's subset would require separately
  compiled rulesets (yara-x evaluates every rule in a compiled set; the dominant atom-matching cost is
  not skipped by condition gating) — which cannot express a continuous custom score floor. Instead run
  clamd ∥ yara so the full corpus is effectively free.
- **Custom score dial = suspicious-pocket only (dial a).** The firm-tunable floor gates **only** the
  `_SUSP_` heuristic pocket; high-confidence rules always count. A firm can never silence real malware
  detection — only tune heuristic noise. Rejected the global-severity-floor alternative as a footgun.
- **One flagged state.** No infected-vs-suspicious policy split. The severity is carried as **reason
  text** the user sees; the firm treatment menu applies to any flag.
- **Treatment menu = block / informed-access (± step-up) / allow-and-flag.** No reject/delete option.
- **No hard floor.** Even a freshly-uploaded high-confidence infected file obeys the firm's treatment
  policy (a firm may allow-and-flag it). The audit floor and never-silently-clean still hold.

## Architecture

### Two dials, presets on top

A firm's rule policy is `(scanTier, suspiciousScoreFloor)`. The six menu items are presets:

| Preset             | scanTier | suspiciousScoreFloor |
| ------------------ | -------- | -------------------- |
| core               | core     | (curated)            |
| extended (curated) | extended | 75                   |
| extended           | extended | 0 (off)              |
| full (curated)     | full     | 75                   |
| full               | full     | 0 (off)              |
| custom             | any      | firm-chosen          |

"Curated vs raw" is just two presets of the floor; custom exposes the floor directly. The firm UI
bounds the custom range to where the `_SUSP_` score histogram is meaningful (emitted by
`build-yara-rules`), not a misleading 0–100.

### Engine / container changes (`containers/scan`)

- **`forge.rs` becomes a tagger, not a filter.** Bake the **full** corpus; record for every rule
  `{tier ∈ core|extended|full, score, isSuspicious}`. Tier membership is computed at build by fetching
  all three Forge packages and diffing rule identifiers (nested: core ⊂ extended ⊂ full) — robust, no
  dependence on an internal meta field. No rules are dropped at build time.
- **`build-yara-rules`** bakes the full compiled blob **plus** a side map `ruleId → {tier, score,
  isSuspicious}`, and emits the `_SUSP_` score histogram for the UI range.
- **`Dockerfile`** fetches all three tier packages (still build-time only; `enableInternet = false`
  unchanged) and resolves the same `yara-rules/<tag>` engine-version component.
- **Concurrent engines** in `lib.rs`: `tokio::join!` the clamd scan with the yara `spawn_blocking`
  instead of sequencing them. Emit **per-engine timing** in the response and feed it to the
  load-profile harness so we can prove yara never overtakes clamd (golden rule 10); only then would
  per-tier compiled blobs be reconsidered as a measured optimization.
- **The container returns enriched raw matches, not a verdict.** The response carries the clamd verdict
  (clean / a named signature / unavailable), the structural-heuristic flags, and **per matched yara
  rule** `{ruleId, tier, score, isSuspicious}`. The container no longer decides infected/suspicious —
  it reports facts; the app decides per-firm. `verdict.rs`'s `combine` moves app-side (see below);
  the container keeps only the never-silently-clean fault signalling (a clamd-unavailable with no other
  signal is still a retryable 503, never a verdict).

### Contract + cache

- **`MalwareScanPort` / `scan-port.ts`** change from returning a decided `ScanResult` to returning the
  **raw result** (clamd verdict + enriched matches + heuristic flags + engineVersion + per-engine
  timing). This is the most invasive change — it edits the merged, reviewed Rust⇄TS boundary.
- **`scan_cache`** stores the **raw result** keyed `(content_sha256, engineVersion)`. Dedup stays
  global and firm-agnostic; the per-firm verdict is derived from the cached raw result, so a firm
  policy change re-evaluates instantly with **no container re-scan**.

### Per-firm verdict (app-side)

A pure function `verdict(rawResult, firmPolicy) → clean | flagged | unscanned` with the flag **reason**
(clamd signature name, yara rule id, or structural reason) as text:

- A clamd signature → flagged.
- A matched yara rule **counts** iff its `tier` is within the firm's `scanTier` **and** (`!isSuspicious`
  || `score ≥ suspiciousScoreFloor`). Any counting match → flagged.
- A structural attack (bomb / nesting / entry-count) → flagged.
- Encrypted/uninspectable → unscanned (honest, not a fault).
- A clamd-unavailable with no other signal → throw/retry (**never** a fabricated clean).

### Flagged-file treatment

Firm setting `flaggedTreatment ∈ block | informed-access | allow-and-flag`, applied **uniformly** at
both ingest and access:

- **block** — quarantined, inaccessible (today's upload behaviour).
- **informed-access** — committed but the raw download/preview is gated behind the acknowledgment
  (`malware-flagged` 409); if `stepUpReauthOnFlagged` is on, an additional re-authentication is
  required before serving.
- **allow-and-flag** — committed and served, visibly marked in the UI.

Two non-negotiable floors regardless of choice: **every flagged file is always audited** (flag,
reason, actor, action — redact-by-default, verdict only, never content/name), and a scan **fault** is
always a retry, never a flagged/clean fabrication.

### Triggers that (re-)evaluate

Upload, restore-a-previous-version, the nightly clamd/YARA update (engineVersion change), a firm policy
change, and any open/download/preview all funnel into the evaluate core. A **policy change** re-filters
the cached raw match set (cheap, no re-scan); an **engineVersion change** forces a re-scan via the
existing staleness gate.

## Firm-scoped settings (new)

Four values resolved through the existing scoped-setting resolver (firm scope):

- `scanTier` — `core | extended | full` (default `extended`)
- `suspiciousScoreFloor` — integer (default `75`)
- `flaggedTreatment` — `block | informed-access | allow-and-flag` (default `block`)
- `stepUpReauthOnFlagged` — boolean (default `false`)

**Default for a new firm:** `extended / 75 / block / false` — the safest equivalent of today's
behaviour (curated extended, quarantine flagged). Firms opt _into_ more access, never silently into
less safety.

## Invariants preserved

- **Never silently clean** — a scan fault/timeout/missing-engine is still a retryable throw; the
  container still fails loud, and the app verdict never fabricates clean from a fault.
- **Informed access** — committed-but-flagged files remain accessible only behind acknowledgment (+
  optional step-up); no data loss.
- **Per-firm content dedup** — the cached raw result is firm-agnostic, so dedup stays global; only the
  cheap verdict is per-firm.
- **Redact-by-default** — telemetry/audit carry the verdict + reason only, never file content or name.
- **Zero runtime egress** — the container still bakes everything at build; `enableInternet = false`.

## Sensitive areas (high review bar)

- **`ingest-core.ts`** must branch on firm treatment instead of always quarantining a flagged upload —
  a deliberate change to carefully-reviewed code. Full pre-merge adversarial review.
- **Contract + cache reshape** touch the merged scan path; the worker integration + Rust tests must be
  green and the `magna-carta-scan` test stub updated to the raw shape.
- **Performance** — the concurrency win is gated behind the per-engine timing instrumentation, not
  assumed.

## Build sequencing

- **Slice A — engine substrate.** `forge.rs` tagger; fetch all three tiers; concurrent engines +
  timing; enriched raw match output; move `combine` app-side; `MalwareScanPort` + `scan_cache` raw
  reshape; update the test stub. Ships with the per-firm verdict defaulting to today's behaviour
  (extended/75) so it is a no-behaviour-change refactor end-to-end.
- **Slice B — firm policy.** The four firm-scoped settings + resolver wiring; per-firm verdict from the
  cached raw result; treatment at ingest and access; policy-change re-evaluation; firm-settings UI
  (presets + custom floor slider bounded by the histogram); docs/ADRs.

A precedes B (B needs A's raw contract and app-side verdict).

## Forward note

**Restore-from-version** is not built yet. When it lands it must re-enter the evaluate core as a
first-class trigger (re-evaluate staleness and enqueue a scan at restore time), not rely on lazy
access-time staleness — otherwise a restored old version could sit accessible with a stale/unscanned
verdict. Recorded here so it is not missed.

## Testing

- **Rust:** `forge.rs` tier-tagging (core/extended/full membership from the three-package diff);
  build-bin histogram + side-map emission; concurrent-engine equivalence (same matches as sequential)
  - timing present; enriched raw output shape; fault still 503.
- **App:** `verdict()` truth table across tier × floor × match kinds (clamd sig, high-confidence rule,
  suspicious-above/below floor, structural, encrypted, fault); cache stores/reads the raw shape; dedup
  unaffected; a policy change re-evaluates without a re-scan.
- **Ingest/access:** each treatment at upload and at access (block/informed-access ± step-up/
  allow-and-flag); always-audited floor; never-silently-clean on fault.
- **Load profile:** per-engine timing recorded; assert yara ≤ clamd on the corpus fixtures.
