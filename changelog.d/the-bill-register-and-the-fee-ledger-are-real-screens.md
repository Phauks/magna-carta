---
category: Added
audience: internal
---

**The matter's Billing tab carries the bill register and the fee ledger**, both ported from the
owner's own surfaces and both composed on the product's one grid — so sorting, in-header filters,
show and hide, reorder, pin, resize, selection, the totals row and the counts strip are inherited
rather than decided again.

Wired to the billing API that already existed: creating an invoice, claiming unbilled work, editing a
line, voiding a draft, finalizing, credit notes, write-offs, applying a client credit, recording
delivery, and reading invoices, credit notes, deliveries and client credits alongside the matter's
unbilled total and its fee arrangement.

**Money is integer minor units end to end, and the only division by one hundred is at the render
boundary.** Typed amounts are parsed digit by digit rather than through a float, because
`parseFloat("1.15") * 100` is `114.99999999999999` — pinned by a test.

Seven gaps between the design and what can be served are named on the screen rather than papered
over. There is no per-matter invoice listing, so the register is client-wide with This Matter as its
leading money column and the all-matters total beside it — which is the mockup's own distinction, now
load-bearing. Nothing serves a trust-account listing, so applying trust funds ships as the full
designed dialog with the act disabled and its dependency named, and the unreachable client call was
removed rather than shipped. Claiming works and releasing a claim does not. The matter read carries
no client, so the client is resolved from the party wearing that role, and a matter without one
refuses to draft a bill and says why.
