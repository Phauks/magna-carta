---
category: Changed
audience: internal
---

**The interface ships on its own Worker: the app's hostname is split by route pattern, and a UI
merge no longer has any reason to rebuild the API.**

The 2026-08-21 split design's two owner flags were answered and the cutover performed
(2026-08-31): the custom domain on `magna-carta` became route patterns on the zone —
`magna-carta-web` serves every path, `magna-carta` only `/api/*`, `/wopi/*`, `/search-objects/*`
and `/__dev/*`. Same origin, same cookie, no CORS; nothing auth-side moved. The decision, the one
deliberate departure from the design (the API Worker keeps its `assets` block as the local-dev
vehicle and one-gesture rollback — `wrangler dev` and the e2e suite serve the whole app from it),
and the accepted deploy-skew cost are recorded in the `the-interface-ships-on-its-own-worker` ADR.

In the repository, the change is mostly the record and one honest retirement: the version
overlay's page-versus-API "Different Builds" warning described a normal state once the two deploy
separately, so it is gone — the overlay's topology line explains why the rows may differ, and the
version poll's Update Available notice remains the one reload signal. The final decoupling lever
is dashboard state (dropping `apps/web/*` from the `magna-carta` project's Build Watch Paths) and
is tracked on the deploy queue.
