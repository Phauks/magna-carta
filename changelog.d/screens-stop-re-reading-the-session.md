---
category: Changed
audience: public
---

**Screens stop re-reading the session, and arriving at a matter read a moment ago is instant.** `readSession` (`apps/web/src/lib/matters/matters-api.ts`), which about forty-five surfaces call on mount, now answers from the one query cache under the same key the (app) guard fills on the way in (`meGetQueryKey`), at the session-stable ceiling. Each of those screens used to pay a full `/api/v1/me` round trip, in series, before its own read could start. `readSession(fetch, { fresh: true })` and `sessionPermissions.reread` skip the cache for the one write that changes the session under a screen (the Beta Branch switch). A refusal is never cached. The (app) guard drops the cached session before sending somebody to the joining screen, so their return with a firm is judged on a fresh answer rather than bounced back on the cached "no firm yet".

The `/matters/[id]` layout reads the matter through the cache at the record staleness (`readMatterRecord`, `apps/web/src/lib/matters/matter-record.ts`) when arriving, and from the server when the matter already on screen is re-read (`invalidateAll` after a status change or a renumbering). Recording where the paper file is kept drops the cached record. Home starts the Today card's reads from its route load, so the hover preload begins them before the click.

## Public

**Pages open faster, and show their loading placeholder less often.** Most screens no longer wait to re-check who you are before asking for their own data, and going back to a matter you just looked at opens it straight away.
