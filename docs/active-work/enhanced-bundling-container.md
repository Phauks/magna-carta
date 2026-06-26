# enhanced-bundling-container

**Scope.** Enhanced Bundling continuation (Plan 1 pure TS core already merged to main). This branch carries:

- The **ADR** for Enhanced Bundling (`docs/decisions/pending/enhanced-bundling-formats-encryption-split.md`) — formats/encryption/split, two-lane build, encrypted-no-cache rule, dedicated-container decision; extends ADR-0027.
- **Plan 2** — a new dedicated Rust Container `containers/bundle` (axum, mirrors `containers/scan`): the `Encoder` trait + ZIP/7z adapters (Deflate/LZMA2, AES-256, ZIP64, UTF-8, timestamps, header encryption, format-native multi-volume), streaming R2→encoder→R2, CI acceptance gate. Gated on a 7z-crate evaluation (findings doc lands first).

**Status (2026-06-26).** Plan 3 (worker orchestration) BUILT + reviewed (8 tasks A1-A6/B1-B2 + final Opus whole-branch review, fixes applied), NOT merged. Plan 2 (Rust container) written-not-built → bundle lanes are 503-gated until it ships. BEFORE MERGE: sync main + reconcile `wrangler.jsonc` (main's per-firm-database-do work also consolidated a duplicate durable_objects key — these WILL conflict); verify migration tag `v1` vs deploy state. Full worker suite OOMs this host — verify with targeted `pnpm --filter @magna-carta/worker run test <path>` (no `--`).

---
_Earlier:_ Synced with main (merge 7289656). All DESIGN resolved; container + worker NOT built. Committed: ADR; crate feasibility (`zip` 8.6 + `sevenz-rust2`, both need Write+Seek → disk-spool); **split 7z-only** (`zip.supportsSplit=false`, tested); container↔R2 = **outbound Workers** (no creds/egress); **Plan 2** (7-task `containers/bundle` plan); **Plan 3 design notes** (dedicated `apps/bundle-worker` mirroring `apps/scan-worker` + `BUNDLE_SERVICE` binding + outbound `env.R2` handler; 3 delivery lanes). **Encrypted-delivery resolved:** passwords NEVER stored; encrypted = stream single file, no artifact/cache/queue (option A); **encrypted+split invalid in v1** → `validateOptionsForFormat` rejects it (tested, 121 green). NEXT: write the full Plan 3 (worker tasks), then build (TS, verifiable in the pool with the container adapter stubbed); container (Plan 2) build is CI-image-gated. Plan 4 = UI.

**Files I expect to touch.**

- `docs/decisions/pending/enhanced-bundling-formats-encryption-split.md` (ADR fragment).
- `docs/specs/2026-06-25-enhanced-bundling-plan-2-*` (crate-evaluation findings + container implementation plan).
- `containers/bundle/` (new Rust crate: `Cargo.toml`, `src/`, `Dockerfile`, tests) — later, on build.
- Eventually `apps/worker/wrangler.jsonc` + a container adapter (Plan 3 — may move to its own branch).

**Cross-cutting (coordinate before editing):** `STATUS.md`, `ROADMAP.md`, `apps/worker/wrangler.jsonc`. ADR + CHANGELOG go through fragments (never hand-edit rendered files on a branch).
