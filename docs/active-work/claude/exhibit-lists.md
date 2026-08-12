---
branch: claude/exhibit-lists
worktree: .claude/worktrees/exhibit-lists
area: Exhibits and exhibit lists (slice 2·7) — design and implementation plan only
status: designing
touches: docs/specs, docs/decisions/pending, changelog.d, status.d
---

Design-only stream: the exhibit model (a matter-level exhibit, an ordered set, a computed label), the
in-text reference mechanism, the filed-versus-draft freeze line, exhibit separator pages and the
compiled package, numbering schemes, and how the list itself is produced. **No product code.** The
deliverables are `docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md`, its implementation
plan, two decision fragments, a changelog fragment, and a `status.d/2-7-exhibits.md` fragment.

Nothing outside those paths is edited. The design lands new obligations on
`@magna-carta/document-assembly` (an `exhibits` list-valued dictionary source, and a new placeholder
form), on `@magna-carta/file-manager` (a link over existing `file` handles — no new bytes path), and
on `crates/pdf-core`'s shipped Bates engine (package pagination). A concurrent stream editing the
merge-field catalogue, the expression language, or the discovery production model should read the
_Reference mechanism_ and _Bates_ sections before assuming this stream's shape.
