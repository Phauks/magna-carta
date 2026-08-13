# @magna-carta/product-updates — CLAUDE.md

**Purpose.** The contract for the customer-facing product-updates content: the artifact schema every
renderer reads, and the strict parser that derives it from the assembled Markdown home. Pure — it
reads a string and returns data. It has no binding, no network call, no file system access, and no
knowledge of any firm.

**White paper:** _Product updates (changelog, release notes & roadmap)_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-11-community-surfaces-design.md`](../../docs/specs/2026-08-11-community-surfaces-design.md).

## Key files / entry points

- `src/schema.ts` — the published contract: `publicChangelogArtifactSchema` and
  `publicRoadmapArtifactSchema`, their entry shapes, the category and band vocabularies,
  `groupIntoReleases()` (the date-then-category grouping a changelog renderer wants) and
  `groupIntoBands()` (the band-then-area grouping a roadmap renderer wants).
- `src/public-changelog.ts` — `parsePublicChangelog()` and `buildPublicChangelogArtifact()`: the
  assembled Markdown home turned into the validated artifact.
- `src/public-roadmap.ts` — the same pair for the roadmap: `parsePublicRoadmap()` and
  `buildPublicRoadmapArtifact()` over `../../docs/public-roadmap.md`.
- `../../docs/public-changelog.md` — the document this package reads. Assembled on `main` by
  `vp run changelog-build` from the `## Public` blocks of `audience: public` fragments in
  `changelog.d/`; curated there into thematic roll-ups at publish time.
- `../../tooling/doc-fragments/changelog.mjs` — the other half of the pipeline: the fragment parser
  and the assembler that WRITES that document. The two agree on a category vocabulary, and
  `test/corpus.test.ts` fails if either side changes it alone.

## Local conventions

- **The parser is strict, and stays strict.** A malformed document throws rather than yielding a
  shorter artifact. The failure being guarded is silent omission — a mistyped category heading or a
  bullet above the first dated heading would otherwise drop a shipped change out of the published
  changelog with nothing raised. Add a new rule as a `problems.push`, not as a lenient fallback, and
  collect every problem in the document rather than stopping at the first.
- **There is no committed generated artifact and deliberately no drift gate.** A consumer calls
  `buildPublicChangelogArtifact()` or `buildPublicRoadmapArtifact()` at its own build time, so an
  artifact cannot fall out of step with the document it derives from. Do not add a checked-in
  `public-changelog.json` or `public-roadmap.json`; either would be a second home for the same fact
  and would need a gate to hold it.
- **The two documents are current for different reasons, and only one of them is gated.**
  `docs/public-changelog.md` is _authored_: fragments fold into it once and are then curated by hand
  into thematic roll-ups, so no generator owns its bytes. `docs/public-roadmap.md` is _derived_:
  `tooling/doc-fragments/build-public-roadmap.mjs` renders it whole from the `roadmap.d/` feature
  ledger every run and `pnpm run lint:roadmap` fails when the committed file differs. Never
  hand-edit the roadmap document, and never add a gate to the changelog one.
- Entries are **dated, not versioned**, because no release has been cut. `version` is present and
  null rather than absent, so the day a release is cut is an edit to the document and a switch in a
  renderer — not a schema change every reader has to tolerate.

## Invariants that apply here

- **This package is platform-level and knows nothing about firms.** The changelog is one document
  read identically by everybody; there is no firm in the data and there must never be one. It
  therefore does not import `@magna-carta/data-access`, holds no firm identifier, and takes no
  binding — the reason golden rule 3 is not in tension here is that there is no business data in
  play, not that an exception was made.
- **No emoji reaches the published artifact.** The ban is enforced upstream, on the fragment, by
  `pnpm run lint:changelog-fragments` — the right place, because a fragment can still be edited and
  a published entry cannot. Do not add a second scrub here; add to the lint instead.

## Dependencies & contracts

- Depends on `zod` and nothing else — no other `@magna-carta/*` package at runtime.
- Consumed by whatever renders the changelog (the public page and the in-app updates route). Both
  read the same artifact from the same document, which is the point: one source, two renderers.
- `test/corpus.test.ts` reaches across into `tooling/doc-fragments/` to assert the shared category
  vocabulary. That is the only cross-workspace import here and it exists to make the agreement fail
  loudly rather than quietly.

## Gotchas

- The assembler writes a folded entry as `- ${text}` with the author's newlines intact, so a
  multi-paragraph public block becomes a bullet with unindented continuation lines. The parser
  accumulates those into one entry on purpose; do not "fix" it by requiring indentation without
  changing the assembler in the same pass.
- `parsePublicChangelog` deliberately ignores everything above the first release heading. The
  document's preamble explains the file to a contributor and is not product content.
