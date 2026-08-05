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
next: The jurisdiction corpus stream, then three-way reconciliation
link-spec: docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md
link-plan:
adrs: ADR-0009
blocked-by:
---

**Sub-slices 1 and 2 built.** Sub-slice 1 — trust schema, the three-level client/matter tree, the zero floor written in the creation batch, the composition guard owning no-commingling and fees-never-touch-trust, holds and available balance, the two-linked-entry transfer, and the fitness suite. Fifteen owner flags stay open; the code refuses rather than defaults wherever one would have to be guessed.

**Sub-slice 2** — deposits, disbursements, and matter-to-matter transfers, each behind a required-idempotency route; the append-only `trust_movement` client-ledger record carrying source or payee, purpose, method-as-a-value, reference, and the authorizing member, with its shape enforced by a database CHECK; available balance as the disbursement ceiling; a bank-free reallocation between two matters of one client; and a movement refusal on an account whose office recorded no jurisdiction. The jurisdiction corpus remains open.

**The matter-close gate** is the matter shell's close hook filled for the first time: a matter whose client trust ledger still holds money, or carries an active disputed-funds hold, is refused with the balance, the account holding it, and the movements that clear it. Rules are handed to the shell by the composition root rather than imported by it, and a rule may also guard the close batch itself, so a deposit landing between the check and the commit aborts the close instead of slipping under it. A matter with no trust ledger closes freely.

**Two-person disbursement authorization** (owner-directed) closes the last open piece of sub-slice 2: a disbursement is a pending request until a second member approves it, and the movement posts only on that approval, with the approver as `authorized_by` and the submitter as `recorded_by`. The approver-differs rule is a database trigger, not route discipline; the available-balance ceiling is re-read at approval time through the same composer an ungated payment used, so a request overtaken by other activity refuses instead of posting; rejection and withdrawal are recorded, append-only, alongside the request. A firm with a single member holding `trust:manage` may still pay, with that basis stated on the record, and the database withdraws the exception the moment a second such member exists. Three recommended defaults are flagged for owner review: every disbursement is gated rather than only those over a threshold, a pending request never expires, and no new permission was minted.
