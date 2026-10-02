---
number: 315
slug: a-model-pin-carries-the-date-it-was-last-true
status: Proposed
date: 2026-08-14
area: AI / inference
summary: "Model-pin rot is treated as one defect on two surfaces. The MECHANISM is built and changes no model: reasoning selection resolves through a platform-maintained evergreen tier (most-capable / balanced) whose occupant is catalog data and can be re-pointed by deploy configuration without a build — but only ever onto a model already curated, because a deploy-time string cannot carry a human's finding that a model is zero-data-retention eligible, and the catalog being exhaustive is what makes a non-ZDR model unrepresentable rather than merely discouraged. Each entry now carries TWO verification dates, verifiedOn for the confidentiality facts and availabilityVerifiedOn for the lifecycle facts, because they come from different provider pages and a single date would let the cheap check silently refresh the claim that matters; beside them sit the provider's published retirementNotBefore and supersededBy. A pure freshness pass grades findings expired (fails the gate) or due (reported only), and on 2026-08-14 reports three true findings and zero failures. It cannot detect a successor released since the last check — supersession is not derivable from in-repo data and a gate-time provider call needs network and credentials in CI — so that gap is bounded by the re-read interval rather than closed. For the embedding pin the honest finding is that NO mechanism makes it safely changeable once an index exists, so the design protects the pre-index window instead: the entry records pinState open and a fitness scan fails the moment any code reaches a vector index, forcing the choice to be made before the first vector rather than discovered after. THREE CHOICES ARE LEFT TO THE OWNER and none is taken here: whether the reasoning tiers move onto claude-opus-5 and claude-sonnet-5, what replaces claude-haiku-4-5 before its published retirement, and which embedding model the first index is built with."
---

**A model identifier is a fact with an expiry date, and nothing in this repository could see the
expiry. The mechanism that makes it visible is built; which model the platform runs stays the owner's
call.**

**Context:** Two pins rot on their own schedule and neither announces it. The reasoning default was the
literal `anthropic/claude-opus-4-8` in `packages/inference/src/settings.ts`. The embedding pin is
`@cf/baai/bge-large-en-v1.5`, and the semantic-half cost analysis
([`../research/2026-08-14-semantic-half-convergence-and-cost.md`](../research/2026-08-14-semantic-half-convergence-and-cost.md))
recommended re-opening it **now** for a reason that does not wait: the pin is unchangeable once an index
exists, because every stored vector is a function of the model that produced it, and today there is no
index.

**Vendor-quoted**, read on 2026-08-14 from the provider's own model-overview and deprecation references:
`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5` and `claude-haiku-4-5` are the current models;
`claude-opus-4-8` and `claude-sonnet-4-6` are listed under *legacy*, both still Active. Earliest
published retirement dates: `claude-opus-4-8` 2027-05-28, `claude-sonnet-4-6` 2027-02-17,
**`claude-haiku-4-5` 2026-10-15** — 62 days out. The provider commits to at least 60 days' notice.
`claude-fable-5` requires 30-day retention and is not available under zero data retention, so the
catalog's existing exclusion of it is confirmed rather than assumed.

**One vendor-quoted fact decides the shape of the answer to flag F1.** The provider states that every
model id it publishes is a **pinned snapshot, not an evergreen pointer** — the dateless `claude-opus-5`
form included. So there is no vendor-side evergreen alias to defer to, and "track model advancement"
can only mean a name the *platform* maintains. That is precisely what the owner's docket answer asked
for, and it is buildable exactly because the indirection is ours.

**Decision (the mechanism, taken here):**

**Reasoning selection resolves through a tier.** `ReasoningTier` — `most-capable` / `balanced` — is what
the firm default and deploy configuration refer to; which curated model occupies a tier is catalog data,
validated at module load so every tier has exactly one occupant and resolution is total. Deploy
configuration may re-point a tier with no build. **The override can only ever select an entry already in
the catalog.** That is the design, not an omission: a deploy-time string cannot carry a human's finding
that a model is zero-data-retention eligible, so adding a model still costs a code change and a
verification, while choosing among verified models does not. Widening it to arbitrary identifiers would
make the catalog advisory, and the catalog being exhaustive is the whole reason a non-eligible model is
unrepresentable rather than merely discouraged. Rejections fall back to the catalog occupant and are
reported, never swallowed. A firm's own explicit selection is never re-pointed — that is a decision it
made about its own confidential content.

**Every entry carries two verification dates.** `verifiedOn` records when the confidentiality facts were
read; `availabilityVerifiedOn` when the lifecycle facts were. They are separate because they come from
different provider pages and go stale independently, and one date would let a lifecycle re-read silently
launder a confidentiality claim nobody looked at. `retirementNotBefore` and `supersededBy` record what
the provider publishes. **Nothing resolves a model through `supersededBy`** — a successor is not in the
catalog, so it carries no verified facts, and a fitness test asserts it stays unselectable.

**The freshness pass grades two ways.** `expired` — past a published retirement, or unread past the hard
interval — fails the gate, because a model past its retirement may return an error rather than an
answer. `due` — a successor exists, a retirement approaches, a fact is overdue — is reported and does
not, because a decision that belongs to a person should not arrive as a broken build. The pass takes the
date as a parameter rather than reading a clock, so its behaviour is pinned at fixed dates in tests
instead of only observable on the day the calendar trips it.

**Measured**, running the pass against the catalog on 2026-08-14: **three findings, all true, zero
false, zero expired.** `claude-opus-4-8` superseded by `claude-opus-5`; `claude-sonnet-4-6` superseded by
`claude-sonnet-5`; `claude-haiku-4-5` 62 days from its published retirement. Every one was already true
and none of them was visible.

**What the pass cannot see, stated rather than implied:** a successor released since the last time
somebody looked. Supersession is not derivable from in-repo data. The provider does expose a models
endpoint that would answer it, and it is deliberately not called: a gate-time network call needs
credentials in CI and fails for reasons unrelated to the change under test. The gap is therefore
**bounded** by the re-read interval — 120 days to a warning, 240 to an expiry, both set well inside the
60 days of notice the provider commits to — rather than closed. Whether to close it with a scheduled
job that queries the endpoint out-of-band is a further decision, not taken here.

**The embedding pin gets a different answer, because the honest finding is negative.** Re-embedding a
firm's corpus is the only way to change an embedding model once vectors exist; there is no migration and
no adapter that makes stored vectors comparable to vectors from a different model. **So no mechanism can
make the embedding pin safely changeable after an index exists, and none is claimed.** The design
protects the window instead. The embedding entry records `pinState: "open"`, and a fitness scan asserts
that while it reads open, no source file reaches a vector index — comments stripped first, so the
deferred semantic-search module's descriptions of the unwritten adapter do not count as writing one. The
first code that writes a vector fails that test, and clearing it means recording `frozen`, which only
somebody who has decided the model can honestly do. Verified by construction rather than by inspection:
the scan was run against a deliberate vector write and reported exactly that file and nothing else.

**Left to the owner — three choices, none taken here:**

1. **Do the reasoning tiers move onto `claude-opus-5` and `claude-sonnet-5`?** This is flag F1. **The
   blocking input is not preference, it is verification:** zero-data-retention eligibility for both was
   *not* checked as part of this work, and until it is neither may enter the catalog at all — the
   reasoning slot admits ZDR-eligible models only, and the schema enforces it. Vendor-quoted context for
   the decision: `claude-opus-5` is priced identically to `claude-opus-4-8` ($5/$25 per million tokens),
   and `claude-sonnet-5` is *cheaper* than `claude-sonnet-4-6` ($2/$10 against $3/$15).
2. **What replaces `claude-haiku-4-5` before 2026-10-15?** It is the utility-slot model and the nearest
   pin to its published retirement. It is still Active and nothing is broken today; the pass will keep
   reporting it and will fail the gate if the date passes with the entry unchanged.
3. **Which embedding model the first index is built with.** Vendor-quoted, both read 2026-08-14:
   the pinned `@cf/baai/bge-large-en-v1.5` is 1,024 dimensions, a **512-token** maximum input, $0.20 per
   million input tokens; `@cf/baai/bge-m3` is a **60,000-token** context at **$0.012** per million input
   tokens. **Derived** from those two pairs: roughly **17x** the token cost and **117x** the context
   window separate them. **Not obtained, and it is the open input:** the provider's model page still does
   not state bge-m3's output dimensionality, so the Vectorize sizing half of the comparison cannot be
   completed — which is exactly the gap the cost analysis named and it has not closed. The 512-token
   ceiling also carries the recall problem that analysis identified: on the platform's page-per-passage
   chunking, the tail of a full page of legal prose would never be embedded at all.

**Consequences:** No model changed, no behaviour changed, and the gate is green — asserted directly by a
fitness test that the default tier still resolves to the model the platform already ran. The reasoning
default is no longer a literal anyone must find. Three real staleness facts that existed yesterday are
now visible, and the entry that reaches its retirement date first will fail the build rather than fail a
firm. The embedding choice stays available on exactly the terms it is actually available on: free until
the first vector, and structurally forced to be made before it. Builds on ADR-0111 (the one
credential-less chokepoint) and ADR-0110 (the confidentiality posture); it weakens neither — the curated
catalog remains the only way a model becomes selectable, and that is what every part of this leans on.
