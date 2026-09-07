---
category: Changed
audience: internal
---

The per-firm lineage collapses from 105 migrations into one baseline.

Every firm provisioned after a collapse replays the whole history on its first wake, and the history is where the accidents live: a table rebuild that cannot run against a populated database stays a permanent hazard for as long as it is in the chain, because every new firm meets it again. Five such rebuilds were in this one, including the pair that put a firm's database out of reach for a day. They are gone, not grandfathered.

The baseline is not written by hand and not edited from the old one. `scripts/collapse-baseline.mjs` DUMPS it from a database built by applying the existing chain, so the only thing it can express is what the chain actually produced, and `--verify` applies both and compares every object and every seeded row. It was checked against the real pre-collapse chain reconstructed from git: **767 objects and 408 seeded rows, identical.**

The verify pass earned its place immediately. The first dump silently dropped the three triggers that keep the directory's full-text index in step with the table it indexes — their names share the virtual table's prefix, and the shadow-table exclusion was written as a prefix test. A baseline missing them would have built a directory whose search quietly returned only what existed at the collapse. The exclusion now names the shadow set exactly.

Reconciliation composes. A database provisioned before the FIRST collapse carries the chain that collapse replaced, and reconciling it once lands it on a baseline this collapse has since retired in turn — so the runner now reconciles repeatedly, walking the whole history forward, rather than leaving such a database holding a tag the code no longer knows.
