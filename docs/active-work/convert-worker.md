# convert-worker — active work

**Branch:** `convert-worker` (off `main`). **Area:** File conversion — the dedicated engine worker (slice 2·4c).

**Scope.** Build `apps/convert-worker` (`magna-carta-convert`): a stateless, no-public-surface worker
reached only via a service binding from the app worker, owning the conversion engine Container(s).
Mirrors `apps/scan-worker` (the Container-subsystem-extraction pattern). Plus the app-worker seam: a
`CONVERT` service binding and `resolveEnginePort` returning a service-binding `ConversionPort` adapter
(restores the adapter removed in the 2·4b realignment, now pointed at the binding).

**Out of scope (deferred):** the `containers/convert/` Dockerfile + in-container libvips HTTP service
(a Rust/axum service like `containers/scan`, deploy-time/heavy); the LibreOffice/FFmpeg engine
Containers; the conversion UI (0·7a).

**Files I expect to touch:**
- `apps/convert-worker/**` (new app — index, forward-convert proxy, LibvipsContainer DO, warm cron,
  wrangler/package/tsconfig/vitest/worker-env, tests)
- `apps/worker/src/conversions/conversion-engine.ts` (resolveEnginePort → service-binding adapter)
- `apps/worker/src/app.ts` (the `CONVERT` binding in `Bindings`)
- `apps/worker/wrangler.jsonc` (the `services` block)
- `pnpm-workspace.yaml` / root (register the new app, if needed)
- `docs/specs/2026-06-23-slice-2-4c-convert-worker-*.md`, `docs/decisions/pending/container-subsystems-dedicated-workers.md`,
  `changelog.d/`, STATUS.md (my row only)

**Cross-cutting heads-up:** the ADR `container-subsystems-dedicated-workers` is a shared family
decision (scan + editing 2·2 + PDF-engine); coordinate before others edit it.
