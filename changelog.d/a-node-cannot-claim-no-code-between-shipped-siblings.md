---
category: Changed
audience: internal
---

**A capability could read `not-started` in the build register while sixteen modules, twelve routes
and a registered close gate stood behind it, and nothing could see the contradiction. Two more rules
in the ledger-staleness scan close that, and four nodes in the register were wrong because of it.**

**Why nothing saw it.** Every rule in `tooling/lint-ledger-staleness/` keys on a node **naming a
path**: it resolves the path, asks whether some other node accounts for it, asks whether the sentence
around it claims the path is absent. A node that describes its own absence in prose gives those rules
nothing to hold. `financial.trust.reconciliation`'s evidence was "in slice 3-2 scope … no code" and
named no path at all; `financial.trust.close-rule` named the hook file, which exists and which the
matters node correctly accounts for, and made its absence claim about a symbol rather than a path.
Both were silent by construction, and both sat at `not-started` over `packages/trust`'s
reconciliation, matching, statement-import and three-way-proof modules, over
`apps/api-worker/src/http/routes/trust/trust-reconciliation.ts`, and over a close precondition registered in the
matter composition root and tested at two layers.

**The new rule reads no prose.** A node carries `slices:`; a `status.d/<slug>.md` fragment carries
`built:`. A `not-started` node whose slice fragments all report `built: in-progress` or `built: done`,
and one of whose **siblings** is already shipped under that same slice, is two committed documents
contradicting each other — no filesystem, no keyword matching, no guessing at English.

**The narrowing is the whole design, and it was measured rather than assumed.** The unnarrowed form
fires 19 times and 14 of those are one correct idiom: a capability tagged to the slice that built the
_substrate it will reuse_. `payments.port` sits on the port system, every `portal.capabilities.*` on
the document slice whose engine it will call. What separates those from a stale node is where the
stream's output landed — their substrate is in another subtree, while a stream that has already
shipped this node's own siblings is demonstrably working inside this one. Restricting to
`not-started` drops two more: `designed` and `planned` are **attested** pre-code states, where a spec
or a plan was written and somebody recorded that the build had not begun, and widening to them buys
one true positive at the price of one false. Final measurement: **2 hits, both real, no exemptions**.
A second rule holds the input honest — a `slices:` entry naming no fragment would silently switch the
first rule off, and 267 tags across 235 nodes all resolve today.

**What the register was saying, and what it says now.** Reconciliation is `partial`, not
`not-started`: the whole workflow — a recorded bank period, an import that previews before it stores,
ranked match candidates a person confirms, and a three-way proof frozen on close — is on main behind
routes, with no screen on any of it. The zero-balance close precondition is `shipped`; its "all bills
paid" half is deliberately not registered, because an uncollectable receivable's lawful exit is a
write-off. Two further nodes the narrowing surfaced were verified by hand and corrected the same way:
per-account jurisdiction binding and location-on-trust-accounts are both `partial`, both shipping
their binding and their refusals while nothing yet resolves a rule profile through the port.

Shipped moves 244 → 245 and partial 186 → 189, so shipped-plus-partial goes 430 → 434 of 705, 61% to
62%. Four capabilities that existed were being counted as work not begun.
