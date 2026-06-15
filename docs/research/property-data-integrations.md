# Property-Data Integrations — Magna Carta

**Date:** 2026-06-15
**Scope:** Third-party property-data services — parcel/APN lookup and property valuation (AVM) — as candidate integration adapters.
**Purpose:** A forward-looking backlog of potential adapters for the _Integrations_ phase (the plugin marketplace seam, populated). Nothing here is built or selected. Every vendor named is a candidate; access terms, pricing, coverage, and historical-data depth are all **to confirm when we get closer**. This is a research note, not a commitment.

## Why a firm needs this

The driver is **point-in-time / retrospective property valuation** — "what was this house worth as of date X" — which recurs across practice areas:

- **Probate & estate** — date-of-death valuation of real property for the estate inventory.
- **Family law** — date-of-marriage and date-of-separation values for asset division.
- **Litigation** — as-of-filing or as-of-incident valuation where real property is in dispute.

Secondary uses fall out of the same data: **matter intake** (identify a property precisely by APN), **conflicts enrichment** (tie a directory party to owned property), and **conveyancing** (legal description, ownership, assessment history).

## Two port angles

Property data splits cleanly into two category ports under the ports-and-adapters model (see the white paper, _Plugin / Add-on system_). They are kept separate because the vendor sets differ and APN lookup unlocks far more than a single valuation number — though some vendors span both.

### 1. Parcel / APN lookup port

Resolve and enrich a parcel: **APN ↔ address**, parcel boundaries/geometry, current ownership, assessment history, and legal description — the rich property dossier.

Candidate adapters:

- **Regrid** — nationwide parcel boundaries + APN, broad coverage.
- **ReportAll USA** — parcel API (boundaries, owner, APN).
- **LightBox** — parcel/APN and property data.
- **ATTOM Data** — parcel + assessment/sales history (also spans valuation).
- **Melissa** — property/parcel lookup.
- **CoreLogic** — parcel and ownership data (enterprise; also spans valuation).
- **Direct county-assessor feeds** — authoritative but per-county and uneven; a fallback where a vendor lacks coverage.

### 2. Property valuation (AVM) port

Estimate value — ideally **as-of a point in time / with historical series**, not just a current figure.

Candidate adapters:

- **ATTOM Data** — AVM plus sales/assessment history.
- **HouseCanary** — AVM and valuation API with history.
- **CoreLogic** — AVM (enterprise).
- **Black Knight / ICE** — AVM.
- **Quantarium** — AVM.
- **Clear Capital** — ClearAVM.
- **RentCast / RealtyMole** — value + rent estimates, lower-cost API.
- **Zillow (Zestimate)** and **Redfin** — **potential sources to detail later**; their public-API access for point-in-time valuation is limited and needs confirming when we get closer.

## Fit & notes

- **Ports-and-adapters.** Each port is a typed category interface; each vendor is a swappable adapter — its own Worker behind the port with per-firm scoped secrets, consistent with every other integration.
- **Procurement is the gate, not engineering.** As with the legal-research adapters, design the port now and license the adapter when vendor access (terms, coverage, historical depth, pricing) is confirmed. Treat data-licensing and each vendor's ToS as a procurement prerequisite.
- **Some vendors span both ports** (ATTOM, CoreLogic) — one credential, two adapters.
- **Historical depth is the differentiator.** The legal use cases need _as-of-date_ values and assessment history, not just a current estimate; confirm each vendor's historical coverage before selection.

## Sources

- [Regrid — parcel data](https://regrid.com/)
- [ReportAll USA — parcel API](https://reportallusa.com/)
- [LightBox](https://www.lightboxre.com/)
- [ATTOM Data — property data API](https://www.attomdata.com/)
- [HouseCanary](https://www.housecanary.com/)
- [CoreLogic](https://www.corelogic.com/)
- [RentCast API](https://www.rentcast.io/api)
