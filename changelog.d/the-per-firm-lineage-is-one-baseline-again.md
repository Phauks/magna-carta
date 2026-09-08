---
category: Changed
audience: internal
---

The per-firm lineage collapses from 105 migrations into one baseline.

Every firm provisioned after a collapse replays the whole history on its first wake, and the history is where the accidents live: a table rebuild that cannot run against a populated database stays a permanent hazard for as long as it is in the chain, because every new firm meets it again. Five such rebuilds were in this one, including the pair that put a firm's database out of reach for a day. They are gone, not grandfathered.

The baseline is not written by hand and not edited from the old one. `scripts/collapse-baseline.mjs` DUMPS it from a database built by applying the existing chain, so the only thing it can express is what the chain actually produced, and `--verify` applies both and compares every object and every seeded row. It was checked against the real pre-collapse chain reconstructed from git: **767 objects and 408 seeded rows, identical.**

The verify pass earned its place immediately. The first dump silently dropped the three triggers that keep the directory's full-text index in step with the table it indexes — their names share the virtual table's prefix, and the shadow-table exclusion was written as a prefix test. A baseline missing them would have built a directory whose search quietly returned only what existed at the collapse. The exclusion now names the shadow set exactly.

A collapse retires migration SQL, and the honest consequence is that a database left behind cannot be carried forward by it. Reconciliation rewrites the ledger of a database sitting at the chain's head, which every live database is; a database that stopped part way through the retired history has a schema no baseline describes, and there is no hop that reaches it — reconciling always lands a ledger on exactly one tag, and no collapse retires a single migration. So the runner refuses that database, and now refuses it in its own words: told "code older than schema", whoever is holding the outage goes looking for a rollback that cannot help.
