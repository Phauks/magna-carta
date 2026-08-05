---
slice: 3·2 — Trust accounting + jurisdiction compliance
group: phase-3
order: 2
research: done by="Opus 4.8"
spec: in-progress
plan: todo
built: in-progress by="Opus 4.8"
ui: todo
load-profile: todo
tested: in-progress by="Opus 4.8"
branch: claude/trust-3-2-2-movements
active-work: docs/active-work/claude/trust-3-2-2-movements.md
next: The zero-balance matter-close precondition, then the jurisdiction corpus stream and three-way reconciliation
link-spec: docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md
link-plan:
adrs: ADR-0009
blocked-by:
---

**Sub-slices 1 and 2 built.** Sub-slice 1 — trust schema, the three-level client/matter tree, the zero floor written in the creation batch, the composition guard owning no-commingling and fees-never-touch-trust, holds and available balance, the two-linked-entry transfer, and the fitness suite. Fifteen owner flags stay open; the code refuses rather than defaults wherever one would have to be guessed.

**Sub-slice 2** — deposits, disbursements, and matter-to-matter transfers, each behind a required-idempotency route; the append-only `trust_movement` client-ledger record carrying source or payee, purpose, method-as-a-value, reference, and the authorizing member, with its shape enforced by a database CHECK; available balance as the disbursement ceiling; a bank-free reallocation between two matters of one client; and a movement refusal on an account whose office recorded no jurisdiction. The matter-close precondition and the jurisdiction corpus remain open.
