# Scan-policy `_SUSP_` score-histogram seam — design

**Date:** 2026-06-28
**Status:** Approved (design); implementation pending.

## Context

The malware scanner's per-firm policy (Slice B1, merged) lets a firm set a `suspiciousScoreFloor`:
heuristic `_SUSP_` YARA rules whose score is below the floor do not flag a file. The future firm-settings
UI (Slice B2) exposes a custom-floor slider, and to be meaningful the slider must show the **distribution
of `_SUSP_` rule scores** in the baked corpus — "set the floor here and you admit N more rules." That
distribution (a 5-point-bucket histogram) is computed today only at image-build time in
`build-yara-rules.rs` and `println!`'d to the build log — it is not retrievable at runtime. This seam
surfaces it through a runtime API.

The B2 Svelte UI is **out of scope**: it is blocked on the design system (`@magna-carta/design-system`,
slice 0·7a/0·7b), which is not yet on `main`. This seam builds only the data path the UI will later
consume, so the UI work needs no engine/container retrofit when it lands.

## Non-goals

- The B2 settings page / slider component (deferred to the design system).
- Per-firm histogram variation — the histogram is a property of the baked corpus (the engine version),
  identical for every firm.
- Re-tiering by `tier` in the histogram — the slider gates only the `_SUSP_` score floor; the histogram
  counts suspicious rules by score, matching what the floor actually gates.

## Design

### 1. Shared histogram function (`containers/scan`)

The side-map already loaded at boot — `SideMap = HashMap<String, RuleMeta { tier, score, is_suspicious }>`
— carries every rule's score and suspicious flag, the same data `build-yara-rules`'s summary iterates.
Extract the bucket logic (`bucket = (score / 5) * 5`, count suspicious rules per bucket, ascending) into
one function over an iterator of `RuleMeta` (or the `SideMap`). `build-yara-rules.rs`'s summary log and
the runtime endpoint both call it, so the log and the API can never drift.

### 2. Runtime computation + endpoint (`containers/scan`)

At boot (`main.rs`), compute the histogram once from the loaded side-map and store it in `AppState`
(it is fixed for the instance's lifetime — the side-map does not change). Add a route to `lib.rs`:

```
GET /rules/score-histogram  ->  200
{
  "engineVersion": "<compose_engine_version>",
  "minScoreGate": 75,            // the build-time default floor, for reference
  "total": <suspicious rule count>,
  "buckets": [ { "floor": 40, "count": 3 }, { "floor": 45, "count": 7 }, ... ]  // 5-pt, ascending
}
```

Buckets contain only non-empty buckets (the build log already prints only populated buckets). A corpus
with no `_SUSP_` rules returns `total: 0, buckets: []`.

### 3. scan-worker forward (`apps/scan-worker`)

The main worker reaches the scan container through the `SCAN` service binding fronting `ScanContainer`.
Add a forward for `GET /rules/score-histogram` mirroring the existing scan forward, so the histogram is
reachable over the same trust boundary as a scan.

### 4. Firm-facing worker route (`apps/worker`)

```
GET /api/v1/firm/scan-policy/score-histogram
```

- `permission: "firm:manageScanPolicy"` (the slider lives behind the same gate as the policy itself),
  `resource: "firm"`, `authenticated: true`, `audited: false`, `rateLimit: "default"`.
- Resolves the scan service via the binding and returns its histogram JSON.
- **No engine deployed** (every local/test env — `resolveScanPort` is engine-less, the `SCAN` binding is
  absent or returns no engine): return `{ "engineVersion": null, "total": 0, "buckets": [] }` at **200**,
  so the future slider renders unbounded/disabled rather than surfacing an error. A genuine engine fault
  (deployed but unreachable) follows the standard redacted error path, not a fabricated empty.
- Regenerate the OpenAPI snapshot + api-client.

### 5. Data shape (TS contract)

```ts
interface ScoreHistogramBucket { floor: number; count: number }
interface ScoreHistogramResponse {
  engineVersion: string | null;       // null = no engine deployed
  minScoreGate: number | null;        // null when engineVersion is null
  total: number;
  buckets: ScoreHistogramBucket[];
}
```

## Testing

- **Rust (cargo):** the shared histogram fn over a synthetic side-map (correct buckets, ascending,
  suspicious-only, empty-corpus case); the `/rules/score-histogram` route returns the boot-computed value.
- **Worker (Miniflare):** the no-engine path returns 200 with the empty shape; the route is gated
  (403 without `firm:manageScanPolicy`). The live-engine path is CI/deploy-gated, consistent with all
  scan-engine work (the local pool has no container).
- **OpenAPI snapshot** stays in sync (conformance test).

## Deploy gating

Like the rest of the scan engine, the live histogram only returns real data once the scan container image
is built and the `SCAN` binding is wired in production; until then the worker route returns the
no-engine empty shape. No migration, no schema change, no firm data.
