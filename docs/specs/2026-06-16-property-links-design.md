# Property external-links resolver — design

**Status:** Accepted (design) · **Date:** 2026-06-16 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ (build-in-vs-plugin rule) and _Integrations_ → property data
**Research input:** deep-link investigation 2026-06-16 (Zillow/Redfin URL formats + universal-link behavior, synthesized inline); companion to [`docs/research/property-data-integrations.md`](../research/property-data-integrations.md)
**ADRs:** **ADR-0093 (property external-links as a pure registry-driven utility; links-vs-data split — new)**

A small pure utility that turns what we know about a property into the external lookup links available for it — "view this property on Zillow / Redfin / …" — so a user reaches the information in one click. **Pure backend logic only; no UI** (the buttons ride the Locations UI when it lands). Mirrors `@magna-carta/parcels` (the county-assessor deep-link resolver): URL construction, no network, no credentials, no `env`.

**Why this shape (ADR-0093).** Zillow **retired its public API (~2021)** and Redfin has none; scraping either violates their ToS. So for these services the **deep-link is the ceiling** — valuation (Zestimate), listing data, ownership, and history **cannot** be pulled from them programmatically. That richer data is a *separate, credentialed* concern (ATTOM/Regrid/HouseCanary — [`property-data-integrations.md`](../research/property-data-integrations.md)), behind the integration framework's future credentialed adapters; it does not belong here and Zillow/Redfin cannot feed it. This package is therefore the **external-links** half of property lookups — pure, credential-less, and extensible by adding providers, distinct from the **property-data** half.

**Build gates:** none. Pure library; depends only on the workspace toolchain. The consuming UI is gated on the Locations UI (design system 0·7a → 0·7b → slice 1·1 UI) — out of scope here.

---

## 1. Module placement

New pure package **`@magna-carta/property-links`** (mirrors `packages/parcels`): `type: module`, `sideEffects: false`, subpath exports, no runtime dependencies. Files:

- `src/types.ts` — `PropertyReference`, `PropertyLink`, `LinkProvider`.
- `src/format.ts` — `formatAddress(reference)` (the one place address components become a string).
- `src/providers/zillow.ts`, `src/providers/redfin.ts` — one provider each.
- `src/registry.ts` — the provider array + `resolvePropertyLinks(reference)`.

Adding a provider is one file + one registry row — nothing else changes (the `parcels` design point).

## 2. The provider model

```ts
export interface LinkProvider {
  readonly id: string;            // e.g. "zillow"
  readonly label: string;         // e.g. "Zillow" (button text)
  build(reference: PropertyReference): string | null; // null = insufficient info
}
```

`resolvePropertyLinks(reference): PropertyLink[]` maps the registry, calls each provider's `build`, and **drops the `null`s** — so the result is exactly the lookups usable for what the caller knows. **Total function: never throws, never yields an empty or malformed URL** (the `parcels` discipline — a consumer can always render whatever comes back).

## 3. Input — `PropertyReference`

Aligned to the codebase's `AddressInput` (`street`/`city`/`region`/`postal`) so a Location maps in directly:

```ts
export interface PropertyReference {
  readonly street?: string;
  readonly city?: string;
  readonly region?: string;        // state / province
  readonly postal?: string;
  readonly formattedAddress?: string; // pre-joined convenience; wins if present
  readonly apn?: string;             // unused by Zillow/Redfin — reserved for the assessor provider seam
  readonly jurisdictionId?: string;  // 5-digit county FIPS — reserved for the assessor provider seam
}
```

`formatAddress` returns `formattedAddress` when set; otherwise joins `[street, city, "region postal"]` with `", "`, skipping empties. A provider that needs an address returns `null` when `formatAddress` yields too little to be useful (rule: requires `street` **and** at least one of `city`/`postal`).

## 4. Providers (v1)

From the 2026-06-16 investigation:

- **Zillow** (`id: "zillow"`): `https://www.zillow.com/homes/{slug}_rb/` where `slug` = the formatted address with runs of whitespace → single `-`, commas dropped, the literal `_rb/` appended. Example: `123 Main St, Reno, NV 89501` → `https://www.zillow.com/homes/123-Main-St-Reno-NV-89501_rb/`. Geocodes and usually redirects to the property page.
- **Redfin** (`id: "redfin"`): `https://www.redfin.com/?location={encoded}` where `{encoded}` is the formatted address `encodeURIComponent`-ed. Example: `https://www.redfin.com/?location=123%20Main%20St%2C%20Reno%2C%20NV%2089501`. Lands on the search/map result (auto-navigates to the listing on a single exact match).

**Honest limitation (documented, not a defect):** neither yields a *guaranteed* exact-listing URL from a bare address — both need an internal id (Zillow ZPID / Redfin property id) we do not have. These are best-effort "look up this address" links. Acceptable for the feature.

**Delivery is a plain hyperlink.** Both sites register Universal Links (iOS) / App Links (Android), so a normal `https` link opens the native app when installed and the website otherwise — on mobile, desktop, and (via OS hand-off) the future Tauri webview. No custom URL schemes (`zillow://`/`redfin://` are undocumented, fragile, and have no web fallback). The resolver returns only the `https` URL; the **anchor attributes** (`target="_blank" rel="noopener noreferrer"`) are the UI's concern (§6).

## 5. Output — `PropertyLink`

```ts
export interface PropertyLink {
  readonly providerId: string; // LinkProvider.id
  readonly label: string;      // LinkProvider.label
  readonly url: string;        // ready-to-use https URL
}
```

## 6. Surfacing (UI — out of scope now)

The resolver is UI-agnostic. When the Locations UI lands, the screen calls `resolvePropertyLinks` with the Location's address and renders the `PropertyLink[]` as a row of buttons — `<a href={url} target="_blank" rel="noopener noreferrer">{label}</a>` — through the design system. The same resolver later serves a Directory "property" entity or a matter's subject-property: anywhere an address lives, one call gives the full lookup set.

## 7. Testing

- **Per provider:** exact expected URL for a known address; encoding edge cases (spaces, commas, abbreviations); `null` when the reference lacks `street` or both `city`/`postal`; `formattedAddress` override path.
- **`formatAddress`:** component joining, empty-skipping, the `formattedAddress` short-circuit.
- **`resolvePropertyLinks`:** aggregates all providers; drops `null`s; an empty/blank reference yields `[]` and never throws (the total-function guarantee).
- Pure unit tests (Vitest, node pool), like `parcels`.

## 8. Seams (no code now)

- **More providers** (one registry row each): Google Maps / Street View, Realtor.com, Trulia, and a **county-assessor provider that wraps `@magna-carta/parcels`** (`apn` + `jurisdictionId` already reserved on `PropertyReference`) — folding the assessor deep-link into the same `PropertyLink[]`, unifying all "view this property externally" lookups in one list.
- **Per-firm provider configuration** (which providers to show, ordering) via the settings registry (ADR-0040) — declared when there is a settings UI.
- **Optional framework adapter:** expose the resolver as a credential-less adapter behind a `propertyExternalLinks` port (the `parcels`-as-adapter precedent, ADR-0091) if it should appear in the integration registry. Not needed for a directly-callable pure utility.
- **Property-data (separate subsystem):** valuation/ownership/assessment via credentialed vendor adapters — explicitly *not* this package.

## 9. Decisions recorded & docs

**ADR-0093** (Decision Log): property external-links as a pure registry-driven utility; the links-vs-data split; Zillow/Redfin capped at deep-links (no API). On build: a row in [`ROADMAP.md`](../../ROADMAP.md) + [`STATUS.md`](../../STATUS.md) and a `CHANGELOG.md` entry, same commit (golden rule 5). No per-firm data surface, so the load-profile accretion rule does not bind (a pure resolver).
