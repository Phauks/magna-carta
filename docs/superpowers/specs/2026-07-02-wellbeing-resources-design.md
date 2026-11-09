# Wellbeing Resources — State Bar Lawyer-Assistance Directory

> **Status:** DESIGN — approved 2026-07-02, pending written-spec review.
> **Author stream:** `wellbeing-resources` branch.
> **Supersedes / relates:** reuses the authoring pattern of `@magna-carta/government-links`
> (per-state table → builder → FIPS-keyed registry → accessors + coverage-map verifier) and
> the research-corpus process of `docs/research/trust-rules/` (source corpus → structured
> `profiles.json` with per-field provenance → regenerable viewer).

## Goal

Consolidate, per US jurisdiction, the mental-health / emotional-support resources available to
lawyers — the State Bar **Lawyer Assistance Programs** (LAPs) and their affiliated hotlines,
peer networks, and clinical providers — behind a single curated, verified dataset the product
can surface in-app. A permanent **national safety net** (988 Suicide & Crisis Lifeline, SAMHSA
National Helpline, the ABA CoLAP directory) is always present, so a lawyer in any jurisdiction —
even one we have not yet covered — gets a real answer.

This is a **curated resource directory**, not a keyed deep-link lookup. That distinction drives
every structural decision below.

## What the research spike found (2026-07-02)

A six-way parallel spike (CA, TX, NY, WY, SD + a national sweep) established the real shape of the
data and killed the naive "one link per state" model:

- **Every state has a real program** — even the two small states picked to test the sparse case
  (WY, SD) have full programs. The hard problem is _shape variance_, not absence.
- **A state carries multiple resources, not one.** NY has a statewide NYSBA LAP **plus** a
  separate NYC Bar LAP **plus** county programs; WY has a bar program **plus** an outsourced
  clinical vendor (WPAP) **plus** a teletherapy member benefit; SD layers a peer network, a
  Sand Creek/ALLONE EAP, and a cost-coverage project. → **a state is a list of resources.**
- **Operator type varies:** state bar directly (CA), bar + affiliated nonprofit (TX
  Sheeran-Crowley Trust), voluntary bar (NY NYSBA), outsourced EAP vendor (WY WPAP, SD Sand
  Creek), or the courts. → `operatorType` field.
- **Scope varies within a state:** statewide vs. metro (NYC) vs. county. → `scope` field.
- **Contact is phone as often as URL, and hours vary.** TX/NY/SD publish 24/7 hotlines; CA/WY
  publish business-line numbers with **hours unstated**. → structured `phones[]`; never infer
  round-the-clock availability.
- **Confidential + free, with nuance:** confidential-by-statute (TX/NY/CA), "some services free,
  fees may apply" (CA). → short qualifier fields, not bare booleans.
- **Link rot is real and the bar's own site is not reliable.** SD's bar-site LAP path returns
  **404** (the live program lives on `sdlawyerwellness.com`); WY's page still lists the **dead**
  pre-988 crisis number. → per-resource `verifiedOn`; **we** own the national crisis numbers.
- **A canonical seed exists:** the ABA CoLAP by-state directory
  (`americanbar.org/groups/lawyer_assistance/resources/lap_programs_by_state/`). It 403s
  automated fetch, so enumeration needs a browser pass.

## Approach (decisions locked in brainstorming)

1. **New dedicated package**, `@magna-carta/wellbeing-resources` — its own resource-centric
   types, mirroring `government-links`' proven authoring pattern and reusing shared primitives
   (state FIPS/code keys, the coverage-map viewer). Chosen over cramming rich resources into
   `government-links`' `PortalSite`/`deepLink` shape (wrong fit) or a data-only JSON blob (loses
   type safety, tests, and the verify/needs-fix curation the link rot demands). `government-links`
   is additionally **paused** pending an integrations reorg — we build on our own ground.
2. **Data first, code second.** Research all jurisdictions into a structured corpus, _then_
   analyze it to finalize the model and build the package. The model below is a **hypothesis**;
   the corpus confirms or reshapes it — exactly as trust-rules deferred its schema until the
   corpus was clean.
3. **50 states + DC committed**; territories (PR/GU/VI/AS/MP) best-effort (likely
   national-fallback-only).
4. **Defer the in-app UI** to its own later slice (a true vertical slice through presentation).

## Phase A — Research corpus (mirrors `docs/research/trust-rules/`)

Root: `docs/research/wellbeing-resources/`

- `sources/US-XX/` — each jurisdiction's official LAP landing page(s) captured as PDF/HTML +
  `.txt` extraction; the national sources (988, SAMHSA, ABA CoLAP) captured once at the root.
  `manifest.yaml` records sha256 + provenance (publisher, year/accessed, `sourceUrl`,
  `accessGate`); `_collection-worklist.tsv` records how each was obtained.
- `group-N-*.md` — human-readable per-state research drafts, batched (e.g. AL–IN), each field
  marked with the confidence legend `✅` confirmed from a directly-fetched primary source /
  `⚠️` partial or inferred / `❓` unverified.
- `profiles/profiles.json` — **the dataset.** Per jurisdiction: a **list of resources**; every
  field carries provenance `{ value, confidence, sourceUrl, sourceTier, verifiedOn }`.
  `confidence ∈ HIGH | MEDIUM | LOW | NA`; `sourceTier ∈ primary-official | corroborated |
  secondary`. Each profile references its `sources/` manifest entry.
- `profiles/viewer.html` — the verify / needs-fix / fix coverage map, driven by `profiles.json`
  (lifted from the `government-links` and trust-rules viewers). **Generated — never hand-edited;**
  edit the dataset via `extract/*.json` inputs + a regenerable pipeline.
- **Seeding:** the six spike states (CA/TX/NY/WY/SD + national) drop in as `HIGH`, verified
  2026-07-02. The ABA CoLAP directory seeds the remaining jurisdictions via a browser pass
  (403s automated fetch), each then verified against the program's own official page.

**Discipline carried from trust-rules (non-negotiable):**

- Every `HIGH`/`MEDIUM` value rests on a **verbatim quote from a source fetched this session** —
  never training recall.
- Provenance is uniform across **every** field, not just some.
- A thin / absent jurisdiction is **not a gap**: it "resolves to the national safety net by
  design." `NA` is an answer.
- **We** supply the canonical national crisis numbers (988), never trusting a state page to be
  current.

## Phase B — Analyze → finalize model → build the package

With the jurisdiction profiles verified, confirm/adjust the model, then build
`packages/wellbeing-resources/` from the dataset.

### Data model (hypothesis — Phase B confirms against the corpus)

```ts
type OperatorType = "stateBar" | "nonprofit" | "court" | "vendor" | "national";
type ResourceScope = "statewide" | "metro" | "national";
type Availability = "aroundTheClock" | "businessHours" | "unspecified";
type ServiceTag =
  | "counseling"
  | "substanceUse"
  | "mentalHealth"
  | "peerSupport"
  | "crisisLine"
  | "teletherapy"
  | "financialAid"
  | "familySupport"
  | "monitoring";

interface Phone {
  readonly number: string; // display form, e.g. "800-343-8527"
  readonly label?: string; // "Confidential helpline", "Peer volunteer", "Intake"
  readonly availability: Availability; // only aroundTheClock when the page states it
  readonly hoursNote?: string; // free text when nuanced
}

interface WellbeingResource {
  readonly name: string; // "Texas Lawyers' Assistance Program (TLAP)"
  readonly operator: string; // "State Bar of Texas"
  readonly operatorType: OperatorType;
  readonly scope: ResourceScope;
  readonly url?: string; // landing page — may be off the bar's own domain
  readonly phones: readonly Phone[];
  readonly email?: string;
  readonly services: readonly ServiceTag[];
  readonly confidential?: string; // short qualifier, e.g. "Confidential by statute"
  readonly cost?: string; // "Free" | "Some services free; fees may apply"
  readonly description?: string; // one or two sentences
  readonly verifiedOn: string; // ISO date the url/phone was last confirmed
  readonly notes?: string;
}
```

A jurisdiction entry is keyed by **2-digit state FIPS** (same key space as `government-links`,
so the two align and can share a state-name/FIPS primitive) and holds `resources:
readonly WellbeingResource[]`. `NATIONAL_RESOURCES` lives at top level and is returned alongside
every jurisdiction.

**National safety net (always present):** 988 Suicide & Crisis Lifeline (call/text/chat, 24/7,
free, confidential); SAMHSA National Helpline 1-800-662-4357 (referrals, 24/7); ABA CoLAP by-state
directory (lawyer-specific routing).

### Package layout (mirrors `government-links`)

```
packages/wellbeing-resources/
  package.json · CLAUDE.md
  src/
    types.ts              # the model above
    helpers.ts            # tiny builder: stateResources(fips, code)…
    national.ts           # the always-shown national safety net
    states/
      california.ts  texas.ts  newyork.ts  wyoming.ts  southdakota.ts  …
    registry.ts           # composes states + national; accessors
    manifest.ts           # coverage manifest (which jurisdictions are done/verified)
  test/  (registry · states · national)
  mockups/directory.html  # verify/needs-fix coverage map (may share Phase A's viewer)
```

**Accessors:** `wellbeingResourcesForState(fips)`, `nationalResources()`, `allCoveredStates()`.

### Testing

Unit tests: registry composition; FIPS keys unique and valid; national resources always present;
every resource has ≥1 contact (`url` or a `phone`) and a `verifiedOn`; every `service` tag in
union; every `phone.availability` is `aroundTheClock` only where the source stated it. The six
spike states seed the fixtures.

## Non-goals / deferred

- **In-app wellbeing UI panel** — later slice.
- **Public marketing/directory page** — later, once the in-app surface proves the data.
- **Per-firm or matter scoping** — none; this is public reference data compiled into the bundle,
  like `government-links`.
- **Automated live link-checking** — the `verifiedOn` + viewer workflow is human-driven for v1;
  an automated checker is a possible later enhancement.

## Generalization — a reusable mass-state research corpus pattern

Trust-rules and this project are the second and third instances of the same shape: **fan-out
per-jurisdiction web research → a source corpus with provenance → a structured `profiles.json`
with per-field confidence → a regenerable viewer for human verify/needs-fix → analyze the clean
data to design a typed engine.** After Phase A ships, extract this into a reusable convention (a
documented template, or a skill) so the next mass-state project — licensing boards, filing fees,
court rules, notary rules — starts from the groove instead of reinventing it. Candidate home:
`docs/conventions/` (the process) + a shared viewer/pipeline primitive. Tracked here as a
follow-up, not built in this slice.

## Risks & open questions

- **ABA CoLAP 403** — enumeration needs a browser pass; budget for it in Phase A.
- **Territories** — LAP coverage may be genuinely absent; confirm they resolve cleanly to the
  national safety net rather than forcing empty rows.
- **Model drift** — the hypothesis model may need fields the spike did not surface (e.g. a
  distinct "cost-coverage / financial-aid program" as its own resource vs. a `financialAid`
  service tag). Phase B analysis is the checkpoint; do not freeze the model before the corpus is
  in.
- **Voluntary-bar states (NY)** — "which resource is authoritative" is location-dependent; the
  `scope` field encodes this, but the future UI must present statewide + metro without implying
  one supersedes the other.

## Success criteria

- Phase A: 50 states + DC each have ≥1 verified resource (or a clean `NA` → national fallback)
  in `profiles.json`, every field with provenance, and the viewer renders the coverage map with
  a working verify/needs-fix loop.
- Phase B: `@magna-carta/wellbeing-resources` builds and passes tests; `wellbeingResourcesForState`
  - `nationalResources` return the verified data; the national safety net is unconditionally
    present.
