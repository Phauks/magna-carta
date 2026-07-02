# Stream: wellbeing-resources

**Branch:** `wellbeing-resources` · **Started:** 2026-07-02

## Scope

Consolidate per-jurisdiction lawyer mental-health / emotional-support resources (State Bar
Lawyer Assistance Programs + affiliated hotlines/peer networks/clinical vendors) into a curated,
verified dataset, plus a permanent national safety net (988, SAMHSA, ABA CoLAP). Data-first:
research corpus (mirrors `docs/research/trust-rules/`), then a typed
`@magna-carta/wellbeing-resources` package. In-app UI deferred.

Design: [`docs/superpowers/specs/2026-07-02-wellbeing-resources-design.md`](../superpowers/specs/2026-07-02-wellbeing-resources-design.md).

## Files expected to touch

- `docs/research/wellbeing-resources/**` (new — source corpus, profiles, viewer)
- `packages/wellbeing-resources/**` (new package — Phase B)
- `docs/superpowers/specs/2026-07-02-wellbeing-resources-design.md`

## Notes

- Reuses the authoring pattern of `packages/government-links` (paused; not modified here).
- Possible shared primitive later: state FIPS/code keys + the coverage-map viewer.
