---
branch: slice-3-3-costs
worktree: C:/dev/magna-carta-worktrees/slice-3-3-costs
area: Phase 3 (Financial Core) — slice 3·3 (Costs & expenses)
status: designed; spec written, awaiting review → implementation plan. Not built.
touches: docs/specs/2026-06-23-slice-3-3-costs-expenses-design.md, docs/decisions/pending/ (4 ADR fragments), changelog.d/, NEW packages/billing-core (EXTRACTED from timekeeping — shared WIP lifecycle + review-gate definition; rewires @magna-carta/timekeeping), NEW packages/costs, packages/database (per-firm-schema cost_entry + a per-firm migration), packages/access-control (costs:* permissions), packages/identifiers (costEntry handle), apps/worker (the first per-firm QUEUE consumer + costs routes + the shipping recoverable-charge producer adapter), packages/data-access (scoped-setting recovery policy), packages/fixtures (CostVolume), ROADMAP.md/STATUS.md (3·3 rows)
---

Phase 3 slice 3·3 — the firm's per-matter cost/disbursement WIP store. Costs are billable
work-in-progress that converge onto an invoice in 3·4; this slice never touches the ledger.

**Key cross-cutting note for other streams:** this slice **extracts the shared WIP lifecycle**
(`lifecycle.ts` + the `approval_required` review-gate definition) **out of `@magna-carta/timekeeping`
into a new `@magna-carta/billing-core`** so time and costs share one workflow (and 3·4 billing
inherits it). If your stream touches `timekeeping/lifecycle.ts` or the `approval_required` setting,
coordinate here. The extraction is behavior-preserving and re-verifies 3·1's suite green.

Other net-new substrate: the codebase's **first per-firm queue consumer** (the per-firm `QUEUE`
dispatch the relay already publishes to), and the **generalized cost-recovery seam** — a canonical
`recoverable-charge` event with a `pass_through` vs `platform_fee` kind driving a category-keyed
firm recovery policy. Shipping (`shipment.purchased`) is the only wired producer; e-sign/SMS/voice
are documented seams.

Mechanical contention: the next per-firm migration slot, `access-control/registry.ts`,
`identifiers/registry.ts`, `per-firm-schema.ts`, and `apps/worker` `index.ts` queue dispatch.
Gate cross-cutting edits on `vp run worktrees` + a `main` sync.
