---
branch: claude/public-roadmap
worktree: .claude/worktrees/public-roadmap
area: public roadmap — derived from the roadmap.d feature ledger, plus the owner's one-screen "now" digest
status: building
touches: roadmap.d/ (all area files, additive keys only), tooling/doc-fragments/roadmap.mjs, tooling/lint-roadmap.mjs, packages/product-updates/, docs/public-roadmap.md, docs/now.md, docs/specs/, docs/user/features/, vite.config.ts, package.json, .github/workflows/, CLAUDE.md, ROADMAP.md (one pointer line)
---

Builds the **public roadmap** as a rendered output of the `roadmap.d/` feature ledger, on the same
precedent as `changelog.d/` to `CHANGELOG.md` — a hand-maintained public roadmap beside the internal
one would drift, and drift is the failure being fixed. Two generated documents:
`docs/public-roadmap.md` (users) and `docs/now.md` (the owner's one-screen view). Both are derived
whole from the ledger every run and diff-gated, so a capability that ships moves itself.

**Additive to the ledger only.** The node keys this stream adds (`audience`, `public-name`,
`public-summary`, `awaiting-owner`) are optional; no existing key changes meaning and no existing
node's `status` is touched except where an area file is opted into the public view. A concurrent
stream editing its own area file conflicts only if it edits the same node block.

The **web surface is deliberately not built** — that is a UI decision for the owner. The seam is the
artifact contract in `@magna-carta/product-updates`, exactly as the public changelog already does it.
