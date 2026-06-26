---
branch: scan-firm-policy-settings
worktree: C:/dev/magna-carta-worktrees/scan-firm-policy-settings
area: Per-firm scan policy Slice B — firm-scoped scan-policy settings + per-firm verdict + flagged-file treatment (+ UI)
status: planning
touches: packages/file-manager (verdict, ingest-core, safe-delivery/preview-policy), apps/worker (ingest-consumer, download/preview routes, firm-settings routes), packages/database (per-firm migration + scoped settings), the design-system firm-settings UI, STATUS.md, ROADMAP.md, docs/specs, docs/decisions/pending, changelog.d
---

Slice B builds the firm-facing half of per-firm scan policy on the Slice-A substrate (now on main:
container returns `RawScanResult`, app-side `computeVerdict(raw, policy)`, raw `scan_cache`). Design is
settled in `docs/specs/2026-06-25-scan-per-firm-policy-design.md`:
- **Two dials** `scanTier ∈ core|extended|full` × `suspiciousScoreFloor` (gates only the `_SUSP_` pocket),
  with the 6 presets + a custom floor; firm-scoped settings reusing the time-tracking scoped-setting resolver.
  Defaults: `extended / 75 / block / off`.
- **One `flagged` state** (reason shown); **treatment menu** `block | informed-access (± step-up re-auth) |
  allow-and-flag` applied uniformly at **ingest AND access**; always audited; no reject/delete; no hard floor.
- Per-firm verdict: thread the firm's policy into `computeVerdict` at ingest + the rescan/access recompute.
- UI: firm-settings page (preset menu + custom floor slider bounded by the `_SUSP_` score histogram).

Builds as **B1 (backend rails)** then **B2 (UI)**. Touches the merged ingest path + the safe-delivery
download/preview gate (slice 2·3) — sync first if you work file ingest, the download gate, or firm settings.
Slice-A pre-push CI gates (linux cfg(unix) build + full Miniflare suite) are logged in ROADMAP "Deferred —
operational setup".
