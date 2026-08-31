---
category: Fixed
audience: public
---

**Transient read faults retry instead of surfacing an Error ID.** Production logs showed the
docket's burst of parallel reads occasionally losing exactly one request to Better Auth's
"Failed to get session" APIError while its siblings resolved the same cookie in the same second —
and the screen behind that one request failing whole. `resolveSession` now re-asks through a
transient throw (two retries, 50/150ms; a null verdict is never retried), and the firm-database
proxy re-sends a READ whose Durable Object RPC failed with a `retryable` (and not `overloaded`)
error — on a fresh stub each time, because a broken RPC stub stays broken, and every merge to
`main` deploys and resets every live object. Writes never retry: their safety is the caller's
Idempotency-Key. The web shell also turns on SvelteKit hover preloading (`app.html`), so a matter's
data read starts when the pointer settles on its link rather than after the click.

## Public

**Fewer "Try again" moments, and matters open faster.** Occasionally a screen would refuse to load
with "The Docket Could Not Be Read" and an Error ID, then work on the very next try — that
momentary fault is now retried behind the scenes before you ever see it. Opening a matter also got
quicker: the page starts loading the instant your pointer settles on the link, not after the click.
