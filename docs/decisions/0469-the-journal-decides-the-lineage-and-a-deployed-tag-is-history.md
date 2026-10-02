---
number: 469
slug: the-journal-decides-the-lineage-and-a-deployed-tag-is-history
status: Accepted
date: 2026-09-15
area: Database / schema migrations
summary: "Three gates replace three hand disciplines around the drizzle migration lineages, all running on every pull request rather than only under the run-tests label. The worker's tag-to-SQL bundle modules are GENERATED from the journal instead of hand-kept, because the journal already decides which migrations exist and the hand-kept map lost an entry three times — a merge resolves the journal cleanly, since its entries are adjacent lines, and drops one branch's import in the same conflict, which surfaced only as a Durable Object throwing on wake. A conflicted _journal.json is resolved by a command that takes `main` as the arbiter rather than ours/theirs — main IS production here, so a tag on main has deployed and is immutable while a tag that is not can still move for free — keeping trunk entries' tags and order, appending the rest in integration order, re-stamping each above the head, renaming the .sql and regenerating the bundles. And a migration that has deployed can no longer be edited or renamed, measured from where the branch left main rather than main's tip so a migration that landed while the branch was open is not mistaken for one the branch deleted; deliberate exceptions are recorded with the reason no database could have applied them, while a baseline collapse needs no entry because LEGACY_BASELINES already reconciles those at runtime and the gate reads that list directly."
---

**The journal is the source of truth for what a lineage contains, and a tag that has deployed is
history rather than a name — so both should be enforced rather than remembered.**

**Context:** Apply order in these lineages is by TAG: `migrationsFromJournal` sorts the journal
lexically, and `idx` is drizzle's dense counter naming the `meta/NNNN_snapshot.json` files. That one
fact has three consequences that were each a discipline somebody had to keep.

A branch cut before another one lands keeps its earlier timestamp while drizzle renumbers its `idx`
to the end. A fresh database then applies it before the migration it was written on top of, building
its schema in an order no already-migrated firm ever used. Nothing about the merge looks wrong
afterwards and every firm that already exists keeps working, which is exactly why two of them
reached `main` in September 2026.

The worker has no filesystem, so every migration's SQL is bundled as a `.sql` text import and a map
from tag to imported text. That map was hand-kept, and it lost an entry three times. The failure is
silent where it is made — the journal merges cleanly, because its entries are adjacent lines, and
one branch's import is dropped in the same conflict — and loud somewhere else entirely, inside a
Durable Object on wake, which reached us as a twenty-second route timeout.

And `main` IS production here: a merge deploys within minutes. So a tag on `main` is a tag some
database has written into its applied-ledger, and that ledger records the tag, not the SQL behind
it. Editing a deployed migration is therefore invisible to every database that already ran it, and
renaming one leaves those databases holding a tag the runner cannot recognise — which it refuses,
blocking every later migration for the life of that database. Neither is repaired by deploying
again; `LEGACY_BASELINES` is what undoing one costs after the fact.

**Decision:** Three tools, each a pure rules module with an impure runner beside it, all registered
through the root `package.json`'s `lint:*` set so they run on every pull request rather than only
under the `run-tests` label.

**The bundle is generated** (`tooling/migration-bundles`). The journal already decides which
migrations exist, so deriving the map from it removes the question rather than testing for it. The
emitted modules stay ordinary committed TypeScript — a reader following `perFirmMigrations` lands on
real code — and are held to the generate-and-diff discipline the OpenAPI snapshot and the drizzle
`meta/` snapshots already use. The generator wraps an over-width map entry exactly where the
formatter would, so its output is a fixed point of `vp check --fix` and the two cannot undo each
other. What the generator cannot see is whether the bundler RESOLVED an import it wrote, so the
api-worker's bundle test stays as the only thing running the real module through the real plugin.

**A conflicted journal is resolved by a command** (`tooling/resolve-journal`). The arbiter is not
"ours" and "theirs" — which of those is the branch depends on which direction the merge ran, and
getting it backwards re-stamps the wrong migration. It is `main`. Trunk entries keep their tags and
their relative order; everything else is appended in the order it was integrated, because a later
migration may depend on an earlier one, and re-stamped above the head so the tags agree with that
order rather than the other way round. It reads git's conflict stages when the journal is unmerged
and the journal on disk when it is not, which makes the same tool the repair for an inversion that
already landed. It refuses to drop a tag that is on `main`, renames each `.sql`, regenerates the
bundles, and asserts the lineage is in apply order before it finishes.

**A deployed migration is immutable** (`tooling/migration-immutability`). The baseline is the merge
base with `main`, not `main`'s tip: measured against the tip, a migration that landed while the
branch was open reads as one the branch deleted, and an alarm that is never right is one people
learn to ignore. Deliberate exceptions are recorded in a list that demands the reason no database
could have applied the migration, because a gate with no override gets switched off the first time
it is right to override and then protects nothing. A baseline collapse is deliberately NOT such an
exception: the runtime already reconciles those tags through `LEGACY_BASELINES`, and recording the
same fact twice would let the two disagree.

**Consequences:** Adding a migration now means running the generator and committing what it writes
— hand-editing the bundle modules is refused. The gate's `governance` job checks out full history,
which it did not need before, because "what has deployed" has no other record. A rename of a
deployed tag stops being a quiet edit and becomes a recorded decision.

**Alternatives considered:** A committed ledger of deployed tags, instead of reading `main`. It is
the same fact kept twice, free to disagree with the branch that forgot to update it — and the branch
that forgets is the branch this gate exists for. Keeping the bundle hand-written and adding a test
that checks it: that test already existed, and the next merge broke the ordering instead of the
membership, which is the shape of a rule that needs a generator rather than a check.
