---
category: Fixed
audience: internal
---

**Both Worker configs said the application's hostname was unattached; it has been attached and serving all along.** `apps/api-worker/wrangler.jsonc` described its `workers.dev` URL as "the current public URL until magnacarta.esq attaches", and `apps/web-worker/wrangler.jsonc` said the single-page-application split was blocked because the cutover "needs a zone hostname the account does not have yet". A read of `GET /accounts/{account_id}/workers/domains/records` shows the apex bound to the `magna-carta` Worker as a custom domain, enabled, with `status.magnacarta.esq` beside it.

**The inference that produced it is the part worth keeping.** A custom domain is account state: it is attached in the dashboard, appears in no `wrangler.jsonc`, and `wrangler deploy` does not remove it. So a Worker carrying `workers_dev: true` with no `routes` block can be answering a real apex hostname, and "no routes in the config, therefore workers.dev only" is a conclusion the config cannot support. Both comments now say so, and point at the read rather than restating today's answer — the rule `docs/conventions/operations.md` opens with, after this repository disagreed with the live configuration four times.

The web Worker's blocker is restated rather than removed, because the split really is still blocked — for the other reason. A custom domain consumes the whole hostname, so the apex has to be converted to route patterns on the zone before two Workers can split it by path and before `magna-carta-web` can serve anyone. That is a mechanism, so it does not rot. The standing invariant survives unchanged: the app Worker's `assets` block stays until a live routing read shows the interface reaching users another way.

Comments only — no `run_worker_first`, `assets`, binding, var or trigger value changed.
