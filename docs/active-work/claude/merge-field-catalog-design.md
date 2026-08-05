---
branch: claude/merge-field-catalog-design
worktree: C:/dev/magna-carta-worktrees/claude/merge-field-catalog-design
area: Merge-field catalog system — design only (spec + implementation plan for scaling the merge dictionary to hundreds of fields)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream: how the shipped merge-field dictionary (`@magna-carta/document-assembly`)
scales from tens of keys to hundreds — the subject/facet catalogue model, the formatting system,
the sourcing budget, estate and court identity, picker discoverability, and the key-permanence
lifecycle. **No product code in this stream.** It writes two specs, one decision fragment, and one
changelog fragment, and touches nothing in `packages/` or `apps/`. A concurrent stream building in
`packages/document-assembly`, `packages/merge-field-catalog-contract`, or the design system's
merge-field components will not collide with these files, but should read the design before widening
the dictionary by hand.
