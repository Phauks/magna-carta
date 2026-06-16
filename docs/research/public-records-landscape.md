# US Public-Records Landscape & Coverage Strategy

**Date:** 2026-06-15
**Scope:** The structure of US public records (court, property, business, vital, identity), what systems and commercial aggregators cover each, the legal gates on access, and what Magna Carta can realistically integrate — with Nevada as the worked example. Folds in the **coverage map** concept (a future marketing-site feature).
**Purpose:** Decide where direct integration is feasible versus where an aggregator (or nothing) is the only option, and which categories to prioritize. Forward-looking research; nothing is built. Companion to [`property-data-integrations.md`](property-data-integrations.md) (parcel/APN valuation) — this note covers the records sourcing those features draw on.

## Method & confidence

Gathered by fan-out web research across federal/state/county systems and the major aggregators, cross-corroborated. Confidence is tagged **High / Med / Low** inline where it matters. Two **migrations are in flight in 2026** and will move URLs and pricing: Nevada appellate court records → **CTrack** (~June 2026), and the Nevada Secretary of State → the **ORION** platform (UCC already migrated Dec 2025; SilverFlume retiring ~late summer 2026). The recurring structural fact: holdings are overwhelmingly **state/county-controlled and fragmented** — any "national" claim is a vendor aggregation layer, not a government endpoint.

## Strategic summary (the decisions this note serves)

- **Two priorities, opposite ends of the feasibility spectrum.** **Parcel/APN data is the single most coverable category** (real county GIS APIs + open bulk data). **Court records are among the least** (no government APIs; state/county is portal-only and scraping violates ToS). Both are high priority for us; they need different strategies.
- **Skip-trace / background checks are deprioritized — by design, not just effort.** The blocker is the **permissible-purpose model**: under GLBA/DPPA/FCRA the legal right to pull the data attaches to the **end user**, not the platform, so each firm must be individually credentialed. A SaaS cannot lawfully resell these lookups from one account. This is structural, not a coverage gap we can close.
- **Nevada is the right beachhead.** 17 county-equivalent jurisdictions; **Clark (Las Vegas) + Washoe (Reno) ≈ 85% of population**, and both reuse the *same* vendor systems (Tyler Odyssey for courts, ArcGIS for parcels), so a few connectors cover most of the state. Start with **APN (clean, open)**, then court (scrape-or-aggregator).

## The five categories

### 1. Court & litigation records

Subcategories: civil, criminal, family, probate, traffic (state/county trial courts); bankruptcy + federal civil/criminal/appellate (federal).

- **Federal — tractable.** **PACER** (read layer over CM/ECF; $0.10/page, capped $3.00/doc, waived ≤ $30/quarter) exposes a real **Case-Locator API**. **CourtListener / RECAP** (Free Law Project) is the open mirror — a genuine **REST API v4 + bulk** over a large federal docket archive (per-case completeness depends on user uploads). [High]
- **State & county — the hard problem.** No national database; **most states have no complete statewide portal**. ~3,200 county custodians. Dominant case-management system is **Tyler Technologies Odyssey** (~half the US population), surfaced as per-county **Odyssey portals** — **human search pages only, no public API, scraping expressly against ToS and enforced**. A minority of states are genuinely unified (PA, FL, ID). [High]
- **Sealing is per-jurisdiction.** Juvenile sealed by default; family/domestic heavily restricted. "Court record" ≠ "public" — any pipeline must respect per-jurisdiction rules. [High]
- **Aggregators (real APIs):** **UniCourt** (API-first, 4,000+ courts, 40+ states), **Docket Alarm** (best-documented, transparent ~$40–100/mo + PACER pass-through), **Trellis.law** (state-trial-court specialist), **Courthouse News CasePortal** (new-filing focus), **LexisNexis CourtLink** (enterprise, not self-serve). Pricing mostly sales-quoted. [High capability / Low pricing transparency]

**Verdict:** Federal is integrable directly. State/county realistically requires an aggregator for breadth, or focused-jurisdiction scraping with accepted ToS/legal risk.

### 2. Property & land records

- **Assessor / parcel / APN — the bright spot.** County assessor + GIS. **APN is the universal join key** between the tax roll and the GIS parcel-boundary layer. Many counties expose **real ArcGIS REST services + open bulk downloads** (GeoJSON/shapefile/CSV) — genuine machine access, no scraping. [High]
- **Recorder / Register of Deeds — locked down.** Deeds, mortgages/deeds of trust, liens. County-level (town/municipal in New England), ~3,000+ jurisdictions, no standard. Vendor portals (Tyler Eagle, Kofile/GovOS, Fidlar) are **portal-only, indexes often free but images paywalled**. Needed for title/chain-of-title work, not for APN lookups. [High]
- **Aggregators (self-serve APIs):** **ATTOM** (assessor + deeds + 40-yr sales history), **CoreLogic** (largest legacy DB, enterprise), **Regrid** (parcel boundaries + bulk, ~99.8% of counties), **ReportAll USA** (parcels + attributes), **LightBox** (SmartParcels). Coverage percentages are vendor self-reported and **population-weighted, not county-weighted**. [API existence High / coverage Med]
- **GLBA does not gate consuming recorded land/assessor data** — publicly-available-government-record exemption. Friction is operational (fragmentation, non-disclosure states where sale prices aren't public), and aggregator *contract* terms on redistribution — not statute. [High]

**Verdict:** Parcel/APN is directly coverable per county (GIS REST) and via national aggregators. Deed documents are scrape-or-aggregator and lower priority.

### 3. Business & commercial filings

- **Entity registrations** — Secretary of State, ~51 separate systems, no federal registry; Delaware (the key formation state) has **no public API/bulk** — aggregator effectively mandatory for breadth. **UCC** filings at state SoS (central) + county (fixtures). **Trademarks/patents** at **USPTO** — the cleanest source (free REST APIs + bulk via the Open Data Portal). [High]
- **Aggregators:** **Cobalt Intelligence** (50-state entity, closest to a self-serve SoS dev API; UCC only ~11 states), **OpenCorporates** (200M+ global, strong provenance), **Middesk** (50-state KYB). **UCC is the weakest area across all vendors.** [High entity / Med UCC]

**Verdict:** Medium priority. Often cheapest via a state's official bulk product (see Nevada) plus USPTO direct for marks.

### 4. Vital & personal records

- **Birth / death** — state vital-records office; **frequently NOT open public records** (restricted to eligible parties; public only after long embargoes). CDC/NCHS holds statistics, not certificates. SSA Death Master File via NTIS is certification-gated. [High]
- **Marriage / divorce** — more often public; marriage via county recorder/clerk, divorce via the District Court (same portals as category 1). [High]
- **Voter registration** — state rolls, huge variance; **most states prohibit commercial use** (likely blocks legal-tech use). [Med]
- **Professional licensing** — state boards (portal-only, board-by-board) + clean federal exceptions: **NPI/NPPES** (CMS healthcare, free REST API + bulk) and **FINRA BrokerCheck**. [High federal exceptions / Med state patchwork]
- **Motor-vehicle records** — state DMV, **DPPA-gated** (permissible-use accounts only). [High]

**Verdict:** Low priority. Births/deaths off-limits; marriage/divorce ride the court portals; NPI/FINRA are clean federal API targets if ever needed.

### 5. Identity / contact / investigative data (skip-trace / people-search)

**Not a government system** — a commercial industry on credit-header + utility/phone + public-records data. Vendors: **LexisNexis Accurint**, **Thomson Reuters CLEAR** (CLEAR is Thomson Reuters, *not* LexisNexis), **TLOxp** (TransUnion), **Tracers**, **idiCORE** (IDI/red violet), **MicroBilt**. All have APIs, all are **gated credentialed access** with per-query permissible-purpose attestation, field-level masking of SSN/DOB/DL, and (for the heaviest) on-site inspection. [High]

**Verdict:** **Deprioritized.** Structurally incompatible with one-account multi-tenant resale (see below). Revisit only as per-firm BYO-credential pass-through, if ever.

## Permissible-purpose law map

Three federal statutes create true **use-gates** (who may receive data and how they may use it). State data-broker laws add registration/deletion, not new use-gates.

| Statute | Gates | Law-firm path |
|---|---|---|
| **DPPA** (18 USC §2721) | State DMV driver/registration data | §2721(b)(4) **litigation** use is the core exception; *Maracich v. Spears* — does **not** cover client solicitation. Resellers carry a duty to inquire + 5-yr redisclosure records. |
| **GLBA** (15 USC §6801) | Credit-header / financial NPI (why skip-trace SSN/address is gated) | §6802(e)(3) fraud/risk/fiduciary and (e)(8) legal-process exceptions. **Recorded land/assessor records are exempt** (public-record). |
| **FCRA** (15 USC §1681) | Any data *used for* eligibility (credit/employment/insurance/tenancy) | Skip-trace "locate" products are sold with an **FCRA non-use certification**; the same record becomes a regulated consumer report the instant it's used for an FCRA purpose. |
| **State broker laws** (CA Delete Act/DROP live Jan 2026; VT, TX, OR; CT Jan 2027) | Broker **registration + deletion**, not use | Likely don't bind a platform that only *consumes* an aggregator API — but the federal use-gates flow through every query. |

**Architectural implication (load-bearing):** if we ever touch DPPA/GLBA/FCRA-gated data, capture an explicit **permissible-purpose code per query** bound to the matter/user, with SSN/DOB/DL gated behind credentialed roles — exactly what every aggregator contractually requires, and cheap now versus a retrofit.

## Nevada assessment (the worked example)

**17 county-equivalent jurisdictions** (16 counties + Carson City), grouped into 11 judicial districts. **Clark ~2.41M + Washoe ~509K ≈ 85%+ of the ~3.1M population**; the other 15 are rural-to-frontier (smallest: Esmeralda ~729). [High] Both metros reuse the same vendor systems, so a few connectors go far. The rural long tail is high-effort, low-population, often no online portal.

| Category | Machine-accessible? | What we'd integrate |
|---|---|---|
| Courts | **No** | Scrape Tyler **Odyssey** portals (Clark `clarkcountycourts.us`, Washoe `washoecourts.com`) + appellate ACIS → **CTrack** ~June 2026. ToS caution. |
| Property — **parcel/APN/GIS** | **Yes** | **Clark GISMO ArcGIS Hub** + **Washoe ArcGIS REST FeatureServer** (daily refresh): REST query + GeoJSON/shapefile/CSV. Statewide NDOT parcel layer exists but **stale (2018)**. |
| Property — recorder index | **No** | Scrape AcclaimWeb (Clark) / ICRIS (Washoe); images paywalled. |
| Business | **Yes (paid bulk)** | SoS **bulk dump ~$125 / ~$500-mo** — now via **ORION**; re-confirm post-migration pricing. No free REST API. |
| Vital | **No** (births/deaths legally closed, NRS 440) | Marriage/divorce via county/court portals (scrape). |
| DMV | **No** (DPPA) | Permissible-use account (Form IR001), not a feed. |
| Licensing | **No** | Scrape each board (State Bar, Contractors, Medical, Nursing, Real Estate…). No API found. |

**Read:** the only true APIs in Nevada are **county GIS/parcel REST services** (the APN bright spot); the only true official bulk feed is the **SoS paid data product**. Everything else is portal scraping, and DMV + state birth/death are legally restricted regardless of technical means.

## Build-direct vs. buy-aggregator, and the multi-tenant reality

- **Direct is realistic** when the jurisdiction set is small, enumerable, already online, and publishes a bulk/open feed or stable GIS API — e.g. **Nevada parcel/APN via Clark + Washoe ArcGIS**. Effort scales linearly with hand-maintained connectors against drifting formats: sane for a focused footprint, not for national breadth.
- **An aggregator is the only sane option** for broad/national coverage — 3,000+ recording jurisdictions, ~24,000 taxing agencies, no data standard, most with no API. Even major title plants cover only ~1,800 of 3,000+ counties; that gap is *why* the aggregation industry exists.
- **Multi-tenant credentialing — the SaaS-shaping fact.**
  - *Non-regulated data (court dockets, parcels, business filings):* one platform account can serve many tenants, but **self-serve aggregator terms forbid resale** (ATTOM, Regrid, OpenCorporates internal-use) — needs a negotiated **OEM/redistribution license** (often per-end-user/per-record pricing). Direct county GIS data carries no such restriction — another point for **direct APN coverage** in the beachhead.
  - *Regulated data (skip-trace, DPPA-touched):* **no** — permissible purpose attaches to the end user; each firm must be individually credentialed. Compliant patterns are **per-tenant BYO-credential pass-through** (recommended, low liability; a bar number often satisfies vetting) or **platform-as-reseller** (inherits the full vetting/audit/duty-to-inquire stack).

## The coverage map (future marketing-site feature)

A general, public-facing **interactive US map of what Magna Carta covers** — not limited to public records. Coverage varies by jurisdiction across many dimensions (court-records sourcing, parcel/APN, e-filing, court-rules docketing, trust-accounting jurisdiction profiles, business filings), and an honest, granular map of "here's exactly what we support in your county/state" is a credibility and differentiation move no competitor advertises.

- **Two audiences, one data source.** Internally it is the gap/roadmap instrument (per **dimension × jurisdiction**, a status: *Direct API · Aggregator-backed · Scrape · None/Restricted*). Externally it is a marketing-site asset. Both are **views over the same provenance/source registry** the platform already needs — coverage status is derivable, not a separate system, which is a further reason to make per-record **`source` + jurisdiction provenance** first-class early.
- **General, not records-only.** Frame the map as platform-wide coverage so it can grow to include any jurisdiction-varying capability, with public records and parcel/APN as the first populated layers.
- **Status:** future; lives on the marketing site (itself a later, pre-distribution workstream). Captured here so the provenance/coverage data model is designed to feed it.

## Open questions / to verify before relying on this

- Aggregator pricing and **reseller/OEM terms** (UniCourt, Trellis, CourtLink, ATTOM, CoreLogic, Cobalt, Middesk, Tracers, IDI) — mostly sales-quoted; have counsel review GLBA/DPPA/FCRA reseller liability directly.
- Post-migration Nevada specifics: **CTrack** court URLs (~June 2026) and **ORION** SoS bulk/UCC pricing.
- Exact recording-jurisdiction count (no single census) and aggregator coverage % (vendor-reported, population-weighted).
- A possible non-publicized Clark County Clerk bulk-records arrangement (direct inquiry).

## Sources

- Federal courts: [PACER](https://pacer.uscourts.gov/) · [CourtListener / RECAP API](https://www.courtlistener.com/help/api/rest/)
- Court aggregators: [UniCourt API](https://unicourt.com/products/api) · [Docket Alarm](https://www.docketalarm.com/) · [Trellis](https://trellis.law/) · [LexisNexis CourtLink](https://www.lexisnexis.com/en-us/products/courtlink-for-corporate-or-professionals.page)
- Property: [ATTOM](https://www.attomdata.com/) · [CoreLogic](https://www.corelogic.com/) · [Regrid](https://regrid.com/) · [ReportAll USA](https://reportallusa.com/) · [LightBox](https://www.lightboxre.com/)
- Business: [USPTO Open Data Portal](https://data.uspto.gov/) · [Cobalt Intelligence](https://www.cobaltintelligence.com/) · [OpenCorporates API](https://api.opencorporates.com/) · [Middesk](https://www.middesk.com/)
- Skip-trace: [LexisNexis Accurint](https://www.accurint.com/) · [Thomson Reuters CLEAR](https://legal.thomsonreuters.com/en/products/clear-investigation-software) · [TLOxp](https://www.tloxp.com/) · [Tracers](https://www.tracers.com/) · [idiCORE](https://www.ididata.com/) · [MicroBilt](https://www.microbilt.com/)
- Law: [DPPA 18 USC §2721](https://www.law.cornell.edu/uscode/text/18/2721) · [GLBA 15 USC §6802](https://www.law.cornell.edu/uscode/text/15/6802) · [FCRA 15 USC §1681b](https://www.law.cornell.edu/uscode/text/15/1681b) · [CA Delete Act / DROP](https://cppa.ca.gov/)
- Nevada: [Nevada Judiciary](https://nvcourts.gov/) · [Clark County Courts portal](https://www.clarkcountycourts.us/Portal/) · [Washoe County Courts](https://www.washoecourts.com/) · [Clark County GISMO](https://clarkcountygis-ccgismo.hub.arcgis.com/) · [Washoe County open data](https://explore-washoe.opendata.arcgis.com/) · [NV SoS entity search](https://esos.nv.gov/) · [NV Project ORION](https://projectorion.nv.gov/) · [NV SoS data download](https://www.nvsos.gov/sos/online-services/data-download) · [NV Office of Vital Records](https://dpbh.nv.gov/) · [NV DMV records](https://dmv.nv.gov/records.htm) · [State Bar of Nevada](https://nvbar.org/)
