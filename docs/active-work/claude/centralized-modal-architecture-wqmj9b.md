---
worktree: /home/user/magna-carta (remote session)
area: One shell for an act asked of a reader — the modal peer of RecordWindow
status: designing
touches: docs/specs/2026-09-01-consolidated-modal-architecture-design.md, docs/decisions/pending/
---

Surveying every modal panel in `apps/web` and designing the one shell they should all be, so the
branches now in flight stop each writing their own. Design only so far: this stream has written a
spec and an ADR fragment and has touched no code, no shared file, and no rendered tracker.

When it builds, it will own `packages/design-system/src/lib/components/action-dialog/`, the shared
close guard lifted out of `record-window/`, and `tooling/lint-one-ui/` (one registry entry, one new
rule, and the allowance ledger that carries the thirty existing panels). A concurrent stream should
know that the guard extraction touches `record-window.svelte`, which
`claude/focused-cori-b8z77b` and `claude/magna-carta-file-manager-mdnug5` both hold open — the
build waits on both.

The migration order is sequenced against the merge window in section 8 of the spec, and its first
rule is that `claude/unified-error-screen-8pam6s` lands before any panel is migrated: it is one
commit behind `main` and rewrites the failure rendering in fifteen of the thirty.
