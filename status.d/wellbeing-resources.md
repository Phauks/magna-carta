---
slice: Wellbeing resources
group: cross-cutting
order: 15
research: done
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: todo
load-profile: n/a
tested: todo
branch: main
active-work:
next:
link-spec:
link-plan:
adrs:
blocked-by:
---

**Phase A research corpus complete + Phase B package built 2026-07-02.** Per-jurisdiction lawyer mental-health/emotional-support resources (State Bar Lawyer Assistance Programs + affiliated hotlines, peer networks, clinical vendors) across all 50 states, DC, and five territories, plus a permanent national safety net (988, SAMHSA, ABA CoLAP) returned for every jurisdiction. `@magna-carta/wellbeing-resources`: typed model (`WellbeingResource`/`JurisdictionEntry`), data generated from the provenance-tracked research corpus (`docs/research/wellbeing-resources/profiles.json`) via `build:data` + a `verify:data` drift guard, registry accessors (`wellbeingResourcesForState`, `nationalResources`, `allCoveredJurisdictions`, `isNationalFallbackOnly`), a coverage manifest, invariant tests, and a coverage-directory mockup. Load profile `[-]`: compiled reference data, no per-firm data surface (same footing as `@magna-carta/government-links`). **Deferred:** the in-app UI surface and extracting the mass-state research pattern to `docs/conventions/`. Spec: [`docs/superpowers/specs/2026-07-02-wellbeing-resources-design.md`](docs/superpowers/specs/2026-07-02-wellbeing-resources-design.md); plans: [Phase A](docs/superpowers/plans/2026-07-02-wellbeing-resources-phase-a.md), [Phase B](docs/superpowers/plans/2026-07-02-wellbeing-resources-phase-b.md).
