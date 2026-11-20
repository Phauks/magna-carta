---
number: 541
slug: google-places-is-the-only-address-engine
status: Accepted
date: 2026-11-20
area: Directory
summary: "Address autocomplete runs on Google Places alone, chosen by the owner on 2026-11-20 after a week's trial. The platform's own US index (the magna-carta-address Worker, its Containers, crates/address-core and the magna-carta-addresses bucket) and the Smarty adapter are removed, superseding the decisions that chose them; neither had been switched on. The owner chose this with the trade-offs laid out: Google's terms let a customer keep only a place ID while a chosen address is saved into the record, every typed address goes to Google, and the bill grows with volume, against one engine to run, every country covered and the addresses people expect to see."
---

**Address autocomplete runs on Google Places alone.**

**Context.** Two earlier decisions chose the engines: Smarty first, on storage terms
([`0496`](0496-address-autocomplete-runs-on-the-provider-that-lets-the-firm-keep-the-address.md)),
then the platform's own US index built monthly from OpenAddresses
([`0497`](0497-the-united-states-is-answered-from-the-platforms-own-address-index.md)). Neither was
ever switched on: Smarty had no account, and the own index waited on an R2 bucket and a Workers
Builds connection. On 2026-11-13 the owner asked to try Google first and decide afterwards whether the
own index was needed; the Google adapter went live from the Secrets Store. On 2026-11-20, shown the
choice between the own index for the United States beside Google, Google only, and waiting, the owner
chose Google only.

**Decision.**

- **One engine.** `apps/api-worker/src/address-lookup/address-lookup-engine.ts` hands every request
  the Google port while `GOOGLE_PLACES_API_KEY` is set, and the deferred port otherwise. The routed
  port that composed engines by country is gone with the engines it composed.
- **Removed:** `apps/address-worker`, `containers/address`, `crates/address-core`, the Smarty and
  self-hosted adapters in `packages/address-lookup`, the `ADDRESS_SERVICE` binding type and the
  Smarty secrets, the primary-office region bias (only the own index used it), and the
  `magna-carta-address` row on System Status.
- **Kept:** the port, the contract (its optional `near` stays, unused by Google, so the published
  API does not change shape), the deferred state, and the spec of the own index as a record.

**Consequences.**

- Google's storage terms remain an open question rather than a settled one: they allow keeping a
  place ID, and the record keeps the chosen parts. The runbook (operations, section 19) says so.
- Each pause in typing sends a client's partial address to Google, where the own index would have
  kept US addresses on the platform.
- Cost tracks volume: about nothing inside Google's free monthly caps at today's volume, roughly
  $300 a month at 20,000 addresses (`docs/operating-costs.md`).
- Reopening the own index means restoring the removed directories from history and reading the
  spec. As far as the repository records, nothing was created on the account to undo.
