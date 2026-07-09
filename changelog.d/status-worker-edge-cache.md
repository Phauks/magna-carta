---
category: Changed
---

**The status page is now served from an edge cache.** The public status page and its machine-readable feed are held at Cloudflare's edge for thirty seconds, so the traffic spike an incident brings is absorbed without invoking the status worker or reading its data store — the page's availability no longer depends on the availability of the one thing it reads. If that read starts failing, the edge keeps serving the last good page for up to ten minutes while retrying behind it, rather than immediately showing the bare "temporarily unavailable" stand-in. A newly published incident becomes visible within thirty seconds.
