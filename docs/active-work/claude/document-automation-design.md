---
branch: claude/document-automation-design
worktree: C:/dev/magna-carta-worktrees/claude/document-automation-design
area: Slice 2·6 document automation — design spec + implementation plan (docs only, no product code)
status: designing
touches: docs/specs/, docs/active-work/, changelog.d/, docs/decisions/pending/
---

Design-only stream for slice 2·6 (document automation): the template model, the merge-data
dictionary, the assembly-engine choice under golden rule 14, the API and orchestration contract,
and the slice-by-slice build plan. Two new spec files plus a changelog fragment and two pending
ADR fragments; **no product code, no schema, no route** in this stream.

Nothing cross-cutting is edited — `STATUS.md`, `ROADMAP.md`, `CLAUDE.md`, the white paper, and
`docs/conventions/` are all untouched, and no existing spec is modified. A concurrent stream that
owns `packages/custom-fields`, `packages/file-manager`, `packages/conversion`, or
`apps/worker/src/editing` will not collide with this one; the spec only names their seams.

Files:

- `docs/specs/2026-08-04-document-automation-design.md`
- `docs/specs/2026-08-04-document-automation-implementation-plan.md`
- `docs/decisions/pending/document-automation-assembly-engine.md`
- `docs/decisions/pending/document-automation-template-model.md`
- `changelog.d/document-automation-design.md`
