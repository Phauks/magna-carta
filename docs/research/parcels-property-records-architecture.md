# Parcels → County Property-Records Engine, and a `property-links` Aggregator (design direction)

**Date:** 2026-06-16
**Scope:** Where recorder / register-of-deeds (and GIS) county lookups belong, and how the parcels package layers under a future consumer aggregator. Companion to [`parcels-key-model-and-resolver.md`](parcels-key-model-and-resolver.md) and [`property-data-integrations.md`](property-data-integrations.md).
**Status:** Direction agreed and **the model generalization has begun** — the `category`/`system` model is built and proven by the Nevada Secretary-of-State business domain (the cheaper, harder-axis proof); recorder/GIS and the package rename follow on the same seam (below).

## Decision

Recorder/deed lookups are the _same pattern_ parcels already implements: a per-county deep-link to a government portal, keyed by jurisdiction (FIPS), resolved through pluggable platform adapters. The recorder is just another county system on the same machinery — different vendor platforms (Tyler Eagle, Kofile/GovOS, Fidlar, AcclaimWeb), the same jurisdiction registry + adapter abstraction.

So a **separate package would duplicate parcels' jurisdiction/adapter engine** (golden rule 1). Instead:

- **Generalize parcels** from "assessor deep-links" to **county property-record deep-links** — a jurisdiction can carry multiple typed record-system portals (**assessor**, **recorder**, **GIS**), each with its own platform adapter or template.
- **A future `property-links` package is the consumer aggregator** — it surfaces the county-government links (by wrapping parcels) in the same `PropertyLink[]` alongside the commercial sites (Zillow / Redfin / Google Maps / Realtor) and the property-data adapters.

### The layering

- **parcels** = the county-government records engine (assessor + recorder + GIS deep-links over the shared jurisdiction registry + adapters).
- **property-links** = the consumer aggregator (commercial sites + a parcels-wrapping provider for the county links) → one `PropertyLink[]`.

### Honest caveat

Recorder deed _images_ are paywalled / portal-only (per the public-records research). So, exactly like the assessor, we **deep-link to the recorder's search — we do not pull deed data.** Chain-of-title work stays a human-on-the-portal task; parcels only removes the clicks to get there.

## The model generalization (begun — business domain first)

The pre-generalization model was `AssessorSite` (one assessor portal per jurisdiction). The generalized shape carries two discriminators on every `PortalSite` — a `category` (`property | business`) and a `system` (`assessor | recorder | gis | businessEntity | ucc`) — and the registry keys on **`system` + `jurisdictionId`**, so one jurisdiction can hold several portals (a county its assessor + recorder; a state its Secretary-of-State register + UCC index) without collision. `category` also fixes the key granularity: property is keyed by county (5-digit FIPS / 10-digit MCD GEOID), business by **2-digit state FIPS** (the Secretary of State is a state office).

This was cheap exactly as predicted: the **`stateSites` builder insulates every per-county row** from the site shape, so all ~820 property rows took the new `category`/`system` fields from the builder with no row edits — a helper-level change, no retrofit.

**The first proof was the business domain, not recorder/GIS** — because it needed no new property data to validate the seam, and it exercises the _harder_ axis (a second category at a different jurisdiction granularity). **Nevada Secretary of State** is wired (`src/business/`): the SilverFlume business-entity search + the ORION UCC index, both search-only, keyed by state FIPS `32`. A generic `portalUrl(site, {key, year})` resolves any portal; `assessorUrl(site, {apn})` is now a thin property-domain wrapper over it. The `./business` subpath export and `siteForSystem` / `businessEntitySiteForState` / `uccSiteForState` accessors are the consumer surface.

**Done since:** the package is renamed to `@magna-carta/government-links` with `property/` and `business/` as subpath domains over the shared root engine (no legacy alias); the business domain now covers **all 50 states + DC** (each state's Secretary-of-State business-entity search, plus the UCC index where public) — proving the second category scales to national coverage with no shape changes.

**Next:** the property recorder/GIS systems drop onto the _same_ built seam when their data lands (extend `stateSites` for the new `system`, register under the existing key); broaden assessor coverage to the remaining states. The `property-links` aggregator consumes the property domain via its county-assessor provider.
