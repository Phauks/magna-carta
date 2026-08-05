---
branch: claude/billing-3-4-design
worktree: C:/dev/magna-carta-worktrees/claude/billing-3-4-design
area: Billing and invoicing (slice 3·4) — design only (the invoice model, billing arrangements, the trust boundary, the tax seam, the ledger tie-in)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream for the financial core's convergence slice: invoices over the shipped time (3·1),
costs (3·3), and trust (3·2) foundations. It writes two specs, one decision fragment, and one
changelog fragment, and touches nothing in `packages/` or `apps/`. **No product code in this
stream.**

What it settles: the draft/final/void invoice model and where append-only discipline attaches; how a
draft claims unbilled work-in-progress and releases it; invoice numbering over the matter-number
allocation idiom; per-client, multi-matter aggregation; which billing arrangements ship and which are
recorded-but-dormant; the tax seam; what an invoice exposes to a future payments slice; whether
finalization posts accounts receivable or derives it; and — the consequential one — **what satisfies
the trust subsystem's `EarnedFeePrecondition`**, which currently refuses every transfer pending flag
T4.

**Overlap to watch.** The design names, but does not write, changes a concurrent stream could collide
with: an extraction of the counter/allocation numbering builders out of
`packages/matters/src/numbering/counter-statements.ts` into a shared package; new `billing:*` keys in
the access-control permission registry; new identifier prefixes; and a per-firm migration. It
requires **no change to `@magna-carta/trust`** — the precondition is implemented on the billing side
— and it explicitly does not weaken any trust invariant.
