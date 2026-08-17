# passive-dev-orchestrator-m7f9jw — reach, roll-ups, and the decision desk

**Scope.** Three owner-raised corrections to how the feature ledger is read, all in the same
machinery:

1. **Roll-up parents were counted as units of work**, which skewed every share in the register. 133
   of 754 nodes are parents and 107 of them are `partial`, so the distortion landed almost entirely
   on the one status a reader is most likely to mistake for progress. The counts now run over units
   of work, with the parent split stated rather than dropped.
2. **A new ledger key, `surface:`** — `screen` · `awaiting-screen` · `internal`. `status` cannot say
   whether anybody can reach a capability, and reading a shipped backend and a shipped screen as one
   number overstates the product by the whole of the unbuilt interface. Required on every leaf with
   code behind it, refused on parents and on nodes with nothing built.
3. **The decision desk** — `docs/decisions-open.html`, rendered from the `awaiting-owner` nodes by
   the same command that renders the register. Every open question in one place, with an answer box,
   the built-or-not delineation on each card, local persistence, and a copy-out block that names each
   decision by node id.

**Files touched.** `tooling/doc-fragments/roadmap.mjs`, `tooling/doc-fragments/decision-desk.mjs`
(new), `tooling/doc-fragments/build-register.mjs`, `tooling/doc-fragments/register-artifact.mjs`
(one export), `tooling/lint-roadmap.mjs`, `roadmap.d/README.md`, every `roadmap.d/*.md` that has a
built leaf, and the three rendered outputs under `docs/`.

**Overlap.** Touches the whole of `roadmap.d/`, so any concurrent stream that flips a node's status
will collide. Sync before flipping one.
