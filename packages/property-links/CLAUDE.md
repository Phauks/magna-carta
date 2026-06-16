# @magna-carta/property-links — local notes

Pure, dependency-free utility (mirrors `@magna-carta/parcels`): turns a `PropertyReference` into the
external "view this property on X" links available for it. URL construction only — no network, no
credentials, no `env`, no UI.

- A `LinkProvider` is `{ id, label, build(reference) → url | null }`; `build` returns `null` when it
  lacks the info it needs. Add a provider = one file in `src/providers/` + one row in `registry.ts`.
- `resolvePropertyLinks(reference)` maps the registry and drops the `null`s — total, never throws.
- Delivered as plain `https` links; the consuming UI adds `target="_blank" rel="noopener noreferrer"`
  (Universal/App Links open the native app when installed, else the website). No `zillow://` schemes.
- Honest limit: address-only links land best-effort (Zillow usually the property, Redfin the search
  result) — neither site exposes a guaranteed exact-listing URL without an internal id.

Seams (see `docs/specs/2026-06-16-property-links-design.md`, ADR-0093): more providers (Trulia, FEMA flood-map, Bing/Apple/OpenStreetMap, NETR Online);
a county-assessor provider wrapping `@magna-carta/parcels` (`apn`/`jurisdictionId` reserved on the
reference); per-firm provider config; an optional credential-less framework adapter. Property _data_
(valuation/ownership) is a separate credentialed concern, not this package.
