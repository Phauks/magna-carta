# claude/trust-authority-design

**Scope:** Design-only, owner-directed (task 144): how the owner's authority-based rule for money
leaving a client ledger maps onto the disbursement-authorization machinery already shipped —
the model mapping, the change to the shipped default, the routing of a member without authority, the
four-cell matrix against the database mirrors, and the audit face. One design page plus an ADR
fragment. No production code, no schema, no migration in this stream.

## Files touched

- `docs/specs/2026-08-10-trust-authority-based-authorization.md` (new — the deliverable)
- `docs/decisions/pending/trust-authority-based-authorization.md` (new — Proposed)
- `changelog.d/trust-authority-based-authorization.md` (new)
- this note

## Overlap

Reads but does not edit `packages/trust` (`authorization-policy.ts`,
`disbursement-authorization.ts`, `transfer.ts`), `packages/billing/src/apply-authorization.ts`, and
the per-firm migration `20260807T050000_trust-authorization-policy`. No cross-cutting file is
touched — no `CLAUDE.md`, no `STATUS.md`, no `ROADMAP.md`, no white paper, no `docs/conventions/`.

The design names a future per-firm migration but assigns it no index: the journal head is idx 49 and
the calendar slice in flight holds idx 50 and possibly more, so the build slice takes 51 or later.
No conflict with that stream, which touches no trust file.
