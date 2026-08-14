---
category: Added
audience: internal
---

**A hard-coded model identifier goes wrong on a schedule this repository cannot see, so the inference
catalog now records when each pin was last checked and against what — and the gate says so.**

No model changed. The reasoning default resolves to the same model it did yesterday, the embedding
model is the same, and the gate is green.

**The reasoning half.** The firm default was the literal string `anthropic/claude-opus-4-8` written into
`settings.ts`. It is now derived from a **reasoning tier** — `most-capable` / `balanced` — that the
catalog assigns an occupant to and validates at module load, so moving the platform forward is a data
edit rather than a hunt for every literal. `reasoning-tier.ts` additionally lets deploy configuration
re-point a tier with no build at all. **That override can only ever select a model already curated in
the catalog**, which is the design and not a gap: a deploy-time string cannot carry a human's finding
that a model is zero-data-retention eligible, so adding a model still costs a code change and a
verification while choosing among verified ones does not. A rejected override falls back to the catalog
occupant and is reported rather than swallowed. A firm that has explicitly chosen a model keeps it —
re-pointing a firm's own selection because the platform default moved would override a decision it made
about its own confidential content.

**The staleness half, which is the part that stops this recurring.** Every entry now carries two
verification dates instead of one: `verifiedOn` for the confidentiality facts and
`availabilityVerifiedOn` for the lifecycle facts. They are separate because they live on different
provider pages and go stale independently, and a single date would let the cheap lifecycle check
silently refresh the confidentiality claim nobody re-read. Beside them sit the provider's own published
facts — `retirementNotBefore` and `supersededBy`. `model-pin-freshness.ts` reads those dates against a
calendar (never a network, never prose) and grades findings two ways: **`expired`** — past a published
retirement, or unread past the hard interval — fails the gate, because a model past its retirement may
return an error rather than an answer; **`due`** — a successor exists, a retirement approaches, a fact
is overdue — is reported and does not, because a decision that belongs to a person should not arrive as
a broken build.

Read against the provider's deprecation reference on 2026-08-14, the pass reports three findings and no
failures: `claude-opus-4-8` and `claude-sonnet-4-6` each have a published successor, and
`claude-haiku-4-5` reaches its earliest published retirement date in 62 days. All three were true before
this change and nothing in the repository could say so.

**What it cannot see, stated rather than implied:** a successor released since the last time somebody
looked. Supersession is not derivable from in-repo data, and a gate-time call to the provider's models
endpoint would need a network and credentials in CI and would fail for reasons unrelated to the change
under test. The gap is _bounded_ by the re-read interval, not closed.

**The embedding half is a different problem and gets a different answer.** Every stored vector is a
function of the model that produced it, so the pin is free to move only while no index exists and costs
a full re-embedding of every corpus afterwards. **No mechanism makes a frozen pin cheaply changeable and
none is claimed here.** What is built instead protects the window: the embedding entry records
`pinState: "open"`, and a fitness scan refuses to let that window close by accident — while the pin reads
open, no source file may reach a vector index. Comments are stripped before the scan, so the deferred
semantic-search module's descriptions of the adapter nobody has written do not count as writing one. The
first code that writes a vector fails that test, and clearing it means recording `frozen` — a line whose
only honest author is whoever has decided which model the index is built with. Verified by construction:
the scan was run against a deliberate vector write and reported exactly it.
