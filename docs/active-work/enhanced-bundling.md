# enhanced-bundling

**Scope.** Enhanced Bundling — extend the existing matter bulk-download (**bundle**) path with format
(ZIP, 7z), compression, AES-256 encryption, and format-native multi-volume splitting, plus quality-of-
life options (output name, wrapper folder, flatten, `CONTENTS` manifest). Heavy builds move to a new
dedicated Rust Container; the existing `client-zip` fast lane stays for plain downloads. General-
convenience framing — no legal-production features. Design: `docs/specs/2026-06-25-enhanced-bundling-design.md`.

**Status.** Design committed. Implementation plan next (`writing-plans`), then build. Not built.

**Files I expect to touch.**

- `packages/file-manager/src/zip-composition.ts` (+ a new options/layout module) — `BundleOptions`,
  wrapper/flatten transforms, options-aware manifest hash.
- `apps/worker/src/downloads/` — coordinator + queue consumer + routes extended for options, split
  artifacts, and the encrypted (no-cache, in-memory-password) path.
- `containers/bundle/` (new) — the Rust archive-builder container (axum), mirroring `containers/scan`.
- A new ADR (`docs/decisions/pending/`) — naming, two-lane split, encrypted-bundle no-cache rule,
  dedicated-container decision.
- Web UI: a "Bundle options…" surface on the matter download/export action (design-system only).

**Cross-cutting (coordinate before editing):** `STATUS.md`, `ROADMAP.md`, `CHANGELOG.md` (via fragment),
`apps/worker/wrangler.jsonc` (new container binding + queue/DO wiring).
