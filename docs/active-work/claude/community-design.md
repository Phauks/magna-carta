---
branch: claude/community-design
worktree: .claude/worktrees/community-design
area: Community surfaces — public changelog, feature voting, forums (design only)
status: designing
touches: docs/specs/2026-08-11-community-surfaces-design.md, docs/decisions/pending/community-*.md, docs/decisions/pending/public-changelog-audience-and-source.md, changelog.d/community-surfaces-design.md
---

Design-only stream: one spec covering the three community surfaces (public changelog, feature voting, forums), five pending decision fragments, and a changelog fragment. No product code, no schema, no package. It builds on the accepted community feedback-board design of 2026-06-17 and the product-updates design (ADR-0048) rather than replacing either; where it departs from them the departure is written as a pending decision, never as a silent edit.

Touches only new files. It does **not** edit `CHANGELOG.md`, `STATUS.md`, `ROADMAP.md`, the Decision-Log register, the white paper, or `docs/conventions/` — the white-paper note and the `docs/specs/README.md` index entry land when the decisions are ratified on `main`, so nothing here collides with a concurrent stream. A future stream implementing the changelog `audience` field will touch `tooling/doc-fragments/changelog.mjs`, `tooling/doc-fragments/build-changelog.mjs`, and every file in `changelog.d/`; that is flagged here so it is not started in parallel with anything else editing fragments.
