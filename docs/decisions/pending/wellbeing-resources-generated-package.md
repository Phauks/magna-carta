---
slug: wellbeing-resources-generated-package
status: Accepted
area: Wellbeing resources
date: 2026-07-02
summary: "Lawyer wellbeing resources vary in shape per jurisdiction (a state carries a list of resources — bar programs, affiliated nonprofits, courts, outsourced EAP vendors — at statewide or metro scope), so the keyed deep-link model of `@magna-carta/government-links` (`PortalSite`/`deepLink`) does not fit, and a validated research corpus with per-resource provenance already exists. Ships a dedicated `@magna-carta/wellbeing-resources` package with a resource-centric model (`WellbeingResource`/`JurisdictionEntry`) whose data table is generated from the research corpus `docs/research/wellbeing-resources/profiles.json` (single source of truth) rather than hand-authored per state — the generator projects research resources to the shipped model, dropping research-only provenance (confidence, sourceUrl, sourceTier) and folding no-program jurisdictions into a nationalFallbackOnly flag, with the national safety net (988, SAMHSA, ABA CoLAP) unconditionally present. One home per fact — the corpus and the shipped data cannot drift (a verify:data guard enforces it); diverges from government-links' hand-authoring, justified by the upstream corpus; the in-app UI and any public directory are deferred to a later vertical slice."
---

**Wellbeing resources: a generated, resource-centric package.**

**Context:** Lawyer wellbeing resources vary in shape per jurisdiction (a state carries a list of
resources — bar programs, affiliated nonprofits, courts, outsourced EAP vendors — at statewide or metro
scope), so the keyed deep-link model of `@magna-carta/government-links` (`PortalSite`/`deepLink`) does
not fit. A validated research corpus with per-resource provenance already exists.

**Decision:** Ship a dedicated `@magna-carta/wellbeing-resources` package with a resource-centric model
(`WellbeingResource` / `JurisdictionEntry`). Its data table is **generated** from the research corpus
`docs/research/wellbeing-resources/profiles.json` (single source of truth) rather than hand-authored per
state — the generator projects research resources to the shipped model, dropping research-only
provenance (`confidence`, `sourceUrl`, `sourceTier`) and folding "no program" jurisdictions into a
`nationalFallbackOnly` flag. The national safety net (988, SAMHSA, ABA CoLAP) is unconditionally present.

**Consequences:** One home per fact — the corpus and the shipped data cannot drift (a `verify:data`
guard enforces it). Diverges from `government-links`' hand-authoring, justified by the upstream corpus.
The in-app UI and any public directory are deferred to a later vertical slice.
