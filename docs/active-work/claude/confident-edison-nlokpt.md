---
worktree: C:/dev/magna-carta-worktrees/claude/confident-edison-nlokpt
area: Address lookup — the postal-code and administrative-area dataset behind the one address form, and the lookup port the autocomplete engine will land behind
status: building
touches: packages/address-formats, packages/address-lookup, packages/design-system/src/lib/components/address-fields, docs/research/address-formats, docs/specs/, docs/decisions/pending/, changelog.d/, status.d/, roadmap.d/design-system.md, roadmap.d/integrations.md
---

Two layers of the address-lookup ladder. The first is `@magna-carta/address-formats`: the
postal-code patterns and administrative-area lists projected from the address-internationalization
corpus, generated with a drift guard, reaching `AddressFields` as optional props so the component
stays domain-blind. The second is `@magna-carta/address-lookup`: the port an autocomplete engine
lands behind, wired-but-dormant the way `resolveSearchIndexPort` is, so no engine has to exist for
the seam to ship.

No provider is adopted and nothing calls out — an address provider is the owner's disclosure
decision, not this stream's. Anything touching `packages/design-system/src/lib/components/address-fields`
or the directory's address section should coordinate; nothing else in flight names them today.
