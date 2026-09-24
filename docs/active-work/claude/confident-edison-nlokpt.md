---
worktree: C:/dev/magna-carta-worktrees/claude/confident-edison-nlokpt
area: Address autocomplete — the lookup engine behind AddressLookupPort, the two Worker routes that serve it, and street-field suggestions in the one address form
status: building
touches: packages/address-lookup, packages/design-system/src/lib/components/address-fields, apps/api-worker/src/routes/address-lookup.ts, apps/api-worker/src/address-lookup, apps/api-worker/src/app.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src/types.gen.ts, apps/web/src/lib/addresses, apps/web/src/lib/directory/sections/address-section.svelte, apps/web/src/lib/offices/office-record-window.svelte, docs/specs/, docs/decisions/pending/, docs/user/, changelog.d/, roadmap.d/core-domain.md
---

Layer 2 of the address ladder: the engine behind `AddressLookupPort`, now that the owner has ruled an
address may leave the tenancy. The provider is chosen on STORAGE TERMS — the chosen address is written
into a permanent record, and the two largest autocomplete services forbid storing their results — and
the adapter stays dormant until its credentials are provisioned, so nothing calls out and nothing is
spent until the owner sets them.

The routes are read-shaped POSTs on purpose: invocation logging records full URLs, and the query is a
client's address. Anything touching the address form or the OpenAPI contract should coordinate.
