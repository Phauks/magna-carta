---
branch: claude/custodian-design
worktree: C:/dev/magna-carta-worktrees/claude/custodian-design
area: Slice 4·2 Custodian — design spec + implementation plan (docs only, no product code)
status: designing
touches: docs/specs/, docs/active-work/, changelog.d/, docs/decisions/pending/
---

Design-only stream for slice 4·2 (Custodian): the packet/item custody model, the location tree rooted
at a firm Location, the append-only movement ledger, firm-scoped custody numbering on the matters
allocation-ledger idiom, scanned-copy binding into the File Manager, the review and destruction
seams, and the slice-by-slice build plan. Two new spec files plus a changelog fragment and two
pending ADR fragments; **no product code, no schema, no route** in this stream.

Evaluates the earlier brainstorm on `main`
(`docs/specs/2026-06-16-safe-custody-design.md`) as input rather than inheriting it — what is kept
and what is discarded is stated in the new design's first section. The remote branch
`safe-custody-design` carries no unmerged content: its single commit is already on `main` (salvaged
as `67eba609`), differing only in emphasis-marker formatting. Nothing on that branch was taken
forward beyond what `main` already has.

Nothing cross-cutting is edited — `STATUS.md`, `ROADMAP.md`, `CLAUDE.md`, the white paper, and
`docs/conventions/` are all untouched, and no existing spec is modified. A concurrent stream that
owns `packages/locations`, `packages/directory`, `packages/matters`, `packages/file-manager`,
`packages/custom-fields`, or `packages/shipping` will not collide with this one; the spec only names
their seams.

Files:

- `docs/specs/2026-08-04-custodian-design.md`
- `docs/specs/2026-08-04-custodian-implementation-plan.md`
- `docs/decisions/pending/custodian-register-model.md`
- `docs/decisions/pending/custodian-retention-jurisdiction-posture.md`
- `changelog.d/custodian-design.md`
