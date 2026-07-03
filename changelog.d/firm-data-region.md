---
category: Added
---

**Firms now carry a `data_region` that pins their storage jurisdiction.** A new control-plane column
(`us` default, `eu` supported) is threaded through provisioning: an `eu` firm's R2 bucket — and its
object-create notification rules — are placed under Cloudflare's EU jurisdiction, and the firm-database
Durable Object addressor is made jurisdiction-capable. Wiring that capability to every data-access call
site is a follow-up activation step, so no firm is end-to-end EU-resident yet. Set once at provisioning;
no cross-region moves. `us` is North-America placement; Canada is reserved.
