---
worktree: (none — this stream runs in a cloud session's primary checkout)
area: Address autocomplete — the self-hosted United States engine behind the existing AddressLookupPort, built monthly from OpenAddresses into R2 and read by range from a Container
status: building
touches: crates/address-core/, crates/Cargo.toml, containers/address/, apps/address-worker/, packages/address-lookup/, apps/api-worker/src/address-lookup/, apps/api-worker/src/routes/address-lookup.ts, apps/api-worker/src/app.ts, packages/design-system/src/lib/components/address-fields/, apps/web/src/lib/addresses/, docs/specs/, docs/decisions/pending/, docs/deploy-queue.md, docs/conventions/operations.md, docs/operating-costs.md, roadmap.d/core-domain.md, changelog.d/
---

Adds the engine the address lookup routes have been waiting for: four census-region Tantivy partitions
of OpenAddresses in a platform R2 bucket, a query Container that keeps them open, a build Container on a
daily staleness cron, and a dedicated `apps/address-worker` that owns both and intercepts their object
and source-data hosts. Design: `docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md`.
The new directories collide with nobody; the shared edits are the crates workspace member list and the
app worker's binding type.
