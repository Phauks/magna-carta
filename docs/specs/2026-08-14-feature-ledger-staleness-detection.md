# Feature-ledger staleness detection

**Status:** design accepted, built in the same change.
**Home for:** why the ledger-staleness scan checks what it checks, and why it refuses to check the
rest. The rules themselves live in `tooling/lint-ledger-staleness/`; the ledger format lives in
[`roadmap.d/README.md`](../../roadmap.d/README.md).

## The gap

`roadmap.d/` is the source of truth for what exists in this program, and every derived document —
[`docs/now.md`](../now.md), the unpublished public roadmap — is rendered from it.
`pnpm run lint:roadmap` already gates drift, but **in one direction only: it compares the rendered
documents against the ledger, never the ledger against the repository.** The assembler therefore
cannot invent a state, and equally cannot notice a stale one. A node nobody updates stays wrong
forever, and every derived document repeats it faithfully.

Two nodes went stale one day apart, both found by a person reading rather than by a check:

1. `discovery.search` and `discovery.search.keyword` read `designed` — which the ledger's own
   vocabulary defines as "Accepted design spec exists; no code" — after roughly four thousand lines
   of engine, worker, container and object host had shipped. `discovery.search`'s evidence line
   still read _"No index code on the tree yet."_
2. The `communications.email.filing.auto-file-rules` notes read _"Nothing evaluates during a capture
   yet: the port on the capture core and the evidence gatherer in the consumer are the next slice"_
   two slices after both were built.

Both were on the largest change of their day, which points at **size** rather than carelessness: the
bigger the change, the deeper in code its author is and the further from the ledger.

## The design constraint that decides everything

The hard part is not detection. It is a check that **fails loudly and rarely**. A noisy fitness
function is worse than none: people learn to skip it, and then it misses the real one. This ledger
has 702 nodes, so a rule firing on even two percent of them produces fourteen lines of output that
nobody reads twice.

So every candidate below was **measured against the ledger as it stands**, and against a checkout of
the tree from before the search fix, rather than argued about. A rule was kept only when every hit
it produced was real. The measurements are quoted inline because they are the whole argument.

## What is checked, and why

Eight rules. Each is exact — a path resolves or it does not, a status is in a set or it is not — and
none of them guesses at natural language.

Two status groups do the work, both taken from the vocabulary table in `roadmap.d/README.md` rather
than invented here:

- **pre-code** — `not-started` ("no artifact or spec yet"), `designed` ("no code"), `planned`
  ("build not started"). These statuses are **assertions that code does not exist.**
- **has-code** — `shipped`, `partial`, `in-build`.

`researching`, `deferred` and `cut` are in neither: they make no claim about code either way.

### 1. Unaccounted code — the staleness rule

> A **pre-code** node names, in its own `evidence` / `notes` / `scope`, a code path that **exists**
> on the tree and that **no has-code node claims**.

This is the rule that earns the change. The reasoning is a single observation about how the ledger is
actually written: a pre-code node legitimately points at substrate that is already built — _"the
bulk-download engine it reuses is shipped"_ — and **substrate that is already built belongs to some
other node that says so.** A path that exists, is cited by a node claiming no code, and is claimed by
nothing that has code, is code that no node in the ledger accounts for.

Measured: **41** pre-code nodes name an existing code path (the raw noise floor a cruder version of
this rule would produce). Requiring the path to be unclaimed by any has-code node reduces that to
**one** on today's ledger, and to **two** on the pre-fix tree — where the extra one is
`discovery.search.keyword` itself, with four unaccounted paths.

### 2. An absence claim about a path that resolves

> A prose field claims a **named** path is absent — "does not exist", "is not built", "is unbuilt",
> "no `<path>`" — and the path **exists**.

This is the checkable core of "a future-tense claim about something that is now present". It works
only where the claim names a path, which is the narrowing that makes it exact instead of a guess: the
absence phrase must sit within sixty characters of the path token, so a claim binds to the thing it is
about rather than to a clause three sentences away.

Measured: across **499** path mentions in the ledger, exactly **one** is inside an absence claim —
and that one is a hit. It applies at any status, so it covers the case rule 1 cannot see: a `partial`
node that says one of its own parts is missing when it is not.

### 3. Roll-up contradiction

> A **pre-code** parent has a **has-code** descendant.

A parent's status is a roll-up — `roadmap.d/README.md` defines `partial` as exactly "Parent node
whose children mix shipped and not" — so a parent asserting that no code exists beneath it while a
child asserts that some does is a self-contradiction inside the ledger, needing no filesystem at all.

Measured: **one** hit. Restricting to this shape matters — the naive "parent ranks below its
most-advanced child" fires **87** times, because a `partial` parent over `shipped` children is the
single most common and most correct shape in the whole ledger.

This rule also makes the repair **cascade**, which is why it is worth having next to rule 1: the
moment `discovery.search.keyword` is corrected from `designed` to `partial`, this rule fires on its
still-stale `designed` parent.

### 4. A named path does not resolve

> Any code path named in any field, and the single `spec:` path, must exist.

Cheap, exact, no judgement. It catches deletion and renaming — the direction the other rules cannot
see — and it is the rule that keeps the other rules honest, because rules 1 and 2 both reason from
"this path exists" and would silently weaken if the ledger drifted to naming paths that do not.

Measured: **323** distinct code paths named in the ledger; **zero** do not resolve. It is a
zero-cost guard on a currently clean invariant, which is the cheapest moment to install one.

### 5. A decision reference resolves

> Each `adrs:` entry is `ADR-NNNN` and has a file in `docs/decisions/`.

`roadmap.d/README.md` already requires this and nothing enforced it, because the parser drops the
`adrs` key before the lint sees it.

Measured: **five** entries across **four** nodes name decisions by their **pending fragment slug**
(`notifications-delivery-half`) — decisions that have since been accepted and numbered
(`ADR-0251`). Same staleness, different field: the ledger names a thing by a name it no longer has.

### 6. `not-started` carries no `spec:`

> `not-started` is defined as "no artifact **or spec** yet", so a `spec:` key contradicts it.

Measured: **zero** hits. Free, and it closes the one vocabulary contradiction the parser can see
without touching the filesystem.

### 7. A build stream that has already delivered beside the node

> A **`not-started`** node, **every** slice it names reporting `built: in-progress` or `built: done`,
> and a **sibling** tagged to one of those same slices holding a has-code status.

Added after two further nodes went stale in a way rules 1–6 are structurally unable to see. Both sat
at `not-started` over a package with sixteen modules, a route file and an accepted decision behind
them, and neither was visible to the scan **because neither named a path**: rules 1, 2 and 4 all key
on a path token, and a node that describes its own absence in prose ("no code", "no registration
exists") offers nothing to key on. This rule reads no prose at all. A node carries `slices:`, a
`status.d/` fragment carries `built:`, and both are committed documents; the contradiction is between
the two of them.

Only the `built` stage is read. `ui`, `tested` and the rest describe work around the code rather than
whether it exists.

**Two narrowings, both load-bearing, both measured over the whole ledger.**

- **The sibling requirement.** Without it the rule fires **19** times and **14 are the same correct
  idiom** — the one the rejected slice rule below was rejected for. A capability tagged to the slice
  that built the _substrate it will reuse_ is not stale: `payments.port` and `calendar.sync` sit on
  the port system, every `portal.capabilities.*` on the document slice whose engine it will call,
  `discovery.review.email-threading` on the shipped email parse core. What separates those from a
  stale node is **where the stream's output landed.** Their substrate is in another subtree; a stream
  that has already shipped this node's own siblings is demonstrably working inside this subtree.
  Siblings only — an ancestor corroborates nothing, because a `partial` parent over pre-code children
  is the most common and most correct shape in the ledger (rule 3 says the same), and a has-code
  _descendant_ is already rule 3's finding.
- **`not-started` alone, not the whole pre-code group.** Widening to `designed` and `planned` adds
  exactly two hits: one stale (`financial.trust.multi-jurisdiction-accounts`) and one correct
  (`matter-assets.carry-forward`, whose slice is mid-build and has honestly not reached it).
  One-for-one is not a ratio this file keeps a rule at. The distinction that survives is real rather
  than fitted: `designed` and `planned` are **attested** pre-code states — a spec or plan was written
  and somebody recorded that the build had not begun — whereas `not-started` is "promised in the
  white paper; no artifact or spec yet", the state a node is born in and keeps until someone
  revisits it. A `not-started` node inside a subtree a stream has already delivered into is precisely
  the node nobody revisited.

**A node on several slices is contradicted only when every one of them reports built.** A capability
tracked under two streams is built by both, so one still at `todo` is an honest reason for it to be
pre-code — three nodes in `roadmap.d/reports.md` are exactly that shape, and the stricter reading is
the one that keeps the rule silent on them. Slices with no fragment are excluded from the test (rule
8 reports them separately); a node naming no slice at all is silent, which is 164 of the 175
`not-started` nodes.

Measured: **2** hits, both the known-stale nodes, no false positives.

### 8. A slice tag names a fragment that does not exist

> Every `slices:` entry must resolve to a `status.d/<slug>.md` fragment.

The guard rule 4 is, for the other kind of reference, and installed for the same reason: rule 7
reasons from "this slug has a fragment reporting built", so a slug that quietly stops resolving turns
rule 7 off for that node with nothing raised. Nothing else in the repository checked this —
`lint:status` validates the fragments themselves, `lint:roadmap` only compares the rendered documents
to the ledger.

Measured: **267** slice tags across 235 nodes naming 55 distinct fragments, all 267 resolving.

### 9. An `in-build` node whose build stream has no active-work note

> A node claiming `in-build` must have a `docs/active-work/<branch>.md` note behind it.

`in-build` is the one status that asserts something about **right now** rather than about the tree,
and the thing it asserts is that somebody is working. A stream that finished, or was abandoned, leaves
the node saying so forever, and the register repeats it — one node had been `in-build` for eleven days
over a branch that merged on day two. The active-work registry is where a live stream declares itself,
so it is the only committed document that can contradict the claim.

### 10. A merged design whose owner flags reach no decision desk

> A spec carrying an owner-flag register, cited only by nodes with nothing built behind them, must have
> an `awaiting-owner:` line on at least one of them.

A design lands with a numbered flag register, its capability nodes go in as `designed`, and nobody
writes the `awaiting-owner:` line. The register renders, `docs/decisions-open.html` renders, and the
questions deciding what gets built appear on neither — so the slice sits blocked and the one person
who can unblock it is never shown the block. That is exactly what happened to the general ledger:
sixteen flags, six nodes, and a `notes:` line reading "sixteen owner flags gate what is built" —
true, unactionable, and invisible to the document written to collect such questions. It is also the
second occurrence: an earlier sweep moved seventy flags onto nodes by hand, which fixed the ledger of
the day and installed no detector, so the next merged design reopened the hole.

The signal is the spec's own register — a table row whose first cell is a bolded token (`| **G1** |`)
or the inline `Flagged (**G12**)` form, two or more of them so a stray bolded cell cannot invent one.

**The narrowing is the whole rule: fire only when EVERY node citing the spec is pre-code.** A flag
register is a point-in-time list, and flags are answered by being built. Custodian's eleven and
discovery's ten are mostly settled, and the shipped code beside them is what settled them; nothing in
the spec distinguishes an answered flag from an open one, so the rule refuses to guess. A subtree with
any code in it has had some of these decided. A design where nothing at all is built has had none,
because deciding them is what starts the build.

Reported **once per spec**, on the lowest id citing it. Six identical lines about one design is the
shape people stop reading.

Measured: **1** hit on the whole ledger — the general ledger — and no false positives. Widening to
"any node citing the spec is pre-code" was measured too: 6 spec groups, five of them designs whose
flags the code beside them had long since answered.

## What is deliberately not checked

Five candidates were measured and **rejected**. Each is recorded because the measurement is the
reason, and without it someone will propose them again.

### Rejected: a node's `slices:` tag has files, so it cannot be pre-code

Predicted false-positive profile: a slice tag shared across nodes at different maturities. Confirmed
exactly. Measured against `status.d/` fragments marked `built: done`, this fires **13** times and
**all 13 are false** — `calendar.sync`, `communications.messaging.port` and `payments.port` are all
genuinely not started and all tagged `integration-port-system`, a slice that is genuinely built. The
tag says which slice would carry the work, not that the work happened.

It also **would not have caught instance 1**, which settles it: neither `discovery.search` nor
`discovery.search.keyword` carries a `slices:` tag at all. Only 235 of 702 nodes do.

**Rule 7 later recovered the signal this rejection threw away**, and the difference is worth stating
because it is the pattern: the rejected form asked the _filesystem_ whether the slice had files and
took the answer as being about the node, which it never was. Rule 7 asks the slice's own fragment
whether its build has begun, and then demands that the stream have already delivered a **sibling** of
the node — which is what makes the claim about this node rather than about the slice. Same input,
19 hits down to 2, none false. A rejected rule is a rejected _shape_, not a rejected input.

### Rejected: an affirmative build claim inside a pre-code node

"is built", "now exists", "unit-tested", "has landed" appearing in a node that claims no code.

This one is seductive because it **would** have caught instance 1 — `discovery.search.keyword`'s
evidence said "now exists end to end" and "All unit-tested" while reading `designed`. It fires **22**
times on today's ledger and **all 22 are false**, every one of them the same legitimate idiom: a
pre-code node explaining what it is waiting on. _"The bulk-download engine it reuses is shipped; no
portal-scoped path."_ _"The integration port system it will plug into is shipped."_ That idiom is
good writing and the rule punishes it.

The obvious narrowing — suppress the rule when the field also contains a contrasting absence clause —
**fails on the very instance it was built for**: `discovery.search.keyword`'s evidence also said
"Still dormant end to end" and "Deferred within the design". A narrowing that suppresses the one true
positive while keeping the twenty-two false ones is worse than no rule. Rule 1 catches the same node
by a route that does not read the prose at all.

### Rejected: coupling the diff to the ledger

"A change touching N lines under a path a node claims must also touch that node." It would have
caught **both** instances, and it is still the wrong check:

- It needs a diff base, so it is non-deterministic locally and depends on CI fetch depth — the one
  property a fitness function cannot afford.
- It fires on every refactor, rename, formatter pass and test-only edit under a claimed path, which
  is most changes.
- Decisively: **it is satisfied by touching the node, not by making the node true.** A gate that a
  one-word edit silences is a gate that a one-word edit will silence, and it would then read as
  green over exactly the drift it was installed to find.

The honest replacement for it is not a lint. It is the weekly docs-sync routine, which already audits
the merge window for features that advanced without their node moving, and which reads the diff with
judgement rather than a threshold.

### Rejected: an absence assertion must name a path

The blind spot this file already admits to — "an absence clause naming capabilities in prose rather
than paths" — invites an elegant-looking answer. You cannot check an English sentence against a
filesystem, but you can **refuse** the sentence: require that evidence asserting something does not
exist also carry at least one repository path. _"No conflicts check exists to trigger"_ becomes
_"no caller of `packages/conflicts` exists"_, and the moment it names a path rules 1, 2 and 4 can
see it. A convention enforcement rather than a truth oracle, with the existing machinery doing the
checking.

**Measured: 96 raw hits on the ledger as it stood — 14% of every node.** That is not a lint finding, it is a
migration, and it is an order of magnitude past the fourteen-line threshold at the top of this file.
More decisively, the hits are not a fixable tail. They are the ledger's most common and most correct
idiom: _"no code"_, _"none exists"_, _"No portal app or routes exist"_, _"no messaging port
defined"_, _"Backend only — no UI"_. Every one names a capability that has **no location on the tree
at all**, because it was never built anywhere. Forcing a path onto them means inventing one, and an
invented path buys nothing: rule 4 correctly suppresses an unresolved path inside an absence claim,
so the fiction is never checked until someone happens to create a file at exactly that name. The
rule delivers falsifiability only where the author can predict where code will land — which is the
`designed`/`planned` case, and precisely not the 175 born-`not-started` nodes it would fire on.

There is a second, quieter reason. The failure this rule targets is the author's belief about the
world being wrong. The convention asks them to state that belief more precisely — but writing
_"no `packages/conflicts` caller exists"_ requires having looked the package up, and looking it up is
what corrects the error. The convention cannot make somebody check.

**A better formulation was found while measuring, and it also fails the bar.** Drop the filesystem
entirely and compare the ledger against itself: _a node's prose asserts that a named capability does
not exist, where that capability is another area root the ledger itself holds at a has-code status._
No path, no English resolved against the tree, just two committed statements disagreeing — the same
shape as rules 3 and 7. Measured: **8 hits, 5 true, 3 false**. Narrowing it (the matched term must be
a standalone word, not part of a hyphenated compound, and must be followed by a subsystem noun) gives
**6 hits, 5 true, 1 false**. The five true ones are real and were repaired by hand:
`directory.edges.relationships` and `matters.lifecycle.consultations` both said the conflicts engine
was not built over a shipped `packages/conflicts`; `financial.time.capture.calendar-drafts` said no
Calendar subsystem existed over a shipped `packages/calendar`;
`settings.area-ui.notifications-category` waited on an "unbuilt notifications registry" that had
shipped; `observability.incidents.acknowledgement` called the whole notifications subsystem unbuilt.

One false positive is one too many for this file, and it is not an accident of the pattern set. It is
`ai.magnus.record` — _"the include-or-exclude control belongs to the discovery surface and is not
built **here**"_ — a node scoping an absence to itself while naming a subsystem that exists. That
construction is ordinary English and will recur, and the narrowings that would suppress it ("ignore a
clause containing _here_") are fitted to the one sample rather than derived, which is the trap the
affirmative-build-claim rejection above was already caught by. The rule's reach is small enough that
the trade is not close: it can only see the 32 area-root slugs spelled exactly, so
_"no screening runs at intake"_ is invisible to it either way.

**What is kept instead is the matcher, not the rule.** The pattern set is a good search tool and a
poor gate, and it earned its keep in that role: run by hand over `roadmap.d/`, it found the five
nodes above plus a whole stale seam in `roadmap.d/financial.md` — `invoice-composition` reading
`not-started` with "no invoice model in tree" over eight invoice tables, and `wip-to-ar` reading
`not-started` with "no posting service exists" over a `finalizeInvoice` that posts the receivable.
That is the honest division: judgement reads prose, the gate does not.

## Which of the two instances this catches

Stated plainly, because a detector that catches neither is not worth building.

- **Instance 1 — caught.** Replayed against the tree as of the commit before the fix, rule 1 fires on
  `discovery.search.keyword` with four unaccounted paths (`crates/search-core`, `crates/search-eval`,
  `containers/search`, `apps/search-worker`), alongside one other true positive and no false ones.
  The **parent** `discovery.search` is not caught directly — its evidence named no path, only the
  sentence "No index code on the tree yet" — but it sits three lines away in the same file, and rule 3
  fires on it the moment the child is corrected. The real repair was one commit covering both.
- **Instance 2 — not caught, and no rule here would catch it.** _"Nothing evaluates during a capture
  yet: the port on the capture core and the evidence gatherer in the consumer are the next slice"_
  names no path and no identifier, and sits on a `partial` node, which is a status that makes no claim
  about code. Detecting it requires resolving an English noun phrase ("the evidence gatherer in the
  consumer") against the tree. That is the natural-language guessing this design refuses, and the
  22-false-positive measurement above is what such guessing costs here.

One of two is the honest score. It is worth building because the rules that catch the first one cost
nothing on the ledger they do not catch — **zero false positives across every rule, on two separate
checkouts** — and because they found three further stale nodes nobody had noticed.

### Instance 3 — the blind spot rule 7 was added for

`financial.trust.reconciliation` and `financial.trust.close-rule` both read `not-started` while
`packages/trust` held sixteen modules, `apps/worker/src/routes/trust/trust-reconciliation.ts` held twelve
routes, and the close gate was registered in the matter composition root. Rules 1–6 were silent by
construction and it is worth being precise about why, because it is the same reason both times:

- `reconciliation` named **no path at all** — its evidence was "in slice 3-2 scope per the phase-3
  slice map … no code" — so there was nothing for a path rule to resolve.
- `close-rule` named `packages/matters/src/close-preconditions.ts`, which exists **and which the
  matters node accounts for**, so rule 1's unclaimed filter correctly passed it. The absence claim
  ("no registration exists") was about a symbol, not a path, so rule 2 could not bind it either.

Neither is a defect in rules 1–6; both are the cost of refusing to resolve English against the tree.
Rule 7 reaches them from the other side, without reading either sentence.

## What it finds on today's ledger

Eight hits across six nodes, every one real, none of them the two known instances:

| Node                                  | Rule    | What is stale                                                                                                      |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `financial.trust.jurisdiction-engine` | 1 and 2 | Reads `designed`; evidence says "packages/trust-jurisdictions does not exist yet" and the package exists with code |
| `financial.billing.ledes`             | 3       | Reads `not-started` over a `shipped` child (`ledes.e-billing-flag`)                                                |
| `notifications` (+3 nodes)            | 5       | `adrs:` names two decisions by pending slug; both are now `ADR-0251` and `ADR-0258`                                |

All six are corrected in the same change, which is what makes the scan exit clean.

## The escape hatch

A node may carry `ledger-staleness:allow — <reason>` in its `notes:`. It suppresses **only** the
filesystem-reasoning rules (1, 2 and 4) for that node, and it requires a reason after the marker —
a bare marker is itself a failure. This follows the marker-plus-reason idiom already used by the
object-dimension scan (`fitness:allow-no-dimensions`) and the conflicts-vocabulary gate
(`conflicts-vocabulary:allow`).

Rules 3, 5, 6, 7 and 8 have **no** escape hatch. They compare the ledger against itself and against
files that either exist or do not; there is no legitimate exception to a parent contradicting its own
child, to citing a decision that was never written, or to a `not-started` node sitting between
siblings its own build stream has already shipped. Rule 7 earns that by its narrowing rather than by
assertion — it fires twice on today's ledger, and needing a per-node exemption would be the signal
that the rule is the wrong shape, not that the node is an exception.

## Where it runs

`pnpm run lint:ledger-staleness`, in the Governance step of `.github/workflows/gate.yml`, beside
`lint:roadmap`. It is pure filesystem reads over 27 area files and needs no build, so it costs
nothing to run in the pre-push scope as well.

The scan **self-tests before it scans**: its rules are proven to fire on known-stale fixtures and to
stay quiet on the permitted forms on every run, so a pattern that silently stopped matching fails
loudly instead of reading as a permanently green check. That idiom is taken from
`tooling/lint-conflicts-vocabulary/`, and it matters more here than usual, because the reason this
scan exists is that a check which never fires is indistinguishable from a codebase with no drift.
