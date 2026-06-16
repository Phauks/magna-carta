# Parcels → County Property-Records Engine, and a `property-links` Aggregator (design direction)

**Date:** 2026-06-16
**Scope:** Where recorder / register-of-deeds (and GIS) county lookups belong, and how the parcels package layers under a future consumer aggregator. Companion to [`parcels-key-model-and-resolver.md`](parcels-key-model-and-resolver.md) and [`property-data-integrations.md`](property-data-integrations.md).
**Status:** Direction agreed; the model generalization is **deferred** until real recorder data exists (rationale below). Design-recorded now so it stays deliberate.

## Decision

Recorder/deed lookups are the *same pattern* parcels already implements: a per-county deep-link to a government portal, keyed by jurisdiction (FIPS), resolved through pluggable platform adapters. The recorder is just another county system on the same machinery — different vendor platforms (Tyler Eagle, Kofile/GovOS, Fidlar, AcclaimWeb), the same jurisdiction registry + adapter abstraction.

So a **separate package would duplicate parcels' jurisdiction/adapter engine** (golden rule 1). Instead:

- **Generalize parcels** from "assessor deep-links" to **county property-record deep-links** — a jurisdiction can carry multiple typed record-system portals (**assessor**, **recorder**, **GIS**), each with its own platform adapter or template.
- **A future `property-links` package is the consumer aggregator** — it surfaces the county-government links (by wrapping parcels) in the same `PropertyLink[]` alongside the commercial sites (Zillow / Redfin / Google Maps / Realtor) and the property-data adapters.

### The layering

- **parcels** = the county-government records engine (assessor + recorder + GIS deep-links over the shared jurisdiction registry + adapters).
- **property-links** = the consumer aggregator (commercial sites + a parcels-wrapping provider for the county links) → one `PropertyLink[]`.

### Honest caveat

Recorder deed *images* are paywalled / portal-only (per the public-records research). So, exactly like the assessor, we **deep-link to the recorder's search — we do not pull deed data.** Chain-of-title work stays a human-on-the-portal task; parcels only removes the clicks to get there.

## Why the model generalization is deferred (not done now)

The current model is `AssessorSite` (one assessor portal per jurisdiction); the generalized shape is a jurisdiction carrying a `system` discriminator (`assessor | recorder | gis`), or a jurisdiction → systems map.

Normally "expensive to retrofit" (ADR-0078) would argue for doing it up front. Here it does **not**, because the **`stateSites` builder already insulates every per-county row** from the site shape: the ~530 registry rows are produced by `search` / `template` / `platform`, not written as literal `AssessorSite` objects. So adding a `system` dimension later is a **helper-level change**, not a 530-row retrofit — there is no retrofit penalty for waiting.

And we have **zero recorder/GIS data today**, so generalizing now would be guessing the shape. The right trigger is the first state's recorder data: at that point the generalization is mechanical (extend `stateSites` + the registry key), informed by a real second system.

**So:** finish assessor coverage (the active goal — every county searchable), keep the `stateSites` abstraction as the insulating seam, and generalize to multi-system when recorder data lands. The `property-links` aggregator is a separate, later consumer layer.
