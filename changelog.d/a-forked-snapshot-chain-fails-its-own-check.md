---
category: Fixed
audience: internal
---

**`check-snapshots` fails on a forked snapshot chain instead of reporting "nothing to do".** Merging
two branches that each added a per-firm migration leaves two snapshots naming one parent, and
drizzle refuses every `generate` against that lineage — but the pinned drizzle-kit reports the
refusal as an `Error:` line and **exits 0**, so `refresh-snapshot.mjs`, which read the status alone,
took a refused generate for "the schema matches the snapshot". It passed through two such merges on
one branch.

Two layers now. `refresh-snapshot.mjs` looks for the fork itself before generating — any two
snapshots sharing a `prevId` — and names the files and the repair: keep the one already on main,
delete the branch's, refresh, then let `generate` report "No schema changes". And any `Error:` line
drizzle-kit prints is a failure whatever its status, which covers the failures that are not forks.
Both are proven against the real pre-repair commit and a stub that errors at exit 0.

The broader gate was not blind: `tooling/migration-integrity`'s lineage check does catch the fork
(checked against the same commit). What it could not do is stop a person who ran the snapshot check
alone — which the repair message itself told them to re-verify with. That message now names the
generate as the proof.
