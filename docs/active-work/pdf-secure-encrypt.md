---
branch: pdf-secure-encrypt
worktree: C:/dev/magna-carta-worktrees/pdf-secure-encrypt
area: PDF engine — secure/encrypt (slice 5 completion) + Tools surface
status: engine + WASM binding + docs built (merge-ready); Tools UI deferred to the 0·7 cycle
touches: crates/pdf-core/** (new decrypt + secure modules, lib.rs exports, Cargo.toml crypto deps), packages/pdf/src/index.ts (decryptDocument/secureDocument bindings) + tests, packages/tools/src/catalog.ts (one row), packages/access-control/src/registry.ts (one permission), apps/worker/src/routes/pdf-secure.ts (new, only if a server route is kept) + app.ts registration, apps/worker migrations (role seed for the new permission), the SPA Tools shell (one id->component mapping), docs/specs/2026-06-26-pdf-secure-encrypt-design.md (+ plan), docs/decisions/pending/pdf-secure-encrypt.md, changelog.d/pdf-secure-encrypt.md, STATUS.md (own row), ROADMAP.md
---

Completes roadmap slice 5 (forms + **secure/encrypt**) now that AcroForm forms is merged. Two engine
primitives in `crates/pdf-core` — **decrypt** (unlock a password-protected PDF so the rest of the
engine can operate on it) and **secure** (apply AES-256 + owner/user passwords + permissions to
output) — plus an ethereal Tools-area **"Unlock & Secure PDF"** tool in the `documents` subject group.

Key finding (golden rule 11, verified against the crate source): `lopdf 0.41` already implements the
full Standard Security Handler **bidirectionally** — RC4 (R2/R3), AES-128 (V4), and AES-256 (V5/R6,
PDF 2.0). So this slice is **integration + firm policy, not a from-scratch crypto build**.

Design: `docs/specs/2026-06-26-pdf-secure-encrypt-design.md`.
Roadmap home: `docs/specs/2026-06-21-rust-pdf-engine-roadmap-design.md` (slice 5).
Principle: `tools-area-ethereal-principle` (Tools = matter-grade work without committing to a matter).
