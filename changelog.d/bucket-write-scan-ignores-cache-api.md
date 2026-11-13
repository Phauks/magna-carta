---
category: Fixed
audience: internal
---

The bucket-write fitness scan now recognizes a Cache API `cache.put(…)` as not a bucket write, so the provider-roster edge cache no longer fails it.
