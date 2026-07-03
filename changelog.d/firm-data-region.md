---
category: Added
---

**Firms now carry a `data_region` that pins their storage jurisdiction.** A new control-plane column
(`us` default, `eu` supported) is threaded through provisioning: an `eu` firm's R2 bucket is created
under Cloudflare's EU jurisdiction and its firm-database Durable Object is jurisdiction-capable, giving
a hard EU-residency guarantee. Set once at provisioning; no cross-region moves. `us` is North-America
placement; Canada is reserved.
