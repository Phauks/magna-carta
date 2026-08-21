---
category: Changed
audience: internal
---

**Twenty-eight areas of the feature ledger were read against the repository, and the drift ran almost
entirely in one direction: nodes describing work that has since landed.** The staleness gate keys on a
node NAMING a code path, or carrying a `slices:` tag whose fragment reports built. Of 755 nodes, 162
assert an absence in prose while naming no path, and 133 of those carry no slice tag either — outside
every rule by construction. That is roughly a fifth of the ledger the gate is structurally unable to
read, and it was green over all of it.

**The largest correction is Custodian, where three nodes describe work slice 4·2·4 shipped.**
Stocktake sits at `deferred` saying the MVP ships container data with no stocktake workflow;
`packages/custodian` carries `stocktake-service`, `stocktake-statements` and `stocktake-reconciliation`
over two tables, with seven routes and a source-scan fitness function holding the observe-only
boundary. Retention-and-destruction sits at `designed` saying `custody_destruction_request` has no
service, no route and nothing that writes it; there are five routes, a service, and database triggers
forcing the requester and approver to differ. Will reminders sits at `deferred` saying the per-state
statute catalog is out of the MVP; the catalog is built with Nevada and two of its counties encoded,
and it is the REMINDER half that is blocked, because the register records no date of death. The area
root counted twenty-five routes over eleven tables against thirty-eight over thirteen.

**Two sibling contradictions, both the shape the discovery sweep found.** Conflicts' strictness node
said Beider-Morse runs at the over-inclusive band while its matching-engine node said Beider-Morse is
unbuilt and gave the workerd measurement for why — the second is right, and what actually widens is
the Double Metaphone scheme filter. Notifications' digest node sits at `deferred` calling the rollup a
declared seam, three blocks below the email node describing the same digest as shipped with its
module, its renderer and its hourly pass.

**Six dependency claims were inverted** — a node saying its dependency is not built where the
dependency ships. `containers/libreoffice` is a Rust supervisor over a pool of office-suite child
processes, so the office conversion engine, the platform's container list, and the document-automation
PDF arm were all describing a gap that closed. `crates/search-core` is Tantivy 0.26, so the Rust-core
node's "Tantivy search not started" and the container node's "Tantivy container not started" were both
wrong. Per-type matter templates said document automation is "Not started" where it is built through
2·6·5. Locations now carries an IANA `time_zone` column, validated on write, which two areas asserted
did not exist.

**And a systematic one the gate cannot see: sixteen nodes across six areas cited `changelog.d/*.md`
fragments as evidence, and every fragment named had been consumed by the assembler.** Every one of
those paths dangled. They are replaced with the code they stood in for, which is more useful anyway —
the settings permission check turns out to be a stated mock returning true for the billing area alone,
which no changelog line was going to say.

**No `status:` value was changed.** The sweep corrects `evidence:` and `notes:` only, on the ground
that restatusing a node one has only read is a claim reading cannot settle. Where a status is
demonstrably behind its own code, the node now says so in its own prose and the register renders the
contradiction rather than hiding it.

**Two shape findings about the gate itself.** Rule 1 (unaccounted code) is disarmed inside any area
whose root names its whole package: a `partial` root naming `packages/custodian` accounts for every
path under it, so a `deferred` child naming a shipped module in the same package never fires. And the
path parser reads a SvelteKit route group out of a path — `apps/web-worker/src/routes/(app)/tools/whois-lookup`
resolves as `tools/whois-lookup` and reports missing — so evidence for a web route has to be written
around it.
