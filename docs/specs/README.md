# Specs

Detailed, per-subsystem design — the output of the **design → spec → plan → build** cycle. The white paper stays high-level (what each subsystem is and why); a spec here is the implementation-grade detail for one subsystem before code is written.

## The cycle

1. **White paper section** names the subsystem and the decision (the _what/why_).
2. **Brainstorm** the open questions into a concrete design.
3. **Spec** (here) captures the agreed design: data model, interfaces, flows, edge cases, error handling, test plan.
4. **Implementation plan** breaks the spec into ordered, reviewable steps.
5. **Build**, recording any new decisions in [`../Decision-Log.md`](../Decision-Log.md) in the same commit.

A spec does not restate the white paper — it links to its section and goes deeper. When a spec settles a new architectural decision, that decision is logged in the Decision Log (with its stable `ADR-NNNN` id), not buried here.

## Naming

`YYYY-MM-DD-<subsystem>-design.md` (e.g. `2026-06-01-conflicts-matching-design.md`). One subsystem per file; split if a subsystem is large.

## Index

As specs are written, list them here with status.

| Spec                                                                                                       | Subsystem                                                                                                                                         | White-paper area                                                                              | Status                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`2026-06-04-foundational-data-conventions-design.md`](2026-06-04-foundational-data-conventions-design.md) | Money, identifiers, idempotency, transactional outbox, schema-migration/fleet                                                                     | _Foundational data & runtime conventions_ (§9.3–9.7)                                          | Accepted (design) — ADR-0061–0065      |
| [`2026-06-04-api-contract-design.md`](2026-06-04-api-contract-design.md)                                   | API contract & route conventions — library, route-metadata model + enforcement chokepoint, error/pagination/auth-surface/versioning, codegen + CI | _Delivery model and application architecture_ · _Authentication, access control & encryption_ | Accepted (design) — ADR-0066–0067      |
| [`2026-06-04-phase-0-walking-skeleton-design.md`](2026-06-04-phase-0-walking-skeleton-design.md)           | Phase 0 · slice 0·1 walking skeleton — Worker architecture, monorepo layout, `vp` toolchain, local dev + CI, module-reference policy              | _Build roadmap_ (Phase 0) · _Delivery model and application architecture_                     | Accepted (design) — ADR-0069, ADR-0070 |

## Backlog — subsystems awaiting a spec

These are marked `> Needs development.` in the white paper (referenced by area, not section number — numbers shift on reorganization) and are the first candidates:

- ~~Access control / RBAC~~ — **decided at the white-paper level (ADR-0068)**, no spec needed yet. _Ethical walls_ and _external-principal enforcement_ are deferred seams — a spec is written only when one is built.
- **Conflicts matching engine** — white paper, _Conflicts Check_
- **Rules-based docketing** — white paper, _Calendar and rules-based docketing_
- **Tasks & workflows / matter plans** — white paper, _Tasks and workflows / matter plans_
- **E-signature** — white paper, _Payments and e-signature_
- **Client intake / CRM** — white paper, _Client intake / CRM_
