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
- Consumed by `@magna-carta/web-worker` (the assembly input area) and by the design-system stories, which
  adapt entries into the components' own structural option shape rather than importing this package
  into the design system.
- The live provider will call the merge-field dictionary and template-fields endpoints once those
  exist; this package does not gain a client for them — the caller supplies one.

## The fixture is a checked projection, not an invention

`FIXTURE_MERGE_FIELD_ENTRIES` used to be free to describe fields the engine does not have, and it had
already grown a practice area, a court case number, and a responsible attorney that nothing could
fill in. `test/fixture-projection.test.ts` takes that freedom away: **every platform key in the
fixture must exist in the real merge-field dictionary**, with the same value type, sensitivity,
label, group, subject, prominence, formats, and example renderings. At twenty-nine keys a free
fixture was a harmless stand-in; at hundreds it is a second catalogue with its own way of being wrong.

- **The one exception is a firm's own field.** `custom.<handle>` entries exist per firm and by
  construction not in the platform's shipped list, so they are held to the minted handle SHAPE
  instead — which is also what keeps the surfaces laid out against keys of the real length.
- **The value-type union and the group registry are PINNED to the engine's**, member for member and
  in the same order, asserted by the same test. Two unions describing the same thing and disagreeing
  is a drift generator; this contract's used to carry `longText` and `address` where the engine had
  `image`, `list`, and `rate`.
- **A manifest placeholder may only name a fixture key** (plus the one deliberately broken case) and
  may only ask for a format that key actually supports.

## Gotchas

- **`FIXTURE_MERGE_FIELD_MANIFESTS` deliberately contains a broken case.** The probate petition
  declares `matter.filingDeadline`, which neither the catalog nor the real dictionary carries, so the
  unrecognized-key path is always exercised. A test asserts the fixture's `unrecognizedKeys` matches
  what the catalog actually lacks — if you add that key, the fixture manifest must change with it.
- **`MergeFieldGroup` is a `string`, not a closed union.** The catalog grows to hundreds of fields
  and its headings grow with the subjects behind them, so adding one is a row in
  `MERGE_FIELD_GROUPS`. A consumer that meets a heading it does not recognize must still RENDER the
  fields under it — `mergeFieldGroupLabel` falls back to the key — because dropping a field a person
  has to fill in is how its value ends up typed into the finished document by hand.
- **The mock is asynchronous on purpose**, and takes a `latencyMilliseconds` option. A surface built
  against an instant answer grows loading states that never run.
