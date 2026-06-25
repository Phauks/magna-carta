---
branch: scan-per-firm-policy
worktree: C:/dev/magna-carta-worktrees/scan-per-firm-policy
area: Per-firm scan policy — firm-selectable YARA tier/score + firm-chosen treatment of flagged files
status: designing
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
