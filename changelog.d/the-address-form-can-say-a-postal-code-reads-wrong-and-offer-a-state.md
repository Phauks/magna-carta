---
category: Added
audience: internal
---

The address form can now say a postal code reads wrong, and can offer a country's states, provinces or counties.

It could do neither before. The per-country table it renders from is a curated shape — which boxes a country uses, what they are called, what order they read in — and it carried no postal-code patterns and no administrative-area lists. The feature ledger has held that as the open question since the form shipped.

`@magna-carta/address-formats` is the missing half: 252 countries projected from the address-internationalization corpus into 182 postal-code formats and 62 administrative-area lists, 1,619 areas in all. The corpus is checked in and refreshed by a deliberate act rather than fetched at build time, so no build depends on a third party being up and no postal rule changes under a release nobody made. The generator validates as well as renders — every pattern must compile anchored and every published example must match its own pattern — so a bad corpus breaks the build rather than the address form.

The constraints reach the component as optional props, the way the country list already does. That is not ceremony: the design system links exactly one workspace package by design and `AddressFields` is domain-blind, so importing a corpus into it would end that for every consumer to serve two screens.

A malformed code renders as the field's hint and never its error, so the box is never marked invalid and nothing can refuse a commit — a code can match its country's published format perfectly and still reach nobody. "This country publishes no postal format" stays a different answer from "this is wrong"; seventy of the 252 fall in the first case. The region field takes a native datalist rather than a combobox, because it is not a closed choice: a combobox settles back onto a listed value on close, which would destroy an address in a place no published list carries.

Alongside it, `@magna-carta/address-lookup` adds the autocomplete port with no engine behind it yet — `suggest` and `resolve`, typed outcomes that never throw, and a deferred implementation that reports `engine-not-implemented`, the same wired-but-dormant shape the discovery search index takes. A surface written against it degrades to exactly today's behaviour with no branch and no flag to remove later.

No provider is adopted and nothing calls out. No address leaves the firm's tenancy.
