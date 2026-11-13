---
category: Fixed
audience: internal
---

The build-info overlay now lists the community board worker (`magna-carta-community`), so its row reads "unbound" until that worker is bound, and the fleet-roster test passes again.

The bucket-write fitness scan now recognizes a Cache API `cache.put(…)` as not a bucket write, so the provider-roster edge cache no longer fails it.
