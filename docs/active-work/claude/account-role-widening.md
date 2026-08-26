---
worktree: claude/account-role-widening
area: billing / general ledger — the account-role vocabulary and its CHECK
status: design
touches:
  - docs/specs/2026-08-26-account-role-vocabulary-widening.md
  - docs/specs/2026-08-15-payments-implementation-plan.md
  - docs/specs/2026-08-17-general-ledger-implementation-plan.md
---

# One widening, not two

Two merged plans each add roles to `firm_account_role`, and only the general-ledger one knows that
doing so is a table rebuild. The payments plan — which opens first — says to add the roles to a
TypeScript constant and stops there.

Analysis and a recommendation only. No migration is written here: the two payments role names are
gated on owner flag K8, and a rebuild against names that then change is the second rebuild the whole
exercise exists to avoid.
