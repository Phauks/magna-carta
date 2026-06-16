# Nevada Parcel / APN Enrichment — Build Approach

**Date:** 2026-06-15
**Scope:** Enriching Magna Carta's location data — especially houses — from Nevada county assessor sources. Starts with the most basic use case (an address opens the right county assessor's site) and grows, rung by rung, into in-app parcel/APN enrichment and an optional map. Data target where we pull it: **parcel identity + geometry + assessor attributes** (owner, value, land use, characteristics).
**Status & posture:** Internal enrichment for Magna Carta — **not sold to others** (for now; resale is a footnote, not a goal). This removes nearly all the legal weight: a deep-link is just a hyperlink, and consuming public data for our own use is the easy case. Research + approach; nothing built. Companions: [`public-records-landscape.md`](public-records-landscape.md) (wider records picture, coverage map) and [`property-data-integrations.md`](property-data-integrations.md) (AVM market value — a distinct path; here we use the assessor's roll value). **Not legal advice.**

## Method & confidence

Endpoints, fields, and APN formats were verified against the live ArcGIS REST services where marked **[VERIFIED]**; **[High/Med/Low]** otherwise.

## The basic use case (rung 1): address → assessor deep-link

The smallest useful thing, and it ships fast with **zero ingestion and zero legal exposure** — we're only pointing the user at a public site:

1. **Address → county.** In Nevada this is a 17-entry resolution (geocode to county, or ZIP/city → county for most addresses).
2. **County → assessor URL.** A static table of 17 county→URL templates, in two tiers:
   - **Deep-link to the parcel result** where the site accepts a URL parameter (Washoe and Clark can land on parcel detail by APN/address);
   - **Deep-link to the search page**, pre-filled where possible, otherwise just open the right county's property search.

It attaches naturally to a property address already on a **matter or Location** — "view this property in the county assessor." A config table and a resolver; no map, no scraping, no homework.

## The enrichment ladder

Each rung is optional and builds on the last:

1. **Deep-link** — address → assessor site. *(ships now, ~zero risk)*
2. **Inline lookup** — for API-backed counties (Washoe's fully-attributed FeatureServer; Clark's GISMO + roll join), pull APN, owner, assessed value, and characteristics and show them **inside Magna Carta** so the user never leaves. Internal use of public data — the easy legal case.
3. **Map** — MapLibre + parcel geometry, the visual layer.
4. **National (optional, later)** — an AI-maintained connector fleet that discovers, classifies, and self-heals per-county sources by platform pattern (ArcGIS / Beacon-qPublic / Tyler / GovOS / Fidlar / DevNet …), gated behind a deterministic validation harness. The genuine moat if this ever grows past internal use; out of scope for now.

"Enrich locational data, especially houses" lands on rungs 1–2: APN, owner-of-record, assessed value, land use, lot size, year built — the house dossier, per county.

## The data layer (rungs 2+)

### Canonical parcel model (normalize every county into this)

`county_fips` · `apn_raw` · `apn_normalized` (dash-stripped) · `situs_address` · `owner_name` · `mailing_address` · `assessed_value` (land/building/total) · `appraised_value` · `land_use` / `zoning` · `acreage` / `sqft` · `building` (beds/baths/year/stories) · `last_sale` (date/price) · `geometry` (polygon, WGS84) · `source` (county + service URL) · `source_date` · `fetched_at`.

The `source` / `source_date` / `fetched_at` provenance triplet makes "how fresh is each county" a first-class, queryable fact — and feeds the coverage map.

### Per-county sourcing

| Jurisdiction | Source | Attributes on the polygon? | Notes |
|---|---|---|---|
| **Washoe (Reno)** — start here | **OpenData FeatureServer** `wcgisweb.washoecounty.us/arcgis/rest/services/OpenData/OpenData/FeatureServer/0` [VERIFIED] | **Yes — fully joined** | Owner, situs, assessed+appraised value, land use, acreage, beds/baths/year, last sale all on layer 0. **Refreshed nightly.** Free Hub download (GeoJSON/CSV/Shapefile). The gold standard — do the end-to-end proof here. |
| **Clark (Las Vegas)** | **GISMO** `maps.clarkcountynv.gov/arcgis/rest/services/GISMO/AGParcel/MapServer/1` [VERIFIED] | **No — geometry only** (`APN`, `PARCEL`, `CLASS`) | Owner/value/address are NOT on a public REST layer; join to the Assessor roll (HTML apps `…/assessor/AssessorParcelDetail/`, `…/secroll/secroll.asp`). For internal lookups, rung 1 (deep-link to the roll page) sidesteps this entirely. **TLS gotcha:** use `maps.clarkcountynv.gov`, not `gisgate.co.clark.nv.us` (bad cert). |
| **Carson City, Churchill, Douglas, Lyon, Storey** | Open-data Hubs + the **CWSD** `gis.mbakerintl.com/server/rest/services/CWSD/Parcels/MapServer` [High] | Mixed | Usable REST; Churchill/Carson publish APN + site address downloads. |
| **Elko, Humboldt, Nye + rural tail** | **NDWR fallback** `arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_In_Nevada…/MapServer` (updated 2024-10-22) [High] | Limited | Recent, but **do NOT use the State Demographer aggregation** — see landmine. |
| **Smallest counties** (Esmeralda, Eureka, Lander, Lincoln, Mineral, Pershing, White Pine) | Human assessor portals → deep-link (rung 1) | — | Tiny populations; deep-link is plenty; manual pull only if you want inline data. |
| Statewide last resort | **NDOT** `gis.dot.nv.gov/agsphs/rest/services/Reference/Statewide_Parcels/MapServer/0` [VERIFIED] | Has owner/value fields | "All Parcels -2018-12-31" — **5+ years stale; uniform schema only, never trust owner/value.** |

### APN normalization

- **Clark:** 11-digit geographic APN `XXX-XX-X-XX-XXX` (e.g. `162-35-113-001`), stored as a **string without dashes** in GIS. [VERIFIED]
- **Washoe:** book-page-parcel, stored as an **integer** `APN` plus parsed `BOOK`/`PAGE`/`PARCEL`. [High]
- **Rule:** strip dashes, track the per-source type, normalize on ingest.

### Query examples

By APN (Washoe, fully attributed):
```
.../OpenData/OpenData/FeatureServer/0/query
  ?where=APN=12345678
  &outFields=APN,FIRSTNAME,LASTNAME,FullAddress,TOTALASS,LAND_USE,ACREAGE
  &returnGeometry=true&f=geojson
```
By address (Washoe — no separate geocoder needed):
```
.../FeatureServer/0/query?where=UPPER(FullAddress) LIKE '%1001 E 9TH ST%'&outFields=APN,FullAddress,TOTALASS&f=json
```

### Ingest pattern (rung 2+)

Prefer **periodic bulk ingest into our own normalized store** over live pass-through: nightly for Washoe, weekly/quarterly elsewhere. Gives us a fast API, offline resilience, and the coverage map. Use ArcGIS pagination (`resultOffset`/`resultRecordCount`) or the Washoe daily Hub export.

## The map layer (rung 3): MapLibre + PMTiles on R2 — not Google

- **MapLibre GL JS** (BSD-3, open fork of mapbox-gl-js) renders parcel polygons — no API key, no per-load fee. [High]
- **PMTiles** served straight from **R2** via HTTP range requests (no tile server; R2 has zero egress). Build with **tippecanoe** (`tippecanoe -zg --drop-densest-as-needed -o parcels.pmtiles parcels.geojson`), upload to R2, load via `pmtiles://`. Fits the existing Cloudflare stack. [High]
- **Base map:** OpenStreetMap (ODbL — commercial use fine, attribution, share-alike only on derivative databases) or county imagery. [High]
- **Why not Google as the foundation:** even for internal use Google Maps Platform forbids storing/caching tiles or geocodes (geocodes 30 days; only `place_id` kept indefinitely) and is the licensed, constrained option. MapLibre + OSM ingests no Google content and avoids all of it. Google is fine only as a live display base map if you ever want it. [High]

## Licensing — light, because we're not reselling

- **Rung 1 (deep-link) carries no data-licensing question at all** — it's a hyperlink to a public site.
- **Rungs 2–3 (internal enrichment from public data):** parcel/assessor data is a **Nevada public record** (NRS 239.010 — open and copyable, fees at actual cost). Using it for our own enrichment is the easy case; **the per-county resale clauses don't bite because we're not redistributing.** Still respect each county's access/automation terms when ingesting.
- **Landmine — NRS 250.087:** county parcel datasets given to the **State Demographer are confidential and non-redistributable**. Source each county's *own* public publication directly; never shortcut through the demographer aggregation. [High]
- **The licensed layer is the base map, not your parcels** — MapLibre + OSM sidesteps it.
- **Footnote — if we ever sell it:** resale flips the calculus (per-county terms, multi-tenant credentialing, OEM/redistribution licensing) and a Nevada attorney's review becomes a prerequisite. That's a future decision, not today's.

## How far could this go? (the "like Regrid" question, parked)

A nationwide parcel dataset is a **perpetual data-operations business**, not a build-once product — Regrid normalizes ~3,229 counties with hundreds of cleaning steps and constant refresh; a federal study modeled a national layer at ~$295M one-time **plus ~$85M/year recurring**. That recurring line is why aggregators cost what they do. **Nevada is the opposite:** ~86% of population sits on **two ArcGIS feeds** (Clark + Washoe), so a small team can cover it directly, and the rural tail is trivial by volume. The national ambition (rung 4, the AI connector fleet) only matters if this outgrows internal use.

## This as its own workstream

Treat it as a **separable internal project** with its own name — the parcel/location-enrichment engine — that Magna Carta consumes through the property-data port, exactly where an external vendor would sit, except we build it. Keeping the data layer and the map layer separate means either can be reused or rebuilt independently (in-app panel, the public coverage map, a future standalone). *(Whether it ever becomes its own product/entity is a later business call; the architecture supports it either way.)*

## Open items to verify

- Per-county assessor **deep-link URL templates** and which accept an APN/address parameter (the rung-1 config) — start with Washoe and Clark.
- Washoe's confirmed APN field name/type and the exact Clark Assessor-roll join path (for rung 2).
- Each county's access/automation terms before any ingest.
- A Nevada attorney's review **only if/when** resale is ever on the table.

## Sources

- Clark: [GISMO directory](https://maps.clarkcountynv.gov/arcgis/rest/services) · [AGParcel layer](https://maps.clarkcountynv.gov/arcgis/rest/services/GISMO/AGParcel/MapServer/1) · [Assessor property search](https://www.clarkcountynv.gov/government/assessor/property_search/)
- Washoe: [OpenData FeatureServer](https://wcgisweb.washoecounty.us/arcgis/rest/services/OpenData/OpenData/FeatureServer/0) · [Washoe parcels open data](https://explore-washoe.opendata.arcgis.com/datasets/washoe::parcels)
- Statewide fallbacks: [NDWR County Parcels](https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers) · [NDOT Statewide_Parcels (2018)](https://gis.dot.nv.gov/agsphs/rest/services/Reference/Statewide_Parcels/MapServer/layers) · [CWSD Parcels](https://gis.mbakerintl.com/server/rest/services/CWSD/Parcels/MapServer) · [Carson City open data](https://data-carsoncity.opendata.arcgis.com/)
- Map stack: [MapLibre GL JS](https://maplibre.org/) · [PMTiles](https://protomaps.com/docs/pmtiles) · [tippecanoe](https://github.com/felt/tippecanoe) · [Cloudflare R2](https://developers.cloudflare.com/r2/)
- Licensing: [OpenStreetMap / ODbL](https://www.openstreetmap.org/copyright) · [NRS 239](https://www.leg.state.nv.us/nrs/nrs-239.html) · [NRS 250.087](https://www.leg.state.nv.us/nrs/nrs-250.html) · [Google Maps Platform ToS](https://cloud.google.com/maps-platform/terms)
- National reference: [Regrid](https://regrid.com/) · [ATTOM](https://www.attomdata.com/)
