# @magna-carta/merge-field-catalog-contract — CLAUDE.md

**Purpose.** The typed read contract the merge-field input interface is built against — what a
merge-field catalog entry and a template version's field manifest look like — plus a mock provider
over a realistic fixture catalog. It is a **contract and a stand-in, not an implementation**: it
holds no data access, no network calls, and no assembly logic.

**White paper:** _Documents & automation_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-04-document-automation-design.md`](../../docs/specs/2026-08-04-document-automation-design.md).

## Key files / entry points

- `src/types.ts` — the contract: `MergeFieldEntry`, `MergeFieldCatalog`, `TemplateFieldManifest`,
  `DetectedFieldConversion`, and the `MergeFieldCatalogProvider` seam every consumer takes
- `src/fixture-catalog.ts` — the fixture catalog and three fixture template manifests
- `src/mock-catalog-provider.ts` — `createMockMergeFieldCatalogProvider()`, the stand-in provider
- `src/catalog-grouping.ts` — pure grouping, lookup, and search over catalog entries

## Local conventions

- **Consumers take a `MergeFieldCatalogProvider`, never import the mock.** The mock is constructed
  at a composition root (a page, a story, a test) and passed down. Swapping in the live provider is
  then a one-line change at that root.
- **Nothing here holds a resolved value.** `exampleRendering` is invented sample text that ships
  with the entry — never a client's data — so a catalog response is safe to show before a matter is
  even chosen, and safe to cache in a browser.
- **Fixtures stay realistic.** Real-length labels, a real mix of automatic and manual fields, at
  least one protected entry, one manifest with an unrecognized key, and one with conversion
  proposals — so every state a surface must render has a case to render it from.

## Invariants that apply here

- **Golden rule 12 (full names).** Keys in the catalog are the platform's user-visible tokens and
  keep their spelled-out shape (`matter.responsibleAttorney`, not an abbreviation).
- **Detected conversions are guidance, never a completed action.** `DetectedFieldConversion` has no
  "applied" state by design: a proposal becomes real when a person confirms it in the consuming
  surface. Do not add a field here that could read as "already converted".

## Dependencies & contracts

- No runtime dependencies. Pure TypeScript types and data.
- Consumed by `@magna-carta/web` (the assembly input area) and by the design-system stories, which
  adapt entries into the components' own structural option shape rather than importing this package
  into the design system.
- The live provider will call the merge-field dictionary and template-fields endpoints once those
  exist; this package does not gain a client for them — the caller supplies one.

## Gotchas

- **`FIXTURE_MERGE_FIELD_MANIFESTS` deliberately contains a broken case.** The probate petition
  declares `matter.filingDeadline`, which the catalog does not carry, so the unrecognized-key path
  is always exercised. A test asserts the fixture's `unrecognizedKeys` matches what the catalog
  actually lacks — if you add that key to the catalog, the fixture manifest must change with it.
- **The mock is asynchronous on purpose**, and takes a `latencyMilliseconds` option. A surface built
  against an instant answer grows loading states that never run.
