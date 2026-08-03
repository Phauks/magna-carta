---
category: Fixed
---

- **The CI gate now runs every test suite it claimed to run.** Three coverage holes closed: (1) the
  seven standalone workers (`apps/bundle-worker`, `apps/convert-worker`, `apps/file-repair-worker`,
  `apps/magna-carta-edit`, `apps/ocr-worker`, `apps/recovery-worker`, `apps/scan-worker`) had vitest
  suites that ran nowhere — their configs were never registered in the root `test.projects` list, so
  root `vp test` and the gate both walked past them; they are now registered and run in `test-node`.
  (2) The container Cargo workspaces' unit/integration tests (scan heuristics, bundle encoders,
  recovery shard) ran nowhere — `rust-check` covers only `crates/`; the `containers` job now runs
  `cargo test` for each changed container workspace, with a cargo cache. (3) A changed container with
  no acceptance mapping passed the `containers` job green having tested nothing; an unmapped container
  now fails the job unless explicitly listed as not-yet-covered (collabora, file-repair, ocr, raster —
  each flagged with a warning on every run that touches it).
- **Scan-container integration tests now run on any host.** The first run of the newly gated suites
  surfaced a latent break: the scan router's spool writes to the fixed clamd-shared `/scan` scratch
  directory, which exists only inside the real container, so the `health` and `scan_fault` integration
  tests returned 503 on every Linux host (the Windows dev build takes the buffered path and never hit
  it). The spool directory is now overridable via `SCAN_SCRATCH_DIR` (production never sets it), and
  those tests point it at the OS temp dir.
- **The test-project registry is now a gated fitness function.** `pnpm run lint:test-registration`
  (`tooling/lint-test-registration.mjs`, run in the gate's governance job) fails when a
  `vitest*.config.ts` exists on disk that no root `test.projects` entry covers, or when a literal
  entry points at nothing — so a test suite can never again sit silently unrun.
- **Container workspaces are now fmt/clippy-clean and gated.** The scan workspace's formatting drift
  and two clippy findings (scan, ocr) are fixed, and the containers job's per-changed-workspace gate
  now runs `cargo fmt --check` + `clippy -D warnings` + `cargo test`, matching the crates/ rust gate.
- **Every gate job now carries a hang guard.** All jobs have a `timeout-minutes` cap set comfortably
  above their honest wall-clock (only the lint job had one), so a runaway fails in minutes instead of
  burning a runner toward the 6-hour default.
- **Gate classification hardened.** The `workflow_dispatch` diff base now falls back to the merge-base
  with `origin/main` (`HEAD~1` under-classified multi-commit branches and could wrongly skip the heavy
  jobs); an empty diff fails safe by running everything; a crashed `affected-lint` classifier fails the
  `changes` job — and an empty lint scope fails the `lint` job — instead of silently degrading;
  markdown-only edits inside `crates/` or `containers/` no longer trigger those areas' heavy jobs; the
  `typecheck` job's five checks are separate named steps so a red run names the failing surface.
