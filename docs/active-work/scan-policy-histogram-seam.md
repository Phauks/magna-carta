# scan-policy-histogram-seam

**Scope:** Surface the malware scanner's `_SUSP_` score histogram from build-log-only to a runtime API,
so the future firm scan-policy custom-floor slider (Slice B2 UI) has a data source. The B2 Svelte UI
itself stays deferred — it is blocked on the design system (slice 0·7a/0·7b, not yet on main).

**Files expected to touch:**

- `containers/scan/src/yara.rs` (or a new small module) — shared `_SUSP_` score-histogram function.
- `containers/scan/src/bin/build-yara-rules.rs` — reuse the shared fn for the summary log.
- `containers/scan/src/lib.rs` + `src/main.rs` — compute the histogram at boot from the loaded
  side-map, store in `AppState`, add `GET /rules/score-histogram`.
- `apps/scan-worker/src/*` — forward the new endpoint over the service binding.
- `apps/worker/src/routes/scan-diagnose.ts` or a new route module — `GET /api/v1/firm/scan-policy/score-histogram`.
- `apps/worker/openapi/openapi.json` + `packages/api-client/src/*` (regenerated).
- Tests in `containers/scan` + `apps/worker/test`.
- `changelog.d/` fragment, `STATUS.md` (own row only).

Design: `docs/specs/2026-06-28-scan-policy-histogram-seam-design.md`.
