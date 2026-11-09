---
number: 120
slug: web-domains-tool-group-and-website-context-tag
status: Accepted
date: 2026-06-22
area: Tools catalog
summary: "The @magna-carta/tools catalog gains a new 'web-domains' subject group (label: Websites & Domains) inserted before 'diagnostics', and a new 'website' context tag. Both the WHOIS Lookup and Safe Website Viewer tools declare this context tag, enabling any future surface that holds a URL or domain (e.g. a Directory contact's website field) to call toolsFor('website') and get both tools for free. Builds on ADR-0101."
---

**The Tools catalog gains a `web-domains` subject group and a `website` context tag, enabling both WHOIS Lookup and Safe Website Viewer to surface contextually wherever a URL or domain appears.** Builds on **ADR-0101**.

**Context.** The WHOIS Lookup and Safe Website Viewer tools (spec: [`docs/specs/2026-06-22-whois-and-safe-website-viewer-design.md`](../specs/2026-06-22-whois-and-safe-website-viewer-design.md)) act on a new kind of subject — a website, domain, or URL — that the existing `ContextTag` union (`"address"`, `"person"`, `"business-entity"`, `"property"`, `"government"`, `"diagnostics"`) does not cover. The existing subject groups also do not cover this subject; the nearest is `"diagnostics"`, but these are security-hygiene lookups on external subjects, not internal system diagnostics.

**Decision.** (1) **New subject group `"web-domains"`** with the display label **"Websites & Domains"**, inserted into `SUBJECT_GROUP_ORDER` immediately before `"diagnostics"`. Tools that act on an external website or domain subject go here, not in `diagnostics`. (2) **New context tag `"website"`** added to the `ContextTag` union. Both `whois-lookup` and `safe-website-viewer` declare `contextTags: ["website"]`. (3) The catalog purity fitness function (`packages/tools/test/purity.test.ts`) continues to pass — the new rows reference logic by stable `id` only and import nothing below the catalog layer.

**Consequences.** Any future surface that holds a URL or domain field — for example, a Directory contact's website, a matter's opposing-party URL, or a location's website — can call `toolsFor("website")` at zero marginal cost and surface both tools contextually. The `"web-domains"` group is the correct home for any future domain/URL/IP utility (DNS lookup, certificate viewer, etc.) — they go here, not in `diagnostics`. The group and tag are additive and backward-compatible; no existing tool or surface is affected.
