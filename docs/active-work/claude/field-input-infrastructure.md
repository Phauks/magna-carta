---
branch: claude/field-input-infrastructure
worktree: .claude/worktrees/agent-a813693cef009d5c4
area: Document automation — the user-facing field-input infrastructure (contract, design-system components, assembly input area)
status: review
touches: packages/merge-field-catalog-contract, packages/design-system, apps/web, changelog.d, docs/decisions/pending
---

The user-facing half of document automation: a typed merge-field catalog contract with a mock
provider, the design-system field-input components (picker, chip, detected-field review list), and
the assembly input area in `apps/web` behind `/forms/assemble`.

**Coordination.** The automation backend runs concurrently on `claude/document-automation-slice-1`
and owns `packages/document-assembly`, the worker routes, and `apps/worker`. This stream touches
none of those. The one shared-file edits here are `packages/design-system/package.json` (three
export entries), `packages/design-system/src/lib/styles/components.css` (three recipe imports),
`apps/web/package.json` (two dependencies), and `apps/web/src/lib/developer/dev-fixtures.ts` (one
fixture group) — all additive and all in packages the backend stream does not own.

The contract package is a READ shape, deliberately separate from the assembly package's own
dictionary types. When the assembly package exports the dictionary and the endpoints exist, the one
file that changes on this side is `apps/web/src/lib/document-assembly/merge-field-catalog-source.ts`.
