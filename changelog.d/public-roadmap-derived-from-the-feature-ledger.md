---
category: Added
audience: public
---

A public roadmap and an owner-facing "now" screen, both rendered from the `roadmap.d/` feature
ledger and both diff-gated, so neither can drift from the state of the work.

**The ledger stays the one home.** Four optional node keys carry the public view — `audience`
(`public` opts a node in; the key was already reserved for this), `public-name`, `public-summary`,
and `awaiting-owner` — plus an optional `<!-- public-group: ... -->` header giving an area the
heading a reader sees. Nothing existing changes meaning and an untouched node is invisible to both
new documents.

**A human authors the durable half of a public entry and the assembler derives the volatile half.**
You choose whether a capability is public and what its one sentence says; the horizon band it
appears under is computed from `status` on every run. A capability that ships moves from Building
Now to Completed on the status flip alone, because there is no second place to update.

`docs/public-roadmap.md` publishes fifty curated capabilities under the community board's own status
vocabulary — Building Now, Planned, Future, Completed, Not on the roadmap — with **no dates
anywhere and no date field in the schema to fill in**. Slice and phase numbers, spec paths, decision
records, package names and stage tracking are all withheld, and the lint refuses a public sentence
carrying any of them, or an emoji, or a year or quarter.

`docs/now.md` is one screen for the owner: what is blocked on an owner decision and what the
question is, what is in build, what is queued, and per-area counts. Subtrees collapse to their
shallowest node so a parent and nine children do not print ten lines. What already shipped is
deliberately absent — that is the changelog's fact.

`pnpm run lint:roadmap` re-derives both documents and fails when either has fallen behind the
ledger or been hand-edited; `vp run public-roadmap-build` renders them, and the per-merge assembly
workflow runs it beside the other assemblers. `@magna-carta/product-updates` gains the roadmap
artifact schema and a strict parser — the seam a page would render, on the same no-committed-artifact
rule as the changelog. The page itself is deliberately not built: it is a user-interface decision.

One ledger repair rode along: `financial.billing` was `not-started` while its own children recorded
shipped fee models and shipped corrections, which the ledger's vocabulary calls `partial`.

## Public

**There is now a roadmap you can read.**

It says what is being worked on, what is planned, what is intended but not scheduled, and what has
been delivered — and it says so in the same words the feature-request board will use, so a request
and a roadmap entry never mean two different things by "Building Now".

**It carries no dates, and it never will.** A date on a roadmap is a promise made before the work is
understood, and a missed one costs more than it ever bought. What you get instead is a band that is
true on the day you read it: the bands are derived from the state of the work rather than updated by
hand, so nothing sits in "Building Now" months after it arrived.

**Things move backwards on it.** When something planned is displaced by more urgent work, or its
design turns out to be wrong, it moves back — and the page shows that rather than hiding it.
Anything we said we would build and have since decided against stays listed under "Not on the
roadmap" instead of quietly disappearing.
