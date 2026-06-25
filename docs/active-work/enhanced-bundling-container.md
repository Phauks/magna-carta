# enhanced-bundling-container

**Scope.** Enhanced Bundling continuation (Plan 1 pure TS core already merged to main). This branch carries:

- The **ADR** for Enhanced Bundling (`docs/decisions/pending/enhanced-bundling-formats-encryption-split.md`) — formats/encryption/split, two-lane build, encrypted-no-cache rule, dedicated-container decision; extends ADR-0027.
- **Plan 2** — a new dedicated Rust Container `containers/bundle` (axum, mirrors `containers/scan`): the `Encoder` trait + ZIP/7z adapters (Deflate/LZMA2, AES-256, ZIP64, UTF-8, timestamps, header encryption, format-native multi-volume), streaming R2→encoder→R2, CI acceptance gate. Gated on a 7z-crate evaluation (findings doc lands first).

**Status.** ADR committed. Crate feasibility VERIFIED (`zip` 8.6 for ZIP incl. AES; `sevenz-rust2` for 7z incl. header encryption; both need Write+Seek → spool to ephemeral disk). Split is **7z-only** (no Rust crate writes spanned ZIP) — `zip.supportsSplit=false` applied + tested + committed. Container↔R2 data-flow decision pending (container-direct-R2 vs worker-proxy). Plan 2 (container) not yet written; container NOT built. Plans 3 (worker) + 4 (UI) on later branches.

**Files I expect to touch.**

- `docs/decisions/pending/enhanced-bundling-formats-encryption-split.md` (ADR fragment).
- `docs/specs/2026-06-25-enhanced-bundling-plan-2-*` (crate-evaluation findings + container implementation plan).
- `containers/bundle/` (new Rust crate: `Cargo.toml`, `src/`, `Dockerfile`, tests) — later, on build.
- Eventually `apps/worker/wrangler.jsonc` + a container adapter (Plan 3 — may move to its own branch).

**Cross-cutting (coordinate before editing):** `STATUS.md`, `ROADMAP.md`, `apps/worker/wrangler.jsonc`. ADR + CHANGELOG go through fragments (never hand-edit rendered files on a branch).
