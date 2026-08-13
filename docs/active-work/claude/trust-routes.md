---
branch: claude/trust-routes
worktree: .claude/worktrees/trust-routes
area: trust — the route layer over the bank-charge carve-out (owner flag T3) and the unclaimed-funds diligence file (owner flag T16)
status: building
touches: apps/worker/src/routes/trust-firm-funds.ts, apps/worker/src/routes/trust-unclaimed-funds.ts, apps/worker/src/app.ts, apps/worker/src/contracts/problem-types.ts, apps/worker/openapi/openapi.json, apps/worker/test/conformance.test.ts, apps/worker/test/contracts/problem.test.ts, packages/api-client/src/generated/, packages/trust/package.json, changelog.d/, docs/specs/2026-08-12-trust-bank-charges-and-unclaimed-funds.md, status.d/3-2-trust-accounting-jurisdiction-compliance.md
---

The two capabilities that landed as a domain layer plus schema with no way to reach them. Nothing in
the domain layer changes: this stream is the HTTP surface over what is already built, and it is built
to the boundary the spec drew rather than past it.

**Two route modules, never one.** `trust-firm-funds.ts` carries the firm's own money and gates every
route — including the read — on `trust:firmFunds`; `trust-unclaimed-funds.ts` carries client money's
diligence file and gates on `trust:read` / `trust:manage`. There is deliberately no route that takes
a ledger-node handle and dispatches on what kind of node it turns out to be: the two categories not
sharing a door is the property the carve-out's whole design rests on, and a single dispatching
endpoint would be exactly the boolean the second composition door exists to avoid.

**What the routes may not become.** The closing composer for a review takes no amount, no payee, no
effective date and no method, and neither does the route in front of it — that absence IS the
manual-confirmation gate. There is no close-and-disburse convenience. The dormancy window is a
required query parameter with no default, because there is no period the platform is entitled to
pick. And there is no route that pays anybody out of the firm-funds category: paying a person is a
disbursement and goes through the disbursement queue on the existing surface.

Interface and user documentation stay deferred with the rest of the spec's section 4 — a guide to a
screen a firm cannot open would describe something that does not exist.
