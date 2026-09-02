---
worktree: C:/dev/magna-carta-worktrees/claude/custodian-refinements-19iycw
area: Custodian — the owner's design round on the register, plus the three entry forms that make it writable
status: review
touches: apps/web/src/lib/custodian, apps/web/src/routes/(app)/custodian, apps/web/src/routes/(app)/matters/[id]/custodian, apps/web/test, packages/design-system/src/lib/components/data-table, packages/design-system/src/lib/status-register, docs/conventions/design-corrections.md, docs/user/features/safe-custody-register.md
---

The owner walked the Custodian register and issued a round of corrections: strip the screen to one table (the By Owner, Holds and Due tabs go, the status dropdown and the local search box go), remove the standing prose, and give the register the entry paths it never had. Adds new-packet, describe-item and file-a-copy modals over the existing `custody.*` write endpoints; deletes the four report panels. Two shared-surface edits ride along and are the parts a concurrent stream should know about: the data-table recipe's placeholder cell now wraps its prose (the empty state was widening the table off-screen on every surface, not just this one), and the status register renders custody `out` as "Checked out".
