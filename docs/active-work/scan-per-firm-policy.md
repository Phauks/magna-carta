---
branch: scan-per-firm-policy
worktree: C:/dev/magna-carta-worktrees/scan-per-firm-policy
area: Per-firm scan policy — firm-selectable YARA tier/score + firm-chosen treatment of flagged files
status: building
touches: containers/scan, packages/file-manager (scan-port, scan-cache, ingest-core), apps/worker (scan routes, firm-settings), packages/database (per-firm migration + firm-scoped settings), the design-system firm-settings UI, STATUS.md, ROADMAP.md, docs/specs, docs/decisions/pending, changelog.d
---

Makes the malware scanner's two fixed behaviors firm-configurable. (1) **Tier/score selection** —
bake the _full_ YARA Forge corpus, tag every rule `{tier, score, isSuspicious}`, scan once, and apply
each firm's `(tier × suspicious-score floor)` policy at verdict time (presets core/extended/full ×
curated/raw, plus a custom floor). The container stops deciding infected/suspicious and returns the
_raw_ enriched match set; the per-firm verdict is computed app-side from cache, so a policy change
re-evaluates with no container re-scan and cross-firm content dedup stays global. (2) **Flagged-file
treatment** — one `flagged` state (reason shown), one firm-chosen treatment menu (block /
informed-access ± step-up re-auth / allow-and-flag) applied uniformly at ingest _and_ access; always
audited, never silently cleaned.

Heads-up for concurrent streams: this **edits the merged, reviewed scan path** — `containers/scan`
(forge.rs, yara.rs, lib.rs, main.rs, verdict.rs, Dockerfile, build-yara-rules.rs), the
`MalwareScanPort` contract + `scan_cache` shape, and **`ingest-core.ts`** (treatment branch). If you
touch the scan engine, file ingest, or firm settings, sync with me first. Builds in two slices:
**A** = engine substrate (tagger + concurrent engines + enriched raw contract + cache reshape);
**B** = firm policy settings + per-firm verdict + treatment at ingest/access + UI. A precedes B.

**Slice A (engine substrate) is complete.** The Container returns `RawScanResult` (raw.rs); the full
corpus is baked + tagged `{tier, score, isSuspicious}`; `combine()`/`verdict.rs` is gone. The app side
is wired end-to-end: `computeVerdict`/`DEFAULT_SCAN_POLICY`/`ScanFaultError` (verdict.ts), the raw-result
`scan_cache` (migration `0022_raw_scan_cache`), ingest decides app-side (ingest-core.ts), and the worker
adapter/consumer/diagnostic route + the test stub consume the raw facts. The scan_cache key and the
committed `scan_engine_version` now both derive from `raw.engineVersion`, so a clean ingest commit
repopulates the cache (scan-once dedup live again). Scan-related worker + file-manager suites green;
`cargo clippy -p magna-carta-scan -- -D warnings` clean. **Next: Slice B** (firm-scoped scan-policy
settings + per-firm verdict + treatment menu at ingest/access + UI).
