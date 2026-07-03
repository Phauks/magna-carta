# Stream: wellbeing-resources

**Branch:** `wellbeing-resources` · **Started:** 2026-07-02

## Scope

Consolidate per-jurisdiction lawyer mental-health / emotional-support resources (State Bar
Lawyer Assistance Programs + affiliated hotlines/peer networks/clinical vendors) into a curated,
verified dataset, plus a permanent national safety net (988, SAMHSA, ABA CoLAP). Data-first:
research corpus (mirrors `docs/research/trust-rules/`), then a typed
`@magna-carta/wellbeing-resources` package. In-app UI deferred.

**Phase A (research corpus) complete.** **Phase B (package) built** at
`packages/wellbeing-resources/` — types, generated data (`build:data`/`verify:data` over
`docs/research/wellbeing-resources/profiles.json`), registry accessors, a coverage manifest,
invariant tests, and a coverage-directory mockup; package `CLAUDE.md` added. **Remaining
deferred:** the in-app UI slice and extracting the mass-state research pattern to
`docs/conventions/`.

Design: [`docs/superpowers/specs/2026-07-02-wellbeing-resources-design.md`](../superpowers/specs/2026-07-02-wellbeing-resources-design.md).

## Files expected to touch

- `docs/research/wellbeing-resources/**` (new — source corpus, profiles, viewer)
- `packages/wellbeing-resources/**` (new package — Phase B)
- `docs/superpowers/specs/2026-07-02-wellbeing-resources-design.md`

## Notes

- Reuses the authoring pattern of `packages/government-links` (paused; not modified here).
- Possible shared primitive later: state FIPS/code keys + the coverage-map viewer.
